import subprocess
import tempfile
from pathlib import Path
from app.models import CompileRequest
from app.compiler import run_pipeline

code_no_newline = """#include <stdio.h>
int main() {
    printf("Hello without newline");
    return 0;
}
"""

def test_no_newline():
    req = CompileRequest(code=code_no_newline, filename="test_buf.c")
    res = run_pipeline(req)
    print("Success:", res.success)
    exec_stage = res.stages.get("execution")
    print("Execution Stage:")
    print("  status:", exec_stage.status if exec_stage else None)
    print("  content:", repr(exec_stage.content if exec_stage else None))
    print("  stdout:", repr(exec_stage.stdout if exec_stage else None))
    print("  stderr:", repr(exec_stage.stderr if exec_stage else None))

if __name__ == "__main__":
    test_no_newline()
