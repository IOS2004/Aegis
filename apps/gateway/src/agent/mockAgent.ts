// SPDX-License-Identifier: MIT
import {
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getAegisPolicyManagerDomain,
  ACTION_REQUEST_TYPES,
  buildActionRequest,
  type SignedActionSubmission,
  type ToolName,
} from "@aegis/shared";

export class MockAgent {
  public readonly privateKey: Hex;
  public readonly account: ReturnType<typeof privateKeyToAccount>;
  public readonly address: Address;
  public readonly chainId: number;
  public readonly policyManagerAddress: Address;

  constructor(config: {
    privateKey: Hex;
    chainId: number;
    policyManagerAddress: Address;
  }) {
    this.privateKey = config.privateKey;
    this.account = privateKeyToAccount(config.privateKey);
    this.address = this.account.address;
    this.chainId = config.chainId;
    this.policyManagerAddress = config.policyManagerAddress;
  }

  /**
   * Generates a signed action request using account.signTypedData.
   */
  public async signAction(params: {
    grantId: Hex;
    toolName: ToolName;
    cost: number;
    paramsObj: Record<string, unknown>;
    nonce: number;
    deadline?: number;
    customActionId?: Hex;
  }): Promise<SignedActionSubmission> {
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

  public async createValidReadStatus(grantId: Hex, nonce: number): Promise<SignedActionSubmission> {
    return this.signAction({
      grantId,
      toolName: "read_project_status",
      cost: 0,
      paramsObj: { format: "summary" },
      nonce,
    });
  }

  public async createValidRunTests(grantId: Hex, nonce: number, cost: number = 10): Promise<SignedActionSubmission> {
    return this.signAction({
      grantId,
      toolName: "run_test_suite",
      cost,
      paramsObj: { target: "unit" },
      nonce,
    });
  }

  public async createValidCreateBranch(grantId: Hex, nonce: number, branchName: string): Promise<SignedActionSubmission> {
    return this.signAction({
      grantId,
      toolName: "create_sandbox_branch",
      cost: 5,
      paramsObj: { branchName },
      nonce,
    });
  }

  public async createValidWriteFile(
    grantId: Hex,
    nonce: number,
    fileName: string,
    content: string
  ): Promise<SignedActionSubmission> {
    return this.signAction({
      grantId,
      toolName: "write_demo_file",
      cost: 5,
      paramsObj: { fileName, content },
      nonce,
    });
  }

  public async createUnauthorizedToolAttempt(grantId: Hex, nonce: number): Promise<SignedActionSubmission> {
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

  public async createOverCapAttempt(
    grantId: Hex,
    nonce: number,
    excessiveCost: number
  ): Promise<SignedActionSubmission> {
    return this.signAction({
      grantId,
      toolName: "run_test_suite",
      cost: excessiveCost,
      paramsObj: { target: "unit" },
      nonce,
    });
  }

  public async createOverBudgetAttempt(
    grantId: Hex,
    nonce: number,
    budgetExhaustingCost: number
  ): Promise<SignedActionSubmission> {
    return this.signAction({
      grantId,
      toolName: "run_test_suite",
      cost: budgetExhaustingCost,
      paramsObj: { target: "unit" },
      nonce,
    });
  }

  public async createExpiredSignatureAttempt(grantId: Hex, nonce: number): Promise<SignedActionSubmission> {
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

  public async createPathTraversalAttack(grantId: Hex, nonce: number): Promise<SignedActionSubmission> {
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

  public async createShellInjectionAttack(grantId: Hex, nonce: number): Promise<SignedActionSubmission> {
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
