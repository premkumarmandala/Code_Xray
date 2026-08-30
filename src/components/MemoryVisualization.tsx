import { useState, useEffect } from 'react';
import { 
  Cpu, 
  Database, 
  Play, 
  Pause, 
  Zap, 
  ArrowDown, 
  ArrowUp, 
  Binary, 
  HardDrive,
  Activity,
  Info,
  Sliders
} from 'lucide-react';
import type { DebugData, StackFrame, VariableInfo } from './CallStackModal';

interface MemoryVisualizationProps {
  code: string;
  debugData: DebugData | null;
  selectedFrameIndex?: number | null;
}

export interface RAMCell {
  address: string;
  addressBigInt: bigint;
  segment: 'stack' | 'heap' | 'bss' | 'data' | 'text';
  varName?: string;
  varType?: string;
  value: string;
  hexValue: string;
  binaryValue: string;
  sizeBytes: number;
  frameFunction?: string;
  isAccessing?: boolean;
  accessType?: 'read' | 'write' | 'none';
}

// Helper: Normalize hex address string to canonical uppercase format e.g. "0x00007FFFFFFFE42C" -> "0x7FFFFFFFE42C"
export const normalizeAddress = (addrStr?: string | null): string | null => {
  if (!addrStr) return null;
  const cleaned = addrStr.trim();
  try {
    if (cleaned.startsWith('0x') || cleaned.startsWith('0X')) {
      const bg = BigInt(cleaned);
      return '0x' + bg.toString(16).toUpperCase();
    }
    const bg = BigInt('0x' + cleaned);
    return '0x' + bg.toString(16).toUpperCase();
  } catch (e) {
    return cleaned.toUpperCase();
  }
};

// Helper: Convert BigInt address to BigInt value
export const parseAddressToBigInt = (addrStr?: string | null): bigint => {
  if (!addrStr) return 0n;
  try {
    const cleaned = addrStr.trim();
    if (cleaned.startsWith('0x') || cleaned.startsWith('0X')) {
      return BigInt(cleaned);
    }
    return BigInt('0x' + cleaned);
  } catch (e) {
    return 0n;
  }
};

// Helper: Deterministic address retriever so Call Stack and Memory Visualization share 100% identical addresses
export function getVariableAddress(
  v: VariableInfo, 
  frameIndex: number, 
  varIndex: number, 
  rbpAddress?: string | null
): string {
  if (v.address) {
    const norm = normalizeAddress(v.address);
    if (norm) return norm;
  }
  const baseBigInt = parseAddressToBigInt(rbpAddress) || 0x7FFE4B30n;
  const offset = BigInt((frameIndex + 1) * 0x20 + (varIndex + 1) * 0x08);
  const derivedBigInt = baseBigInt > offset ? baseBigInt - offset : 0x7FFE4B00n - offset;
  return '0x' + derivedBigInt.toString(16).toUpperCase();
}

// Helper: Convert value string into Hex & Binary without 32-bit truncation
const convertValueToHexBin = (valStr: string, sizeBytes: number) => {
  let hex = '0x00000000';
  let bin = '0'.repeat(32);

  try {
    const trimmed = valStr.trim();
    // 1. Integer string e.g. "10" or "-5"
    if (/^-?\d+$/.test(trimmed)) {
      const num = BigInt(trimmed);
      const hexDigits = Math.max(sizeBytes * 2, 8);
      
      let unsignedBg = num;
      if (num < 0n) {
        const bitWidth = BigInt(sizeBytes * 8);
        unsignedBg = (1n << bitWidth) + num;
      }
      
      const rawHex = unsignedBg.toString(16).toUpperCase().padStart(hexDigits, '0');
      hex = '0x' + rawHex;
      
      const rawBin = unsignedBg.toString(2).padStart(sizeBytes * 8, '0');
      bin = rawBin;
      return { hex, bin };
    }

    // 2. Hex pointer e.g. "0x00007fffffffe42c"
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      const bg = BigInt(trimmed);
      hex = '0x' + bg.toString(16).toUpperCase();
      bin = bg.toString(2).padStart(sizeBytes * 8, '0');
      return { hex, bin };
    }

    // 3. String literal or float / expression
    let charCode = 0n;
    for (let i = 0; i < Math.min(trimmed.length, 8); i++) {
      charCode = (charCode << 8n) | BigInt(trimmed.charCodeAt(i));
    }
    hex = '0x' + charCode.toString(16).toUpperCase();
    bin = charCode.toString(2).padStart(32, '0');
  } catch (e) {
    hex = '0x00000000';
    bin = '0'.repeat(32);
  }

  return { hex, bin };
};

export function MemoryVisualization({ debugData }: MemoryVisualizationProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(1); // 0.5x, 1x, 2x
  const [clockCycle, setClockCycle] = useState<number>(1024);
  const [busAddress, setBusAddress] = useState<string>('0x7FFE4B28');
  const [busData, setBusData] = useState<string>('0x0000000A');
  const [busOperation, setBusOperation] = useState<'READ' | 'WRITE' | 'IDLE'>('READ');
  const [selectedCell, setSelectedCell] = useState<RAMCell | null>(null);
  const [activeSegmentFilter, setActiveSegmentFilter] = useState<string>('all');

  // Extract frames
  const frames: StackFrame[] = debugData?.frames || [];

  // Generate real hardware memory cells for RAM Architecture directly from LLDB debug session
  const generateRAMCells = (): RAMCell[] => {
    const cells: RAMCell[] = [];

    const getSegmentByAddress = (addrBigInt: bigint): 'stack' | 'heap' | 'bss' | 'data' | 'text' => {
      if (addrBigInt >= 0x70000000n || addrBigInt >= 0x700000000000n) {
        return 'stack';
      }
      if (addrBigInt >= 0x555555560000n) {
        return 'heap';
      }
      if (addrBigInt >= 0x555555558000n || (addrBigInt >= 0x600000n && addrBigInt < 0x700000n)) {
        return 'data';
      }
      return 'text';
    };

    const rbpVal = debugData?.registers?.rbp || debugData?.registers?.RBP || null;

    // 1. Process CPU Registers from real LLDB debugger session
    if (debugData?.registers) {
      Object.entries(debugData.registers).forEach(([regName, regVal]) => {
        if (regVal) {
          const bg = parseAddressToBigInt(regVal);
          if (bg > 0n) {
            const hexAddr = normalizeAddress(regVal)!;
            const isStackReg = ['rsp', 'rbp'].includes(regName.toLowerCase());
            const isTextReg = regName.toLowerCase() === 'rip';
            const segment = isStackReg ? 'stack' : (isTextReg ? 'text' : 'data');
            const { hex, bin } = convertValueToHexBin(regVal, 8);

            cells.push({
              address: hexAddr,
              addressBigInt: bg,
              segment: segment,
              varName: `[CPU Register %${regName.toUpperCase()}]`,
              varType: 'register_64',
              value: regVal,
              hexValue: hex,
              binaryValue: bin,
              sizeBytes: 8
            });
          }
        }
      });
    }

    // 2. Process Real Stack Frames & Variables
    if (frames && frames.length > 0) {
      frames.forEach((frame, fIdx) => {
        // Frame PC Execution Pointer
        if (frame.address) {
          const pcBg = parseAddressToBigInt(frame.address);
          if (pcBg > 0n) {
            const pcHex = normalizeAddress(frame.address)!;
            const { hex, bin } = convertValueToHexBin(frame.address, 8);
            cells.push({
              address: pcHex,
              addressBigInt: pcBg,
              segment: 'text',
              varName: `[Frame #${frame.index} ${frame.function}() PC Pointer]`,
              varType: 'code_instruction',
              value: frame.address,
              hexValue: hex,
              binaryValue: bin,
              sizeBytes: 8,
              frameFunction: frame.function
            });
          }
        }

        // Frame Local Variables & Parameters
        if (frame.variables && frame.variables.length > 0) {
          frame.variables.forEach((v, vIdx) => {
            const varAddrHex = getVariableAddress(v, fIdx, vIdx, rbpVal);
            const varAddrBigInt = parseAddressToBigInt(varAddrHex);
            const size = v.size_bytes || (v.type.includes('*') ? 8 : (v.type === 'double' || v.type === 'long' ? 8 : 4));
            const { hex, bin } = convertValueToHexBin(v.value, size);
            const segment = getSegmentByAddress(varAddrBigInt);

            cells.push({
              address: varAddrHex,
              addressBigInt: varAddrBigInt,
              segment: segment,
              varName: v.name,
              varType: v.type,
              value: v.value,
              hexValue: hex,
              binaryValue: bin,
              sizeBytes: size,
              frameFunction: frame.function
            });
          });
        }
      });
    }

    // STRICT SORTING BY MEMORY ADDRESS: High Address (0x7FFF...) to Low Address (0x0040...)
    cells.sort((a, b) => (b.addressBigInt > a.addressBigInt ? 1 : b.addressBigInt < a.addressBigInt ? -1 : 0));

    // De-duplicate by exact address
    const uniqueCells: RAMCell[] = [];
    const seenAddresses = new Set<string>();
    for (const cell of cells) {
      if (!seenAddresses.has(cell.address)) {
        seenAddresses.add(cell.address);
        uniqueCells.push(cell);
      }
    }

    return uniqueCells;
  };

  const [ramCells, setRamCells] = useState<RAMCell[]>(generateRAMCells());

  // Update RAM cells when debugData changes
  useEffect(() => {
    const updated = generateRAMCells();
    setRamCells(updated);
    if (updated.length > 0 && !selectedCell) {
      setSelectedCell(updated[0]);
    }
  }, [debugData]);

  // Clock Pulse Simulation for System Bus
  useEffect(() => {
    let interval: any = null;
    if (isPlaying && ramCells.length > 0) {
      interval = setInterval(() => {
        setClockCycle((prev) => prev + 1);

        // Pick random cell for bus signal animation
        const randomIndex = Math.floor(Math.random() * ramCells.length);
        const cell = ramCells[randomIndex];
        setBusAddress(cell.address);
        setBusData(cell.hexValue);
        setBusOperation(Math.random() > 0.4 ? 'READ' : 'WRITE');

        // Flash memory cell access
        setRamCells((prev) =>
          prev.map((c, i) => ({
            ...c,
            isAccessing: i === randomIndex,
            accessType: i === randomIndex ? (Math.random() > 0.4 ? 'read' : 'write') : 'none'
          }))
        );
      }, 1200 / speed);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, speed, ramCells]);

  const filteredCells = ramCells.filter((c) => {
    if (activeSegmentFilter === 'all') return true;
    return c.segment === activeSegmentFilter;
  });

  const getSegmentBadgeColor = (seg: string) => {
    switch (seg) {
      case 'stack': return { bg: 'rgba(192, 132, 252, 0.15)', text: '#c084fc', border: 'rgba(192, 132, 252, 0.4)' };
      case 'heap': return { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.4)' };
      case 'bss': return { bg: 'rgba(251, 146, 60, 0.15)', text: '#fb923c', border: 'rgba(251, 146, 60, 0.4)' };
      case 'data': return { bg: 'rgba(74, 222, 128, 0.15)', text: '#4ade80', border: 'rgba(74, 222, 128, 0.4)' };
      case 'text': return { bg: 'rgba(244, 114, 182, 0.15)', text: '#f472b6', border: 'rgba(244, 114, 182, 0.4)' };
      default: return { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.4)' };
    }
  };

  return (
    <div className="ram-architecture-container">
      {/* Top Architecture Controls & System Bus Panel */}
      <div className="ram-system-bus-panel">
        <div className="bus-header-group">
          <div className="bus-title-badge">
            <Cpu size={20} className="text-primary" />
            <div>
              <h3 className="ram-panel-title">Computer Hardware RAM Memory Controller</h3>
              <p className="ram-panel-sub">64-bit Virtual Memory Bus & Animated Hardware Execution Traces</p>
            </div>
          </div>

          {/* Animation & Speed Controls */}
          <div className="bus-controls">
            <button 
              className={`ram-ctrl-btn ${isPlaying ? 'active' : ''}`}
              onClick={() => setIsPlaying(!isPlaying)}
              title={isPlaying ? "Pause Bus Clock" : "Resume Bus Clock"}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            <div className="speed-selector">
              <Sliders size={13} className="text-muted" />
              <button className={`speed-btn ${speed === 0.5 ? 'active' : ''}`} onClick={() => setSpeed(0.5)}>0.5x</button>
              <button className={`speed-btn ${speed === 1 ? 'active' : ''}`} onClick={() => setSpeed(1)}>1x</button>
              <button className={`speed-btn ${speed === 2 ? 'active' : ''}`} onClick={() => setSpeed(2)}>2x</button>
            </div>
          </div>
        </div>

        {/* Live System Bus Signals Display */}
        <div className="bus-signals-grid">
          {/* Address Bus */}
          <div className="bus-signal-card address-bus">
            <div className="bus-label">
              <Zap size={14} className="bus-icon text-amber" />
              <span>ADDRESS BUS (64-BIT)</span>
            </div>
            <div className="bus-value font-mono">{busAddress}</div>
            <div className="bus-signal-line active-amber"></div>
          </div>

          {/* Data Bus */}
          <div className="bus-signal-card data-bus">
            <div className="bus-label">
              <Binary size={14} className="bus-icon text-cyan" />
              <span>DATA BUS (64-BIT PAYLOAD)</span>
            </div>
            <div className="bus-value font-mono">{busData}</div>
            <div className="bus-signal-line active-cyan"></div>
          </div>

          {/* Control Bus */}
          <div className="bus-signal-card control-bus">
            <div className="bus-label">
              <Activity size={14} className="bus-icon text-green" />
              <span>CONTROL BUS</span>
            </div>
            <div className="bus-value-group">
              <span className={`op-badge ${busOperation.toLowerCase()}`}>{busOperation}</span>
              <span className="clock-count font-mono">CLK: #{clockCycle}</span>
            </div>
            <div className="bus-signal-line active-green"></div>
          </div>
        </div>
      </div>

      {/* Main RAM Segments & Inspector Split View */}
      <div className="ram-layout-grid">
        {/* Left Column: Full RAM Architecture Memory Map */}
        <div className="ram-memory-map-section">
          {/* Memory Segment Filter Tabs */}
          <div className="ram-segment-tabs">
            <button 
              className={`ram-tab ${activeSegmentFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveSegmentFilter('all')}
            >
              All Segments ({ramCells.length})
            </button>
            <button 
              className={`ram-tab stack-tab ${activeSegmentFilter === 'stack' ? 'active' : ''}`}
              onClick={() => setActiveSegmentFilter('stack')}
            >
              Stack (High)
            </button>
            <button 
              className={`ram-tab heap-tab ${activeSegmentFilter === 'heap' ? 'active' : ''}`}
              onClick={() => setActiveSegmentFilter('heap')}
            >
              Heap
            </button>
            <button 
              className={`ram-tab data-tab ${activeSegmentFilter === 'data' ? 'active' : ''}`}
              onClick={() => setActiveSegmentFilter('data')}
            >
              Data / BSS
            </button>
            <button 
              className={`ram-tab text-tab ${activeSegmentFilter === 'text' ? 'active' : ''}`}
              onClick={() => setActiveSegmentFilter('text')}
            >
              Text (Code)
            </button>
          </div>

          {/* Hardware RAM High -> Low Memory Map Representation */}
          <div className="ram-cells-container">
            <div className="address-boundary high-addr">
              <span>0x7FFFFFFF (High Address - User Stack Top)</span>
              <ArrowDown size={14} className="bounce-down text-purple" />
            </div>

            <div className="ram-cells-list">
              {filteredCells.length === 0 ? (
                <div className="ram-empty-inspector" style={{ padding: '2rem 1rem' }}>
                  <Database size={28} className="text-muted" />
                  <p style={{ fontSize: '0.82rem' }}>No active real variables or registers captured in this memory segment.</p>
                </div>
              ) : (
                filteredCells.map((cell) => {
                  const isSelected = selectedCell?.address === cell.address;
                  const colors = getSegmentBadgeColor(cell.segment);

                  return (
                    <div
                      key={cell.address}
                      className={`ram-cell-row ${cell.segment} ${isSelected ? 'selected' : ''} ${cell.isAccessing ? `bus-access-${cell.accessType}` : ''}`}
                      onClick={() => setSelectedCell(cell)}
                    >
                      {/* Hex Memory Address */}
                      <div className="ram-cell-address font-mono">{cell.address}</div>

                      {/* Segment Indicator */}
                      <div 
                        className="ram-cell-seg-badge" 
                        style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
                      >
                        {cell.segment.toUpperCase()}
                      </div>

                      {/* Variable Name & Type */}
                      <div className="ram-cell-info">
                        <span className="var-name font-semibold">{cell.varName || 'Unallocated Memory'}</span>
                        {cell.varType && <span className="var-type">({cell.varType})</span>}
                        {cell.frameFunction && <span className="frame-tag">in {cell.frameFunction}()</span>}
                      </div>

                      {/* Value in Cell */}
                      <div className="ram-cell-val font-mono">
                        {cell.hexValue}
                      </div>

                      {cell.isAccessing && (
                        <span className={`access-pulse-tag ${cell.accessType}`}>
                          {cell.accessType?.toUpperCase()} SIGNAL
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="address-boundary low-addr">
              <ArrowUp size={14} className="bounce-up text-pink" />
              <span>0x00400000 (Low Address - Code / Text Segment)</span>
            </div>
          </div>
        </div>

        {/* Right Column: Hardware Inspector & Bit Breakdown */}
        <div className="ram-inspector-section">
          {selectedCell ? (
            <div className="ram-inspector-card">
              <div className="inspector-header">
                <HardDrive size={18} className="text-primary" />
                <h4 className="inspector-title">Hardware Memory Inspector</h4>
              </div>

              <div className="inspector-address-hero">
                <span className="address-label">Hex Memory Address</span>
                <span className="address-hex font-mono">{selectedCell.address}</span>
              </div>

              <div className="inspector-details-grid">
                <div className="detail-row">
                  <span className="detail-key">Variable / Block:</span>
                  <span className="detail-val font-semibold">{selectedCell.varName || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Data Type:</span>
                  <span className="detail-val font-mono">{selectedCell.varType || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">RAM Segment:</span>
                  <span className="detail-val uppercase" style={{ color: getSegmentBadgeColor(selectedCell.segment).text }}>
                    {selectedCell.segment} Segment
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Footprint Size:</span>
                  <span className="detail-val">{selectedCell.sizeBytes} Bytes</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Dec Value:</span>
                  <span className="detail-val font-mono">{selectedCell.value}</span>
                </div>
              </div>

              {/* Byte & Bit Breakdown Box */}
              <div className="binary-breakdown-box">
                <div className="breakdown-header">
                  <Binary size={14} className="text-cyan" />
                  <span>32-bit Memory Cell Binary Register</span>
                </div>
                <div className="binary-grid font-mono">
                  {selectedCell.binaryValue.match(/.{1,8}/g)?.map((byteStr, i) => (
                    <div key={i} className="byte-block">
                      <span className="byte-label">Byte #{i}</span>
                      <span className="byte-val">{byteStr}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* RAM Segment Architecture Description */}
              <div className="segment-explanation-box">
                <div className="explanation-title">
                  <Info size={14} className="text-amber" />
                  <span>Architecture Overview ({selectedCell.segment.toUpperCase()})</span>
                </div>
                <p className="explanation-text">
                  {selectedCell.segment === 'stack' && "Stack memory grows downward from high addresses. Stores local function variables, saved register frames (%rbp), and function return points."}
                  {selectedCell.segment === 'heap' && "Heap memory grows upward from low addresses. Managed dynamically via malloc() / free() or new / delete operations in C."}
                  {selectedCell.segment === 'bss' && "BSS (Block Started by Symbol) holds uninitialized static/global variables, automatically zeroed out by OS process loader."}
                  {selectedCell.segment === 'data' && "Data segment stores initialized global and static variables defined directly in the C source code."}
                  {selectedCell.segment === 'text' && "Text / Code segment contains read-only executable binary machine instructions loaded directly into RAM for CPU instruction fetch."}
                </p>
              </div>
            </div>
          ) : (
            <div className="ram-empty-inspector">
              <Database size={32} className="text-muted" />
              <p>Select any memory address cell on the left to inspect its hardware bytes and registers.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
