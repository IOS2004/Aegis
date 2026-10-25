// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IAegisPolicyManager.sol";

/**
 * @title AegisPolicyManager
 * @notice Canonical policy manager contract for Aegis.
 * @dev Enforces monotonic attenuation, EIP-712 typed-data authorization,
 *      ancestry-based revocation, and explicit reservation-release budget accounting.
 */
contract AegisPolicyManager is EIP712, IAegisPolicyManager {
    using ECDSA for bytes32;

    // --- Tool Constants ---
    uint256 public constant TOOL_READ_STATUS    = 1 << 0; // 0x0001
    uint256 public constant TOOL_RUN_TESTS      = 1 << 1; // 0x0002
    uint256 public constant TOOL_CREATE_BRANCH  = 1 << 2; // 0x0004
    uint256 public constant TOOL_WRITE_FILE     = 1 << 3; // 0x0008
    uint256 public constant TOOL_VAULT_TRANSFER = 1 << 4; // 0x0010

    // --- Maximum Delegation Depth ---
    uint256 public constant MAX_DEPTH = 5;

    // --- EIP-712 Typehash ---
    bytes32 public constant ACTION_REQUEST_TYPEHASH = keccak256(
        "ActionRequest(bytes32 actionId,bytes32 grantId,uint256 toolBit,uint256 cost,bytes32 paramsHash,uint256 nonce,uint64 deadline)"
    );

    // --- Contract State ---
    address public immutable owner;
    address public vault;
    uint256 private _rootNonce;

    mapping(bytes32 => Grant) public grants;
    mapping(bytes32 => bool) public executedActions;
    mapping(bytes32 => bytes32) public actionReceipts;

    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() EIP712("AegisPolicyManager", "1") {
        owner = msg.sender;
    }

    /**
     * @notice Sets the authorized AgentVault address.
     */
    event VaultSet(address indexed oldVault, address indexed newVault);

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert Unauthorized();
        address oldVault = vault;
        vault = _vault;
        emit VaultSet(oldVault, _vault);
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function createRootGrant(
        address agent,
        uint256 allowedTools,
        uint64 expiresAt,
        uint256 maxPerAction,
        uint256 maxTotalBudget
    ) external override onlyOwner returns (bytes32 grantId) {
        if (agent == address(0)) revert Unauthorized();
        if (expiresAt <= block.timestamp) revert GrantExpired();
        if (maxTotalBudget == 0) revert BudgetAttenuationFailed();

        grantId = keccak256(
            abi.encode(
                agent,
                allowedTools,
                expiresAt,
                maxPerAction,
                maxTotalBudget,
                _rootNonce++
            )
        );

        grants[grantId] = Grant({
            grantId: grantId,
            parentGrantId: bytes32(0),
            agent: agent,
            allowedTools: allowedTools,
            expiresAt: expiresAt,
            maxPerAction: maxPerAction,
            maxTotalBudget: maxTotalBudget,
            spent: 0,
            reservedChildBudget: 0,
            revoked: false,
            reservationReleased: false,
            nonce: 0
        });

        emit RootGrantCreated(
            grantId,
            msg.sender,
            agent,
            allowedTools,
            maxTotalBudget,
            expiresAt
        );
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function delegateGrant(
        bytes32 parentGrantId,
        address childAgent,
        uint256 childTools,
        uint64 childExpiresAt,
        uint256 childMaxPerAction,
        uint256 childBudget
    ) external override returns (bytes32 childGrantId) {
        Grant storage parent = grants[parentGrantId];
        if (parent.grantId == bytes32(0)) revert GrantNotFound();
        if (parent.revoked) revert GrantRevokedError();
        if (block.timestamp > parent.expiresAt) revert GrantExpired();
        if (msg.sender != parent.agent && msg.sender != owner) revert Unauthorized();
        if (childAgent == address(0)) revert Unauthorized();

        // Monotonic Scope Attenuation: child must not exceed parent
        if ((childTools & ~parent.allowedTools) != 0) revert ScopeAttenuationFailed();
        if (childExpiresAt > parent.expiresAt) revert ExpirationAttenuationFailed();
        if (childMaxPerAction > parent.maxPerAction) revert PerActionAttenuationFailed();

        // Available Capacity Check
        uint256 parentAvailable = parent.maxTotalBudget - parent.spent - parent.reservedChildBudget;
        if (childBudget > parentAvailable) revert BudgetAttenuationFailed();

        // Reserve budget on parent
        parent.reservedChildBudget += childBudget;

        childGrantId = keccak256(
            abi.encode(
                parentGrantId,
                childAgent,
                parent.nonce++
            )
        );

        grants[childGrantId] = Grant({
            grantId: childGrantId,
            parentGrantId: parentGrantId,
            agent: childAgent,
            allowedTools: childTools,
            expiresAt: childExpiresAt,
            maxPerAction: childMaxPerAction,
            maxTotalBudget: childBudget,
            spent: 0,
            reservedChildBudget: 0,
            revoked: false,
            reservationReleased: false,
            nonce: 0
        });

        emit GrantDelegated(
            parentGrantId,
            childGrantId,
            childAgent,
            childTools,
            childBudget,
            childExpiresAt
        );
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function revokeGrant(bytes32 grantId) external override {
        Grant storage grant = grants[grantId];
        if (grant.grantId == bytes32(0)) revert GrantNotFound();
        if (grant.revoked) revert AlreadyRevoked();

        // Only the delegating principal (parent agent or root owner) can revoke
        if (grant.parentGrantId == bytes32(0)) {
            if (msg.sender != owner) revert Unauthorized();
        } else {
            Grant storage parent = grants[grant.parentGrantId];
            if (msg.sender != parent.agent && msg.sender != owner) revert Unauthorized();
        }

        grant.revoked = true;
        uint256 unspentReclaimed = 0;

        // Release reservation strictly once to immediate parent
        if (grant.parentGrantId != bytes32(0) && !grant.reservationReleased) {
            grant.reservationReleased = true;
            Grant storage parent = grants[grant.parentGrantId];
            uint256 unspent = grant.maxTotalBudget - grant.spent;

            // Credit parent if parent is not already revoked
            if (!parent.revoked && unspent > 0) {
                parent.reservedChildBudget -= unspent;
                unspentReclaimed = unspent;
            }
        }

        emit GrantRevoked(grantId, msg.sender, unspentReclaimed);
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function reclaimExpiredBudget(bytes32 childGrantId) external override {
        Grant storage child = grants[childGrantId];
        if (child.grantId == bytes32(0)) revert GrantNotFound();
        if (child.parentGrantId == bytes32(0)) revert CannotReclaimRoot();
        if (block.timestamp <= child.expiresAt) revert GrantNotExpired();
        if (child.reservationReleased) revert ReservationAlreadyReleased();

        child.revoked = true;
        child.reservationReleased = true;

        Grant storage parent = grants[child.parentGrantId];
        uint256 unspent = child.maxTotalBudget - child.spent;
        uint256 unspentReclaimed = 0;

        // Credit immediate parent if parent is not already revoked
        if (!parent.revoked && unspent > 0) {
            parent.reservedChildBudget -= unspent;
            unspentReclaimed = unspent;
        }

        emit ExpiredBudgetReclaimed(
            childGrantId,
            child.parentGrantId,
            unspentReclaimed,
            msg.sender
        );
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function checkAndConsumeBudget(
        ActionRequest calldata request,
        bytes calldata signature
    ) external override {
        if (block.timestamp > request.deadline) revert SignatureExpired();
        Grant storage grant = grants[request.grantId];
        if (grant.grantId == bytes32(0)) revert GrantNotFound();
        if (grant.revoked) revert GrantRevokedError();
        if (block.timestamp > grant.expiresAt) revert GrantExpired();

        // Tool bitmask check
        if ((grant.allowedTools & request.toolBit) == 0) {
            revert ToolNotPermitted(request.toolBit, grant.allowedTools);
        }

        // Per-action cap check
        if (request.cost > grant.maxPerAction) {
            revert PerActionLimitExceeded(request.cost, grant.maxPerAction);
        }

        // Sequential nonce check
        if (request.nonce != grant.nonce) {
            revert InvalidNonce(grant.nonce, request.nonce);
        }

        // EIP-712 Signature verification
        bytes32 structHash = keccak256(
            abi.encode(
                ACTION_REQUEST_TYPEHASH,
                request.actionId,
                request.grantId,
                request.toolBit,
                request.cost,
                request.paramsHash,
                request.nonce,
                request.deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        if (signer != grant.agent) revert InvalidSignature();

        // Execute budget deduction & ancestry validation
        _executeBudgetDeduction(request.grantId, request.cost);

        grant.nonce++;
        executedActions[request.actionId] = true;

        emit ActionAuthorized(
            request.grantId,
            grant.agent,
            request.toolBit,
            request.cost,
            grant.nonce - 1
        );
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function consumeBudgetFromVault(
        bytes32 grantId,
        uint256 toolBit,
        uint256 cost
    ) external override {
        if (msg.sender != vault) revert Unauthorized();
        Grant storage grant = grants[grantId];
        if (grant.grantId == bytes32(0)) revert GrantNotFound();
        if (grant.revoked) revert GrantRevokedError();
        if (block.timestamp > grant.expiresAt) revert GrantExpired();

        if ((grant.allowedTools & toolBit) == 0) {
            revert ToolNotPermitted(toolBit, grant.allowedTools);
        }
        if (cost > grant.maxPerAction) {
            revert PerActionLimitExceeded(cost, grant.maxPerAction);
        }

        _executeBudgetDeduction(grantId, cost);
        grant.nonce++;
    }

    /**
     * @inheritdoc IAegisPolicyManager
     */
    function commitReceipt(
        bytes32 actionId,
        bytes32 grantId,
        bytes32 receiptHash
    ) external override {
        actionReceipts[actionId] = receiptHash;
        emit ReceiptCommitted(actionId, grantId, receiptHash);
    }

    // --- Internal Helpers ---

    function _executeBudgetDeduction(bytes32 grantId, uint256 cost) internal {
        Grant storage grant = grants[grantId];

        // Check available capacity on executing grant
        uint256 available = grant.maxTotalBudget - grant.spent - grant.reservedChildBudget;
        if (cost > available) revert SubtreeBudgetExceeded(cost, available);

        // Walk ancestors and shift reserved budget to spent
        bytes32 currId = grant.parentGrantId;
        uint256 depth = 0;
        while (currId != bytes32(0)) {
            if (++depth > MAX_DEPTH) revert MaxDepthExceeded();
            Grant storage ancestor = grants[currId];
            if (ancestor.revoked) revert AncestorRevoked(currId);
            if (block.timestamp > ancestor.expiresAt) revert AncestorExpired(currId);
            if (ancestor.reservedChildBudget < cost) {
                revert SubtreeBudgetExceeded(cost, ancestor.reservedChildBudget);
            }

            ancestor.reservedChildBudget -= cost;
            ancestor.spent += cost;
            currId = ancestor.parentGrantId;
        }

        grant.spent += cost;
    }

    // --- View Functions ---

    function getGrant(bytes32 grantId) external view override returns (Grant memory) {
        return grants[grantId];
    }

    function isGrantValid(bytes32 grantId) external view override returns (bool valid, bytes32 invalidNodeId) {
        bytes32 currId = grantId;
        uint256 depth = 0;
        while (currId != bytes32(0)) {
            if (++depth > MAX_DEPTH) return (false, currId);
            Grant storage node = grants[currId];
            if (node.grantId == bytes32(0)) return (false, currId);
            if (node.revoked) return (false, currId);
            if (block.timestamp > node.expiresAt) return (false, currId);
            currId = node.parentGrantId;
        }
        return (true, bytes32(0));
    }

    function getAvailableBudget(bytes32 grantId) external view override returns (uint256) {
        Grant storage grant = grants[grantId];
        if (grant.grantId == bytes32(0) || grant.revoked || block.timestamp > grant.expiresAt) {
            return 0;
        }
        return grant.maxTotalBudget - grant.spent - grant.reservedChildBudget;
    }

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }
}
