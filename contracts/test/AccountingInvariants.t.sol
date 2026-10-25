// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AegisPolicyManager.sol";

contract AccountingInvariantsTest is Test {
    AegisPolicyManager public pm;

    uint256 public agentAPk = 0x111;
    address public agentA;
    uint256 public agentBPk = 0x222;
    address public agentB;

    function setUp() public {
        agentA = vm.addr(agentAPk);
        agentB = vm.addr(agentBPk);
        pm = new AegisPolicyManager();
    }

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

    function assertBudgetConservation(bytes32 grantId) internal view {
        IAegisPolicyManager.Grant memory g = pm.getGrant(grantId);
        uint256 available = pm.getAvailableBudget(grantId);
        assertEq(
            g.spent + g.reservedChildBudget + available,
            g.maxTotalBudget,
            "Invariant Violation: S + R + A != B"
        );
        assertTrue(
            g.spent + g.reservedChildBudget <= g.maxTotalBudget,
            "Invariant Violation: S + R > B"
        );
    }

    function testFuzz_ConservationAcrossDelegationAndSpend(
        uint256 rootBudget,
        uint256 childBudget,
        uint256 spendCost
    ) public {
        rootBudget = bound(rootBudget, 100, 1e12);
        childBudget = bound(childBudget, 10, rootBudget);
        spendCost = bound(spendCost, 1, childBudget);

        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, childBudget, rootBudget);
        assertBudgetConservation(g0);

        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, expiry, spendCost, childBudget);
        assertBudgetConservation(g0);
        assertBudgetConservation(g1);

        IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
            actionId: keccak256(abi.encode("fuzz-action", spendCost)),
            grantId: g1,
            toolBit: 1 << 1,
            cost: spendCost,
            paramsHash: keccak256("p"),
            nonce: 0,
            deadline: expiry
        });

        pm.checkAndConsumeBudget(req, signActionRequest(agentBPk, req));
        assertBudgetConservation(g0);
        assertBudgetConservation(g1);

        assertEq(pm.getGrant(g0).spent, spendCost);
        assertEq(pm.getGrant(g1).spent, spendCost);
    }

    function testFuzz_RevocationReclaimsExactUnspent(
        uint256 rootBudget,
        uint256 childBudget,
        uint256 spendCost
    ) public {
        rootBudget = bound(rootBudget, 100, 1e12);
        childBudget = bound(childBudget, 10, rootBudget);
        spendCost = bound(spendCost, 0, childBudget);

        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, childBudget, rootBudget);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, expiry, childBudget, childBudget);

        if (spendCost > 0) {
            IAegisPolicyManager.ActionRequest memory req = IAegisPolicyManager.ActionRequest({
                actionId: keccak256("act"),
                grantId: g1,
                toolBit: 1 << 1,
                cost: spendCost,
                paramsHash: keccak256("p"),
                nonce: 0,
                deadline: expiry
            });
            pm.checkAndConsumeBudget(req, signActionRequest(agentBPk, req));
        }

        uint256 expectedUnspent = childBudget - spendCost;
        uint256 parentAvailBefore = pm.getAvailableBudget(g0);

        pm.revokeGrant(g1);

        uint256 parentAvailAfter = pm.getAvailableBudget(g0);
        assertEq(parentAvailAfter - parentAvailBefore, expectedUnspent);
        assertBudgetConservation(g0);
    }
}
