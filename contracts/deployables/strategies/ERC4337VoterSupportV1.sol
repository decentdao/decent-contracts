// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {SmartAccountValidationV1} from "../account-abstraction/SmartAccountValidationV1.sol";

/**
 * Functionality to support ERC4337 (Account Abstraction) by properly identifying the voter
 * when a contract account is used to interact with the voting system.
 */
abstract contract ERC4337VoterSupportV1 is SmartAccountValidationV1 {
    /**
     * @dev Tracks whether a proposal's voting period has been marked as ended.
     * This flag is set to true when the first vote attempt occurs after the voting end timepoint,
     * triggering a VotingPeriodEnded event. Used to allow an at-most-once vote to not revert
     * after the voting period has ended, and to give bundlers the ability to determine
     * if a proposal voting period has ended without using the banned NUMBER opcode.
     */
    mapping(uint32 => bool) internal _votingPeriodEnded;

    event VotingPeriodEnded(
        uint32 indexed proposalId,
        uint256 votingEndPoint,
        uint256 currentPoint
    );

    constructor() {
        _disableInitializers();
    }

    function __ERC4337VoterSupportV1_init(
        address _lightAccountFactory
    ) internal {
        __SmartAccountValidationV1_init(_lightAccountFactory);
    }

    /**
     * Returns the address of the voter which owns the voting weight
     * @param _msgSender address of the sender. It can be the wallet address, or the smart account address with EOA as owner
     * @return address of the voter
     */
    function voter(address _msgSender) public view virtual returns (address) {
        (bool isValid, address lightAccountOwner) = validateSmartAccount(
            _msgSender
        );
        if (!isValid) {
            return _msgSender;
        }

        return lightAccountOwner;
    }

    /**
     * @dev Tracks whether a proposal's voting period has been officially marked as ended.
     * This flag is set to true when the first vote attempt occurs after the voting end timepoint,
     * triggering a VotingPeriodEnded event. Used to ensure the event is emitted exactly once
     * per proposal, and only if a vote has been attempted after the voting end timepoint.
     * @param _proposalId The ID of the proposal to check.
     * @return True if the voting period has ended and a vote has been attempted after the voting end timepoint, false otherwise.
     */
    function votingPeriodEnded(
        uint32 _proposalId
    ) external view virtual returns (bool) {
        return _votingPeriodEnded[_proposalId];
    }
}
