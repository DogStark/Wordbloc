// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

interface ISpellBlocCertificates {
    function issueCertificate(
        address childWallet,
        uint256 certificateTypeId,
        uint256 wordsCompleted,
        uint256 accuracyAchieved,
        bytes32 dataHash,
        string memory ipfsHash
    ) external;
}

/**
 * @dev Test-only mock. NOT part of the production contract set.
 * On receiving an ERC1155 mint, attempts to re-enter issueCertificate to
 * prove/disprove the nonReentrant guard on SpellBlocCertificates.
 */
contract ReentrantERC1155Receiver is ERC165, IERC1155Receiver {
    ISpellBlocCertificates public immutable target;
    bytes32 public reentryDataHash;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(address _target, bytes32 _reentryDataHash) {
        target = ISpellBlocCertificates(_target);
        reentryDataHash = _reentryDataHash;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        reentryAttempted = true;
        try
            target.issueCertificate(
                address(this),
                0,
                1000,
                10000,
                reentryDataHash,
                "ipfs://reentry"
            )
        {
            reentrySucceeded = true;
        } catch {
            reentrySucceeded = false;
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC165, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
