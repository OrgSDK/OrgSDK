/**
 * VM Sandbox — Public API
 *
 * Re-exports everything needed to create and use a SandboxExecutor.
 *
 * Usage:
 *   import { SandboxExecutor, type SandboxFunction } from "./sandbox";
 *
 * Files in this directory:
 *   executor.ts   — SandboxExecutor class (the main entry point)
 *   context.ts    — VM context creation with proxied safe functions
 *   validate.ts   — TypeScript validation (reject imports/requires, type check)
 *   transpile.ts  — TS → JS transpilation + last-expression rewriting
 *   types.ts      — ExecutionStep, ExecutionResult, SandboxOptions, etc.
 */

export { ResettableTimeout, SandboxExecutor } from "./executor";
export type {
	ExecutionResult,
	ExecutionStep,
	SandboxFunction,
	SandboxOptions,
	SandboxToolContext,
} from "./types";
