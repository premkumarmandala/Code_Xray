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
    sample_output: Optional[str] = Field(default="", description="Expected sample output")
    stdin_input: Optional[str] = Field(default="", description="User stdin input for scanf / getchar / fgets")
    timeout: float = Field(default=5.0, ge=0.5, le=30.0, description="Execution stage timeout in seconds")


class CompileResponse(BaseModel):
    success: bool
    filename: str
    base_name: str
    stages: Dict[str, StageResult]
    errors: List[ParsedError]
    output: str = ""


# Call Stack Backend Models
class CallStackVariable(BaseModel):
    name: str
    type: str
    value: str
    address: Optional[str] = None
    size_bytes: Optional[int] = None


class CallStackFrame(BaseModel):
    frame_number: int
    function: str
    file: str
    line: Optional[int] = None
    variables: List[CallStackVariable] = Field(default_factory=list)


class CallStackResponse(BaseModel):
    success: bool
    frames: List[CallStackFrame] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


# Step-by-Step Tracing Models
class VariableData(BaseModel):
    name: str
    type: str
    value: str
    address: Optional[str] = None
    is_array: bool = False
    array_elements: List[Dict[str, Any]] = Field(default_factory=list)
    is_pointer: bool = False
    pointed_address: Optional[str] = None
    pointed_value: Optional[str] = None


class StackFrame(BaseModel):
    index: int
    function: str
    filename: str
    line: Optional[int] = None
    column: Optional[int] = None
    address: Optional[str] = None
    variables: List[VariableData] = Field(default_factory=list)


class DebugResponse(BaseModel):
    success: bool
    frames: List[StackFrame] = Field(default_factory=list)
    registers: Dict[str, str] = Field(default_factory=dict)
    current_line: Optional[int] = None
    error_message: Optional[str] = None


class TraceStep(BaseModel):
    step_number: int
    current_line: int
    line_code: str
    function: str
    filename: str
    variables: List[VariableData] = Field(default_factory=list)
    stack_frames: List[StackFrame] = Field(default_factory=list)
    registers: Dict[str, str] = Field(default_factory=dict)
    stdout: str = ""
    detected_type: Literal["stack", "array", "pointer", "loop", "general"] = "general"


class TraceResponse(BaseModel):
    success: bool
    code: str
    filename: str
    total_steps: int
    detected_program_type: Literal["stack", "array", "pointer", "loop", "general"] = "general"
    steps: List[TraceStep] = Field(default_factory=list)
    errors: List[ParsedError] = Field(default_factory=list)
    output: str = ""
