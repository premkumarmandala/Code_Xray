from typing import Dict, List, Optional, Any, Literal
from pydantic import BaseModel, Field


class ParsedError(BaseModel):
    type: Literal["error", "warning", "note"]
    message: str
    filename: str
    line: Optional[int] = None
    column: Optional[int] = None


class StageResult(BaseModel):
    stage: str
    status: Literal["success", "error", "skipped"]
    input_file: str
    output_file: str
    content: Optional[str] = None
    representation: Optional[Dict[str, Any]] = None
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    duration_ms: float = 0.0
    file_size: Optional[int] = None
    command: List[str] = Field(default_factory=list)


class CompileRequest(BaseModel):
    code: str = Field(..., description="C source code to compile")
    filename: str = Field(default="main.c", description="Base filename (e.g. sum.c)")
    timeout: float = Field(default=5.0, ge=0.5, le=30.0, description="Execution stage timeout in seconds")


class CompileResponse(BaseModel):
    success: bool
    filename: str
    base_name: str
    stages: Dict[str, StageResult]
    errors: List[ParsedError]
    output: str = ""
