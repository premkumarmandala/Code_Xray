import { useState, useEffect, Fragment } from 'react';
import { Layers, ArrowDown, ArrowLeft, Loader2, Code2, AlertTriangle, HardDrive } from 'lucide-react';
import { MemoryVisualization, getVariableAddress } from './MemoryVisualization';

export interface VariableInfo {
  name: string;
  type: string;
  value: string;
  address?: string | null;
  size_bytes?: number | null;
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
  initialTab?: 'stack' | 'memory';
}

export function CallStackModal({ code, debugData, loading, onClose, initialTab = 'stack' }: CallStackModalProps) {
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'stack' | 'memory'>(initialTab);

  const frames = debugData?.frames || [];
  
  // Set initial selected frame when frames load
  useEffect(() => {
    if (frames.length > 0) {
      setSelectedFrameIndex(frames[0].index);
    } else {
      setSelectedFrameIndex(null);
    }
  }, [debugData]);

  // Handle manual frame selection by user
  const handleSelectFrame = (idx: number) => {
    setSelectedFrameIndex(idx);
  };

  const selectedFrame = frames.find((f) => f.index === selectedFrameIndex) || (frames.length > 0 ? frames[0] : null);
  const codeLines = code.split('\n');

  // Scroll active line into view inside source code panel when selected frame changes
  useEffect(() => {
    if (activeTab === 'stack' && selectedFrame?.line) {
      const activeLineElem = document.getElementById(`stack-source-line-${selectedFrame.line}`);
      if (activeLineElem) {
        activeLineElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [selectedFrameIndex, selectedFrame?.line, activeTab]);

  return (
    <div className="callstack-page-view">
      <div className="callstack-page-container">
        {/* Top Header Navigation */}
        <div className="callstack-header">
          <div className="callstack-title-group">
            <Layers className="text-primary" size={22} />
            <div>
              <h2 className="callstack-modal-title">CodeXRay Execution & Memory Explorer</h2>
              <p className="callstack-modal-subtitle">Internal Debugger Backtrace & Real-time RAM Hardware Architecture</p>
            </div>
          </div>

          {/* Sub-Navigation Tabs */}
          <div className="callstack-tab-switcher">
            <button
              className={`callstack-subtab-btn ${activeTab === 'stack' ? 'active' : ''}`}
              onClick={() => setActiveTab('stack')}
            >
              <Layers size={15} />
              <span>Call Stack & Frames</span>
            </button>
            <button
              className={`callstack-subtab-btn memory-tab ${activeTab === 'memory' ? 'active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              <HardDrive size={15} />
              <span>Memory Visualization</span>
            </button>
          </div>

          <button className="reset-btn" onClick={onClose}>
            <ArrowLeft size={16} />
            Back to Pipeline
          </button>
        </div>

        {loading ? (
          <div className="callstack-loading-state">
            <Loader2 size={32} className="spinner text-primary" />
            <p>Collecting LLDB Call Stack & RAM Hardware State...</p>
          </div>
        ) : !debugData?.success ? (
          <div className="callstack-error-state">
            <AlertTriangle size={32} color="#ef4444" />
            <p>{debugData?.error_message || 'Failed to capture call stack information.'}</p>
          </div>
        ) : activeTab === 'memory' ? (
          /* Memory Visualization View */
          <MemoryVisualization 
            code={code} 
            debugData={debugData} 
            selectedFrameIndex={selectedFrameIndex} 
          />
        ) : (
          /* Call Stack View */
          <div className="callstack-body-grid">
            {/* Left Panel: Full List of Call Stack Frames */}
            <aside className="callstack-nav-panel">
              <div className="section-subtitle-bar">
                <h3 className="section-subtitle">CALL STACK FRAMES ({frames.length})</h3>
              </div>
              
              {/* Scrollable Frame Selection List */}
              <div className="stack-tree-list">
                {frames.length === 0 ? (
                  <div className="no-vars-msg">No active frames captured.</div>
                ) : (
                  frames.map((frame, idx) => {
                    const isSelected = frame.index === selectedFrameIndex;
                    return (
                      <Fragment key={frame.index}>
                        <div 
                          className={`frame-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectFrame(frame.index)}
                        >
                          <div className="frame-badge">Frame #{frame.index}</div>
                          <div className="frame-details">
                            <span className="frame-func">{frame.function}()</span>
                            <span className="frame-loc">{frame.filename}:{frame.line || '?'}</span>
                          </div>
                          {isSelected && <span className="frame-active-tag">Selected</span>}
                        </div>

                        {idx < frames.length - 1 && (
                          <div className={`frame-arrow ${isSelected ? 'arrow-active' : ''}`}>
                            <ArrowDown size={14} className="bouncing-arrow" />
                          </div>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Right Panel: Selected Frame Variables & Source Line Highlighting */}
            <section className="callstack-details-panel">
              {/* Selected Frame Metadata Bar */}
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

              {/* Variables Table for Selected Frame */}
              <div className="variables-section">
                <div className="vars-header-row">
                  <h3 className="section-subtitle">FRAME #{selectedFrame?.index ?? '0'} LOCAL VARIABLES & PARAMETERS</h3>
                </div>
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
                          <td className="var-addr font-mono">
                            {getVariableAddress(
                              v, 
                              selectedFrame?.index ?? 0, 
                              i, 
                              debugData?.registers?.rbp || debugData?.registers?.RBP
                            )}
                          </td>
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
