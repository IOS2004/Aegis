import { type PublicClient, type WalletClient, type Address, type Hex } from "viem";
import { type ActionRequest, type Grant } from "@aegis/shared";
export declare const AEGIS_POLICY_MANAGER_ABI: readonly [{
    readonly name: "getGrant";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "grantId";
    }];
    readonly outputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "grantId";
        }, {
            readonly type: "bytes32";
            readonly name: "parentGrantId";
        }, {
            readonly type: "address";
            readonly name: "agent";
        }, {
            readonly type: "uint256";
            readonly name: "allowedTools";
        }, {
            readonly type: "uint64";
            readonly name: "expiresAt";
        }, {
            readonly type: "uint256";
            readonly name: "maxPerAction";
        }, {
            readonly type: "uint256";
            readonly name: "maxTotalBudget";
        }, {
            readonly type: "uint256";
            readonly name: "spent";
        }, {
            readonly type: "uint256";
            readonly name: "reservedChildBudget";
        }, {
            readonly type: "bool";
            readonly name: "revoked";
        }, {
            readonly type: "bool";
            readonly name: "reservationReleased";
        }, {
            readonly type: "uint256";
            readonly name: "nonce";
        }];
    }];
}, {
    readonly name: "isGrantValid";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "grantId";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
        readonly name: "valid";
    }, {
        readonly type: "bytes32";
        readonly name: "invalidNodeId";
    }];
}, {
    readonly name: "getAvailableBudget";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "grantId";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "checkAndConsumeBudget";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "actionId";
        }, {
            readonly type: "bytes32";
            readonly name: "grantId";
        }, {
            readonly type: "uint256";
            readonly name: "toolBit";
        }, {
            readonly type: "uint256";
            readonly name: "cost";
        }, {
            readonly type: "bytes32";
            readonly name: "paramsHash";
        }, {
            readonly type: "uint256";
            readonly name: "nonce";
        }, {
            readonly type: "uint64";
            readonly name: "deadline";
        }];
        readonly name: "request";
    }, {
        readonly type: "bytes";
        readonly name: "signature";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "commitReceipt";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "actionId";
    }, {
        readonly type: "bytes32";
        readonly name: "grantId";
    }, {
        readonly type: "bytes32";
        readonly name: "receiptHash";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "reclaimExpiredBudget";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "childGrantId";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "DOMAIN_SEPARATOR";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
}];
export declare const AGENT_VAULT_ABI: readonly [{
    readonly name: "executeTransfer";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "actionId";
        }, {
            readonly type: "bytes32";
            readonly name: "grantId";
        }, {
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }, {
            readonly type: "uint256";
            readonly name: "nonce";
        }, {
            readonly type: "uint64";
            readonly name: "deadline";
        }];
        readonly name: "request";
    }, {
        readonly type: "bytes";
        readonly name: "signature";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "deposit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "token";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "policyManager";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}];
export interface PolicyClientConfig {
    rpcUrl: string;
    chainId: number;
    policyManagerAddress: Address;
    vaultAddress?: Address;
    relayerPrivateKey?: Hex;
}
export declare class PolicyClient {
    readonly publicClient: PublicClient;
    readonly walletClient?: WalletClient;
    readonly policyManagerAddress: Address;
    readonly vaultAddress?: Address;
    readonly chainId: number;
    constructor(config: PolicyClientConfig);
    getGrant(grantId: Hex): Promise<Grant>;
    isGrantValid(grantId: Hex): Promise<{
        valid: boolean;
        invalidNodeId: Hex;
    }>;
    getAvailableBudget(grantId: Hex): Promise<bigint>;
    verifyActionSignature(request: ActionRequest, signature: Hex, expectedSigner: Address): Promise<boolean>;
    preConsumeBudget(request: ActionRequest, signature: Hex): Promise<{
        txHash: Hex;
    }>;
    commitReceipt(actionId: Hex, grantId: Hex, receiptHash: Hex): Promise<{
        txHash: Hex;
    }>;
    reclaimExpiredBudget(childGrantId: Hex): Promise<{
        txHash: Hex;
    }>;
}
