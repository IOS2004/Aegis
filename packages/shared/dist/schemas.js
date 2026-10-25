// SPDX-License-Identifier: MIT
import { z } from "zod";
export const HexSchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "Must be a valid hex string starting with 0x")
    .transform((val) => val);
export const Bytes32Schema = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 32-byte hex string (64 hex characters)")
    .transform((val) => val);
export const AddressSchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 20-byte Ethereum address")
    .transform((val) => val);
// --- Tool-Specific Parameter Schemas (Strict Sandboxing) ---
export const ReadProjectStatusParamsSchema = z
    .object({
    format: z.enum(["summary", "full"]).optional(),
})
    .strict();
export const RunTestSuiteParamsSchema = z
    .object({
    target: z
        .string()
        .regex(/^[a-zA-Z0-9_\-]+$/, "Test target must only contain alphanumeric, dash, or underscore characters")
        .optional(),
    timeoutMs: z.number().int().min(500).max(10000).optional(),
})
    .strict();
export const CreateSandboxBranchParamsSchema = z
    .object({
    branchName: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-\/]*[a-zA-Z0-9]$/, "Branch name must be alphanumeric with safe hyphens/slashes and no dangerous characters")
        .refine((val) => !val.includes("..") && !val.includes("//"), {
        message: "Branch name cannot contain path traversal sequences",
    }),
})
    .strict();
export const WriteDemoFileParamsSchema = z
    .object({
    fileName: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$/, "File name must be a single file with safe extension (e.g., demo.txt), no directories or traversal allowed")
        .refine((val) => !val.includes("..") && !val.includes("/") && !val.includes("\\"), {
        message: "Path traversal or directory separators strictly forbidden",
    }),
    content: z.string().max(50000, "Content cannot exceed 50KB"),
})
    .strict();
export const VaultTransferParamsSchema = z
    .object({
    to: AddressSchema,
    amount: z.string().regex(/^[1-9][0-9]*$/, "Amount must be a positive integer in smallest token units"),
})
    .strict();
export const ActionSubmissionSchema = z
    .object({
    grantId: Bytes32Schema,
    toolName: z.enum([
        "read_project_status",
        "run_test_suite",
        "create_sandbox_branch",
        "write_demo_file",
        "vault_transfer",
    ]),
    cost: z.number().int().nonnegative("Cost must be non-negative"),
    params: z.record(z.unknown()),
    nonce: z.number().int().nonnegative("Nonce must be non-negative"),
    deadline: z.number().int().positive("Deadline must be a positive timestamp"),
    signature: HexSchema,
    actionId: Bytes32Schema.optional(),
})
    .strict();
