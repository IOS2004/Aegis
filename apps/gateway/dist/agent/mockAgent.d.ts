import { type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type SignedActionSubmission, type ToolName } from "@aegis/shared";
export declare class MockAgent {
    readonly privateKey: Hex;
    readonly account: ReturnType<typeof privateKeyToAccount>;
    readonly address: Address;
    readonly chainId: number;
    readonly policyManagerAddress: Address;
    constructor(config: {
        privateKey: Hex;
        chainId: number;
        policyManagerAddress: Address;
    });
    /**
     * Generates a signed action request using account.signTypedData.
     */
    signAction(params: {
        grantId: Hex;
        toolName: ToolName;
        cost: number;
        paramsObj: Record<string, unknown>;
        nonce: number;
        deadline?: number;
        customActionId?: Hex;
    }): Promise<SignedActionSubmission>;
    createValidReadStatus(grantId: Hex, nonce: number): Promise<SignedActionSubmission>;
    createValidRunTests(grantId: Hex, nonce: number, cost?: number): Promise<SignedActionSubmission>;
    createValidCreateBranch(grantId: Hex, nonce: number, branchName: string): Promise<SignedActionSubmission>;
    createValidWriteFile(grantId: Hex, nonce: number, fileName: string, content: string): Promise<SignedActionSubmission>;
    createUnauthorizedToolAttempt(grantId: Hex, nonce: number): Promise<SignedActionSubmission>;
    createOverCapAttempt(grantId: Hex, nonce: number, excessiveCost: number): Promise<SignedActionSubmission>;
    createOverBudgetAttempt(grantId: Hex, nonce: number, budgetExhaustingCost: number): Promise<SignedActionSubmission>;
    createExpiredSignatureAttempt(grantId: Hex, nonce: number): Promise<SignedActionSubmission>;
    createPathTraversalAttack(grantId: Hex, nonce: number): Promise<SignedActionSubmission>;
    createShellInjectionAttack(grantId: Hex, nonce: number): Promise<SignedActionSubmission>;
}
