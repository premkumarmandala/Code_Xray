from pathlib import Path
from app.compiler import parse_clang_errors, sanitize_path
from app.models import CompileRequest


def test_parse_clang_errors():
    stderr = "sum.c:7:12: error: use of undeclared identifier 'x'\nsum.c:10:5: warning: implicit declaration"
    errors = parse_clang_errors(stderr, "sum.c")
    assert len(errors) == 2
    assert errors[0].type == "error"
    assert errors[0].filename == "sum.c"
    assert errors[0].line == 7
    assert errors[0].column == 12
    assert errors[0].message == "use of undeclared identifier 'x'"
    assert errors[1].type == "warning"


def test_sanitize_path():
    temp_dir = Path("/tmp/codexray_12345")
    raw_text = "/tmp/codexray_12345/sum.c:7:12: error: failed in /tmp/codexray_12345/sum.c"
    clean = sanitize_path(raw_text, temp_dir)
    assert "/tmp/codexray_12345" not in clean
    assert "sum.c:7:12: error: failed in sum.c" in clean


def test_compile_request_defaults():
    req = CompileRequest(code="int main() { return 0; }")
    assert req.filename == "main.c"
    assert req.timeout == 5.0
