import pytest
from app.models import CompileRequest
from app.compiler import run_pipeline
from app.toolchain import Toolchain, ToolchainNotFoundException


def test_full_pipeline_with_installed_clang():
    try:
        toolchain = Toolchain.detect()
    except ToolchainNotFoundException:
        pytest.skip("Clang toolchain not installed on test runner PATH")

    req = CompileRequest(
        code="#include <stdio.h>\nint main() { printf(\"CodeXRay Test\\n\"); return 0; }",
        filename="test_calc.c",
        timeout=3.0
    )

    res = run_pipeline(req)
    assert res.success is True
    assert res.filename == "test_calc.c"
    assert res.base_name == "test_calc"
    assert "source" in res.stages
    assert "preprocessing" in res.stages
    assert "llvm_ir" in res.stages
    assert "assembly" in res.stages
    assert "object_code" in res.stages
    assert "linking" in res.stages
    assert "execution" in res.stages

    # Verify stage output files match base name
    assert res.stages["preprocessing"].output_file == "test_calc.i"
    assert res.stages["llvm_ir"].output_file == "test_calc.ll"
    assert res.stages["assembly"].output_file == "test_calc.s"
    assert res.stages["object_code"].output_file == "test_calc.o"

    # Verify object code is not raw binary content but representation
    assert res.stages["object_code"].content is None
    assert res.stages["object_code"].representation is not None

    # Verify duration and file size metadata
    assert res.stages["preprocessing"].duration_ms > 0
    assert res.stages["preprocessing"].file_size is not None

    # Verify execution output
    assert "CodeXRay Test" in res.output


def test_compilation_error_handling():
    try:
        toolchain = Toolchain.detect()
    except ToolchainNotFoundException:
        pytest.skip("Clang toolchain not installed on test runner PATH")

    # Invalid C code missing semicolon
    req = CompileRequest(
        code="int main() { int x = 5 return 0; }",
        filename="err.c"
    )

    res = run_pipeline(req)
    assert res.success is False
    assert len(res.errors) > 0
    assert res.stages["preprocessing"].status == "success" or res.stages["source"].status == "success"
    # Stage where failure occurs should be error
    failing_stage = [s for s in res.stages.values() if s.status == "error"]
    assert len(failing_stage) == 1
    # Subsequent stages should be skipped
    skipped_stages = [s for s in res.stages.values() if s.status == "skipped"]
    assert len(skipped_stages) > 0
