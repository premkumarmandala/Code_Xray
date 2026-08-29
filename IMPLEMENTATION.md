# CodeXRay Implementation & Architecture Documentation

This document describes the architectural implementation, design patterns, and internal workflow of the CodeXRay Call Stack debugging feature.

---

## 1. System Architecture Overview

CodeXRay uses a decoupled architecture where a **React + TypeScript** client communicates with a **FastAPI (Python)** backend service over REST endpoints.

```
+--------------------------+          POST /api/debug/callstack          +----------------------------+
| React Frontend           | -------------------------------------------> | FastAPI Backend            |
| (CallStackModal.tsx)     | <------------------------------------------- | (app/main.py)              |
+--------------------------+            Structured CallStack JSON         +----------------------------+
            |                                                                           |
   User Selects Frame                                                         Invokes Subprocess
            |                                                                           v
            v                                                             +----------------------------+
Highlights Source Code Line                                               | Clang (-g -O0)             |
& Renders Frame Variables                                                 | LLDB (Non-Interactive)     |
                                                                          +----------------------------+
```

---

## 2. Backend Implementation (`backend/app/`)

### `toolchain.py`
Detects the host toolchain configuration:
- Checks for local `clang` and `lldb` binaries.
- If running on Windows without native LLDB, detects `wsl` and routes execution through Ubuntu WSL.

### `debugger.py`
Handles LLDB batch execution and backtrace parsing:
1. **Isolated Workspace:** Uses Python `tempfile.TemporaryDirectory` for temporary file isolation.
2. **Compilation:** Invokes `clang -g -O0 main.c -o main.exe` to emit DWARF debug symbols.
3. **LLDB Scripting (`lldb -b`):**
   - Discovers function entrypoints (`main`, `add`, `calculate`) and sets breakpoints.
   - Executes `thread backtrace` to extract active frame addresses and line numbers.
   - Iterates through discovered frame numbers using `frame select <N>` and runs `frame variable -L -T` to obtain variable names, data types, current values, and memory addresses.
   - Queries CPU registers using `register read rsp rbp rip rax rbx rcx rdx rsi rdi`.
4. **Parsing:** Extracts structured objects via regex and returns a `CallStackResponse` Pydantic model.

---

## 3. Frontend Implementation (`src/`)

### `App.tsx`
- Triggers `handleOpenCallStack` on clicking the **Call Stack** button in the header.
- Sends C source code to `http://localhost:8000/api/debug/callstack`.
- Normalizes frame structures (`frame_number` -> `index`) and opens `<CallStackModal />`.

### `src/components/CallStackModal.tsx`
- **Frame Navigation:** Renders a vertical tree of stack frames (`Frame #0`, `Frame #1`, `Frame #2`...).
- **Variable Inspection:** Clicking any frame updates the `selectedFrameIndex` state, rendering the variables and arguments specific to that frame in the **Local Variables & Parameters** table.
- **Register Display:** Renders live values for CPU registers (`rsp`, `rbp`, `rip`, `rax`, `rbx`, `rcx`, `rdx`, `rsi`, `rdi`).
- **Source Code Synchronization:** Highlights the line corresponding to `selectedFrame.line` with a green indicator bar (`active-exec-line-green`) and green arrow (`➔`), automatically scrolling the line into view.

---

## 4. API Specification

### Endpoint: `POST /api/debug/callstack`

#### Request Payload
```json
{
  "code": "#include <stdio.h>\nint add(int a, int b) { return a + b; }\nint main() { return add(5, 10); }",
  "filename": "main.c",
  "timeout": 5.0
}
```

#### Response Payload
```json
{
  "success": true,
  "frames": [
    {
      "frame_number": 0,
      "function": "add",
      "file": "main.c",
      "line": 2,
      "address": "0x000055555555514a",
      "variables": [
        {
          "name": "a",
          "type": "int",
          "value": "5",
          "address": "0x00007fffffffe1bc",
          "size_bytes": 4
        },
        {
          "name": "b",
          "type": "int",
          "value": "10",
          "address": "0x00007fffffffe1b8",
          "size_bytes": 4
        }
      ]
    },
    {
      "frame_number": 1,
      "function": "main",
      "file": "main.c",
      "line": 3,
      "address": "0x0000555555555182",
      "variables": []
    }
  ],
  "registers": {
    "rsp": "0x00007fffffffe1a0",
    "rbp": "0x00007fffffffe1c0",
    "rip": "0x000055555555514a",
    "rax": "0x0000000000000000"
  },
  "errors": []
}
```
