import { privateKeyToAccount } from "viem/accounts";
import { getAegisPolicyManagerDomain, ACTION_REQUEST_TYPES, buildActionRequest, } from "@aegis/shared";
export class MockAgent {
    privateKey;
    account;
    address;
    chainId;
    policyManagerAddress;
    constructor(config) {
        this.privateKey = config.privateKey;
        this.account = privateKeyToAccount(config.privateKey);
        this.address = this.account.address;
        this.chainId = config.chainId;
        this.policyManagerAddress = config.policyManagerAddress;
    }
    /**
     * Generates a signed action request using account.signTypedData.
     */
    async signAction(params) {
        const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 3600;
        const actionReq = buildActionRequest({
            grantId: params.grantId,
            toolName: params.toolName,
            cost: BigInt(params.cost),
            paramsObj: params.paramsObj,
            nonce: BigInt(params.nonce),
            deadline: BigInt(deadline),
            actionId: params.customActionId,
        });
        const domain = getAegisPolicyManagerDomain(this.chainId, this.policyManagerAddress);
        const signature = await this.account.signTypedData({
            domain,
            types: ACTION_REQUEST_TYPES,
            primaryType: "ActionRequest",
            message: actionReq,
        });
        return {
            grantId: params.grantId,
            toolName: params.toolName,
            cost: params.cost,
            params: params.paramsObj,
            nonce: params.nonce,
            deadline,
            signature,
            actionId: actionReq.actionId,
        };
    }
    // --- Adversarial Request Generators for Testing ---
    async createValidReadStatus(grantId, nonce) {
        return this.signAction({
            grantId,
            toolName: "read_project_status",
            cost: 0,
            paramsObj: { format: "summary" },
            nonce,
        });
    }
    async createValidRunTests(grantId, nonce, cost = 10) {
        return this.signAction({
            grantId,
            toolName: "run_test_suite",
            cost,
            paramsObj: { target: "unit" },
            nonce,
        });
    }
    async createValidCreateBranch(grantId, nonce, branchName) {
        return this.signAction({
            grantId,
            toolName: "create_sandbox_branch",
            cost: 5,
            paramsObj: { branchName },
            nonce,
        });
    }
    async createValidWriteFile(grantId, nonce, fileName, content) {
        return this.signAction({
            grantId,
            toolName: "write_demo_file",
            cost: 5,
            paramsObj: { fileName, content },
            nonce,
        });
    }
    async createUnauthorizedToolAttempt(grantId, nonce) {
        return this.signAction({
            grantId,
            toolName: "vault_transfer",
            cost: 50,
            paramsObj: {
                to: "0x000000000000000000000000000000000000CAFE",
                amount: "50000000",
            },
            nonce,
        });
    }
    async createOverCapAttempt(grantId, nonce, excessiveCost) {
        return this.signAction({
            grantId,
            toolName: "run_test_suite",
            cost: excessiveCost,
            paramsObj: { target: "unit" },
            nonce,
        });
    }
    async createOverBudgetAttempt(grantId, nonce, budgetExhaustingCost) {
        return this.signAction({
            grantId,
            toolName: "run_test_suite",
            cost: budgetExhaustingCost,
            paramsObj: { target: "unit" },
            nonce,
        });
    }
    async createExpiredSignatureAttempt(grantId, nonce) {
        const pastDeadline = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
        return this.signAction({
            grantId,
            toolName: "read_project_status",
            cost: 0,
            paramsObj: { format: "summary" },
            nonce,
            deadline: pastDeadline,
        });
    }
    async createPathTraversalAttack(grantId, nonce) {
        return this.signAction({
            grantId,
            toolName: "write_demo_file",
            cost: 5,
            paramsObj: {
                fileName: "../../escaped.txt",
                content: "Malicious payload outside sandbox",
            },
            nonce,
        });
    }
    async createShellInjectionAttack(grantId, nonce) {
        return this.signAction({
            grantId,
            toolName: "create_sandbox_branch",
            cost: 5,
            paramsObj: {
                branchName: "main; rm -rf /",
            },
            nonce,
        });
    }
}
