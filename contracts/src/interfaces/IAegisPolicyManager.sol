// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAegisPolicyManager
 * @notice Interface for the Aegis Policy Manager, enforcing grant lifecycles,
 *         monotonic scope attenuation, atomic budget accounting, ancestry-based revocation,
 *         explicit reservation-release semantics, and EIP-712 typed-data authorization.
 */
interface IAegisPolicyManager {
    // --- Data Structures ---

    struct Grant {
        bytes32 grantId;              // Unique identifier for the grant
        bytes32 parentGrantId;        // Sentinel bytes32(0) if this is a Root Grant
        address agent;                // Public address corresponding to agent signing key
        uint256 allowedTools;         // Bitmask of allowed tool permissions
        uint64 expiresAt;             // Unix timestamp after which the grant expires
        uint256 maxPerAction;         // Maximum cost/units permissible for a single action
        uint256 maxTotalBudget;       // Maximum aggregate budget allocated to this grant's subtree
        uint256 spent;                // Amount spent by this grant and its descendants
        uint256 reservedChildBudget;  // Budget committed to unreleased direct child grants
        bool revoked;                 // Explicit revocation flag
        bool reservationReleased;     // Explicit flag indicating whether reservation has been released back to parent
        uint256 nonce;                // Sequential nonce for replay protection
    }

    struct ActionRequest {
        bytes32 actionId;
        bytes32 grantId;
        uint256 toolBit;
        uint256 cost;
        bytes32 paramsHash;
        uint256 nonce;
        uint64 deadline;
    }

    // --- Custom Errors ---
    error Unauthorized();
    error GrantNotFound();
    error GrantRevokedError();
    error GrantExpired();
    error GrantNotExpired();
    error AlreadyRevoked();
    error ReservationAlreadyReleased();
    error CannotReclaimRoot();
    error AncestorRevoked(bytes32 ancestorGrantId);
    error AncestorExpired(bytes32 ancestorGrantId);
    error ToolNotPermitted(uint256 toolBit, uint256 allowedTools);
    error PerActionLimitExceeded(uint256 requested, uint256 maxPerAction);
    error SubtreeBudgetExceeded(uint256 requested, uint256 available);
    error InvalidNonce(uint256 expected, uint256 actual);
    error InvalidSignature();
    error SignatureExpired();
    error ScopeAttenuationFailed();
    error ExpirationAttenuationFailed();
    error PerActionAttenuationFailed();
    error BudgetAttenuationFailed();
    error MaxDepthExceeded();

    // --- Events ---
    event RootGrantCreated(
        bytes32 indexed grantId,
        address indexed owner,
        address indexed agent,
        uint256 allowedTools,
        uint256 maxTotalBudget,
        uint64 expiresAt
    );

    event GrantDelegated(
        bytes32 indexed parentGrantId,
        bytes32 indexed childGrantId,
        address indexed childAgent,
        uint256 allowedTools,
        uint256 budget,
        uint64 expiresAt
    );

    event ActionAuthorized(
        bytes32 indexed grantId,
        address indexed agent,
        uint256 indexed toolBit,
        uint256 cost,
        uint256 nonce
    );

    event GrantRevoked(
        bytes32 indexed grantId,
        address indexed revoker,
        uint256 unspentReclaimed
    );

    event ExpiredBudgetReclaimed(
        bytes32 indexed childGrantId,
        bytes32 indexed parentGrantId,
        uint256 unspentReclaimed,
        address indexed caller
    );

    event ReceiptCommitted(
        bytes32 indexed actionId,
        bytes32 indexed grantId,
        bytes32 receiptHash
    );

    // --- Grant Lifecycle Functions ---

    /**
     * @notice Creates a new Root Grant owned by the caller.
     * @param agent The public address of the authorized AI agent.
     * @param allowedTools Bitmask of permitted tools.
     * @param expiresAt Unix timestamp when this grant expires.
     * @param maxPerAction Maximum cost permitted per single action.
     * @param maxTotalBudget Total budget allocated to this root subtree.
     * @return grantId The computed unique identifier for the grant.
     */
    function createRootGrant(
        address agent,
        uint256 allowedTools,
        uint64 expiresAt,
        uint256 maxPerAction,
        uint256 maxTotalBudget
    ) external returns (bytes32 grantId);

    /**
     * @notice Delegates a subset of permissions and budget from a parent grant to a child agent.
     * @dev Enforces monotonic attenuation across tool scope, expiry, per-action cap, and budget.
     * @param parentGrantId The ID of the delegating parent grant.
     * @param childAgent Public address of the child AI agent.
     * @param childTools Bitmask of tools granted to child (must be subset of parent).
     * @param childExpiresAt Expiry of child (must be <= parent.expiresAt).
     * @param childMaxPerAction Single action cap (must be <= parent.maxPerAction).
     * @param childBudget Total budget reserved from parent for child.
     * @return childGrantId The computed unique identifier for the child grant.
     */
    function delegateGrant(
        bytes32 parentGrantId,
        address childAgent,
        uint256 childTools,
        uint64 childExpiresAt,
        uint256 childMaxPerAction,
        uint256 childBudget
    ) external returns (bytes32 childGrantId);

    /**
     * @notice Revokes a grant, immediately deactivating its entire subtree and releasing its unspent budget
     *         strictly once to its immediate parent.
     * @param grantId The ID of the grant to revoke.
     */
    function revokeGrant(bytes32 grantId) external;

    /**
     * @notice Reclaims unspent budget from an expired child grant back to its immediate parent.
     * @dev Can be called permissionlessly by anyone once block.timestamp > child.expiresAt.
     *      Releases the reservation exactly once.
     * @param childGrantId The ID of the expired child grant.
     */
    function reclaimExpiredBudget(bytes32 childGrantId) external;

    /**
     * @notice Verifies EIP-712 typed-data signature, nonce, ancestry, tool scope, and consumes budget.
     * @param request The structured ActionRequest payload.
     * @param signature Cryptographic EIP-712 signature over ActionRequest.
     */
    function checkAndConsumeBudget(
        ActionRequest calldata request,
        bytes calldata signature
    ) external;

    /**
     * @notice Consumes budget on behalf of an authorized caller contract (e.g. AgentVault).
     * @param grantId The ID of the executing grant.
     * @param toolBit The tool bit.
     * @param cost Budget units to deduct.
     */
    function consumeBudgetFromVault(
        bytes32 grantId,
        uint256 toolBit,
        uint256 cost
    ) external;

    /**
     * @notice Anchors an off-chain execution receipt hash on-chain.
     * @param actionId Unique ID of the executed action.
     * @param grantId The grant ID under which it was executed.
     * @param receiptHash Cryptographic hash (SHA256/Keccak256) of the execution output.
     */
    function commitReceipt(
        bytes32 actionId,
        bytes32 grantId,
        bytes32 receiptHash
    ) external;

    // --- View Functions ---

    function getGrant(bytes32 grantId) external view returns (Grant memory);
    function isGrantValid(bytes32 grantId) external view returns (bool valid, bytes32 invalidNodeId);
    function getAvailableBudget(bytes32 grantId) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
