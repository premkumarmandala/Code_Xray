import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from app.models import CompileRequest, CompileResponse, StageResult, ParsedError
from app.toolchain import Toolchain, ToolchainNotFoundException, run_command


def parse_clang_errors(stderr_text: str, filename: str) -> List[ParsedError]:
    """
    Extracts structured error/warning information from Clang output.
    """
    errors: List[ParsedError] = []
    pattern = re.compile(
        r"^(?P<filename>[^:\n]+):(?P<line>\d+):(?P<column>\d+):\s+(?P<type>error|warning|note):\s+(?P<message>.+)$",
        re.MULTILINE,
    )

    for match in pattern.finditer(stderr_text):
        data = match.groupdict()
        errors.append(
            ParsedError(
                type=data["type"],  # type: ignore
                message=data["message"].strip(),
                filename=Path(data["filename"]).name,
                line=int(data["line"]),
                column=int(data["column"]),
            )
        )

    if not errors and stderr_text.strip():
        for line in stderr_text.splitlines():
            if "error:" in line.lower() or "fatal" in line.lower():
                errors.append(
                    ParsedError(
                        type="error",
                        message=line.strip(),
                        filename=filename,
                    )
                )

    return errors


def sanitize_path(text: str, temp_dir: Path) -> str:
    """
    Strips temporary directory absolute paths from output strings cross-platform.
    """
    if not text:
        return ""
    str_posix = temp_dir.as_posix()
    str_native = str(temp_dir)

    sanitized = text
    for p in {str_posix, str_native}:
        if p:
            sanitized = (
                sanitized.replace(p + "/", "")
                .replace(p + "\\", "")
                .replace(p, "")
            )
    return sanitized


def get_file_size(file_path: Path) -> Optional[int]:
    if file_path.exists() and file_path.is_file():
        return file_path.stat().st_size
    return None


def run_pipeline(request: CompileRequest) -> CompileResponse:
    # 1. Toolchain Verification
    try:
        toolchain = Toolchain.detect()
    except ToolchainNotFoundException as exc:
        return CompileResponse(
            success=False,
            filename=request.filename,
            base_name=Path(request.filename).stem,
            stages={},
            errors=[
                ParsedError(
                    type="error",
                    message=str(exc),
                    filename=request.filename,
                )
            ],
            output="",
        )

    # 2. Setup Filenames & Extensions
    orig_filename = Path(request.filename).name or "main.c"
    base_name = Path(orig_filename).stem or "main"
    
    src_file = f"{base_name}.c"
    i_file = f"{base_name}.i"
    ll_file = f"{base_name}.ll"
    s_file = f"{base_name}.s"
    o_file = f"{base_name}.o"
    
    # Executable naming
    is_wsl_mode = toolchain.clang_cmd[0].lower().endswith("wsl") or toolchain.clang_cmd[0].lower().endswith("wsl.exe")
    exe_file = f"{base_name}.exe" if (sys.platform == "win32" and not is_wsl_mode) else base_name

    stages_dict: Dict[str, StageResult] = {}
    collected_errors: List[ParsedError] = []
    execution_output = ""
    pipeline_success = True

    stage_names = [
        "source",
        "preprocessing",
        "llvm_ir",
        "assembly",
        "object_code",
        "linking",
        "execution",
    ]

    for s_name in stage_names:
        stages_dict[s_name] = StageResult(
            stage=s_name,
            status="skipped",
            input_file="",
            output_file="",
        )

    with tempfile.TemporaryDirectory(prefix="codexray_", ignore_cleanup_errors=True) as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)

        # STAGE 1: SOURCE
        src_path = tmp_dir / src_file
        try:
            src_path.write_text(request.code, encoding="utf-8")
            stages_dict["source"] = StageResult(
                stage="source",
                status="success",
                input_file=src_file,
                output_file=src_file,
                content=request.code,
                duration_ms=1.0,
                file_size=get_file_size(src_path),
                command=[],
            )
        except Exception as exc:
            stages_dict["source"] = StageResult(
                stage="source",
                status="error",
                input_file=src_file,
                output_file=src_file,
                stderr=f"Failed to write source file: {str(exc)}",
            )
            return CompileResponse(
                success=False,
                filename=orig_filename,
                base_name=base_name,
                stages=stages_dict,
                errors=[ParsedError(type="error", message=str(exc), filename=src_file)],
                output="",
            )

        def fail_pipeline(stage_key: str, in_file: str, out_file: str, cmd_display: List[str], exit_code: int, stdout: str, stderr: str, duration_ms: float):
            nonlocal pipeline_success
            pipeline_success = False
            clean_stderr = sanitize_path(stderr, tmp_dir)
            clean_stdout = sanitize_path(stdout, tmp_dir)
            parsed = parse_clang_errors(clean_stderr, in_file)
            collected_errors.extend(parsed)

            stages_dict[stage_key] = StageResult(
                stage=stage_key,
                status="error",
                input_file=in_file,
                output_file=out_file,
                stdout=clean_stdout,
                stderr=clean_stderr,
                exit_code=exit_code,
                duration_ms=duration_ms,
                command=cmd_display,
            )

        # STAGE 2: PREPROCESSING (clang -E)
        cmd_prep = [*toolchain.clang_cmd, "-E", src_file, "-o", i_file]
        cmd_prep_display = ["clang", "-E", src_file, "-o", i_file]
        code, out, err, dur = run_command(cmd_prep, cwd=tmp_dir, timeout=10.0)

        i_path = tmp_dir / i_file
        if code == 0 and i_path.exists():
            content_i = i_path.read_text(encoding="utf-8", errors="replace")
            stages_dict["preprocessing"] = StageResult(
                stage="preprocessing",
                status="success",
                input_file=src_file,
                output_file=i_file,
                content=content_i,
                stdout=sanitize_path(out, tmp_dir),
                stderr=sanitize_path(err, tmp_dir),
                exit_code=code,
                duration_ms=dur,
                file_size=get_file_size(i_path),
                command=cmd_prep_display,
            )
        else:
            fail_pipeline("preprocessing", src_file, i_file, cmd_prep_display, code, out, err, dur)
            return CompileResponse(
                success=False,
                filename=orig_filename,
                base_name=base_name,
                stages=stages_dict,
                errors=collected_errors,
                output="",
            )

        # STAGE 3: LLVM IR (clang -S -emit-llvm)
        cmd_ir = [*toolchain.clang_cmd, "-S", "-emit-llvm", i_file, "-o", ll_file]
        cmd_ir_display = ["clang", "-S", "-emit-llvm", i_file, "-o", ll_file]
        code, out, err, dur = run_command(cmd_ir, cwd=tmp_dir, timeout=10.0)

        ll_path = tmp_dir / ll_file
        if code == 0 and ll_path.exists():
            content_ll = ll_path.read_text(encoding="utf-8", errors="replace")
            stages_dict["llvm_ir"] = StageResult(
                stage="llvm_ir",
                status="success",
                input_file=i_file,
                output_file=ll_file,
                content=content_ll,
                stdout=sanitize_path(out, tmp_dir),
                stderr=sanitize_path(err, tmp_dir),
                exit_code=code,
                duration_ms=dur,
                file_size=get_file_size(ll_path),
                command=cmd_ir_display,
            )
        else:
            fail_pipeline("llvm_ir", i_file, ll_file, cmd_ir_display, code, out, err, dur)
            return CompileResponse(
                success=False,
                filename=orig_filename,
                base_name=base_name,
                stages=stages_dict,
                errors=collected_errors,
                output="",
            )

        # STAGE 4: ASSEMBLY (clang -S)
        cmd_asm = [*toolchain.clang_cmd, "-S", ll_file, "-o", s_file]
        cmd_asm_display = ["clang", "-S", ll_file, "-o", s_file]
        code, out, err, dur = run_command(cmd_asm, cwd=tmp_dir, timeout=10.0)

        s_path = tmp_dir / s_file
        if code == 0 and s_path.exists():
            content_s = s_path.read_text(encoding="utf-8", errors="replace")
            stages_dict["assembly"] = StageResult(
                stage="assembly",
                status="success",
                input_file=ll_file,
                output_file=s_file,
                content=content_s,
                stdout=sanitize_path(out, tmp_dir),
                stderr=sanitize_path(err, tmp_dir),
                exit_code=code,
                duration_ms=dur,
                file_size=get_file_size(s_path),
                command=cmd_asm_display,
            )
        else:
            fail_pipeline("assembly", ll_file, s_file, cmd_asm_display, code, out, err, dur)
            return CompileResponse(
                success=False,
                filename=orig_filename,
                base_name=base_name,
                stages=stages_dict,
                errors=collected_errors,
                output="",
            )

        # STAGE 5: OBJECT CODE (clang -c)
        cmd_obj = [*toolchain.clang_cmd, "-c", s_file, "-o", o_file]
        cmd_obj_display = ["clang", "-c", s_file, "-o", o_file]
        code, out, err, dur = run_command(cmd_obj, cwd=tmp_dir, timeout=10.0)

        o_path = tmp_dir / o_file
        if code == 0 and o_path.exists():
            disassembly_text = ""
            if toolchain.objdump_cmd:
                cmd_dump = [*toolchain.objdump_cmd, "-d", o_file]
                d_code, d_out, d_err, _ = run_command(cmd_dump, cwd=tmp_dir, timeout=5.0)
                if d_code == 0:
                    disassembly_text = sanitize_path(d_out, tmp_dir)
                else:
                    disassembly_text = f"[Disassembly notice: {sanitize_path(d_err, tmp_dir)}]"

            representation_data = {
                "format": "Relocatable Object File",
                "disassembly": disassembly_text or "[Disassembly representation generated from binary object file]",
                "file_size_bytes": get_file_size(o_path),
            }

            stages_dict["object_code"] = StageResult(
                stage="object_code",
                status="success",
                input_file=s_file,
                output_file=o_file,
                content=None,
                representation=representation_data,
                stdout=sanitize_path(out, tmp_dir),
                stderr=sanitize_path(err, tmp_dir),
                exit_code=code,
                duration_ms=dur,
                file_size=get_file_size(o_path),
                command=cmd_obj_display,
            )
        else:
            fail_pipeline("object_code", s_file, o_file, cmd_obj_display, code, out, err, dur)
            return CompileResponse(
                success=False,
                filename=orig_filename,
                base_name=base_name,
                stages=stages_dict,
                errors=collected_errors,
                output="",
            )

        # STAGE 6: LINKING (clang o_file -o exe_file)
        cmd_link = [*toolchain.clang_cmd, o_file, "-o", exe_file]
        cmd_link_display = ["clang", o_file, "-o", exe_file]
        code, out, err, dur = run_command(cmd_link, cwd=tmp_dir, timeout=10.0)

        exe_path = tmp_dir / exe_file
        if code == 0 and exe_path.exists():
            link_info = (
                f"Successfully linked '{o_file}' into executable '{exe_file}'.\n"
                f"Binary size: {get_file_size(exe_path)} bytes."
            )
            stages_dict["linking"] = StageResult(
                stage="linking",
                status="success",
                input_file=o_file,
                output_file=exe_file,
                content=link_info,
                stdout=sanitize_path(out, tmp_dir),
                stderr=sanitize_path(err, tmp_dir),
                exit_code=code,
                duration_ms=dur,
                file_size=get_file_size(exe_path),
                command=cmd_link_display,
            )
        else:
            fail_pipeline("linking", o_file, exe_file, cmd_link_display, code, out, err, dur)
            return CompileResponse(
                success=False,
                filename=orig_filename,
                base_name=base_name,
                stages=stages_dict,
                errors=collected_errors,
                output="",
            )

        # STAGE 7: EXECUTION
        if is_wsl_mode:
            wsl_posix_path = tmp_dir.as_posix()
            cmd_exec = [
                toolchain.clang_cmd[0],
                "bash",
                "-c",
                f"cd \"$(wslpath '{wsl_posix_path}')\" && ./{exe_file}"
            ]
        else:
            cmd_exec = [str(exe_path)]

        cmd_exec_display = [f"./{exe_file}"]
        
        exec_timeout = min(max(request.timeout, 0.5), 30.0)
        code, out, err, dur = run_command(cmd_exec, cwd=tmp_dir, timeout=exec_timeout)

        clean_stdout = sanitize_path(out, tmp_dir)
        clean_stderr = sanitize_path(err, tmp_dir)
        execution_output = clean_stdout if clean_stdout else clean_stderr

        # Format complete execution summary with stdout, stderr, and exit code
        exec_summary_lines = []
        if clean_stdout:
            exec_summary_lines.append("=== Program Standard Output (stdout) ===")
            exec_summary_lines.append(clean_stdout.rstrip("\r\n"))
        if clean_stderr:
            exec_summary_lines.append("=== Program Standard Error (stderr) ===")
            exec_summary_lines.append(clean_stderr.rstrip("\r\n"))

        if not exec_summary_lines:
            exec_summary_lines.append("=== Program Execution ===")
            exec_summary_lines.append("[Process executed successfully and produced no standard output]")

        exec_summary_lines.append("\n=== Process Metadata ===")
        exec_summary_lines.append(f"Exit Code: {code}")
        exec_summary_lines.append(f"Execution Time: {dur} ms")

        display_content = "\n".join(exec_summary_lines)

        if code == 0:
            stages_dict["execution"] = StageResult(
                stage="execution",
                status="success",
                input_file=exe_file,
                output_file="stdout",
                content=display_content,
                stdout=clean_stdout,
                stderr=clean_stderr,
                exit_code=code,
                duration_ms=dur,
                file_size=None,
                command=cmd_exec_display,
            )
        else:
            fail_pipeline("execution", exe_file, "stdout", cmd_exec_display, code, out, err, dur)

    return CompileResponse(
        success=pipeline_success,
        filename=orig_filename,
        base_name=base_name,
        stages=stages_dict,
        errors=collected_errors,
        output=execution_output,
    )
