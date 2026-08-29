# CodeXRay: C Compilation Pipeline & Debugger Visualizer

CodeXRay is an interactive C compiler pipeline visualizer and real-time execution debugger. It compiles C code through actual compiler stages using **Clang** and extracts real backtraces, local variables, frame parameters, memory addresses, and CPU registers via **LLDB**.

---

## Key Features & Capabilities

- **Real Clang Toolchain Pipeline Execution:**
  - Standard compilation stage outputs: Source, Preprocessed (`-E`), LLVM IR (`-emit-llvm`), Assembly (`-S`), and Machine Binary disassembly.
- **Interactive LLDB Call Stack Inspection:**
  - Real-time stack backtraces captured from live LLDB debugging sessions (`-g -O0`).
  - Frame selection (`Frame #0`, `Frame #1`, `Frame #2`...) displaying isolated local variables and function arguments for each frame.
  - Memory location pointers (`0x7ffff...`) and memory variable sizes in bytes.
- **Live CPU Registers View:**
  - Inspect process CPU registers directly from LLDB (`RSP`, `RBP`, `RIP`, `RAX`, `RBX`, `RCX`, `RDX`, `RSI`, `RDI`).
- **Synchronized Source Code Visualizer:**
  - Selecting any frame automatically highlights the active execution line in the C source panel with a bright green pointer (`➔`) and auto-scrolls directly to the line.

---

## Architecture & Workflow

### 1. Clang & LLDB Execution Environment
- The backend is written in **FastAPI (Python)** and interacts directly with system compilers via standard non-shell subprocesses (`subprocess.Popen`).
- Automatically detects native **Clang/LLDB** installations on Windows/POSIX or **WSL (Ubuntu)** on Windows environments.

### 2. Call Stack Debugging Workflow
1. **Request:** Frontend sends C code via `POST /api/debug/callstack`.
2. **Compilation:** Backend writes C code to an isolated temporary workspace (`tempfile.TemporaryDirectory`) and compiles it using `clang -g -O0`.
3. **LLDB Batch Execution:** Launches LLDB non-interactively (`lldb -b`) to set breakpoints, capture the active thread backtrace, select each stack frame, read local variables, and query CPU register states.
4. **Parsing & Normalization:** Parses LLDB stdout using regex into structured `CallStackFrame` and `CallStackVariable` JSON objects without fake data or placeholders.
5. **Interactive UI Rendering:** React renders the modal, allowing frame navigation, register inspection, and line highlighting.

---

## Project Structure

```text
Code_Xray/
├── backend/
│   ├── app/
│   │   ├── compiler.py     # Compiler stage handlers (-E, -emit-llvm, -S)
│   │   ├── debugger.py     # LLDB batch session runner & backtrace parser
│   │   ├── main.py         # FastAPI routes (/api/compile, /api/debug/callstack)
│   │   ├── models.py       # Pydantic data schemas
│   │   └── toolchain.py    # Auto-detection for Clang/LLDB & WSL
│   ├── tests/              # Pytest test suite
│   └── requirements.txt
├── src/
│   ├── components/
│   │   ├── CallStackModal.tsx   # Call stack backtrace, variables & registers view
│   │   └── ExecutionVisualizer.tsx # Stage pipeline viewer
│   ├── App.tsx                  # Main layout & pipeline state
│   └── App.css                  # UI styles & dark theme animations
├── package.json
└── README.md
```

---

## Getting Started

### Backend Requirements
- **Python 3.10+**
- **Clang** & **LLDB** (or **WSL** with `clang` and `lldb` installed)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend Requirements
- **Node.js 18+** & **npm**

```bash
npm install
npm run dev
```

---

## Running Backend Tests

To run pytest unit tests verifying compilation stages and LLDB stack frame parsing:

```bash
cd backend
python -m pytest
```
