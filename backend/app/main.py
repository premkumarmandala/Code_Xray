from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.models import CompileRequest, CompileResponse, CallStackResponse, TraceResponse
from app.compiler import run_pipeline
from app.debugger import debug_callstack
from app.tracer import run_lldb_trace

app = FastAPI(
    title="CodeXRay Backend API",
    description="Educational C compilation pipeline visualizer backend using Clang/LLVM",
    version="1.0.0",
)

# Enable CORS for React frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
@app.get("/health")
@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "CodeXRay Backend API"}


@app.post("/api/compile", response_model=CompileResponse)
def compile_c_code(request: CompileRequest):
    try:
        response = run_pipeline(request)
        return response
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal compilation server error: {str(exc)}",
        )


@app.post("/api/debug/callstack", response_model=CallStackResponse)
def get_debug_callstack(request: CompileRequest):
    try:
        response = debug_callstack(request)
        return response
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal debugger error: {str(exc)}",
        )


@app.post("/api/trace", response_model=TraceResponse)
def trace_c_code(request: CompileRequest):
    try:
        response = run_lldb_trace(request)
        return response
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal runtime tracer error: {str(exc)}",
        )
