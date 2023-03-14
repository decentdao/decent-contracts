// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

interface IBaseStrategy {

    /**
     * Sets the address of the Azorius contract this BaseStrategy is being used on.
     *
     * @param _azoriusModule address of the Azorius Safe module
     */
    function setAzorius(address _azoriusModule) external;

    /**
     * Called by the Azorius module. This notifies this BaseStrategy that a new
     * Proposal has been created.
     *
     * @param _data arbitrary data to pass to this BaseStrategy
     */
    function initializeProposal(bytes memory _data) external;

    /**
     * Returns whether a Proposal has been passed.
     *
     * @param _proposalId proposalId to check
     * @return bool true if the proposal has passed, otherwise false
     */
    function isPassed(uint256 _proposalId) external view returns (bool);

    /**
     * Returns whether the specified address can submit a Proposal with
     * this BaseStrategy.
     *
     * This allows a BaseStrategy to place any limits it would like on
     * who can create new Proposals, such as requiring a minimum token
     * delegation.
     *
     * @param _address address to check
     * @return bool true if the address can submit a Proposal, otherwise false
     */
    function isProposer(address _address) external view returns (bool);

    /**
     * Returns the block number voting ends on a given Proposal.
     *
     * TODO would uint64 be better here for both block number and proposalId? max value is 18446744073709551615, current Eth block is 16828775
     *
     * @param _proposalId proposalId to check
     * @return uint256 block number when voting ends on the Proposal
     */
    function votingEndBlock(uint256 _proposalId) external view returns (uint256);
}