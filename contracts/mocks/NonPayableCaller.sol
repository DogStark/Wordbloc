// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @dev Test-only mock. NOT part of the production contract set.
 * Deliberately has no receive()/fallback so it cannot accept a refund.
 * Used to exercise the overpayment-refund path when the payer cannot
 * receive CELO back.
 */
contract NonPayableCaller {
    function purchaseSubscription(address target, uint8 planType) external payable {
        (bool ok, bytes memory data) = target.call{value: msg.value}(
            abi.encodeWithSignature("purchaseSubscription(uint8)", planType)
        );
        if (!ok) {
            assembly {
                revert(add(data, 32), mload(data))
            }
        }
    }
}
