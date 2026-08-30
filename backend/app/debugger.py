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
    Parses LLDB backtrace sections, frame variables, and CPU registers into structured CallStackFrame objects.
    Captures all user function frames across execution steps and maps variables per frame.
    """
    frames_map: Dict[str, CallStackFrame] = {}

    # Extract all thread backtrace blocks in output
    bt_blocks = re.findall(r"\(lldb\)\s+thread\s+backtrace\s*\n(.*?)(?=\(lldb\)|\Z)", lldb_stdout, re.DOTALL)
    if not bt_blocks:
        bt_blocks = [lldb_stdout]

    # Robust regex for LLDB frame headers across all LLDB version formats
    frame_re = re.compile(
        r"frame\s+#(?P<index>\d+):\s+(?P<address>0x[0-9a-fA-F]+)\s+(?:[^\n`]+`(?P<func>[^\s(]+)|(?P<func2>[^\s(]+))(?:(?:\(.*?\))?)?(?:\s+at\s+(?P<file>[^:\n]+):(?P<line>\d+)(?::(?P<col>\d+))?)?",
        re.MULTILINE
    )

    # Process all backtrace blocks to discover all user frames
    for block in bt_blocks:
        for m in frame_re.finditer(block):
            d = m.groupdict()
            func = d["func"] or d.get("func2") or "unknown"
            raw_file = d.get("file")
            filename = Path(raw_file).name if raw_file else "main.c"
            line = int(d["line"]) if d.get("line") else 1
            address = d.get("address")

            # Filter out C runtime initialization frames
            if (
                (func.startswith("_") and func != "main") or 
                "libc" in filename.lower() or 
                "crt" in filename.lower() or
                func in ("_start", "start", "__libc_start_main", "main_seh")
            ):
                continue

            if func not in frames_map:
                frames_map[func] = CallStackFrame(
                    frame_number=len(frames_map),
                    function=func,
                    file=filename,
                    line=line,
                    address=address,
                    variables=[]
                )

    frames = list(frames_map.values())

    # Regex for variable output lines
    var_re = re.compile(
        r"^(?:(?P<addr>0x[0-9a-fA-F]+):\s+)?(?:\s*)\((?P<type>[^)]+)\)\s+(?P<name>[a-zA-Z0-9_\[\]\.\*]+)\s*=\s*(?P<val>.+)$",
        re.MULTILINE
    )

    # Parse Frame Variables per "frame select <N>" block
    frame_blocks = re.split(r"\(lldb\)\s+frame\s+select\s+(\d+)", lldb_stdout)
    for i in range(1, len(frame_blocks), 2):
        block_content = frame_blocks[i + 1]
        
        # Match function name in frame select block if present
        func_match = frame_re.search(block_content)
        target_f = None
        if func_match:
            d = func_match.groupdict()
            fn_name = d["func"] or d.get("func2")
            if fn_name and fn_name in frames_map:
                target_f = frames_map[fn_name]

        if not target_f and len(frames) > 0:
            frame_idx = int(frame_blocks[i])
            if frame_idx < len(frames):
                target_f = frames[frame_idx]

        if target_f:
            f_vars: List[CallStackVariable] = list(target_f.variables)
            existing_names = {v.name for v in f_vars}

            for vm in var_re.finditer(block_content):
                vd = vm.groupdict()
                v_name = vd["name"].strip()
                if v_name not in existing_names:
                    existing_names.add(v_name)
                    v_type = vd["type"].strip()
                    f_vars.append(
                        CallStackVariable(
                            name=v_name,
                            type=v_type,
                            value=vd["val"].strip(),
                            address=vd["addr"] if vd["addr"] else None,
                            size_bytes=get_type_size(v_type)
                        )
                    )
            target_f.variables = f_vars

    # Re-index frame numbers sequentially 0, 1, 2...
    for idx, f in enumerate(frames):
        f.frame_number = idx

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

        # 2. Extract function names to set breakpoints on every user function
        functions = re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{", request.code)
        target_funcs = list(set([fn for fn in functions if fn not in ("if", "for", "while", "switch", "return")]))
        if "main" not in target_funcs:
            target_funcs.append("main")

        bp_cmds = []
        for fn in target_funcs:
            bp_cmds.extend(["-o", f"b {fn}"])

        def execute_lldb_commands(flags: list) -> str:
            if is_wsl:
                posix_path = tmp_dir.as_posix()
                cmd = [
                    toolchain.clang_cmd[0],
                    "bash",
                    "-c",
                    f"cd \"$(wslpath '{posix_path}')\" && lldb -b " + " ".join([f"'{flag}'" for flag in flags]) + " ./" + exe_file
                ]
            else:
                cmd = ["lldb", "-b", *flags, f"./{exe_file}"]
            _, lldb_stdout, _, _ = run_command(cmd, cwd=tmp_dir, timeout=10.0)
            return lldb_stdout

        # LLDB run: set breakpoints, run, and step through all breakpoints collecting backtraces & variables
        lldb_o_flags = [*bp_cmds, "-o", "r", "-o", "thread backtrace", "-o", "frame select 0", "-o", "frame variable -L -T"]
        for _ in range(len(target_funcs)):
            lldb_o_flags.extend(["-o", "c", "-o", "thread backtrace", "-o", "frame select 0", "-o", "frame variable -L -T"])

        lldb_o_flags.extend(["-o", "register read rsp rbp rip rax rbx rcx rdx rsi rdi"])

        lldb_out = execute_lldb_commands(lldb_o_flags)
        frames, registers = parse_callstack_output(lldb_out)

        # Fallback if multi-step output didn't capture frames: simple run at main
        if not frames:
            fallback_flags = [*bp_cmds, "-o", "r", "-o", "thread backtrace", "-o", "frame select 0", "-o", "frame variable -L -T"]
            lldb_out = execute_lldb_commands(fallback_flags)
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
