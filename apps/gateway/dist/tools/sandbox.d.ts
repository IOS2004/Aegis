import type { CreateSandboxBranchParams, ReadProjectStatusParams, RunTestSuiteParams, WriteDemoFileParams } from "@aegis/shared";
export interface ToolExecutionResult {
    success: boolean;
    toolName: string;
    output: string;
    resultHash: `0x${string}`;
    durationMs: number;
    error?: string;
}
export declare class SandboxEnvironment {
    readonly rootDir: string;
    readonly demoDir: string;
    readonly maxOutputBytes: number;
    constructor(baseDir?: string);
    private init;
    /**
     * Prevents path traversal and symlink escapes.
     * Ensures the resolved canonical path lies strictly within the target parent directory.
     */
    resolveSafeChildPath(parentDir: string, relativeOrFileName: string): string;
    readProjectStatus(params: ReadProjectStatusParams): Promise<ToolExecutionResult>;
    createSandboxBranch(params: CreateSandboxBranchParams): Promise<ToolExecutionResult>;
    writeDemoFile(params: WriteDemoFileParams): Promise<ToolExecutionResult>;
    runTestSuite(params: RunTestSuiteParams): Promise<ToolExecutionResult>;
}
