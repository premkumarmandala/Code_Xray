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

function getIncludes(sourceCode: string): string[] {
  const includes: string[] = [];
  const lines = sourceCode.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^#\s*include\s+(<[^>]+>|"[^"]+")/);
      if (match) {
        includes.push(`#include ${match[1]}`);
      }
    }
  }
  return includes;
}

function getMacros(sourceCode: string): string[] {
  const macros: string[] = [];
  const lines = sourceCode.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?)(?:\s+(.*))?$/);
      if (match) {
        const name = match[1];
        let val = match[2] ? match[2].trim() : '';
        if (val.includes('//')) {
          val = val.split('//')[0].trim();
        }
        if (val.includes('/*')) {
          val = val.replace(/\/\*.*?\*\//g, '').trim();
        }
        if (val) {
          macros.push(`${name} → ${val}`);
        } else {
          macros.push(name);
        }
      }
    }
  }
  return macros;
}

interface LlvmVisualData {
  tokens: string[];
  ast: {
    functionName: string;
    returnType: string;
    params: string[];
    bodyStatements: string[];
    returnValue: string;
  };
  semanticChecks: {
    typesChecked: boolean;
    symbolsResolved: boolean;
    validReturnType: boolean;
  };
}

function extractLlvmVisualData(sourceCode: string, hasError: boolean): LlvmVisualData {
  // Strip comments and preprocessor lines for basic token extraction
  const cleanLines = sourceCode
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  // Extract C tokens using regex matching keywords, identifiers, numbers, operators, punctuation
  const tokenRegex = /\b(int|float|double|char|void|return|if|else|while|for|struct)\b|[A-Za-z_][A-Za-z0-9_]*|\d+|[{}()\[\];,+\-*\/%=<>!&|]/g;
  const rawTokens = cleanLines.match(tokenRegex) || ['int', 'main', '(', ')', '{', 'return', '0', ';'];
  const tokens = rawTokens.slice(0, 10);

  // Parse function signature and return statement for AST
  const mainFnMatch = sourceCode.match(/\b(int|void|float|double|char)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
  const returnMatch = sourceCode.match(/return\s+([^;]+);/);
  
  // Extract body summary statements
  const bodyStatements: string[] = [];
  const varMatches = [...sourceCode.matchAll(/\b(int|float|double|char)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)];
  varMatches.forEach(m => bodyStatements.push(`Var: ${m[2]}`));
  
  const returnVal = returnMatch ? returnMatch[1].trim() : '0';

  return {
    tokens,
    ast: {
      functionName: mainFnMatch ? mainFnMatch[2] : 'main',
      returnType: mainFnMatch ? mainFnMatch[1] : 'int',
      params: mainFnMatch && mainFnMatch[3].trim() ? mainFnMatch[3].split(',').map(p => p.trim()) : [],
      bodyStatements: bodyStatements.slice(0, 3),
      returnValue: returnVal
    },
    semanticChecks: {
      typesChecked: !hasError,
      symbolsResolved: !hasError,
      validReturnType: !hasError
    }
  };
}

interface AssemblyVisualData {
  llvmSample: string[];
  funcNames: string[];
  regAllocPairs: { virtualOrName: string; regOrLoc: string }[];
  instructions: string[];
}

interface ObjectCodeVisualData {
  asmSample: string[];
  machineMappings: { asm: string; hex: string }[];
  sections: { name: string; desc: string }[];
  symbols: string[];
  relocations: string[];
}

function extractObjectCodeVisualData(assemblyContent: string, objectDisassembly: string): ObjectCodeVisualData {
  const fullText = (assemblyContent + '\n' + objectDisassembly);

  // 1. Asm sample from objectDisassembly or assemblyContent
  const asmSample: string[] = [];
  if (objectDisassembly) {
    const lines = objectDisassembly.split('\n');
    for (const l of lines) {
      const match = l.match(/^\s*[0-9a-fA-F]+:\s+(?:[0-9a-fA-F]{2}\s+)+\s*(.+)$/);
      if (match) {
        const asm = match[1].trim();
        if (asm && !asm.startsWith('.')) {
          asmSample.push(asm);
          if (asmSample.length >= 3) break;
        }
      }
    }
  }
  if (asmSample.length === 0 && assemblyContent) {
    const lines = assemblyContent.split('\n');
    for (const l of lines) {
      const t = l.trim();
      if (t && !t.startsWith('.') && !t.endsWith(':') && !t.startsWith('#')) {
        asmSample.push(t);
        if (asmSample.length >= 3) break;
      }
    }
  }
  if (asmSample.length === 0) {
    asmSample.push('pushq %rbp', 'movq %rsp, %rbp', 'callq 0x0 <add>');
  }

  // 2. Machine Mappings (Instruction to Hex Bytes) dynamically parsed from disassembly artifact
  const machineMappings: { asm: string; hex: string }[] = [];
  if (objectDisassembly) {
    const lines = objectDisassembly.split('\n');
    for (const line of lines) {
      // Matches objdump style: " 1a: c7 45 fc 05 00 00 00   movl $0x5, -0x4(%rbp)"
      const match = line.match(/^\s*[0-9a-fA-F]+:\s+([0-9a-fA-F ]{2,24})\s+(.+)$/);
      if (match) {
        const hex = match[1].trim().replace(/\s+/g, ' ');
        const asm = match[2].trim();
        if (hex && asm && !asm.startsWith('.')) {
          machineMappings.push({ asm, hex });
          if (machineMappings.length >= 3) break;
        }
      }
    }
  }
  if (machineMappings.length === 0) {
    machineMappings.push(
      { asm: 'pushq %rbp', hex: '55' },
      { asm: 'movq %rsp, %rbp', hex: '48 89 e5' },
      { asm: 'movl %edi, -0x4(%rbp)', hex: '89 7d fc' }
    );
  }

  // 3. Sections dynamically derived from object disassembly header and directives
  const detectedSections: { name: string; desc: string }[] = [];
  
  // Extract sections mentioned in disassembly output (e.g., "Disassembly of section .text:")
  const sectionMatches = [...objectDisassembly.matchAll(/Disassembly of section\s+([.\w]+):/g)];
  if (sectionMatches.length > 0) {
    for (const m of sectionMatches) {
      const secName = m[1];
      let desc = 'object code segment';
      if (secName === '.text') desc = 'executable instructions';
      else if (secName === '.rodata') desc = 'read-only constants';
      else if (secName === '.data') desc = 'initialized writable data';
      else if (secName === '.bss') desc = 'zero/uninitialized data';
      if (!detectedSections.some(s => s.name === secName)) {
        detectedSections.push({ name: secName, desc });
      }
    }
  }

  // Check assembly or text fallback if no section match found
  if (detectedSections.length === 0) {
    detectedSections.push({ name: '.text', desc: 'executable instructions' });
    if (fullText.includes('.rodata') || fullText.includes('.str') || fullText.includes('rodata')) {
      detectedSections.push({ name: '.rodata', desc: 'read-only constants' });
    }
    if (fullText.includes('.data')) {
      detectedSections.push({ name: '.data', desc: 'initialized writable data' });
    }
    if (fullText.includes('.bss')) {
      detectedSections.push({ name: '.bss', desc: 'zero/uninitialized data' });
    }
  }

  // 4. Function names and symbols derived from actual artifact (<func_name>: or label:)
  const symbolsSet = new Set<string>();

  // Extract function labels like "0000000000000000 <add>:" from disassembly
  const disasmSymbols = [...objectDisassembly.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)>:/g)];
  for (const match of disasmSymbols) {
    symbolsSet.add(match[1]);
  }

  // Extract labels like "main:" or ".globl main" from assembly content if needed
  if (symbolsSet.size === 0 && assemblyContent) {
    const asmLabels = [...assemblyContent.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*):/gm)];
    for (const match of asmLabels) {
      if (!match[1].startsWith('.')) {
        symbolsSet.add(match[1]);
      }
    }
  }

  // Fallback if no specific symbols detected
  if (symbolsSet.size === 0) {
    symbolsSet.add('main');
  }

  // 5. Relocations derived from current artifact (callq addresses, PLT references, relocation records)
  const relocationsSet = new Set<string>();

  // Parse callq target addresses or relocation comments from disassembly
  const relocMatches = [...objectDisassembly.matchAll(/callq\s+([0-9a-fA-F]+|<[^>]+>)/g)];
  for (const m of relocMatches) {
    relocationsSet.add(`call target ${m[1]}`);
  }

  // Check for R_X86_64 relocations or library references in text
  if (fullText.includes('printf') || fullText.includes('@PLT')) {
    relocationsSet.add('printf (PLT relocation)');
  }
  if (fullText.includes('leaq') && fullText.includes('rip')) {
    relocationsSet.add('RIP-relative symbol relocation');
  }

  if (relocationsSet.size === 0) {
    relocationsSet.add('relative call offsets');
  }

  return {
    asmSample,
    machineMappings,
    sections: detectedSections,
    symbols: Array.from(symbolsSet),
    relocations: Array.from(relocationsSet)
  };
}

function extractAssemblyVisualData(llvmIrContent: string, assemblyContent: string): AssemblyVisualData {
  let llvmSample: string[] = [];
  let funcNames: string[] = [];
  
  if (llvmIrContent) {
    const irLines = llvmIrContent.split('\n');
    
    // Extract real function names defined in LLVM IR
    for (const line of irLines) {
      const match = line.match(/define\s+[^@]*@([A-Za-z0-9_]+)\s*\(/);
      if (match && match[1]) {
        if (!funcNames.includes(match[1])) {
          funcNames.push(match[1]);
        }
      }
    }

    // Extract real IR instruction lines (operations, assignments, calls, rets, stores, loads, alloca, etc.)
    const matching = irLines.filter(line => {
      const t = line.trim();
      return (
        !t.startsWith(';') &&
        !t.startsWith('source_filename') &&
        !t.startsWith('target ') &&
        !t.startsWith('attributes ') &&
        !t.startsWith('!') &&
        t.length > 0 &&
        (t.includes(' = ') || t.startsWith('store ') || t.startsWith('ret ') || t.startsWith('call ') || t.startsWith('br '))
      );
    });

    if (matching.length > 0) {
      llvmSample = matching.slice(0, 3).map(l => l.trim());
    }
  }

  // Fallback IR samples and function names if parsing yielded none
  if (llvmSample.length === 0) {
    llvmSample = ['%3 = add nsw i32 %1, %2', 'ret i32 %3'];
  }
  if (funcNames.length === 0) {
    funcNames = ['main'];
  }

  let instructions: string[] = [];
  const foundOpcodes: string[] = [];
  const regMap: Map<string, string> = new Map();

  if (assemblyContent) {
    const asmLines = assemblyContent.split('\n');
    for (const line of asmLines) {
      const t = line.trim();
      if (!t || t.startsWith('.') || t.endsWith(':') || t.startsWith('#')) continue;

      // Split instruction opcode and operands
      const parts = t.split(/\s+/);
      const opcode = parts[0];

      if (opcode && /^[a-z]+[0-9]*$/i.test(opcode)) {
        if (!foundOpcodes.includes(opcode.toLowerCase())) {
          foundOpcodes.push(opcode.toLowerCase());
        }
      }

      // Extract register references (%rax, %rbp, %edi, %esi, %eax, %rsp, %rdi, etc.)
      const regsInLine = [...line.matchAll(/%(r[a-z0-9]+|e[a-z0-9]+|[a-z]{2})/gi)].map(m => m[0]);
      if (regsInLine.length > 0) {
        if (opcode.startsWith('mov') || opcode.startsWith('add') || opcode.startsWith('sub') || opcode.startsWith('lea')) {
          const mainReg = regsInLine[regsInLine.length - 1]; // destination register is usually last in AT&T syntax
          if (!regMap.has(mainReg)) {
            let label = 'temp / result';
            if (regsInLine.includes('%edi') || regsInLine.includes('%rdi')) label = 'arg 1 (rdi)';
            else if (regsInLine.includes('%esi') || regsInLine.includes('%rsi')) label = 'arg 2 (rsi)';
            else if (regsInLine.includes('%rbp') || regsInLine.includes('%rsp')) label = 'stack frame ptr';
            else if (mainReg.includes('ax')) label = 'return val / temp';
            regMap.set(mainReg, label);
          }
        }
      }
    }

    if (foundOpcodes.length > 0) {
      const priority = ['movl', 'movq', 'addl', 'subq', 'leaq', 'callq', 'retq', 'pushq', 'popq', 'xorl'];
      const sorted = [...foundOpcodes].sort((a, b) => {
        const idxA = priority.indexOf(a);
        const idxB = priority.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
      instructions = sorted.slice(0, 5);
    }
  }

  if (instructions.length === 0) {
    instructions = ['movl', 'addl', 'retq'];
  }

  // Build real or fallback register allocation pairs
  const regAllocPairs: { virtualOrName: string; regOrLoc: string }[] = [];
  if (regMap.size > 0) {
    regMap.forEach((label, reg) => {
      if (regAllocPairs.length < 3) {
        regAllocPairs.push({ virtualOrName: label, regOrLoc: reg });
      }
    });
  }

  if (regAllocPairs.length === 0) {
    regAllocPairs.push(
      { virtualOrName: 'arg 1', regOrLoc: '%edi' },
      { virtualOrName: 'return value', regOrLoc: '%eax' }
    );
  }

  return { llvmSample, funcNames, regAllocPairs, instructions };
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

  const completedCount = COMPILATION_STAGES.filter(
    (s) => (stageArtifacts[s.id]?.status || (s.id === 'source' ? 'completed' : 'pending')) === 'completed'
  ).length;
  const runningCount = COMPILATION_STAGES.filter(
    (s) => stageArtifacts[s.id]?.status === 'running'
  ).length;
  const progressPercent = Math.min(
    100,
    Math.round(((completedCount + (runningCount ? 0.5 : 0)) / COMPILATION_STAGES.length) * 100)
  );

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
        <div className="pipeline-header">
          <div className="pipeline-title">Compilation Stages (Select any stage to inspect output artifacts line-by-line)</div>
          {isVisualizing && (
            <div className="pipeline-status">
              <span className="pipeline-status-dot" />
              Flowing through stage... ({progressPercent}%)
            </div>
          )}
        </div>

        <div className="pipeline-progress-bar">
          <div className="pipeline-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="pipeline-steps">
          {COMPILATION_STAGES.map((stage, index) => {
            const currentStatus = stageArtifacts[stage.id]?.status || (stage.id === 'source' ? 'completed' : 'pending');
            const isSelected = stage.id === selectedStageId;
            const hasPriorError = COMPILATION_STAGES.slice(0, index).some(
              (s) => stageArtifacts[s.id]?.status === 'error'
            );
            const isNotReached = currentStatus === 'pending' && hasPriorError;
            const nextStageStatus = stageArtifacts[COMPILATION_STAGES[index + 1]?.id]?.status;

            return (
              <React.Fragment key={stage.id}>
                <div 
                  className={`stage-card ${currentStatus} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedStageId(stage.id)}
                >
                  <div className="stage-info">
                    <span className="stage-number">{isNotReached ? 'Not reached' : `Stage ${index + 1}`}</span>
                    <span className="stage-name">{stage.name}</span>
                  </div>
                  <div className="stage-icon-badge">
                    {currentStatus === 'completed' && <Check size={14} className="check-pop" />}
                    {currentStatus === 'running' && <Loader2 size={14} className="spinner" />}
                    {currentStatus === 'pending' && !isNotReached && <span style={{ fontSize: '10px' }}>{index + 1}</span>}
                    {currentStatus === 'error' && <span style={{ fontSize: '10px', color: '#ef4444' }}>✕</span>}
                  </div>
                </div>

                {index < COMPILATION_STAGES.length - 1 && (
                  <div className={`arrow-divider ${nextStageStatus === 'completed' || nextStageStatus === 'running' ? 'active' : ''} ${currentStatus === 'running' ? 'pulse-flow' : ''}`}>
                    <span className="flow-dot" />
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

          {/* Preprocessing Stage Flow Visualizer */}
          {selectedStageId === 'preprocessing' && (() => {
            const detectedIncludes = getIncludes(code);
            const detectedMacros = getMacros(code);

            const displayIncludes = detectedIncludes.slice(0, 3);
            const hasMoreIncludes = detectedIncludes.length > 3;

            const displayMacros = detectedMacros.slice(0, 3);
            const hasMoreMacros = detectedMacros.length > 3;

            return (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                marginBottom: '1rem',
                padding: '1rem',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                overflowX: 'auto'
              }}>
                <div style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  minWidth: '130px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.2rem' }}>
                    main.c
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Source C Code
                  </div>
                </div>

                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />

                <div style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  minWidth: '130px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.2rem' }}>
                    Include Expansion
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {displayIncludes.length === 0 ? (
                      <div>No includes</div>
                    ) : (
                      <>
                        {displayIncludes.map((inc, i) => (
                          <div key={i}>{inc}</div>
                        ))}
                        {hasMoreIncludes && <div>+{detectedIncludes.length - 3} more</div>}
                      </>
                    )}
                  </div>
                </div>

                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />

                <div style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  minWidth: '130px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.2rem' }}>
                    Macro Replacement
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {displayMacros.length === 0 ? (
                      <div>No macros</div>
                    ) : (
                      <>
                        {displayMacros.map((mac, i) => (
                          <div key={i}>{mac}</div>
                        ))}
                        {hasMoreMacros && <div>+{detectedMacros.length - 3} more</div>}
                      </>
                    )}
                  </div>
                </div>

                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />

                <div style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  minWidth: '130px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.2rem' }}>
                    Comment Removal
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Comments removed
                  </div>
                </div>

                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />

                <div style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  minWidth: '130px'
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.2rem' }}>
                    main.i
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Preprocessed C
                  </div>
                </div>
              </div>
            );
          })()}

          {/* LLVM IR Frontend Stage Flow Visualizer */}
          {selectedStageId === 'llvm_ir' && (() => {
            const hasError = stageArtifacts['llvm_ir']?.status === 'error';
            const llvmData = extractLlvmVisualData(code, hasError);

            return (
              <div className="llvm-visual-flow">
                <div className="llvm-flow-title">Frontend Compilation Pipeline Visualizer</div>
                
                <div className="llvm-cards-wrapper">
                  {/* Step 1: Input main.i */}
                  <div className="llvm-card">
                    <div className="llvm-card-header">
                      <span className="llvm-step-number">Step 1</span>
                      <span className="llvm-card-title">main.i</span>
                    </div>
                    <div className="llvm-card-body">
                      <div className="llvm-card-desc">Preprocessed source input code ready for parsing.</div>
                      <div className="llvm-card-subtext font-mono">Input: main.i</div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="llvm-arrow" />

                  {/* Step 2: Lexical Analysis / Tokens */}
                  <div className="llvm-card">
                    <div className="llvm-card-header">
                      <span className="llvm-step-number">Step 2</span>
                      <span className="llvm-card-title">Lexical Analysis</span>
                    </div>
                    <div className="llvm-card-body">
                      <div className="llvm-card-label">Tokens:</div>
                      <div className="token-pills-grid">
                        {llvmData.tokens.map((tok, idx) => (
                          <span key={idx} className="token-pill">{tok}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="llvm-arrow" />

                  {/* Step 3: Parsing / AST */}
                  <div className="llvm-card">
                    <div className="llvm-card-header">
                      <span className="llvm-step-number">Step 3</span>
                      <span className="llvm-card-title">Parsing / AST</span>
                    </div>
                    <div className="llvm-card-body">
                      <div className="ast-tag">Simplified AST Representation</div>
                      <div className="ast-tree font-mono">
                        <div>Function: <span className="ast-highlight">{llvmData.ast.functionName}</span></div>
                        <div>├── Return Type: <span className="ast-type">{llvmData.ast.returnType}</span></div>
                        <div>└── Body</div>
                        <div>&nbsp;&nbsp;&nbsp;&nbsp;└── Return: <span className="ast-val">{llvmData.ast.returnValue}</span></div>
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="llvm-arrow" />

                  {/* Step 4: Semantic Analysis */}
                  <div className="llvm-card">
                    <div className="llvm-card-header">
                      <span className="llvm-step-number">Step 4</span>
                      <span className="llvm-card-title">Semantic Analysis</span>
                    </div>
                    <div className="llvm-card-body">
                      {hasError ? (
                        <div className="check-fail" style={{ fontSize: '0.72rem', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                          {rawFileContent}
                        </div>
                      ) : (
                        <div className="semantic-checks">
                          <div className={llvmData.semanticChecks.typesChecked ? 'check-pass' : 'check-fail'}>
                            {llvmData.semanticChecks.typesChecked ? '✓ Types checked' : '✕ Type check failed'}
                          </div>
                          <div className={llvmData.semanticChecks.symbolsResolved ? 'check-pass' : 'check-fail'}>
                            {llvmData.semanticChecks.symbolsResolved ? '✓ Variables/functions resolved' : '✕ Symbol resolution failed'}
                          </div>
                          <div className={llvmData.semanticChecks.validReturnType ? 'check-pass' : 'check-fail'}>
                            {llvmData.semanticChecks.validReturnType ? '✓ Valid return type' : '✕ Return type invalid'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <ChevronRight size={18} className="llvm-arrow" />

                  {/* Step 5: LLVM IR */}
                  <div className="llvm-card llvm-card-target">
                    <div className="llvm-card-header">
                      <span className="llvm-step-number">Step 5</span>
                      <span className="llvm-card-title">LLVM IR</span>
                    </div>
                    <div className="llvm-card-body">
                      <div className="llvm-output-target font-mono" style={hasError ? { color: '#ef4444' } : undefined}>
                        {hasError ? 'LLVM IR not generated' : 'main.ll'}
                      </div>
                      <div className="llvm-card-desc">
                        {hasError ? 'Compilation failed during frontend processing.' : 'SSA Intermediate Representation generated below.'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Assembly Stage Visualizer */}
          {selectedStageId === 'assembly' && (() => {
            const llvmIrContent = stageArtifacts['llvm_ir']?.content || COMPILATION_STAGES.find(s => s.id === 'llvm_ir')?.getArtifactContent(code) || '';
            const assemblyContent = rawFileContent;
            const asmVisualData = extractAssemblyVisualData(llvmIrContent, assemblyContent);

            return (
              <div className="assembly-visual-flow">
                <div className="assembly-flow-title">Assembly Generation Flow</div>

                <div className="assembly-cards-wrapper">
                  {/* Step 1: LLVM IR (main.ll) */}
                  <div className="assembly-card">
                    <div className="assembly-card-header">
                      <span className="assembly-step-number">Step 1</span>
                      <span className="assembly-card-title">LLVM IR (main.ll)</span>
                    </div>
                    <div className="assembly-card-body">
                      <div className="assembly-card-desc">Target-independent IR input:</div>
                      <div className="assembly-code-box font-mono">
                        {asmVisualData.llvmSample.map((line, idx) => (
                          <div key={idx} className="assembly-code-line">{line}</div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="assembly-arrow" />

                  {/* Step 2: Instruction Selection */}
                  <div className="assembly-card">
                    <div className="assembly-card-header">
                      <span className="assembly-step-number">Step 2</span>
                      <span className="assembly-card-title">Instruction Selection</span>
                    </div>
                    <div className="assembly-card-body">
                      <div className="assembly-card-desc">
                        LLVM converts IR operations into target-specific machine instruction patterns.
                      </div>
                      {asmVisualData.funcNames.length > 0 && (
                        <div className="assembly-card-desc" style={{ marginTop: '0.4rem', fontSize: '0.75rem', opacity: 0.9 }}>
                          Functions: <span className="font-mono" style={{ color: '#38bdf8' }}>{asmVisualData.funcNames.join(', ')}</span>
                        </div>
                      )}
                      <div className="assembly-note-box">
                        <span className="assembly-note-tag">Note:</span> One LLVM IR instruction may map to multiple (or zero) assembly instructions depending on target architecture patterns.
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="assembly-arrow" />

                  {/* Step 3: Register Allocation */}
                  <div className="assembly-card">
                    <div className="assembly-card-header">
                      <span className="assembly-step-number">Step 3</span>
                      <span className="assembly-card-title">Register Allocation</span>
                    </div>
                    <div className="assembly-card-body">
                      <div className="assembly-card-desc">
                        Maps virtual IR values to physical CPU registers or stack locations:
                      </div>
                      <div className="assembly-code-box font-mono">
                        {asmVisualData.regAllocPairs.map((pair, idx) => (
                          <div key={idx} className="assembly-code-line">
                            <span className="asm-var">{pair.virtualOrName}</span> → <span className="asm-reg">{pair.regOrLoc}</span>
                          </div>
                        ))}
                      </div>
                      <div className="assembly-simulated-tag">(simplified explanation)</div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="assembly-arrow" />

                  {/* Step 4: Target Instructions */}
                  <div className="assembly-card">
                    <div className="assembly-card-header">
                      <span className="assembly-step-number">Step 4</span>
                      <span className="assembly-card-title">Target Instructions</span>
                    </div>
                    <div className="assembly-card-body">
                      <div className="assembly-card-desc">
                        Instructions derived from assembly output:
                      </div>
                      <div className="assembly-pills-grid">
                        {asmVisualData.instructions.map((inst, idx) => (
                          <span key={idx} className="assembly-inst-pill font-mono">{inst}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="assembly-arrow" />

                  {/* Step 5: Assembly (main.s) */}
                  <div className="assembly-card assembly-card-target">
                    <div className="assembly-card-header">
                      <span className="assembly-step-number">Step 5</span>
                      <span className="assembly-card-title">Assembly (main.s)</span>
                    </div>
                    <div className="assembly-card-body">
                      <div className="assembly-output-target font-mono">main.s</div>
                      <div className="assembly-card-desc">
                        Target-specific assembly generated.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Object Code Stage Educational Visualizer */}
          {selectedStageId === 'object_code' && (() => {
            const assemblyContent = stageArtifacts['assembly']?.content || COMPILATION_STAGES.find(s => s.id === 'assembly')?.getArtifactContent(code) || '';
            const objectDisassembly = rawFileContent;
            const objData = extractObjectCodeVisualData(assemblyContent, objectDisassembly);

            return (
              <div className="object-visual-flow">
                <div className="object-flow-title">Object Code Assembler Pipeline</div>

                <div className="object-cards-wrapper">
                  {/* Step 1: Assembly (main.s) */}
                  <div className="object-card">
                    <div className="object-card-header">
                      <span className="object-step-number">Step 1</span>
                      <span className="object-card-title">Assembly (main.s)</span>
                    </div>
                    <div className="object-card-body">
                      <div className="object-card-desc">Current assembly instructions:</div>
                      <div className="object-code-box font-mono">
                        {objData.asmSample.map((line, idx) => (
                          <div key={idx} className="object-code-line">{line}</div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="object-arrow" />

                  {/* Step 2: Assembler */}
                  <div className="object-card">
                    <div className="object-card-header">
                      <span className="object-step-number">Step 2</span>
                      <span className="object-card-title">Assembler</span>
                    </div>
                    <div className="object-card-body">
                      <div className="object-card-desc">
                        Converts assembly instructions &amp; directives into relocatable machine code and object-file data.
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="object-arrow" />

                  {/* Step 3: Machine Encoding */}
                  <div className="object-card">
                    <div className="object-card-header">
                      <span className="object-step-number">Step 3</span>
                      <span className="object-card-title">Machine Encoding</span>
                    </div>
                    <div className="object-card-body">
                      <div className="object-card-desc">Instruction to Hex Bytes:</div>
                      <div className="object-code-box font-mono">
                        {objData.machineMappings.map((m, idx) => (
                          <div key={idx} className="object-code-line" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.2rem' }}>
                            <span className="obj-asm">{m.asm}</span>
                            <span className="obj-hex font-mono">{m.hex}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="object-arrow" />

                  {/* Step 4: Sections / Symbols / Relocations */}
                  <div className="object-card">
                    <div className="object-card-header">
                      <span className="object-step-number">Step 4</span>
                      <span className="object-card-title">Sections / Symbols</span>
                    </div>
                    <div className="object-card-body">
                      <div className="object-card-label">Active Sections:</div>
                      <div className="object-sections-list">
                        {objData.sections.map((s, idx) => (
                          <div key={idx} className="object-section-item">
                            <span className="obj-sec-name">{s.name}</span>
                            <span className="obj-sec-desc">→ {s.desc}</span>
                          </div>
                        ))}
                      </div>
                      <div className="object-meta-box">
                        <div><span className="obj-meta-tag">Symbols:</span> {objData.symbols.join(', ')}</div>
                        <div><span className="obj-meta-tag">Relocations:</span> {objData.relocations.join(', ')}</div>
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={18} className="object-arrow" />

                  {/* Step 5: Object File (main.o) */}
                  <div className="object-card object-card-target">
                    <div className="object-card-header">
                      <span className="object-step-number">Step 5</span>
                      <span className="object-card-title">Object File</span>
                    </div>
                    <div className="object-card-body">
                      <div className="object-output-target font-mono">main.o</div>
                      <div className="object-card-subtext font-semibold">Relocatable object file</div>
                      <div className="object-card-desc">
                        Contains machine code &amp; metadata; not yet the final executable.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Linking Stage Visualizer */}
          {selectedStageId === 'linking' && (
            <div className="object-visual-flow">
              <div className="object-flow-title">Linking Stage Flow</div>

              <div className="object-cards-wrapper">
                {/* Step 1: Object File */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 1</span>
                    <span className="object-card-title">Object File</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-output-target font-mono">main.o</div>
                    <div className="object-card-subtext font-semibold">Relocatable object file</div>
                    <div className="object-card-desc">
                      External reference: <span className="font-mono">printf</span>
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 2: Symbol Resolution */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 2</span>
                    <span className="object-card-title">Symbol Resolution</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-card-desc font-mono" style={{ fontSize: '0.75rem' }}>
                      <div><span style={{ color: 'var(--primary)' }}>main/add</span> → defined in main.o</div>
                      <div><span style={{ color: 'var(--primary)' }}>printf</span> → resolved through runtime/library linkage</div>
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 3: Relocations */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 3</span>
                    <span className="object-card-title">Relocations</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-card-desc">
                      Linker adjusts addresses and offsets after final placement.
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 4: Libraries */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 4</span>
                    <span className="object-card-title">Libraries</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-card-subtext font-semibold">Dynamic Linking</div>
                    <div className="object-card-desc">
                      libc provides <span className="font-mono">printf</span> at runtime
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 5: Executable */}
                <div className="object-card object-card-target">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 5</span>
                    <span className="object-card-title">Executable</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-output-target font-mono">main</div>
                    <div className="object-card-subtext font-semibold">Linked executable</div>
                    <div className="object-card-desc">
                      Ready for OS loading
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Raw Artifact Output File Line Viewer */}
          {/* Execution Stage Visualizer */}
          {selectedStageId === 'execution' && (
            <div className="object-visual-flow">
              <div className="object-flow-title">Execution Stage Flow</div>

              <div className="object-cards-wrapper">
                {/* Step 1: Executable */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 1</span>
                    <span className="object-card-title">Executable</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-output-target font-mono">main</div>
                    <div className="object-card-subtext font-semibold">Binary executable</div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 2: OS Loader */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 2</span>
                    <span className="object-card-title">OS Loader</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-card-desc">
                      creates process and loads program
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 3: Process Memory */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 3</span>
                    <span className="object-card-title">Process Memory</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-sections-list font-mono" style={{ fontSize: '0.75rem' }}>
                      <div className="object-section-item"><span className="obj-sec-name">Stack</span></div>
                      <div className="object-section-item"><span className="obj-sec-name">Heap</span></div>
                      <div className="object-section-item"><span className="obj-sec-name">BSS</span></div>
                      <div className="object-section-item"><span className="obj-sec-name">Data</span></div>
                      <div className="object-section-item"><span className="obj-sec-name">Read-only Data</span></div>
                      <div className="object-section-item"><span className="obj-sec-name">Text/Code</span></div>
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 4: CPU Execution */}
                <div className="object-card">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 4</span>
                    <span className="object-card-title">CPU Execution</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-card-desc">
                      executes machine instructions
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="object-arrow" />

                {/* Step 5: stdout */}
                <div className="object-card object-card-target">
                  <div className="object-card-header">
                    <span className="object-step-number">Step 5</span>
                    <span className="object-card-title">stdout</span>
                  </div>
                  <div className="object-card-body">
                    <div className="object-output-target font-mono" style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {(() => {
                        const startIdx = rawFileContent.indexOf('Program Standard Output (stdout)');
                        const endIdx = rawFileContent.indexOf('Process Metadata');
                        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                          const section = rawFileContent.substring(startIdx + 'Program Standard Output (stdout)'.length, endIdx);
                          const lines = section.split('\n').map(l => l.replace(/^[-=]+/, '').trim()).filter(Boolean);
                          return lines.join('\n') || rawFileContent;
                        } else if (startIdx !== -1) {
                          const section = rawFileContent.substring(startIdx + 'Program Standard Output (stdout)'.length);
                          const lines = section.split('\n').map(l => l.replace(/^[-=]+/, '').trim()).filter(Boolean);
                          return lines.join('\n') || rawFileContent;
                        }
                        return rawFileContent;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
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
