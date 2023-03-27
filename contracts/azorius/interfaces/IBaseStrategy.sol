// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

/**
 * The specification for a voting strategy in Azorius.
 *
 * Each IBaseStrategy implementation need only implement the given functions here,
 * which allows for a highly composable and simple or complex voting strategies.
 *
 * It should be noted that while many voting strategies make use of parameters such as
 * voting period or quorum, that is a detail of the individual strategy itself, and not
 * a requirement for the Azorius system.
 */
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
    function isPassed(uint32 _proposalId) external view returns (bool);

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
     * @param _proposalId proposalId to check
     * @return uint32 block number when voting ends on the Proposal
     */
    function votingEndBlock(uint32 _proposalId) external view returns (uint32);
}
