export interface StageData {
  id: string;
  name: string;
  inputFile: string;
  outputFile: string;
  explanation: string;
  getArtifactContent: (code: string) => string;
  terminalOutput: string;
}

export const SAMPLE_C_CODE = `#include <stdio.h>

#define MULTIPLIER 2

int add(int a, int b) {
    return a + b;
}

int main() {
    int x = 5;
    int y = 10;
    int sum = add(x, y);
    int result = sum * MULTIPLIER;
    
    printf("Result: %d\\n", result);
    return 0;
}
`;

export const COMPILATION_STAGES: StageData[] = [
  {
    id: 'source',
    name: 'Source',
    inputFile: 'main.c',
    outputFile: 'main.c',
    explanation: 'High-level C code written by the developer. This is human-readable code containing functions, preprocessor directives (#include, #define), and structured logic.',
    getArtifactContent: (code: string) => code,
    terminalOutput: '[Source] Loaded main.c. Ready for compilation pipeline.'
  },
  {
    id: 'preprocessing',
    name: 'Preprocessing',
    inputFile: 'main.c',
    outputFile: 'main.i',
    explanation: 'The preprocessor expands header files (#include), replaces macros (#define), strips comments, and handles conditional compilation instructions. The output is pure expanded C code.',
    getArtifactContent: (_code: string) => `# 1 "main.c"
# 1 "<built-in>" 1
# 1 "<built-in>" 3
# 410 "<built-in>" 3
# 1 "<command line>" 1
# 1 "<built-in>" 2
# 1 "main.c" 2
# 1 "/usr/include/stdio.h" 1 3 4
typedef unsigned long size_t;
int printf(const char * restrict format, ...);

int add(int a, int b) {
    return a + b;
}

int main() {
    int x = 5;
    int y = 10;
    int sum = add(x, y);
    int result = sum * 2;
    
    printf("Result: %d\\n", result);
    return 0;
}`,
    terminalOutput: '[Preprocessing] clang -E main.c -o main.i\n[Preprocessing] Expanded header directives and macros.'
  },
  {
    id: 'llvm_ir',
    name: 'LLVM IR',
    inputFile: 'main.i',
    outputFile: 'main.ll',
    explanation: 'Intermediate Representation (IR) is an instruction-set independent code representation. LLVM analyzes, optimizes, and transforms IR before generating machine assembly for target architectures.',
    getArtifactContent: () => `; ModuleID = 'main.c'
source_filename = "main.c"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@.str = private unnamed_addr constant [13 x i8] c"Result: %d\\0A\\00", align 1

define dso_local i32 @add(i32 %0, i32 %1) {
  %3 = alloca i32, align 4
  %4 = alloca i32, align 4
  store i32 %0, i32* %3, align 4
  store i32 %1, i32* %4, align 4
  %5 = load i32, i32* %3, align 4
  %6 = load i32, i32* %4, align 4
  %7 = add nsw i32 %5, %6
  ret i32 %7
}

define dso_local i32 @main() {
  %1 = alloca i32, align 4
  %2 = alloca i32, align 4
  %3 = alloca i32, align 4
  %4 = alloca i32, align 4
  %5 = alloca i32, align 4
  store i32 0, i32* %1, align 4
  store i32 5, i32* %2, align 4
  store i32 10, i32* %3, align 4
  %6 = load i32, i32* %2, align 4
  %7 = load i32, i32* %3, align 4
  %8 = call i32 @add(i32 %6, i32 %7)
  store i32 %8, i32* %4, align 4
  %9 = load i32, i32* %4, align 4
  %10 = mul nsw i32 %9, 2
  store i32 %10, i32* %5, align 4
  %11 = load i32, i32* %5, align 4
  %12 = call i32 (i8*, ...) @printf(i8* getelementptr inbounds ([13 x i8], [13 x i8]* @.str, i32 0, i32 0), i32 %11)
  ret i32 0
}`,
    terminalOutput: '[LLVM IR] clang -S -emit-llvm main.i -o main.ll\n[LLVM IR] Generated SSA-based Intermediate Representation.'
  },
  {
    id: 'assembly',
    name: 'Assembly',
    inputFile: 'main.ll',
    outputFile: 'main.s',
    explanation: 'Assembly code translates target-independent IR into target-specific CPU assembly instructions (e.g., x86_64). It manipulates registers, stack frames, and CPU instructions directly.',
    getArtifactContent: () => `\t.text
\t.file\t"main.c"
\t.globl\tadd
\t.type\tadd, @function
add:
\tpushq\t%rbp
\tmovq\t%rsp, %rbp
\tmovl\t%edi, -4(%rbp)
\tmovl\t%esi, -8(%rbp)
\tmovl\t-4(%rbp), %eax
\taddl\t-8(%rbp), %eax
\tpopq\t%rbp
\tret

\t.globl\tmain
\t.type\tmain, @function
main:
\tpushq\t%rbp
\tmovq\t%rsp, %rbp
\tsubq\t$16, %rsp
\tmovl\t$5, -4(%rbp)
\tmovl\t$10, -8(%rbp)
\tmovl\t-4(%rbp), %edi
\tmovl\t-8(%rbp), %esi
\tcall\tadd
\tshll\t$1, %eax
\tmovl\t%eax, -12(%rbp)
\tleaq\t.L.str(%rip), %rdi
\tmovl\t-12(%rbp), %esi
\txorl\t%eax, %eax
\tcall\tprintf@PLT
\txorl\t%eax, %eax
\taddq\t$16, %rsp
\tpopq\t%rbp
\tret`,
    terminalOutput: '[Assembly] clang -S main.ll -o main.s\n[Assembly] x86_64 target assembly instructions generated.'
  },
  {
    id: 'object_code',
    name: 'Object Code',
    inputFile: 'main.s',
    outputFile: 'main.o',
    explanation: 'An assembler translates text assembly instructions into binary object code (ELF format). It contains machine instructions, relocatable memory addresses, and symbol tables.',
    getArtifactContent: () => `main.o:	file format elf64-x86-64

Disassembly of section .text:

0000000000000000 <add>:
       0: 55                           	pushq	%rbp
       1: 48 89 e5                     	movq	%rsp, %rbp
       4: 89 7d fc                     	movl	%edi, -0x4(%rbp)
       7: 89 75 f8                     	movl	%esi, -0x8(%rbp)
       a: 8b 45 fc                     	movl	-0x4(%rbp), %eax
       d: 03 45 f8                     	addl	-0x8(%rbp), %eax
      10: 5d                           	popq	%rbp
      11: c3                           	retq

0000000000000012 <main>:
      12: 55                           	pushq	%rbp
      13: 48 89 e5                     	movq	%rsp, %rbp
      16: 48 83 ec 10                  	subq	$0x10, %rsp
      1a: c7 45 fc 05 00 00 00         	movl	$0x5, -0x4(%rbp)
      21: c7 45 f8 0a 00 00 00         	movl	$0xa, -0x8(%rbp)
      28: 8b 7d fc                     	movl	-0x4(%rbp), %edi
      2b: 8b 75 f8                     	movl	-0x8(%rbp), %esi
      2e: e8 00 00 00 00               	callq	0x33 <main+0x21>
      33: d1 e0                        	shll	$0x1, %eax
      35: 89 45 f4                     	movl	%eax, -0xc(%rbp)
      38: 48 8d 3d 00 00 00 00         	leaq	0x0(%rip), %rdi
      3f: 8b 75 f4                     	movl	-0xc(%rbp), %esi
      42: b8 00 00 00 00               	movl	$0x0, %eax
      47: e8 00 00 00 00               	callq	0x4c <main+0x3a>
      4c: b8 00 00 00 00               	movl	$0x0, %eax
      51: 48 83 c4 10                  	addq	$0x10, %rsp
      55: 5d                           	popq	%rbp
      56: c3                           	retq`,
    terminalOutput: '[Object Code] clang -c main.s -o main.o\n[Object Code] Binary ELF relocatable object file created.'
  },
  {
    id: 'linking',
    name: 'Linking',
    inputFile: 'main.o, crt1.o, libc.so',
    outputFile: 'main',
    explanation: 'The linker combines object files with C runtime standard libraries (libc), resolves external symbols like printf@PLT, and calculates final executable virtual memory offsets.',
    getArtifactContent: () => `[Linker Map & ELF Executable Summary]
Binary Type: ELF 64-bit LSB executable (dynamically linked)
Entry Point Address: 0x401050

Symbol Resolution Table:
  0x401120 <add>        - Defined in main.o (text section)
  0x401135 <main>       - Defined in main.o (text section)
  0x401030 <printf@plt> - Resolved from /lib/x86_64-linux-gnu/libc.so.6
  0x401000 <_start>     - Resolved from standard C runtime initialization (crt1.o)

Executable layout successfully constructed.`,
    terminalOutput: '[Linking] clang main.o -lc -o main\n[Linking] Resolved external references. ELF executable constructed.'
  },
  {
    id: 'executable',
    name: 'Executable',
    inputFile: 'main.o',
    outputFile: 'main',
    explanation: 'Final linked machine binary (ELF format on Linux). Contains entry point (_start), mapped loadable segments (text, data, rodata), and dynamic linking instructions ready for OS execution.',
    getArtifactContent: () => `[ELF Executable Binary Summary]
Class: ELF64
Data: 2's complement, little endian
Type: DYN (Position-Independent Executable file)
Machine: Advanced Micro Devices x86-64
Entry point address: 0x401050
Start of program headers: 64 (bytes into file)
Number of program headers: 11

Loadable Segments:
  - LOAD 0x0000000000000000 R E (Text / Executable instructions)
  - LOAD 0x0000000000002000 R   (Read-only Data / Constants)
  - LOAD 0x0000000000003000 RW  (Data / Writable variables)`,
    terminalOutput: '[Executable] ELF 64-bit binary created and verified. Permissions set to executable (rwxr-xr-x).'
  },
  {
    id: 'execution',
    name: 'Execution',
    inputFile: 'main',
    outputFile: 'stdout / Process Return Code',
    explanation: 'The Operating System kernel loads the executable file into virtual memory, sets up stack and heap segments, initializes the program counter (PC) to _start, and runs the CPU instructions.',
    getArtifactContent: () => `Result: 30`,
    terminalOutput: '[Execution] Launching process ./main...\n[Execution] Process exited normally with status code 0.'
  }
];
