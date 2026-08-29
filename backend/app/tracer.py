import re
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any, Set

from app.models import (
    CompileRequest,
    TraceResponse,
    TraceStep,
    VariableData,
    StackFrame,
    ParsedError,
)
from app.toolchain import Toolchain, ToolchainNotFoundException, run_command
from app.compiler import parse_clang_errors, sanitize_path


def detect_program_structure(code: str) -> str:
    """
    Detects program type based on AST / source code patterns.
    """
    code_lower = code.lower()
    if any(k in code_lower for k in ["push(", "pop(", "top", "stack[", "struct stack"]):
        return "stack"
    if re.search(r"\b[a-zA-Z_][a-zA-Z0-9_]*\s*\[\s*\d*\s*\]", code):
        return "array"
    if re.search(r"\b(int|char|float|double|void)\s*\*+\s*[a-zA-Z_]", code) or "&" in code:
        return "pointer"
    if any(k in code_lower for k in ["for (", "for(", "while (", "while(", "do {"]):
        return "loop"
    return "general"


def parse_variable_data(raw_var_lines: List[str]) -> List[VariableData]:
    """
    Parses LLDB frame variable -T -L lines into structured VariableData objects.
    """
    variables: List[VariableData] = []
    current_array: Optional[VariableData] = None

    # Line format: 0x00007fffffffe200: (int[5]) arr = {
    # Line format: 0x00007fffffffe200:   (int) [0] = 10
    # Line format: 0x00007fffffffe1fc: (int) sum = 0
    # Line format: 0x00007fffffffe1f0: (int *) ptr = 0x00007fffffffe1fc
    
    var_re = re.compile(
        r"^(?:(?P<addr>0x[0-9a-fA-F]+):\s+)?(?P<indent>\s*)\((?P<type>[^)]+)\)\s+(?P<name>[a-zA-Z0-9_\[\]]+)\s*=\s*(?P<val>.+)$"
    )

    for line in raw_var_lines:
        line = line.strip()
        if not line or line in ("{", "}"):
            continue

        match = var_re.match(line)
        if match:
            d = match.groupdict()
            addr = d["addr"]
            v_type = d["type"].strip()
            v_name = d["name"].strip()
            v_val = d["val"].strip().rstrip(",")

            # Check if this is an array header: (int[5]) arr = {
            if "[" in v_type and "]" in v_type and not v_name.startswith("["):
                current_array = VariableData(
                    name=v_name,
                    type=v_type,
                    value=v_val,
                    address=addr,
                    is_array=True,
                    array_elements=[],
                )
                variables.append(current_array)
                continue

            # Check if this is an array element inside array header: (int) [0] = 10
            if current_array and v_name.startswith("[") and v_name.endswith("]"):
                idx_str = v_name[1:-1]
                if idx_str.isdigit():
                    current_array.array_elements.append({
                        "index": int(idx_str),
                        "value": v_val,
                        "address": addr,
                        "type": v_type,
                    })
                continue

            # Reset array context if no longer inside array
            current_array = None

            # Check if pointer type
            is_ptr = "*" in v_type or "0x" in v_val
            variables.append(
                VariableData(
                    name=v_name,
                    type=v_type,
                    value=v_val,
                    address=addr,
                    is_pointer=is_ptr,
                    pointed_address=v_val if is_ptr and "0x" in v_val else None,
                )
            )

    return variables


def run_lldb_trace(request: CompileRequest) -> TraceResponse:
    try:
        toolchain = Toolchain.detect()
    except ToolchainNotFoundException as exc:
        return TraceResponse(
            success=False,
            code=request.code,
            filename=request.filename,
            total_steps=0,
            errors=[ParsedError(type="error", message=str(exc), filename=request.filename)],
        )

    orig_filename = Path(request.filename).name or "main.c"
    base_name = Path(orig_filename).stem or "main"
    src_file = f"{base_name}.c"

    is_wsl = toolchain.clang_cmd[0].lower().endswith("wsl") or toolchain.clang_cmd[0].lower().endswith("wsl.exe")
    exe_file = f"{base_name}.exe" if (sys.platform == "win32" and not is_wsl) else base_name

    detected_type = detect_program_structure(request.code)
    code_lines = request.code.splitlines()

    # Determine stdin input
    stdin_data = request.stdin_input or ""
    if not stdin_data and request.sample_output:
        # Extract numbers or words from sample output if user provided sample output
        numbers = re.findall(r"\d+", request.sample_output)
        if numbers:
            stdin_data = " ".join(numbers) + "\n"

    with tempfile.TemporaryDirectory(prefix="codexray_trace_", ignore_cleanup_errors=True) as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)
        src_path = tmp_dir / src_file

        src_path.write_text(request.code, encoding="utf-8")

        # 1. Compile with -g -O0
        cmd_compile = [*toolchain.clang_cmd, "-g", "-O0", src_file, "-o", exe_file]
        c_code, out, err, _ = run_command(cmd_compile, cwd=tmp_dir, timeout=10.0)

        if c_code != 0 or not (tmp_dir / exe_file).exists():
            clean_err = sanitize_path(err or out, tmp_dir)
            parsed_errs = parse_clang_errors(clean_err, src_file)
            return TraceResponse(
                success=False,
                code=request.code,
                filename=orig_filename,
                total_steps=0,
                errors=parsed_errs,
            )

        # 2. Build LLDB Stepping Batch Script
        lldb_cmds = ["-o", "b main", "-o", "r"]
        
        # Issue up to 25 step commands
        max_steps = 25
        for _ in range(max_steps):
            lldb_cmds.extend([
                "-o", "frame variable -L -T",
                "-o", "register read rsp rbp rip",
                "-o", "step"
            ])

        if is_wsl:
            posix_path = tmp_dir.as_posix()
            cmd_lldb = [
                toolchain.clang_cmd[0],
                "bash",
                "-c",
                f"cd \"$(wslpath '{posix_path}')\" && lldb -b " + " ".join([f"'{flag}'" for flag in lldb_cmds]) + " ./" + exe_file
            ]
        else:
            cmd_lldb = ["lldb", "-b", *lldb_cmds, f"./{exe_file}"]

        code, lldb_out, lldb_err, _ = run_command(cmd_lldb, cwd=tmp_dir, timeout=12.0, input_data=stdin_data)

        # 3. Parse Stepping Output Blocks
        # Splitting stdout by "(lldb) step" or "Process stopped"
        step_blocks = re.split(r"\(lldb\)\s+step\s*", lldb_out)
        trace_steps: List[TraceStep] = []
        cumulative_stdout = ""

        # Extract line numbers and code text at each step
        line_re = re.compile(rf"{re.escape(src_file)}:(?P<line>\d+)(?::(?P<col>\d+))?", re.MULTILINE)
        
        step_counter = 1
        last_line = -1

        for block in step_blocks:
            line_match = line_re.search(block)
            if not line_match:
                continue

            current_line = int(line_match.group("line"))
            if current_line == last_line and len(trace_steps) > 0:
                continue
            last_line = current_line

            line_code_text = (
                code_lines[current_line - 1].strip()
                if 1 <= current_line <= len(code_lines)
                else ""
            )

            # Parse frame variables
            var_lines = block.splitlines()
            parsed_vars = parse_variable_data(var_lines)

            # Parse registers
            reg_dict: Dict[str, str] = {}
            reg_re = re.compile(r"^\s*(?P<reg>rsp|rbp|rip|rax|rbx|rcx|rdx)\s*=\s*(?P<val>0x[0-9a-fA-F]+)", re.MULTILINE)
            for rm in reg_re.finditer(block):
                rd = rm.groupdict()
                reg_dict[rd["reg"].upper()] = rd["val"]

            trace_steps.append(
                TraceStep(
                    step_number=step_counter,
                    current_line=current_line,
                    line_code=line_code_text,
                    function="main",
                    filename=orig_filename,
                    variables=parsed_vars,
                    stack_frames=[
                        StackFrame(
                            index=0,
                            function="main",
                            filename=orig_filename,
                            line=current_line,
                            variables=parsed_vars,
                        )
                    ],
                    registers=reg_dict,
                    stdout=cumulative_stdout,
                    detected_type=detected_type,  # type: ignore
                )
            )
            step_counter += 1

        # Also run direct execution to capture full stdout
        if is_wsl:
            posix_path = tmp_dir.as_posix()
            cmd_exec = [
                toolchain.clang_cmd[0],
                "bash",
                "-c",
                f"cd \"$(wslpath '{posix_path}')\" && ./{exe_file}"
            ]
        else:
            cmd_exec = [str(tmp_dir / exe_file)]

        _, full_stdout, _, _ = run_command(cmd_exec, cwd=tmp_dir, timeout=5.0, input_data=stdin_data)
        clean_full_stdout = sanitize_path(full_stdout, tmp_dir)

        # Update stdout in trace steps
        if trace_steps:
            trace_steps[-1].stdout = clean_full_stdout

        return TraceResponse(
            success=True,
            code=request.code,
            filename=orig_filename,
            total_steps=len(trace_steps),
            detected_program_type=detected_type,  # type: ignore
            steps=trace_steps,
            errors=[],
            output=clean_full_stdout,
        )
