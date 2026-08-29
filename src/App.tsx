import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  RotateCcw, 
  Check, 
  Code2, 
  Terminal, 
  Info, 
  Copy, 
  CheckCheck, 
  Loader2, 
  Zap, 
  ChevronRight,
  FileCode,
  FileText
} from 'lucide-react';
import { COMPILATION_STAGES, SAMPLE_C_CODE } from './data/compilationData';
import './App.css';

interface StageArtifactState {
  inputFile: string;
  outputFile: string;
  content: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export function App() {
  const [code, setCode] = useState<string>(SAMPLE_C_CODE);
  const [selectedStageId, setSelectedStageId] = useState<string>('source');
  
  // Stored raw stage artifacts from compiler
  const [stageArtifacts, setStageArtifacts] = useState<Record<string, StageArtifactState>>({});

  const [isVisualizing, setIsVisualizing] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([
    '[CodeXRay Ready] Direct raw file viewer active. Select any compilation stage below to view its full raw file.'
  ]);
  const [copied, setCopied] = useState<boolean>(false);

  // Animation controller ref
  const isAnimatingRef = useRef<boolean>(false);

  const selectedStageMeta = COMPILATION_STAGES.find((s) => s.id === selectedStageId) || COMPILATION_STAGES[0];
  
  // Resolve raw file content: prioritize backend raw file content if available, else local raw file template
  const rawFileContent = stageArtifacts[selectedStageId]?.content ?? selectedStageMeta.getArtifactContent(code);
  const currentInputFile = stageArtifacts[selectedStageId]?.inputFile ?? selectedStageMeta.inputFile;
  const currentOutputFile = stageArtifacts[selectedStageId]?.outputFile ?? selectedStageMeta.outputFile;

  // Split raw file text into raw lines
  const rawFileLines = rawFileContent.split('\n');

  // Trigger backend fetch for raw files when code changes or app mounts
  const fetchRawBackendArtifacts = async (sourceCode: string): Promise<any> => {
    try {
      const response = await fetch('http://localhost:8000/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: sourceCode, filename: 'main.c', timeout: 5.0 })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.stages) {
          const stageKeyMap: Record<string, string> = {
            source: 'source',
            preprocessing: 'preprocessing',
            llvm_ir: 'llvm_ir',
            assembly: 'assembly',
            object_code: 'object_code',
            linking: 'linking',
            execution: 'execution'
          };

          const newArtifacts: Record<string, StageArtifactState> = {};
          COMPILATION_STAGES.forEach((stage) => {
            const bKey = stageKeyMap[stage.id];
            const bData = data.stages[bKey];

            if (bData && bData.status === 'success') {
              let contentText = bData.content;
              if (stage.id === 'object_code' && bData.representation) {
                contentText = bData.representation.disassembly || contentText;
              } else if (stage.id === 'execution') {
                contentText = bData.content || bData.stdout || data.output || 'Process executed successfully with exit code 0.';
              }

              newArtifacts[stage.id] = {
                inputFile: bData.input_file || stage.inputFile,
                outputFile: bData.output_file || stage.outputFile,
                content: contentText || stage.getArtifactContent(sourceCode),
                status: 'completed'
              };
            } else if (bData && bData.status === 'error') {
              newArtifacts[stage.id] = {
                inputFile: stage.inputFile,
                outputFile: stage.outputFile,
                content: bData.stderr || 'Compiler error at this stage.',
                status: 'error'
              };
            }
          });

          setStageArtifacts(newArtifacts);
          return data;
        }
      }
    } catch {
      // Offline fallback
    }
    return null;
  };

  // Fetch initial raw artifacts on mount
  useEffect(() => {
    fetchRawBackendArtifacts(SAMPLE_C_CODE);
  }, []);

  const handleCopyArtifact = () => {
    navigator.clipboard.writeText(rawFileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    isAnimatingRef.current = false;
    setIsVisualizing(false);
    setSelectedStageId('source');

    const resetArtifacts: Record<string, StageArtifactState> = {};
    COMPILATION_STAGES.forEach((s) => {
      resetArtifacts[s.id] = {
        inputFile: s.inputFile,
        outputFile: s.outputFile,
        content: s.getArtifactContent(code),
        status: s.id === 'source' ? 'completed' : 'pending'
      };
    });

    setStageArtifacts(resetArtifacts);
    setLogs(['[CodeXRay Reset] Reset pipeline to initial source state.']);
  };

  const runVisualization = async () => {
    if (isVisualizing) return;
    
    setIsVisualizing(true);
    isAnimatingRef.current = true;
    
    setLogs(['[Pipeline Started] Initiating C compilation pipeline...']);

    // Call backend API first
    const backendData = await fetchRawBackendArtifacts(code);
    const stageKeyMap: Record<string, string> = {
      source: 'source',
      preprocessing: 'preprocessing',
      llvm_ir: 'llvm_ir',
      assembly: 'assembly',
      object_code: 'object_code',
      linking: 'linking',
      execution: 'execution'
    };

    if (backendData && backendData.stages) {
      for (let i = 0; i < COMPILATION_STAGES.length; i++) {
        if (!isAnimatingRef.current) break;

        const stage = COMPILATION_STAGES[i];
        const bKey = stageKeyMap[stage.id];
        const bData = backendData.stages[bKey];

        setSelectedStageId(stage.id);

        setStageArtifacts((prev) => ({
          ...prev,
          [stage.id]: {
            ...prev[stage.id],
            status: 'running'
          }
        }));

        setLogs((prev) => [...prev, stage.terminalOutput]);

        await new Promise((resolve) => setTimeout(resolve, 800));
        if (!isAnimatingRef.current) break;

        if (bData && bData.status === 'success') {
          let extractedContent = bData.content;
          if (stage.id === 'object_code' && bData.representation) {
            extractedContent = bData.representation.disassembly || extractedContent;
          } else if (stage.id === 'execution') {
            extractedContent = bData.content || bData.stdout || backendData.output || 'Process executed successfully with exit code 0.';
          }

          setStageArtifacts((prev) => ({
            ...prev,
            [stage.id]: {
              inputFile: bData.input_file || stage.inputFile,
              outputFile: bData.output_file || stage.outputFile,
              content: extractedContent || stage.getArtifactContent(code),
              status: 'completed'
            }
          }));

          if (stage.id === 'execution') {
            const cleanPrint = (bData.stdout || extractedContent).trim();
            setLogs((prev) => [...prev, `[Program Output] ${cleanPrint}`]);
          }
        } else if (bData && bData.status === 'error') {
          setStageArtifacts((prev) => ({
            ...prev,
            [stage.id]: {
              ...prev[stage.id],
              content: bData.stderr || 'Compilation error occurred at this stage.',
              status: 'error'
            }
          }));
          setLogs((prev) => [...prev, `[Error] ${bData.stderr}`]);
          break;
        }
      }
    } else {
      // Client-side fallback animation
      for (let i = 0; i < COMPILATION_STAGES.length; i++) {
        if (!isAnimatingRef.current) break;

        const stage = COMPILATION_STAGES[i];
        setSelectedStageId(stage.id);

        setStageArtifacts((prev) => ({
          ...prev,
          [stage.id]: {
            inputFile: stage.inputFile,
            outputFile: stage.outputFile,
            content: prev[stage.id]?.content || stage.getArtifactContent(code),
            status: 'running'
          }
        }));

        setLogs((prev) => [...prev, stage.terminalOutput]);

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (!isAnimatingRef.current) break;

        setStageArtifacts((prev) => ({
          ...prev,
          [stage.id]: {
            inputFile: stage.inputFile,
            outputFile: stage.outputFile,
            content: stage.getArtifactContent(code),
            status: 'completed'
          }
        }));
      }
    }

    if (isAnimatingRef.current) {
      setLogs((prev) => [
        ...prev,
        '[Pipeline Complete] All compilation stages generated and output captured successfully!'
      ]);
    }

    setIsVisualizing(false);
    isAnimatingRef.current = false;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <Zap className="brand-icon" />
          <div>
            <h1 className="brand-title">CodeXRay</h1>
            <p className="brand-subtitle">Interactive C Compilation Pipeline Visualizer for Students</p>
          </div>
        </div>

        <div className="header-actions">
          <button 
            className="reset-btn" 
            onClick={handleReset}
            title="Reset Pipeline"
          >
            <RotateCcw size={16} />
            Reset
          </button>
          
          <button 
            className="visualize-btn" 
            onClick={runVisualization}
            disabled={isVisualizing}
          >
            {isVisualizing ? (
              <>
                <Loader2 size={18} className="spinner" />
                Visualizing...
              </>
            ) : (
              <>
                <Play size={18} />
                Visualize Compilation
              </>
            )}
          </button>
        </div>
      </header>

      {/* Horizontal Stage Indicator */}
      <nav className="pipeline-container">
        <div className="pipeline-title">Compilation Stages (Select any stage to inspect output artifacts line-by-line)</div>
        <div className="pipeline-steps">
          {COMPILATION_STAGES.map((stage, index) => {
            const currentStatus = stageArtifacts[stage.id]?.status || (stage.id === 'source' ? 'completed' : 'pending');
            const isSelected = stage.id === selectedStageId;

            return (
              <React.Fragment key={stage.id}>
                <div 
                  className={`stage-card ${currentStatus} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedStageId(stage.id)}
                >
                  <div className="stage-info">
                    <span className="stage-number">Stage {index + 1}</span>
                    <span className="stage-name">{stage.name}</span>
                  </div>
                  <div className="stage-icon-badge">
                    {currentStatus === 'completed' && <Check size={14} />}
                    {currentStatus === 'running' && <Loader2 size={14} className="spinner" />}
                    {currentStatus === 'pending' && <span style={{ fontSize: '10px' }}>{index + 1}</span>}
                    {currentStatus === 'error' && <span style={{ fontSize: '10px', color: '#ef4444' }}>✕</span>}
                  </div>
                </div>

                {index < COMPILATION_STAGES.length - 1 && (
                  <div className={`arrow-divider ${stageArtifacts[COMPILATION_STAGES[index + 1].id]?.status === 'completed' ? 'active' : ''}`}>
                    <ChevronRight size={18} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      {/* Main Workspace Split Grid */}
      <main className="main-workspace-grid">
        {/* Left Side: C Code Editor */}
        <section className="editor-panel">
          <div className="panel-header">
            <div className="panel-title">
              <Code2 size={18} style={{ color: 'var(--primary)' }} />
              Source Code Editor (main.c)
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>C Language</span>
          </div>
          <textarea
            className="editor-textarea"
            value={code}
            onChange={(e) => {
              const newCode = e.target.value;
              setCode(newCode);
              setStageArtifacts({});
              fetchRawBackendArtifacts(newCode);
            }}
            placeholder="Write your C code here..."
            spellCheck={false}
          />
        </section>

        {/* Right Side: Stage Visualization Workspace */}
        <section className="workspace-panel">
          {/* Stage Header Info */}
          <div className="stage-header-bar">
            <div className="stage-title-group">
              <FileCode size={20} color="var(--primary)" />
              <h2 className="current-stage-title">{selectedStageMeta.name} Stage</h2>
            </div>
            
            <div className="file-badges">
              <div className="file-badge">
                Input: <span>{currentInputFile}</span>
              </div>
              <div className="file-badge">
                {selectedStageId === 'execution' ? 'Target Output:' : 'Output Raw File:'} <span>{currentOutputFile}</span>
              </div>
            </div>
          </div>

          {/* Educational Explanation */}
          <div className="explanation-box">
            <Info size={20} className="explanation-icon" />
            <p className="explanation-text">
              {selectedStageMeta.explanation}
            </p>
          </div>

          {/* Raw Artifact Output File Line Viewer */}
          <div className="artifact-container">
            <div className="artifact-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <FileText size={15} color="var(--primary)" />
                <span>
                  {selectedStageId === 'execution' 
                    ? `Program Execution Output (stdout): (${rawFileLines.length} lines)`
                    : `Raw File: ${currentOutputFile} (${rawFileLines.length} lines)`}
                </span>
              </div>
              <button className="copy-btn" onClick={handleCopyArtifact}>
                {copied ? <CheckCheck size={14} color="#22c55e" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy Output'}
              </button>
            </div>
            <div className="artifact-code-wrapper">
              {rawFileLines.map((line, idx) => (
                <div key={idx} className="code-line">
                  <span className="line-number">{idx + 1}</span>
                  <span className="line-content">{line || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Bottom Panel: Output / Terminal Section */}
      <footer className="terminal-panel">
        <div className="terminal-header">
          <div className="terminal-title">
            <Terminal size={16} />
            Output / Pipeline Terminal Logs
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status: Active</span>
        </div>
        <div className="terminal-body">
          {logs.map((log, idx) => (
            <div key={idx} className="terminal-line">
              <span className="terminal-prompt">&gt;</span>
              {log}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

export default App;
