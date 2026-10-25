// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AegisPolicyManager.sol";

contract AegisPolicyManagerTest is Test {
    AegisPolicyManager public pm;

    address public owner = address(this);
    uint256 public agentAPk = 0xA11CE;
    address public agentA;
    uint256 public agentBPk = 0xB0B;
    address public agentB;
    uint256 public agentCPk = 0xC0C;
    address public agentC;

    uint256 public constant TOOL_READ_STATUS    = 1 << 0;
    uint256 public constant TOOL_RUN_TESTS      = 1 << 1;
    uint256 public constant TOOL_CREATE_BRANCH  = 1 << 2;
    uint256 public constant TOOL_WRITE_FILE     = 1 << 3;
    uint256 public constant TOOL_VAULT_TRANSFER = 1 << 4;

    function setUp() public {
        agentA = vm.addr(agentAPk);
        agentB = vm.addr(agentBPk);
        agentC = vm.addr(agentCPk);

        pm = new AegisPolicyManager();
    }

    // --- Helper to assert budget conservation invariant on a grant ---
    function assertBudgetConservation(bytes32 grantId) internal view {
        IAegisPolicyManager.Grant memory g = pm.getGrant(grantId);
        uint256 available = pm.getAvailableBudget(grantId);
        assertEq(
            g.spent + g.reservedChildBudget + available,
            g.maxTotalBudget,
            "INVARIANT VIOLATION: spent + reserved + available != maxTotalBudget"
        );
        assertTrue(
            g.spent + g.reservedChildBudget <= g.maxTotalBudget,
            "INVARIANT VIOLATION: spent + reserved > maxTotalBudget"
        );
    }

    // --- Helper to sign EIP-712 ActionRequest ---
    function signActionRequest(
        uint256 pk,
        IAegisPolicyManager.ActionRequest memory req
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                pm.ACTION_REQUEST_TYPEHASH(),
                req.actionId,
                req.grantId,
                req.toolBit,
                req.cost,
                req.paramsHash,
                req.nonce,
                req.deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", pm.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ================================================================
    // 1. Root Grant Creation Tests
    // ================================================================

    function test_CreateRootGrant_Success() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        IAegisPolicyManager.Grant memory g = pm.getGrant(g0);
        assertEq(g.grantId, g0);
        assertEq(g.parentGrantId, bytes32(0));
        assertEq(g.agent, agentA);
        assertEq(g.allowedTools, 0x1F);
        assertEq(g.expiresAt, expiry);
        assertEq(g.maxPerAction, 100);
        assertEq(g.maxTotalBudget, 1000);
        assertEq(g.spent, 0);
        assertEq(g.reservedChildBudget, 0);
        assertFalse(g.revoked);
        assertFalse(g.reservationReleased);

        assertBudgetConservation(g0);
    }

    function test_CreateRootGrant_RevertUnauthorized() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(IAegisPolicyManager.Unauthorized.selector);
        pm.createRootGrant(agentA, 0x1F, uint64(block.timestamp + 1 days), 100, 1000);
    }

    function test_CreateRootGrant_RevertExpired() public {
        vm.expectRevert(IAegisPolicyManager.GrantExpired.selector);
        pm.createRootGrant(agentA, 0x1F, uint64(block.timestamp), 100, 1000);
    }

    function test_CreateRootGrant_RevertZeroBudget() public {
        vm.expectRevert(IAegisPolicyManager.BudgetAttenuationFailed.selector);
        pm.createRootGrant(agentA, 0x1F, uint64(block.timestamp + 1 days), 100, 0);
    }

    // ================================================================
    // 2. Monotonic Attenuation Tests
    // ================================================================

    function test_DelegateGrant_Success() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x07, expiry, 50, 400);

        IAegisPolicyManager.Grant memory child = pm.getGrant(g1);
        assertEq(child.parentGrantId, g0);
        assertEq(child.agent, agentB);
        assertEq(child.allowedTools, 0x07);
        assertEq(child.maxPerAction, 50);
        assertEq(child.maxTotalBudget, 400);

        IAegisPolicyManager.Grant memory parent = pm.getGrant(g0);
        assertEq(parent.reservedChildBudget, 400);

        assertBudgetConservation(g0);
        assertBudgetConservation(g1);
    }

    function test_DelegateGrant_RevertScopeAttenuation() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x07, expiry, 100, 1000); // 0x07 has tools 0, 1, 2

        // Child attempts to request 0x17 (includes tool 4: vault transfer)
        vm.expectRevert(IAegisPolicyManager.ScopeAttenuationFailed.selector);
        pm.delegateGrant(g0, agentB, 0x17, expiry, 50, 400);
    }

    function test_DelegateGrant_RevertExpirationAttenuation() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        vm.expectRevert(IAegisPolicyManager.ExpirationAttenuationFailed.selector);
        pm.delegateGrant(g0, agentB, 0x1F, expiry + 1, 50, 400);
    }

    function test_DelegateGrant_RevertPerActionAttenuation() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        vm.expectRevert(IAegisPolicyManager.PerActionAttenuationFailed.selector);
        pm.delegateGrant(g0, agentB, 0x1F, expiry, 101, 400);
    }

    function test_DelegateGrant_RevertBudgetOversubscription() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        // Parent reserves 600
        pm.delegateGrant(g0, agentB, 0x1F, expiry, 100, 600);

        // Attempting to reserve 500 when available is 400 must revert
        vm.expectRevert(IAegisPolicyManager.BudgetAttenuationFailed.selector);
        pm.delegateGrant(g0, agentC, 0x1F, expiry, 100, 500);
    }

    // ================================================================
    // 3. EIP-712 Action Authorization & Spending Tests
    // ================================================================

    function test_CheckAndConsumeBudget_Success() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x07, expiry, 50, 400);

        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("action-1"),
            grantId: g1,
            toolBit: TOOL_RUN_TESTS,
            cost: 20,
            paramsHash: keccak256("params-1"),
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signActionRequest(agentBPk, req);
        pm.checkAndConsumeBudget(req, sig);

        IAegisPolicyManager.Grant memory child = pm.getGrant(g1);
        assertEq(child.spent, 20);
        assertEq(child.nonce, 1);

        IAegisPolicyManager.Grant memory parent = pm.getGrant(g0);
        assertEq(parent.spent, 20);
        assertEq(parent.reservedChildBudget, 380);

        assertBudgetConservation(g0);
        assertBudgetConservation(g1);
    }

    function test_CheckAndConsumeBudget_RevertWrongSigner() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("action-1"),
            grantId: g0,
            toolBit: TOOL_RUN_TESTS,
            cost: 20,
            paramsHash: keccak256("params-1"),
            nonce: 0,
            deadline: expiry
        });

        // Signed by Agent B instead of Agent A
        bytes memory badSig = signActionRequest(agentBPk, req);
        vm.expectRevert(IAegisPolicyManager.InvalidSignature.selector);
        pm.checkAndConsumeBudget(req, badSig);
    }

    function test_CheckAndConsumeBudget_RevertReplay() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);

        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("action-1"),
            grantId: g0,
            toolBit: TOOL_RUN_TESTS,
            cost: 20,
            paramsHash: keccak256("params-1"),
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signActionRequest(agentAPk, req);
        pm.checkAndConsumeBudget(req, sig);

        // Replay attempt with same signature & nonce 0
        vm.expectRevert(abi.encodeWithSelector(IAegisPolicyManager.InvalidNonce.selector, 1, 0));
        pm.checkAndConsumeBudget(req, sig);
    }

    function test_CheckAndConsumeBudget_RevertToolNotPermitted() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x07, expiry, 50, 400); // 0x07 does NOT have 0x10

        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("action-vault"),
            grantId: g1,
            toolBit: TOOL_VAULT_TRANSFER,
            cost: 20,
            paramsHash: keccak256("params-1"),
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signActionRequest(agentBPk, req);
        vm.expectRevert(abi.encodeWithSelector(IAegisPolicyManager.ToolNotPermitted.selector, TOOL_VAULT_TRANSFER, 0x07));
        pm.checkAndConsumeBudget(req, sig);
    }

    function test_CheckAndConsumeBudget_RevertPerActionCapExceeded() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x07, expiry, 50, 400); // cap = 50

        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("action-overcap"),
            grantId: g1,
            toolBit: TOOL_RUN_TESTS,
            cost: 51,
            paramsHash: keccak256("params-1"),
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signActionRequest(agentBPk, req);
        vm.expectRevert(abi.encodeWithSelector(IAegisPolicyManager.PerActionLimitExceeded.selector, 51, 50));
        pm.checkAndConsumeBudget(req, sig);
    }

    // ================================================================
    // 4. Targeted Edge-Case Accounting & Revocation Tests
    // ================================================================

    /**
     * @notice Test Case 1: Releasing a child reservation credits its parent exactly once;
     *         repeated release attempts cannot credit it again.
     */
    function test_EdgeCase1_SingleReleaseGuarantee() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, expiry, 50, 200);

        assertEq(pm.getAvailableBudget(g0), 800);
        assertEq(pm.getGrant(g0).reservedChildBudget, 200);

        // First revocation: credits parent 200
        pm.revokeGrant(g1);

        assertEq(pm.getGrant(g0).reservedChildBudget, 0);
        assertEq(pm.getAvailableBudget(g0), 1000);
        assertTrue(pm.getGrant(g1).revoked);
        assertTrue(pm.getGrant(g1).reservationReleased);

        // Second revocation attempt must revert
        vm.expectRevert(IAegisPolicyManager.AlreadyRevoked.selector);
        pm.revokeGrant(g1);

        // Parent reserved budget remains 0 and available remains 1000
        assertEq(pm.getGrant(g0).reservedChildBudget, 0);
        assertEq(pm.getAvailableBudget(g0), 1000);
        assertBudgetConservation(g0);
    }

    /**
     * @notice Test Case 2: Revoking an ancestor that has descendants, then reclaiming an expired descendant,
     *         cannot double-credit any ancestor.
     */
    function test_EdgeCase2_AncestorRevocationThenDescendantReclaim() public {
        uint64 rootExpiry = uint64(block.timestamp + 10 days);
        uint64 childExpiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, rootExpiry, 100, 1000);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, childExpiry, 100, 400);
        bytes32 g2 = pm.delegateGrant(g1, agentC, 0x1F, childExpiry, 50, 150);

        // G2 spends 20
        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("act-1"),
            grantId: g2,
            toolBit: TOOL_RUN_TESTS,
            cost: 20,
            paramsHash: keccak256("p"),
            nonce: 0,
            deadline: childExpiry
        });
        pm.checkAndConsumeBudget(req, signActionRequest(agentCPk, req));

        // Warp time past child expiry (root is still active)
        vm.warp(childExpiry + 10);

        // Revoke G1 (ancestor of G2)
        pm.revokeGrant(g1);

        // G0 reclaims all G1's unspent budget: 400 - 20 = 380.
        // G0 available is now 1000 - 20 = 980.
        assertEq(pm.getGrant(g0).reservedChildBudget, 0);
        assertEq(pm.getGrant(g0).spent, 20);
        assertEq(pm.getAvailableBudget(g0), 980);

        // Now attempt to reclaim G2
        pm.reclaimExpiredBudget(g2);

        // G0 must NOT be double-credited! G0 available must remain 980!
        assertEq(pm.getGrant(g0).reservedChildBudget, 0);
        assertEq(pm.getGrant(g0).spent, 20);
        assertEq(pm.getAvailableBudget(g0), 980);
        assertBudgetConservation(g0);
    }

    /**
     * @notice Test Case 3: An expired grant remains reserved until reclamation is confirmed,
     *         and reclamation releases exactly its remaining capacity.
     */
    function test_EdgeCase3_ExpiredGrantBudgetConservationUntilReclamation() public {
        uint64 rootExpiry = uint64(block.timestamp + 10 days);
        uint64 childExpiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, rootExpiry, 100, 500);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, childExpiry, 50, 200);

        // Parent available is 300
        assertEq(pm.getAvailableBudget(g0), 300);

        // Warp past child expiry
        vm.warp(childExpiry + 10);

        // Expired child cannot spend
        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("act-exp"),
            grantId: g1,
            toolBit: TOOL_RUN_TESTS,
            cost: 10,
            paramsHash: keccak256("p"),
            nonce: 0,
            deadline: uint64(block.timestamp + 1 days)
        });
        bytes memory sig = signActionRequest(agentBPk, req);
        vm.expectRevert(IAegisPolicyManager.GrantExpired.selector);
        pm.checkAndConsumeBudget(req, sig);

        // Parent CANNOT delegate 350 yet, because 200 is still reserved in g1!
        vm.expectRevert(IAegisPolicyManager.BudgetAttenuationFailed.selector);
        pm.delegateGrant(g0, agentC, 0x1F, uint64(block.timestamp + 1 days), 50, 350);

        // Reclaim expired budget from g1
        pm.reclaimExpiredBudget(g1);

        // Now parent available is 500
        assertEq(pm.getAvailableBudget(g0), 500);
        assertEq(pm.getGrant(g0).reservedChildBudget, 0);

        // Now parent CAN delegate 350
        bytes32 g2 = pm.delegateGrant(g0, agentC, 0x1F, uint64(block.timestamp + 1 days), 50, 350);
        assertEq(pm.getAvailableBudget(g0), 150);
        assertBudgetConservation(g0);
        assertBudgetConservation(g2);
    }

    /**
     * @notice Test Case 4: Delegation and reclamation in either transaction order cannot oversubscribe a parent.
     */
    function test_EdgeCase4_OrderIndependencePreventsOversubscription() public {
        uint64 rootExpiry = uint64(block.timestamp + 10 days);
        uint64 childExpiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, rootExpiry, 100, 500);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, childExpiry, 50, 200);

        vm.warp(childExpiry + 10);

        // Ordering Scenario: Attempt delegate before reclaim
        vm.expectRevert(IAegisPolicyManager.BudgetAttenuationFailed.selector);
        pm.delegateGrant(g0, agentC, 0x1F, uint64(block.timestamp + 1 days), 50, 400);

        // Can only delegate up to current available (300)
        bytes32 g2 = pm.delegateGrant(g0, agentC, 0x1F, uint64(block.timestamp + 1 days), 50, 250);
        assertEq(pm.getAvailableBudget(g0), 50);

        // Reclaim g1
        pm.reclaimExpiredBudget(g1);
        // Available increases by 200 to 250
        assertEq(pm.getAvailableBudget(g0), 250);

        assertBudgetConservation(g0);
        assertBudgetConservation(g2);
    }

    /**
     * @notice Test Case 5: Full lifecycle walkthrough with invariant verification after every state transition.
     */
    function test_EdgeCase5_FullLifecycleTraceWithInvariants() public {
        uint64 expiry = uint64(block.timestamp + 2 days);

        // Step 0: Root Creation
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100, 1000);
        assertBudgetConservation(g0);
        assertEq(pm.getAvailableBudget(g0), 1000);

        // Step 1: Delegate to Agent A (G1)
        bytes32 g1 = pm.delegateGrant(g0, agentA, 0x1F, expiry, 100, 400);
        assertBudgetConservation(g0);
        assertBudgetConservation(g1);
        assertEq(pm.getAvailableBudget(g0), 600);
        assertEq(pm.getAvailableBudget(g1), 400);

        // Step 2: Agent A delegates to Agent B (G2)
        vm.prank(agentA);
        bytes32 g2 = pm.delegateGrant(g1, agentB, 0x07, expiry, 50, 150);
        assertBudgetConservation(g0);
        assertBudgetConservation(g1);
        assertBudgetConservation(g2);
        assertEq(pm.getAvailableBudget(g0), 600);
        assertEq(pm.getAvailableBudget(g1), 250);
        assertEq(pm.getAvailableBudget(g2), 150);

        // Step 3: Agent B spends 20
        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256("act-3"),
            grantId: g2,
            toolBit: TOOL_RUN_TESTS,
            cost: 20,
            paramsHash: keccak256("test-p"),
            nonce: 0,
            deadline: expiry
        });
        pm.checkAndConsumeBudget(req, signActionRequest(agentBPk, req));

        assertBudgetConservation(g0);
        assertBudgetConservation(g1);
        assertBudgetConservation(g2);
        assertEq(pm.getGrant(g0).spent, 20);
        assertEq(pm.getGrant(g1).spent, 20);
        assertEq(pm.getGrant(g2).spent, 20);

        // Step 6: Agent A revokes G2
        vm.prank(agentA);
        pm.revokeGrant(g2);
        assertBudgetConservation(g0);
        assertBudgetConservation(g1);
        assertEq(pm.getAvailableBudget(g0), 600); // G0 unchanged!
        assertEq(pm.getAvailableBudget(g1), 380); // G1 regained 130!

        // Step 8: Owner revokes G1
        pm.revokeGrant(g1);
        assertBudgetConservation(g0);
        assertEq(pm.getAvailableBudget(g0), 980); // G0 regained remaining 380!
    }
}
