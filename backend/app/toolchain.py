import os
import shutil
import time
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class ToolchainNotFoundException(Exception):
    pass


class Toolchain:
    def __init__(self, clang_cmd: List[str], objdump_cmd: Optional[List[str]] = None):
        self.clang_cmd = clang_cmd
        self.objdump_cmd = objdump_cmd

    @property
    def clang_path(self) -> str:
        return " ".join(self.clang_cmd)

    @property
    def objdump_path(self) -> Optional[str]:
        return " ".join(self.objdump_cmd) if self.objdump_cmd else None

    @classmethod
    def detect(cls) -> "Toolchain":
        # 1. Check env var first
        env_clang = os.environ.get("CLANG_PATH")
        if env_clang:
            return cls(clang_cmd=[env_clang])

        # 2. Check native clang on PATH
        native_clang = shutil.which("clang") or shutil.which("clang.exe")
        if native_clang:
            native_objdump = (
                os.environ.get("LLVM_OBJDUMP_PATH")
                or os.environ.get("OBJDUMP_PATH")
                or shutil.which("llvm-objdump")
                or shutil.which("llvm-objdump.exe")
                or shutil.which("objdump")
                or shutil.which("objdump.exe")
            )
            obj_cmd = [native_objdump] if native_objdump else None
            return cls(clang_cmd=[native_clang], objdump_cmd=obj_cmd)

        # 3. Check WSL clang on Windows if native clang is not installed on Windows PATH
        wsl_bin = shutil.which("wsl") or shutil.which("wsl.exe")
        if wsl_bin:
            try:
                res = subprocess.run([wsl_bin, "clang", "--version"], capture_output=True, text=True, timeout=3.0)
                if res.returncode == 0:
                    wsl_objdump: Optional[List[str]] = None
                    d_res = subprocess.run([wsl_bin, "llvm-objdump", "--version"], capture_output=True, text=True, timeout=3.0)
                    if d_res.returncode == 0:
                        wsl_objdump = [wsl_bin, "llvm-objdump"]
                    else:
                        d2_res = subprocess.run([wsl_bin, "objdump", "--version"], capture_output=True, text=True, timeout=3.0)
                        if d2_res.returncode == 0:
                            wsl_objdump = [wsl_bin, "objdump"]
                    return cls(clang_cmd=[wsl_bin, "clang"], objdump_cmd=wsl_objdump)
            except Exception:
                pass

        raise ToolchainNotFoundException(
            "Clang compiler not found. Please install Clang/LLVM and ensure 'clang' is in your PATH or set the 'CLANG_PATH' environment variable."
        )


def run_command(
    cmd: List[str], cwd: Path, timeout: float = 10.0
) -> Tuple[int, str, str, float]:
    """
    Executes command using subprocess with shell=False.
    Returns (exit_code, stdout, stderr, duration_ms).
    """
    start_time = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
        )
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return proc.returncode, proc.stdout or "", proc.stderr or "", duration_ms
    except subprocess.TimeoutExpired as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        stderr += f"\n[Process Timed Out after {timeout}s]"
        return -1, stdout, stderr, duration_ms
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return -1, "", f"[Execution Error: {str(exc)}]", duration_ms
