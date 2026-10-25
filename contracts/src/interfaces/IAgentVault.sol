// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentVault
 * @notice Interface for AgentVault, which holds mock ERC-20 test tokens and enforces
 *         that tokens are only transferred when authorized by AegisPolicyManager via
 *         EIP-712 structured signatures.
 */
interface IAgentVault {
    // --- Data Structures ---
    struct VaultTransferRequest {
        bytes32 actionId;
        bytes32 grantId;
        address to;
        uint256 amount;
        uint256 nonce;
        uint64 deadline;
    }

    // --- Custom Errors ---
    error Unauthorized();
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error InvalidRecipient();
    error ZeroAmount();
    error SignatureExpired();
    error InvalidSignature();
    error InvalidNonce(uint256 expected, uint256 actual);

    // --- Events ---
    event Deposited(address indexed sender, uint256 amount);
    event TransferExecuted(
        bytes32 indexed grantId,
        address indexed agent,
        address indexed to,
        uint256 amount,
        uint256 nonce
    );

    /**
     * @notice Deposits mock test tokens into the vault.
     * @param amount The amount of tokens to deposit.
     */
    function deposit(uint256 amount) external;

    /**
     * @notice Executes a token transfer out of the vault authorized by an agent grant.
     * @param request The structured VaultTransferRequest payload.
     * @param signature EIP-712 cryptographic signature signed by grant.agent.
     * @return success True if the transfer executed successfully.
     */
    function executeTransfer(
        VaultTransferRequest calldata request,
        bytes calldata signature
    ) external returns (bool success);

    /**
     * @notice Returns the address of the AegisPolicyManager contract.
     */
    function policyManager() external view returns (address);

    /**
     * @notice Returns the address of the underlying mock ERC-20 token.
     */
    function token() external view returns (address);

    /**
     * @notice Returns the EIP-712 domain separator.
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
