// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IAgentVault.sol";
import "./interfaces/IAegisPolicyManager.sol";

/**
 * @title AgentVault
 * @notice Holds test ERC-20 assets and enforces contract-level authorization
 *         checks via AegisPolicyManager and EIP-712 structured signatures.
 */
contract AgentVault is EIP712, IAgentVault {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    uint256 public constant TOOL_VAULT_TRANSFER = 1 << 4; // 0x0010

    bytes32 public constant VAULT_TRANSFER_TYPEHASH = keccak256(
        "VaultTransferRequest(bytes32 actionId,bytes32 grantId,address to,uint256 amount,uint256 nonce,uint64 deadline)"
    );

    address public immutable override policyManager;
    address public immutable override token;
    address public immutable owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _policyManager, address _token) EIP712("AgentVault", "1") {
        if (_policyManager == address(0) || _token == address(0)) revert Unauthorized();
        policyManager = _policyManager;
        token = _token;
        owner = msg.sender;
    }

    /**
     * @inheritdoc IAgentVault
     */
    function deposit(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @inheritdoc IAgentVault
     */
    function executeTransfer(
        VaultTransferRequest calldata request,
        bytes calldata signature
    ) external override returns (bool success) {
        if (request.to == address(0)) revert InvalidRecipient();
        if (request.amount == 0) revert ZeroAmount();
        if (block.timestamp > request.deadline) revert SignatureExpired();

        uint256 vaultBalance = IERC20(token).balanceOf(address(this));
        if (vaultBalance < request.amount) {
            revert InsufficientVaultBalance(request.amount, vaultBalance);
        }

        IAegisPolicyManager pm = IAegisPolicyManager(policyManager);
        IAegisPolicyManager.Grant memory grant = pm.getGrant(request.grantId);
        if (grant.grantId == bytes32(0)) revert Unauthorized();
        if (request.nonce != grant.nonce) revert InvalidNonce(grant.nonce, request.nonce);

        // Verify EIP-712 signature against agent address
        bytes32 structHash = keccak256(
            abi.encode(
                VAULT_TRANSFER_TYPEHASH,
                request.actionId,
                request.grantId,
                request.to,
                request.amount,
                request.nonce,
                request.deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        if (signer != grant.agent) revert InvalidSignature();

        // Check ancestry & consume budget in policy manager
        pm.consumeBudgetFromVault(request.grantId, TOOL_VAULT_TRANSFER, request.amount);

        emit TransferExecuted(
            request.grantId,
            grant.agent,
            request.to,
            request.amount,
            request.nonce
        );

        // Execute token transfer
        IERC20(token).safeTransfer(request.to, request.amount);

        return true;
    }

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }
}
