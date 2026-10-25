// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AegisPolicyManager.sol";
import "../src/AgentVault.sol";
import "../src/MockUSDC.sol";

contract AgentVaultTest is Test {
    AegisPolicyManager public pm;
    AgentVault public vault;
    MockUSDC public token;

    address public owner = address(this);
    uint256 public agentAPk = 0xA11CE;
    address public agentA;
    uint256 public agentBPk = 0xB0B;
    address public agentB;
    address public recipient = address(0xCAFE);

    uint256 public constant TOOL_READ_STATUS    = 1 << 0;
    uint256 public constant TOOL_RUN_TESTS      = 1 << 1;
    uint256 public constant TOOL_VAULT_TRANSFER = 1 << 4;

    function setUp() public {
        agentA = vm.addr(agentAPk);
        agentB = vm.addr(agentBPk);

        token = new MockUSDC();
        pm = new AegisPolicyManager();
        vault = new AgentVault(address(pm), address(token));
        pm.setVault(address(vault));

        // Fund vault with 10,000 mUSDC
        token.approve(address(vault), 10_000 * 10 ** 6);
        vault.deposit(10_000 * 10 ** 6);
    }

    // --- Helper to sign EIP-712 VaultTransferRequest ---
    function signVaultTransfer(
        uint256 pk,
        IAgentVault.VaultTransferRequest memory req
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                vault.VAULT_TRANSFER_TYPEHASH(),
                req.actionId,
                req.grantId,
                req.to,
                req.amount,
                req.nonce,
                req.deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_Deposit_Success() public {
        uint256 balBefore = token.balanceOf(address(vault));
        token.approve(address(vault), 500 * 10 ** 6);
        vault.deposit(500 * 10 ** 6);
        assertEq(token.balanceOf(address(vault)), balBefore + 500 * 10 ** 6);
    }

    function test_ExecuteTransfer_Success() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 500 * 10 ** 6, 1000 * 10 ** 6);

        IAgentVault.VaultTransferRequest memory req = IAgentVault.VaultTransferRequest({
            actionId: keccak256("transfer-1"),
            grantId: g0,
            to: recipient,
            amount: 250 * 10 ** 6,
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signVaultTransfer(agentAPk, req);

        uint256 recipientBalBefore = token.balanceOf(recipient);
        bool ok = vault.executeTransfer(req, sig);
        assertTrue(ok);

        assertEq(token.balanceOf(recipient), recipientBalBefore + 250 * 10 ** 6);
        assertEq(pm.getGrant(g0).spent, 250 * 10 ** 6);
        assertEq(pm.getGrant(g0).nonce, 1);
    }

    function test_ExecuteTransfer_RevertToolNotPermitted() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        // Grant with only tools 0, 1 (read status, run tests), NO vault transfer (0x10)
        bytes32 g0 = pm.createRootGrant(agentA, 0x03, expiry, 500 * 10 ** 6, 1000 * 10 ** 6);

        IAgentVault.VaultTransferRequest memory req = IAgentVault.VaultTransferRequest({
            actionId: keccak256("transfer-notpermitted"),
            grantId: g0,
            to: recipient,
            amount: 100 * 10 ** 6,
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signVaultTransfer(agentAPk, req);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAegisPolicyManager.ToolNotPermitted.selector,
                TOOL_VAULT_TRANSFER,
                0x03
            )
        );
        vault.executeTransfer(req, sig);
    }

    function test_ExecuteTransfer_RevertPerActionCapExceeded() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        // Grant with maxPerAction = 100
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 100 * 10 ** 6, 1000 * 10 ** 6);

        IAgentVault.VaultTransferRequest memory req = IAgentVault.VaultTransferRequest({
            actionId: keccak256("transfer-overcap"),
            grantId: g0,
            to: recipient,
            amount: 101 * 10 ** 6, // Exceeds 100
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signVaultTransfer(agentAPk, req);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAegisPolicyManager.PerActionLimitExceeded.selector,
                101 * 10 ** 6,
                100 * 10 ** 6
            )
        );
        vault.executeTransfer(req, sig);
    }

    function test_ExecuteTransfer_RevertBudgetExceeded() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        // Grant with maxTotalBudget = 100
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 200 * 10 ** 6, 100 * 10 ** 6);

        // First transfer 80
        IAgentVault.VaultTransferRequest memory req1 = IAgentVault.VaultTransferRequest({
            actionId: keccak256("transfer-1"),
            grantId: g0,
            to: recipient,
            amount: 80 * 10 ** 6,
            nonce: 0,
            deadline: expiry
        });
        vault.executeTransfer(req1, signVaultTransfer(agentAPk, req1));

        // Second transfer 30 (80 + 30 = 110 > 100) must revert
        IAgentVault.VaultTransferRequest memory req2 = IAgentVault.VaultTransferRequest({
            actionId: keccak256("transfer-2"),
            grantId: g0,
            to: recipient,
            amount: 30 * 10 ** 6,
            nonce: 1,
            deadline: expiry
        });
        bytes memory sig = signVaultTransfer(agentAPk, req2);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAegisPolicyManager.SubtreeBudgetExceeded.selector,
                30 * 10 ** 6,
                20 * 10 ** 6
            )
        );
        vault.executeTransfer(req2, sig);
    }

    function test_ExecuteTransfer_RevertRevokedAncestor() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 g0 = pm.createRootGrant(agentA, 0x1F, expiry, 500 * 10 ** 6, 1000 * 10 ** 6);
        bytes32 g1 = pm.delegateGrant(g0, agentB, 0x1F, expiry, 200 * 10 ** 6, 400 * 10 ** 6);

        // Revoke root grant g0
        pm.revokeGrant(g0);

        // Child g1 attempts to transfer
        IAgentVault.VaultTransferRequest memory req = IAgentVault.VaultTransferRequest({
            actionId: keccak256("transfer-revoked"),
            grantId: g1,
            to: recipient,
            amount: 50 * 10 ** 6,
            nonce: 0,
            deadline: expiry
        });

        bytes memory sig = signVaultTransfer(agentBPk, req);

        vm.expectRevert(abi.encodeWithSelector(IAegisPolicyManager.AncestorRevoked.selector, g0));
        vault.executeTransfer(req, sig);
    }
}
