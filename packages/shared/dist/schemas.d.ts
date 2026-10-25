import { z } from "zod";
export declare const HexSchema: z.ZodEffects<z.ZodString, `0x${string}`, string>;
export declare const Bytes32Schema: z.ZodEffects<z.ZodString, `0x${string}`, string>;
export declare const AddressSchema: z.ZodEffects<z.ZodString, `0x${string}`, string>;
export declare const ReadProjectStatusParamsSchema: z.ZodObject<{
    format: z.ZodOptional<z.ZodEnum<["summary", "full"]>>;
}, "strict", z.ZodTypeAny, {
    format?: "summary" | "full" | undefined;
}, {
    format?: "summary" | "full" | undefined;
}>;
export declare const RunTestSuiteParamsSchema: z.ZodObject<{
    target: z.ZodOptional<z.ZodString>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    target?: string | undefined;
    timeoutMs?: number | undefined;
}, {
    target?: string | undefined;
    timeoutMs?: number | undefined;
}>;
export declare const CreateSandboxBranchParamsSchema: z.ZodObject<{
    branchName: z.ZodEffects<z.ZodString, string, string>;
}, "strict", z.ZodTypeAny, {
    branchName: string;
}, {
    branchName: string;
}>;
export declare const WriteDemoFileParamsSchema: z.ZodObject<{
    fileName: z.ZodEffects<z.ZodString, string, string>;
    content: z.ZodString;
}, "strict", z.ZodTypeAny, {
    fileName: string;
    content: string;
}, {
    fileName: string;
    content: string;
}>;
export declare const VaultTransferParamsSchema: z.ZodObject<{
    to: z.ZodEffects<z.ZodString, `0x${string}`, string>;
    amount: z.ZodString;
}, "strict", z.ZodTypeAny, {
    to: `0x${string}`;
    amount: string;
}, {
    to: string;
    amount: string;
}>;
export declare const ActionSubmissionSchema: z.ZodObject<{
    grantId: z.ZodEffects<z.ZodString, `0x${string}`, string>;
    toolName: z.ZodEnum<["read_project_status", "run_test_suite", "create_sandbox_branch", "write_demo_file", "vault_transfer"]>;
    cost: z.ZodNumber;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    nonce: z.ZodNumber;
    deadline: z.ZodNumber;
    signature: z.ZodEffects<z.ZodString, `0x${string}`, string>;
    actionId: z.ZodOptional<z.ZodEffects<z.ZodString, `0x${string}`, string>>;
}, "strict", z.ZodTypeAny, {
    grantId: `0x${string}`;
    cost: number;
    nonce: number;
    deadline: number;
    params: Record<string, unknown>;
    toolName: "read_project_status" | "run_test_suite" | "create_sandbox_branch" | "write_demo_file" | "vault_transfer";
    signature: `0x${string}`;
    actionId?: `0x${string}` | undefined;
}, {
    grantId: string;
    cost: number;
    nonce: number;
    deadline: number;
    params: Record<string, unknown>;
    toolName: "read_project_status" | "run_test_suite" | "create_sandbox_branch" | "write_demo_file" | "vault_transfer";
    signature: string;
    actionId?: string | undefined;
}>;
export type ActionSubmission = z.infer<typeof ActionSubmissionSchema>;
export type ReadProjectStatusParams = z.infer<typeof ReadProjectStatusParamsSchema>;
export type RunTestSuiteParams = z.infer<typeof RunTestSuiteParamsSchema>;
export type CreateSandboxBranchParams = z.infer<typeof CreateSandboxBranchParamsSchema>;
export type WriteDemoFileParams = z.infer<typeof WriteDemoFileParamsSchema>;
export type VaultTransferParams = z.infer<typeof VaultTransferParamsSchema>;
