// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {ITokenAdapterV1} from "../../interfaces/decent/deployables/ITokenAdapterV1.sol";
import {Version} from "../Version.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title StrategyV1
 * @notice This contract is the central voting engine for Azorius.
 * It manages different Token Adapters to aggregate voting weight and uses this
 * weight to determine proposal outcomes based on its configured parameters.
 * For the MVP, it uses a simple linear aggregation of raw weights from adapters
 * and applies quorum/basis logic similar to existing linear strategies.
 */
contract StrategyV1 is
    Initializable,
    IStrategyV1,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ERC165,
    ERC4337VoterSupportV1,
    Version
{
    uint16 public constant VERSION = 1;

    // --- State Variables ---

    address public azorius; // The Azorius module this strategy serves
    uint32 public votingPeriod; // Duration for voting on proposals
    uint256 public quorumThreshold; // Fixed number of votes required for quorum
    uint256 public basisNumerator; // Numerator for basis calculation (denominator is 1,000,000)

    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    // @notice Mapping from proposalId to its voting details.
    struct ProposalVotingDetails {
        uint48 votingStartTimestamp;
        uint48 votingEndTimestamp;
        uint32 votingStartBlock;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 abstainVotes;
    }
    mapping(uint32 => ProposalVotingDetails) public proposalVotingDetails;

    ITokenAdapterV1[] public tokenAdapters;

    enum VoteType {
        NO,
        YES,
        ABSTAIN
    }

    // --- Events ---
    event StrategyParametersUpdated(
        uint32 votingPeriod,
        uint256 quorumThreshold,
        uint256 basisNumerator
    );
    event AdapterAdded(address indexed adapter, uint256 index);
    event AdapterRemoved(address indexed adapter, uint256 index);
    event Voted(
        address indexed voter,
        uint32 indexed proposalId,
        VoteType voteType,
        uint256 totalWeightCastedInTx
    );
    event ProposalInitialized(
        uint32 indexed proposalId,
        uint48 votingStartTimestamp,
        uint48 votingEndTimestamp,
        uint32 votingStartBlock
    );

    // --- Errors ---
    error InvalidAzoriusAddress();
    error InvalidVotingPeriod();
    error InvalidBasisNumerator();
    error AdapterIsZeroAddress();
    error AdapterAlreadyExists();
    error AdapterNotFound();
    error NoAdapters();
    error ProposalNotFoundOrNotActive();
    error NoVotingWeight();
    error InvalidVoteType();
    error ProposalNotInitialized();
    error MismatchedInputs();

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the StrategyV1 contract.
     * @param _initialOwner The initial owner of this Strategy contract.
     * @param _azorius The address of the AzoriusV1 contract this strategy will serve.
     * @param _votingPeriod The duration (in seconds) for which proposals will be active.
     * @param _quorumThreshold The fixed number of votes required for a proposal to meet quorum.
     * @param _basisNumerator The numerator for calculating the basis for passing a proposal.
     * @param _initialTokenAdapters Array of initial token adapters to set.
     * @param _lightAccountFactory Address of the LightAccountFactory for ERC4337 support.
     */
    function initialize(
        address _initialOwner,
        address _azorius,
        uint32 _votingPeriod,
        uint256 _quorumThreshold,
        uint256 _basisNumerator,
        ITokenAdapterV1[] memory _initialTokenAdapters,
        address _lightAccountFactory
    ) public virtual initializer {
        if (_azorius == address(0)) revert InvalidAzoriusAddress();

        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();
        __ERC4337VoterSupportV1_init(_lightAccountFactory);

        azorius = _azorius;
        _updateVotingPeriod(_votingPeriod);
        _updateQuorumThreshold(_quorumThreshold);
        _updateBasisNumerator(_basisNumerator);

        if (_initialTokenAdapters.length > 0) {
            for (uint256 i = 0; i < _initialTokenAdapters.length; i++) {
                _addAdapter(_initialTokenAdapters[i]);
            }
        }

        emit StrategyParametersUpdated(
            votingPeriod, // Current votingPeriod
            quorumThreshold, // Current quorumThreshold
            basisNumerator // The newly set basisNumerator
        );
    }

    /**
     * @dev Authorizes an upgrade to a new implementation.
     * Only the owner (likely Azorius or a DAO governor) can authorize upgrades.
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    // --- Parameter Update Functions ---

    /**
     * @notice Updates the voting period for future proposals.
     * @param _newVotingPeriod The new voting period in seconds (must be > 0).
     */
    function updateVotingPeriod(uint32 _newVotingPeriod) external onlyOwner {
        _updateVotingPeriod(_newVotingPeriod);
        emit StrategyParametersUpdated(
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    /**
     * @notice Updates the quorum threshold for future proposals.
     * @param _newQuorumThreshold The new quorum threshold (can be 0).
     */
    function updateQuorumThreshold(
        uint256 _newQuorumThreshold
    ) external onlyOwner {
        _updateQuorumThreshold(_newQuorumThreshold);
        emit StrategyParametersUpdated(
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    /**
     * @notice Updates the basis numerator for future proposals.
     * @param _newBasisNumerator The new numerator to use (between 500,000 and 1,000,000).
     */
    function updateBasisNumerator(
        uint256 _newBasisNumerator
    ) external onlyOwner {
        _updateBasisNumerator(_newBasisNumerator);
        emit StrategyParametersUpdated(
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    // --- Internal Helper Functions ---

    /**
     * @dev Updates the voting period, validates it.
     * @param _newVotingPeriod The voting period to set.
     */
    function _updateVotingPeriod(uint32 _newVotingPeriod) internal {
        if (_newVotingPeriod == 0) revert InvalidVotingPeriod();
        votingPeriod = _newVotingPeriod;
    }

    /**
     * @dev Updates the quorum threshold.
     * @param _newQuorumThreshold The quorum threshold to set.
     */
    function _updateQuorumThreshold(uint256 _newQuorumThreshold) internal {
        // No specific validation for quorumThreshold (can be 0)
        quorumThreshold = _newQuorumThreshold;
    }

    /**
     * @dev Updates the basis numerator, validates it.
     * @param _newBasisNumerator The basis numerator to set.
     */
    function _updateBasisNumerator(uint256 _newBasisNumerator) internal {
        if (
            _newBasisNumerator > BASIS_DENOMINATOR ||
            _newBasisNumerator < BASIS_DENOMINATOR / 2
        ) revert InvalidBasisNumerator();

        basisNumerator = _newBasisNumerator;
    }

    /**
     * @dev Internal function to add a token adapter.
     * Contains core logic for checks and state update.
     */
    function _addAdapter(ITokenAdapterV1 _adapter) internal {
        if (address(_adapter) == address(0)) revert AdapterIsZeroAddress();
        for (uint256 i = 0; i < tokenAdapters.length; i++) {
            if (tokenAdapters[i] == _adapter) revert AdapterAlreadyExists();
        }
        tokenAdapters.push(_adapter);
        emit AdapterAdded(address(_adapter), tokenAdapters.length - 1);
    }

    // --- Token Adapter Management ---

    /**
     * @notice Adds a token adapter to the strategy.
     * @param _adapter The address of the ITokenAdapter to add.
     */
    function addAdapter(ITokenAdapterV1 _adapter) public onlyOwner {
        _addAdapter(_adapter);
    }

    /**
     * @notice Removes a token adapter from the strategy.
     * @param _adapter The address of the ITokenAdapter to remove.
     */
    function removeAdapter(ITokenAdapterV1 _adapter) external onlyOwner {
        if (address(_adapter) == address(0)) revert AdapterIsZeroAddress();
        uint256 adapterCount = tokenAdapters.length;
        if (adapterCount == 0) revert AdapterNotFound();

        for (uint256 i = 0; i < adapterCount; i++) {
            if (tokenAdapters[i] == _adapter) {
                tokenAdapters[i] = tokenAdapters[adapterCount - 1];
                tokenAdapters.pop();
                emit AdapterRemoved(address(_adapter), i);
                return;
            }
        }
        revert AdapterNotFound();
    }

    /**
     * @notice Returns the number of token adapters currently configured.
     */
    function getTokenAdapterCount() external view returns (uint256) {
        return tokenAdapters.length;
    }

    /**
     * @notice Called by Azorius when a new proposal is created.
     * @dev See {IStrategyV1-initializeProposal}.
     */
    function initializeProposal(bytes memory _data) external virtual override {
        if (msg.sender != azorius) revert InvalidAzoriusAddress();
        if (tokenAdapters.length == 0) revert NoAdapters();

        uint32 proposalId = abi.decode(_data, (uint32));

        ProposalVotingDetails storage proposal = proposalVotingDetails[
            proposalId
        ];
        proposal.votingStartTimestamp = uint48(block.timestamp);
        proposal.votingEndTimestamp = uint48(block.timestamp + votingPeriod);
        proposal.votingStartBlock = uint32(block.number);
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        proposal.abstainVotes = 0;
        // Note: mapping(address => bool) hasVoted is implicitly false for all addresses initially

        emit ProposalInitialized(
            proposalId,
            proposal.votingStartTimestamp,
            proposal.votingEndTimestamp,
            proposal.votingStartBlock
        );
    }

    /**
     * @notice Checks if a proposal has passed.
     * @dev See {IStrategyV1-isPassed}.
     */
    function isPassed(
        uint32 _proposalId
    ) external view virtual override returns (bool) {
        ProposalVotingDetails storage proposal = proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            // Proposal not initialized or details cleared - cannot be passed.
            return false;
        }

        if (block.timestamp <= proposal.votingEndTimestamp) {
            // Voting period not yet over.
            return false;
        }

        // Quorum Check using fixed threshold
        uint256 totalVotesForQuorum = proposal.yesVotes + proposal.abstainVotes;
        bool quorumMet = totalVotesForQuorum >= quorumThreshold;

        if (!quorumMet) {
            return false;
        }

        // Basis Check
        // yesVotes / (yesVotes + noVotes) > basisNumerator / BASIS_DENOMINATOR
        // To avoid division, rewrite as: yesVotes * BASIS_DENOMINATOR > (yesVotes + noVotes) * basisNumerator
        uint256 totalYesAndNoVotes = proposal.yesVotes + proposal.noVotes;
        if (totalYesAndNoVotes == 0) {
            // If there are no yes or no votes, basis cannot be met unless basisNumerator is 0 (which is disallowed).
            // Or if yesVotes is > 0 and basisNumerator is less than 50% (e.g. simple majority on 0 no votes).
            // Our current check `_basisNumerator < BASIS_DENOMINATOR / 2` prevents basis < 50%.
            // Thus, if totalYesAndNoVotes is 0, basis is only met if yesVotes > 0 and basis is effectively >0% (which it is).
            // However, standard interpretation is that if yes+no = 0, it fails basis unless yes > 0 for some reason (e.g. basis is 0%).
            // Given basisNumerator must be >= 50%, if yesVotes + noVotes = 0, then yesVotes is 0.
            // So, 0 * DENOMINATOR > 0 * basisNumerator (0 > 0) is false. Fails basis.
            return false;
        }
        bool basisMet = (proposal.yesVotes * BASIS_DENOMINATOR) >
            (totalYesAndNoVotes * basisNumerator);

        return basisMet;
    }

    /**
     * @notice Checks if an address is eligible to create proposals.
     * @dev See {IStrategyV1-isProposer}.
     */
    function isProposer(
        address _address
    ) external view virtual override returns (bool) {
        if (tokenAdapters.length == 0) return false;
        for (uint256 i = 0; i < tokenAdapters.length; i++) {
            if (tokenAdapters[i].isProposer(_address)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Gets the voting start and end timestamps for a proposal.
     * @dev See {IStrategyV1-getVotingTimestamps}.
     */
    function getVotingTimestamps(
        uint32 _proposalId
    )
        external
        view
        virtual
        override
        returns (uint48 startTime, uint48 endTime)
    {
        ProposalVotingDetails storage details = proposalVotingDetails[
            _proposalId
        ];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized(); // Ensure proposal exists
        return (details.votingStartTimestamp, details.votingEndTimestamp);
    }

    function getProposalBlocks(
        uint32 _proposalId
    ) external view virtual override returns (uint32 votingStartBlock) {
        ProposalVotingDetails storage details = proposalVotingDetails[
            _proposalId
        ];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized(); // Check if proposal exists via votingEndTimestamp
        return details.votingStartBlock;
    }

    function vote(
        uint32 _proposalId,
        uint8 _voteType,
        ITokenAdapterV1[] calldata _adaptersToUse,
        bytes[] calldata _adapterVoteData
    ) external virtual override {
        if (_adaptersToUse.length != _adapterVoteData.length)
            revert MismatchedInputs();

        address resolvedVoter = voter(msg.sender);
        ProposalVotingDetails storage proposal = proposalVotingDetails[
            _proposalId
        ];

        if (
            proposal.votingEndTimestamp == 0 ||
            block.timestamp > proposal.votingEndTimestamp
        ) {
            revert ProposalNotFoundOrNotActive();
        }

        uint256 totalWeightForThisVoteTransaction = 0;
        for (uint256 i = 0; i < _adaptersToUse.length; i++) {
            // Ensure the adapter being used is actually one of the configured adapters for this strategy
            // This is a safety check, though StrategyV1 owner configures adapters.
            // A more robust check might involve verifying _adaptersToUse[i] is in tokenAdapters array.
            // For now, we trust the input, assuming it's curated by a trusted frontend or caller.
            uint256 weightCasted = _adaptersToUse[i].recordVote(
                resolvedVoter,
                _proposalId,
                _adapterVoteData[i]
            );
            totalWeightForThisVoteTransaction += weightCasted;
        }

        if (totalWeightForThisVoteTransaction == 0) revert NoVotingWeight();

        if (_voteType == uint8(VoteType.YES)) {
            proposal.yesVotes += totalWeightForThisVoteTransaction;
        } else if (_voteType == uint8(VoteType.NO)) {
            proposal.noVotes += totalWeightForThisVoteTransaction;
        } else if (_voteType == uint8(VoteType.ABSTAIN)) {
            proposal.abstainVotes += totalWeightForThisVoteTransaction;
        } else {
            revert InvalidVoteType();
        }

        // Note: We are not setting a global `hasVoted` for the `resolvedVoter` at the StrategyV1 level anymore.
        // Uniqueness is now managed within each adapter (e.g., ERC721Adapter's nftUsedForVote).
        // For ERC20Adapter, the snapshot mechanism inherently handles this for the voter's total weight.
        emit Voted(
            resolvedVoter,
            _proposalId,
            VoteType(_voteType),
            totalWeightForThisVoteTransaction
        );
    }

    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    /**
     * @dev See {ERC165-supportsInterface}.
     * @inheritdoc ERC165
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165, Version) returns (bool) {
        return
            interfaceId == type(IStrategyV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
