// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ISpellBlocPayments {
    function withdrawFunds(uint256 amount) external;
    function emergencyWithdraw() external;
}

/**
 * @dev Test-only mock. NOT part of the production contract set.
 * Used to prove/disprove reentrancy claims against SpellBlocPayments'
 * withdrawal paths when this contract is set as the owner. `target` is
 * immutable (read from bytecode, not SLOAD) and receive() performs no
 * storage writes of its own, so the only gas cost inside the 2300-gas
 * stipend forwarded by `.transfer()` is the reentrant call attempt itself —
 * this isolates whether the guard or the gas stipend is what blocks reentry.
 * Outcome is observed externally (event count / balance deltas), not via
 * mock-side flags, to avoid the mock's own bookkeeping consuming the
 * stipend and confounding the result.
 */
contract ReentrantOwner {
    ISpellBlocPayments public immutable target;

    constructor(address _target) {
        target = ISpellBlocPayments(_target);
    }

    function callWithdrawFunds(uint256 amount) external {
        target.withdrawFunds(amount);
    }

    function callEmergencyWithdraw() external {
        target.emergencyWithdraw();
    }

    receive() external payable {
        // solhint-disable-next-line no-empty-blocks
        try target.withdrawFunds(1) {} catch {}
    }
}
