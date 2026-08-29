import { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ChevronLeft, 
  ChevronRight, 
  Code2, 
  Database, 
  Terminal, 
  ArrowRight,
  Sparkles,
  Repeat
} from 'lucide-react';

export interface VariableData {
  name: string;
  type: string;
  value: string;
  address?: string | null;
  is_array?: boolean;
  array_elements?: { index: number; value: string; address?: string; type?: string }[];
  is_pointer?: boolean;
  pointed_address?: string | null;
  pointed_value?: string | null;
}

export interface TraceStep {
  step_number: number;
  current_line: number;
  line_code: string;
  function: string;
  filename: string;
  variables: VariableData[];
  registers: Record<string, string>;
  stdout: string;
  detected_type: 'stack' | 'array' | 'pointer' | 'loop' | 'general';
}

export interface TraceData {
  success: boolean;
  code: string;
  filename: string;
  total_steps: number;
  detected_program_type: 'stack' | 'array' | 'pointer' | 'loop' | 'general';
  steps: TraceStep[];
  output: string;
}

interface ExecutionVisualizerProps {
  code: string;
  traceData: TraceData | null;
}

export function ExecutionVisualizer({ code, traceData }: ExecutionVisualizerProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1000); // ms per step

  const steps = traceData?.steps || [];
  const currentStep = steps[currentStepIdx] || null;
  const programType = traceData?.detected_program_type || 'general';
  const codeLines = code.split('\n');

  // Auto-play interval timer
  useEffect(() => {
    let timer: any = null;
    if (isPlaying && steps.length > 0) {
      timer = setInterval(() => {
        setCurrentStepIdx((prev) => {
          if (prev >= steps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playSpeed);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, steps.length, playSpeed]);

  if (!traceData || steps.length === 0) {
    return (
      <div className="visualizer-empty-state">
        <Sparkles size={36} color="var(--primary)" />
        <h3>Runtime Visualization Ready</h3>
        <p>Click "Run Step-by-Step Execution" or "Visualize Compilation" to trace execution step by step under LLDB.</p>
      </div>
    );
  }

  // Extract variables for visualizers
  const variables = currentStep?.variables || [];
  const arrayVar = variables.find((v) => v.is_array || (v.array_elements && v.array_elements.length > 0));
  const loopVar = variables.find((v) => ['i', 'j', 'k', 'count', 'iter', 'n'].includes(v.name));
  const pointerVar = variables.find((v) => v.is_pointer || v.type.includes('*'));

  return (
    <div className="visualizer-main-container">
      {/* Step Navigation Controller Bar */}
      <div className="step-controller-bar">
        <div className="step-badge-group">
          <span className="step-badge">
            Step {currentStepIdx + 1} of {steps.length}
          </span>
          <span className="type-badge">
            Type: <strong>{programType.toUpperCase()}</strong>
          </span>
        </div>

        {/* Playback Action Buttons */}
        <div className="playback-controls">
          <button 
            className="ctrl-btn" 
            onClick={() => { setIsPlaying(false); setCurrentStepIdx(0); }}
            disabled={currentStepIdx === 0}
            title="First Step"
          >
            <SkipBack size={16} />
          </button>
          
          <button 
            className="ctrl-btn" 
            onClick={() => { setIsPlaying(false); setCurrentStepIdx((p) => Math.max(0, p - 1)); }}
            disabled={currentStepIdx === 0}
            title="Previous Step"
          >
            <ChevronLeft size={16} />
          </button>

          <button 
            className={`ctrl-btn play-btn ${isPlaying ? 'active' : ''}`}
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? "Pause" : "Auto Play"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button 
            className="ctrl-btn" 
            onClick={() => { setIsPlaying(false); setCurrentStepIdx((p) => Math.min(steps.length - 1, p + 1)); }}
            disabled={currentStepIdx === steps.length - 1}
            title="Next Step"
          >
            <ChevronRight size={16} />
          </button>

          <button 
            className="ctrl-btn" 
            onClick={() => { setIsPlaying(false); setCurrentStepIdx(steps.length - 1); }}
            disabled={currentStepIdx === steps.length - 1}
            title="Last Step"
          >
            <SkipForward size={16} />
          </button>
        </div>

        <div className="speed-selector">
          <span className="speed-label">Speed:</span>
          <select 
            value={playSpeed} 
            onChange={(e) => setPlaySpeed(Number(e.target.value))}
            className="speed-select"
          >
            <option value={1500}>0.5x Slow</option>
            <option value={1000}>1.0x Normal</option>
            <option value={500}>2.0x Fast</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Left Source Code + Right Visualizer */}
      <div className="visualizer-workspace-grid">
        {/* Left Side: Source Code Execution Point */}
        <div className="source-step-panel">
          <div className="panel-subbar">
            <Code2 size={16} color="var(--primary)" />
            <span>Execution Line {currentStep?.current_line}: <code>{currentStep?.line_code || ''}</code></span>
          </div>

          <div className="source-lines-container">
            {codeLines.map((lineText, lineIdx) => {
              const lineNum = lineIdx + 1;
              const isExecLine = lineNum === currentStep?.current_line;

              return (
                <div key={lineIdx} className={`exec-code-line ${isExecLine ? 'executing-now' : ''}`}>
                  <span className="exec-line-num">{lineNum}</span>
                  <span className="exec-line-arrow">{isExecLine ? '➔' : ' '}</span>
                  <span className="exec-line-text">{lineText || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Dynamic Data Structure Visualizer */}
        <div className="structure-visualizer-panel">
          <div className="panel-subbar">
            <Database size={16} color="var(--primary)" />
            <span>
              {programType === 'stack' && 'Stack Memory Visualizer'}
              {programType === 'array' && 'Array Memory Strip'}
              {programType === 'pointer' && 'Pointer & Referenced Memory Map'}
              {programType === 'loop' && 'Loop Iteration & State Changes'}
              {programType === 'general' && 'Program State & Local Variables'}
            </span>
          </div>

          <div className="visualizer-viewport">
            {/* 1. STACK VISUALIZER */}
            {programType === 'stack' && (
              <div className="stack-visualizer-container">
                <div className="stack-column-frame">
                  <div className="stack-top-indicator">TOP ➔</div>
                  {variables.map((v, i) => (
                    <div key={i} className="stack-item-box">
                      <span className="item-val">{v.name} = {v.value}</span>
                      <span className="item-type">{v.type}</span>
                    </div>
                  ))}
                  {variables.length === 0 && (
                    <div className="empty-stack-msg">Stack is empty</div>
                  )}
                </div>
              </div>
            )}

            {/* 2. ARRAY VISUALIZER */}
            {programType === 'array' && (
              <div className="array-visualizer-container">
                {arrayVar && arrayVar.array_elements && arrayVar.array_elements.length > 0 ? (
                  <div className="array-strip">
                    <div className="array-name-tag">{arrayVar.name} ({arrayVar.type})</div>
                    <div className="array-boxes-row">
                      {arrayVar.array_elements.map((elem) => {
                        const isCurrentIndex = loopVar && String(elem.index) === String(loopVar.value);
                        return (
                          <div key={elem.index} className={`array-cell ${isCurrentIndex ? 'accessed' : ''}`}>
                            <div className="cell-val">{elem.value}</div>
                            <div className="cell-idx">[{elem.index}]</div>
                            {elem.address && <div className="cell-addr">{elem.address.slice(-6)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="no-array-msg">Array variables will appear here as the program executes.</div>
                )}
              </div>
            )}

            {/* 3. POINTER VISUALIZER */}
            {programType === 'pointer' && (
              <div className="pointer-visualizer-container">
                {pointerVar ? (
                  <div className="pointer-flow">
                    <div className="pointer-node">
                      <div className="node-title">Pointer: {pointerVar.name}</div>
                      <div className="node-val">{pointerVar.value}</div>
                      <div className="node-type">{pointerVar.type}</div>
                    </div>

                    <div className="pointer-connector">
                      <ArrowRight size={24} color="var(--primary)" />
                    </div>

                    <div className="memory-node">
                      <div className="node-title">Referenced Memory</div>
                      <div className="node-val">{pointerVar.pointed_value || '*ptr value'}</div>
                      <div className="node-addr">{pointerVar.pointed_address || pointerVar.value}</div>
                    </div>
                  </div>
                ) : (
                  <div className="no-array-msg">Pointer addresses will be mapped here as instructions execute.</div>
                )}
              </div>
            )}

            {/* 4. LOOP / GENERAL VARIABLE TABLE */}
            <div className="variables-table-box">
              <h4 className="box-title">
                {programType === 'loop' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Repeat size={16} color="var(--primary)" /> Loop Variables & State
                  </span>
                ) : 'Local Variables'}
              </h4>
              <table className="runtime-vars-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Type</th>
                    <th>Value</th>
                    <th>Memory Address</th>
                  </tr>
                </thead>
                <tbody>
                  {variables.map((v, i) => (
                    <tr key={i} className={loopVar && v.name === loopVar.name ? 'loop-var-row' : ''}>
                      <td className="var-name">{v.name}</td>
                      <td className="var-type">{v.type}</td>
                      <td className="var-val">{v.value}</td>
                      <td className="var-addr">{v.address || 'N/A'}</td>
                    </tr>
                  ))}
                  {variables.length === 0 && (
                    <tr>
                      <td colSpan={4} className="no-vars-cell">No active local variables at this execution line.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Terminal Stdout View */}
      <div className="visualizer-terminal-bar">
        <div className="terminal-bar-title">
          <Terminal size={15} />
          <span>Program Standard Output (stdout up to Step {currentStepIdx + 1})</span>
        </div>
        <div className="terminal-bar-content">
          <span className="prompt-char">&gt;</span>
          {currentStep?.stdout || '(No stdout produced yet at this step)'}
        </div>
      </div>
    </div>
  );
}
