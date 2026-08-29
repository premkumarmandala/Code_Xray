import React, { useState, useEffect } from 'react';
import { Layers, ArrowDown, Cpu, ArrowLeft, Loader2, Code2, AlertTriangle, Play, Pause } from 'lucide-react';

export interface VariableInfo {
  name: string;
  type: string;
  value: string;
  address?: string | null;
}

export interface StackFrame {
  index: number;
  function: string;
  filename: string;
  line?: number;
  column?: number;
  address?: string;
  variables: VariableInfo[];
}

export interface DebugData {
  success: boolean;
  frames: StackFrame[];
  registers: Record<string, string>;
  current_line?: number;
  error_message?: string;
}

interface CallStackModalProps {
  code: string;
  debugData: DebugData | null;
  loading: boolean;
  onClose: () => void;
}

export function CallStackModal({ code, debugData, loading, onClose }: CallStackModalProps) {
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const [animatingFrame, setAnimatingFrame] = useState<number | null>(null);
  const [isAutoStepping, setIsAutoStepping] = useState<boolean>(false);
  const stepSpeed = 1000;

  const frames = debugData?.frames || [];
  
  // Set initial selected frame when frames are loaded
  useEffect(() => {
    if (frames.length > 0) {
      const firstIdx = frames[0].index;
      setSelectedFrameIndex(firstIdx);
      setAnimatingFrame(firstIdx);
    } else {
      setSelectedFrameIndex(null);
      setAnimatingFrame(null);
    }
  }, [debugData]);

  // Handle frame selection with visual activation state
  const handleSelectFrame = (idx: number) => {
    setSelectedFrameIndex(idx);
    setAnimatingFrame(idx);
  };

  // Auto-play through frames (top to bottom backtrace simulation)
  useEffect(() => {
    let timer: any = null;
    if (isAutoStepping && frames.length > 0) {
      timer = setInterval(() => {
        setSelectedFrameIndex((prev) => {
          if (prev === null) return frames[0].index;
          const currentPos = frames.findIndex(f => f.index === prev);
          if (currentPos < 0 || currentPos >= frames.length - 1) {
            setIsAutoStepping(false);
            return prev;
          }
          const nextIndex = frames[currentPos + 1].index;
          setAnimatingFrame(nextIndex);
          return nextIndex;
        });
      }, stepSpeed);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isAutoStepping, frames, stepSpeed]);

  const selectedFrame = frames.find((f) => f.index === selectedFrameIndex) || (frames.length > 0 ? frames[0] : null);
  const codeLines = code.split('\n');

  // Scroll active line into view inside code area when selected frame changes
  useEffect(() => {
    if (selectedFrame?.line) {
      const activeLineElem = document.getElementById(`stack-source-line-${selectedFrame.line}`);
      if (activeLineElem) {
        activeLineElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [selectedFrameIndex, selectedFrame?.line]);

  return (
    <div className="callstack-modal-overlay">
      <div className="callstack-modal-content">
        {/* Modal Header */}
        <div className="callstack-header">
          <div className="callstack-title-group">
            <Layers className="text-primary" size={22} />
            <div>
              <h2 className="callstack-modal-title">CodeXRay Execution Call Stack</h2>
              <p className="callstack-modal-subtitle">Internal Debugger State (LLDB Backtrace, Frames & Variables)</p>
            </div>
          </div>

          <button className="reset-btn" onClick={onClose}>
            <ArrowLeft size={16} />
            Back to Pipeline
          </button>
        </div>

        {loading ? (
          <div className="callstack-loading-state">
            <Loader2 size={32} className="spinner text-primary" />
            <p>Collecting LLDB Call Stack & Memory State...</p>
          </div>
        ) : !debugData?.success ? (
          <div className="callstack-error-state">
            <AlertTriangle size={32} color="#ef4444" />
            <p>{debugData?.error_message || 'Failed to capture call stack information.'}</p>
          </div>
        ) : (
          <div className="callstack-body-grid">
            {/* Left Panel: Call Stack Navigation & Visual Flow */}
            <aside className="callstack-nav-panel">
              <div className="section-subtitle-bar">
                <h3 className="section-subtitle">CALL STACK (DEPTH: {frames.length})</h3>
                {frames.length > 1 && (
                  <div className="stack-anim-controls">
                    <button 
                      className={`anim-btn ${isAutoStepping ? 'active' : ''}`}
                      onClick={() => setIsAutoStepping(!isAutoStepping)}
                      title={isAutoStepping ? "Pause Stack Walk" : "Step Through Call Stack"}
                    >
                      {isAutoStepping ? <Pause size={13} /> : <Play size={13} />}
                      {isAutoStepping ? 'Pause' : 'Animate'}
                    </button>
                  </div>
                )}
              </div>
              
              {/* Stack Flow Visual Tree */}
              <div className="stack-tree-list">
                {frames.map((frame, idx) => {
                  const isSelected = frame.index === selectedFrameIndex;
                  const isAnimating = frame.index === animatingFrame;
                  return (
                    <React.Fragment key={frame.index}>
                      <div 
                        className={`frame-card ${isSelected ? 'selected' : ''} ${isAnimating ? 'pulse-frame' : ''}`}
                        onClick={() => handleSelectFrame(frame.index)}
                        style={{ animationDelay: `${idx * 0.12}s` }}
                      >
                        <div className="frame-badge">Frame #{frame.index}</div>
                        <div className="frame-details">
                          <span className="frame-func">{frame.function}()</span>
                          <span className="frame-loc">{frame.filename}:{frame.line || '?'}</span>
                        </div>
                        {isSelected && <span className="frame-active-tag">Active</span>}
                      </div>

                      {idx < frames.length - 1 && (
                        <div className={`frame-arrow ${isSelected ? 'arrow-active' : ''}`}>
                          <ArrowDown size={14} className="bouncing-arrow" />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Registers Box */}
              <div className="registers-box">
                <div className="registers-title">
                  <Cpu size={16} color="var(--primary)" />
                  <span>CPU Registers</span>
                </div>
                <div className="registers-grid">
                  {debugData.registers && Object.keys(debugData.registers).length > 0 ? (
                    Object.entries(debugData.registers).map(([reg, val]) => (
                      <div key={reg} className="reg-row">
                        <span className="reg-name">{reg}:</span>
                        <span className="reg-val">{val || 'N/A'}</span>
                      </div>
                    ))
                  ) : (
                    <div className="no-vars-msg">No register values available.</div>
                  )}
                </div>
              </div>
            </aside>

            {/* Right Panel: Frame Variables & Source Line Highlighting */}
            <section className="callstack-details-panel">
              {/* Frame Metadata Bar */}
              <div className="frame-meta-bar">
                <div>
                  <span className="meta-label">Selected Frame:</span>
                  <strong className="meta-val">Frame #{selectedFrame?.index} — {selectedFrame?.function}()</strong>
                </div>
                <div>
                  <span className="meta-label">Location:</span>
                  <span className="meta-val">{selectedFrame?.filename}:{selectedFrame?.line}</span>
                </div>
                {selectedFrame?.address && (
                  <div>
                    <span className="meta-label">PC:</span>
                    <span className="meta-val font-mono">{selectedFrame.address}</span>
                  </div>
                )}
              </div>

              {/* Variables Table */}
              <div className="variables-section">
                <h3 className="section-subtitle">LOCAL VARIABLES & PARAMETERS (FRAME #{selectedFrame?.index ?? '0'})</h3>
                {selectedFrame?.variables && selectedFrame.variables.length > 0 ? (
                  <table className="variables-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Value</th>
                        <th>Memory Address</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedFrame.variables.map((v, i) => (
                        <tr key={i}>
                          <td className="var-name">{v.name}</td>
                          <td className="var-type">{v.type}</td>
                          <td className="var-val">{v.value}</td>
                          <td className="var-addr">{v.address || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="no-vars-msg">No local variables or parameters in Frame #{selectedFrame?.index ?? '0'}.</div>
                )}
              </div>

              {/* Source Line Highlight View */}
              <div className="source-highlight-section">
                <div className="source-title-bar">
                  <Code2 size={16} color="#22c55e" />
                  <span>Source Code Execution Point ({selectedFrame?.filename} - Line {selectedFrame?.line || '?'})</span>
                </div>
                <div className="source-highlight-code">
                  {codeLines.map((lineText, lineIdx) => {
                    const lineNum = lineIdx + 1;
                    const isCurrentLine = lineNum === selectedFrame?.line;
                    return (
                      <div 
                        key={lineIdx} 
                        id={`stack-source-line-${lineNum}`}
                        className={`source-line ${isCurrentLine ? 'active-exec-line-green' : ''}`}
                      >
                        <span className="line-num">{lineNum}</span>
                        <span className="line-arrow-green">{isCurrentLine ? '➔' : ' '}</span>
                        <span className="line-text">{lineText || ' '}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
