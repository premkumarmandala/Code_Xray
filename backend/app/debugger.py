import re
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set

from app.models import CompileRequest, CallStackResponse, CallStackFrame, CallStackVariable
from app.toolchain import Toolchain, ToolchainNotFoundException, run_command


def get_type_size(type_str: str) -> Optional[int]:
    """
    Determines memory size in bytes from type string. Returns null if unknown.
    """
    t = type_str.strip().lower()
    if t in ("int", "signed int", "unsigned int"):
        return 4
    if t in ("short", "short int", "unsigned short"):
        return 2
    if t in ("char", "signed char", "unsigned char"):
        return 1
    if t in ("long", "long int", "double", "long long"):
        return 8
    if t == "float":
        return 4
    if "*" in t:
        return 8
    # Match array e.g. int[5] -> 5 * 4 = 20
    m = re.search(r"^([a-z0-9_]+)\[(\d+)\]$", t)
    if m:
        base_t, size = m.groups()
        base_size = get_type_size(base_t)
        if base_size:
            return base_size * int(size)
    return None


def parse_registers(lldb_stdout: str) -> Dict[str, str]:
    """
    Parses LLDB register read output into a dictionary of register name -> value string.
    """
    registers: Dict[str, str] = {}
    reg_re = re.compile(r"^\s*([a-zA-Z0-9_]+)\s*=\s*(0x[0-9a-fA-F]+|\d+)", re.MULTILINE)
    for m in reg_re.finditer(lldb_stdout):
        reg_name, reg_val = m.groups()
        registers[reg_name.lower()] = reg_val
    return registers


def parse_callstack_output(lldb_stdout: str) -> Tuple[List[CallStackFrame], Dict[str, str]]:
    """
    Parses LLDB backtrace, frame variables, and CPU registers into structured CallStackFrame objects and registers dict.
    All values come from actual LLDB session output without fabrication or placeholders.
    """
    frames: List[CallStackFrame] = []
    seen_indices: Set[int] = set()

    # Extract thread backtrace block
    bt_section = lldb_stdout
    bt_match = re.search(r"\(lldb\)\s+thread\s+backtrace\s*\n(.*?)(?=\(lldb\)|\Z)", lldb_stdout, re.DOTALL)
    if bt_match:
        bt_section = bt_match.group(1)

    # Regex: frame #0: 0x000055555555514a main`add(a=10, b=20) at main.c:4:18
    frame_re = re.compile(
        r"frame\s+#(?P<index>\d+):\s+(?P<address>0x[0-9a-fA-F]+)\s+[^`]*`(?P<func>[^\s(]+)(?:\(.*?\))?\s+at\s+(?P<file>[^:\n]+):(?P<line>\d+)(?::(?P<col>\d+))?",
        re.MULTILINE
    )

    for m in frame_re.finditer(bt_section):
        d = m.groupdict()
        idx = int(d["index"])
        func = d["func"]
        filename = Path(d["file"]).name
        line = int(d["line"])
        address = d.get("address")

        # Filter out C runtime initialization frames
        if idx in seen_indices or func.startswith("__") or "libc" in filename.lower():
            continue

        seen_indices.add(idx)
        frames.append(
            CallStackFrame(
                frame_number=idx,
                function=func,
                file=filename,
                line=line,
                address=address,
                variables=[]
            )
        )

    # Parse Frame Variables per "frame select <N>" block
    frame_blocks = re.split(r"\(lldb\)\s+frame\s+select\s+(\d+)", lldb_stdout)
    var_re = re.compile(
        r"^(?:(?P<addr>0x[0-9a-fA-F]+):\s+)?\((?P<type>[^)]+)\)\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?P<val>.+)$",
        re.MULTILINE
    )

    for i in range(1, len(frame_blocks), 2):
        frame_idx = int(frame_blocks[i])
        block_content = frame_blocks[i + 1]

        target_f = next((f for f in frames if f.frame_number == frame_idx), None)
        if target_f:
            f_vars: List[CallStackVariable] = []
            for vm in var_re.finditer(block_content):
                vd = vm.groupdict()
                v_type = vd["type"].strip()
                f_vars.append(
                    CallStackVariable(
                        name=vd["name"].strip(),
                        type=v_type,
                        value=vd["val"].strip(),
                        address=vd["addr"] if vd["addr"] else None,
                        size_bytes=get_type_size(v_type)
                    )
                )
            target_f.variables = f_vars

    registers = parse_registers(lldb_stdout)
    return frames, registers


def debug_callstack(request: CompileRequest) -> CallStackResponse:
    try:
        toolchain = Toolchain.detect()
    except ToolchainNotFoundException as exc:
        return CallStackResponse(success=False, errors=[str(exc)])

    orig_filename = Path(request.filename).name or "main.c"
    base_name = Path(orig_filename).stem or "main"
    src_file = f"{base_name}.c"
    
    is_wsl = toolchain.clang_cmd[0].lower().endswith("wsl") or toolchain.clang_cmd[0].lower().endswith("wsl.exe")
    exe_file = f"{base_name}.exe" if (sys.platform == "win32" and not is_wsl) else base_name

    with tempfile.TemporaryDirectory(prefix="codexray_debug_", ignore_cleanup_errors=True) as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)
        src_path = tmp_dir / src_file

        # Write C source code
        src_path.write_text(request.code, encoding="utf-8")

        # 1. Compile with -g -O0 (debug symbols & zero optimizations)
        cmd_compile = [*toolchain.clang_cmd, "-g", "-O0", src_file, "-o", exe_file]
        code, out, err, _ = run_command(cmd_compile, cwd=tmp_dir, timeout=10.0)

        if code != 0 or not (tmp_dir / exe_file).exists():
            return CallStackResponse(
                success=False,
                errors=[f"Compilation error: {err or out}"]
            )

        # 2. Extract function names to set breakpoints
        functions = re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{", request.code)
        target_funcs = [fn for fn in functions if fn not in ("if", "for", "while", "switch")]
        if "main" not in target_funcs:
            target_funcs.append("main")

        non_main_funcs = [f for f in target_funcs if f != "main"]
        break_target = non_main_funcs[0] if non_main_funcs else "main"

        # First LLDB run: get thread backtrace to discover all frame numbers
        lldb_bt_flags = [
            "-o", f"b {break_target}",
            "-o", "r",
            "-o", "thread backtrace"
        ]

        if is_wsl:
            posix_path = tmp_dir.as_posix()
            cmd_bt = [
                toolchain.clang_cmd[0],
                "bash",
                "-c",
                f"cd \"$(wslpath '{posix_path}')\" && lldb -b " + " ".join([f"'{flag}'" for flag in lldb_bt_flags]) + " ./" + exe_file
            ]
        else:
            cmd_bt = ["lldb", "-b", *lldb_bt_flags, f"./{exe_file}"]

        _, bt_out, _, _ = run_command(cmd_bt, cwd=tmp_dir, timeout=10.0)
        frames_init, _ = parse_callstack_output(bt_out)

        # Second LLDB run: select every discovered frame and get variables and registers
        lldb_o_flags = [
            "-o", f"b {break_target}",
            "-o", "r",
            "-o", "thread backtrace",
            "-o", "register read rsp rbp rip rax rbx rcx rdx rsi rdi"
        ]

        frame_indices = [f.frame_number for f in frames_init] if frames_init else range(5)
        for f_idx in frame_indices:
            lldb_o_flags.extend(["-o", f"frame select {f_idx}"])
            lldb_o_flags.extend(["-o", "frame variable -L -T"])

        if is_wsl:
            cmd_lldb = [
                toolchain.clang_cmd[0],
                "bash",
                "-c",
                f"cd \"$(wslpath '{posix_path}')\" && lldb -b " + " ".join([f"'{flag}'" for flag in lldb_o_flags]) + " ./" + exe_file
            ]
        else:
            cmd_lldb = ["lldb", "-b", *lldb_o_flags, f"./{exe_file}"]

        code, lldb_out, lldb_err, _ = run_command(cmd_lldb, cwd=tmp_dir, timeout=10.0)

        frames, registers = parse_callstack_output(lldb_out)

        if not frames:
            return CallStackResponse(
                success=False,
                errors=["LLDB debugging session finished but no active frames were captured."]
            )

        return CallStackResponse(
            success=True,
            frames=frames,
            registers=registers,
            errors=[]
        )
