// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IStrategyBaseV1} from "../../interfaces/decent/deployables/IStrategyBaseV1.sol";
import {ITokenAdapterBaseV1} from "../../interfaces/decent/deployables/ITokenAdapterBaseV1.sol";
import {Version} from "../Version.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

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

    address public azorius;
    uint32 public votingPeriod;
    uint256 public quorumThreshold;
    uint256 public basisNumerator;

    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    struct ProposalVotingDetails {
        uint48 votingStartTimestamp;
        uint48 votingEndTimestamp;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 abstainVotes;
    }
    mapping(uint32 => ProposalVotingDetails) public proposalVotingDetails;

    ITokenAdapterBaseV1[] public tokenAdapters;

    enum VoteType {
        NO,
        YES,
        ABSTAIN
    }

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
        uint48 votingEndTimestamp
    );

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
    error InvalidAdapterProvidedInVote();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _initialOwner,
        address _azorius,
        uint32 _votingPeriod,
        uint256 _quorumThreshold,
        uint256 _basisNumerator,
        address[] memory _initialTokenAdapters,
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
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    function updateVotingPeriod(
        uint32 _newVotingPeriod
    ) external override onlyOwner {
        _updateVotingPeriod(_newVotingPeriod);
        emit StrategyParametersUpdated(
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    function updateQuorumThreshold(
        uint256 _newQuorumThreshold
    ) external override onlyOwner {
        _updateQuorumThreshold(_newQuorumThreshold);
        emit StrategyParametersUpdated(
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    function updateBasisNumerator(
        uint256 _newBasisNumerator
    ) external override onlyOwner {
        _updateBasisNumerator(_newBasisNumerator);
        emit StrategyParametersUpdated(
            votingPeriod,
            quorumThreshold,
            basisNumerator
        );
    }

    function addAdapter(address _adapter) public override onlyOwner {
        _addAdapter(_adapter);
    }

    function removeAdapter(address _adapter) external override onlyOwner {
        if (_adapter == address(0)) revert AdapterIsZeroAddress();
        uint256 adapterCount = tokenAdapters.length;
        if (adapterCount == 0) revert AdapterNotFound();

        for (uint256 i = 0; i < adapterCount; i++) {
            if (address(tokenAdapters[i]) == _adapter) {
                tokenAdapters[i] = tokenAdapters[adapterCount - 1];
                tokenAdapters.pop();
                emit AdapterRemoved(address(_adapter), i);
                return;
            }
        }
        revert AdapterNotFound();
    }

    function getTokenAdapterCount() external view override returns (uint256) {
        return tokenAdapters.length;
    }

    function initializeProposal(
        uint32 proposalId,
        bytes32[] memory,
        bytes memory
    ) external virtual override {
        if (msg.sender != azorius) revert InvalidAzoriusAddress();
        if (tokenAdapters.length == 0) revert NoAdapters();

        ProposalVotingDetails storage proposal = proposalVotingDetails[
            proposalId
        ];
        proposal.votingStartTimestamp = uint48(block.timestamp);
        proposal.votingEndTimestamp = uint48(block.timestamp + votingPeriod);
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        proposal.abstainVotes = 0;

        emit ProposalInitialized(
            proposalId,
            proposal.votingStartTimestamp,
            proposal.votingEndTimestamp
        );
    }

    function isPassed(
        uint32 _proposalId
    ) external view virtual override returns (bool) {
        ProposalVotingDetails storage proposal = proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        if (block.timestamp <= proposal.votingEndTimestamp) {
            return false;
        }

        return true;
    }

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
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return (details.votingStartTimestamp, details.votingEndTimestamp);
    }

    function _updateVotingPeriod(uint32 _newVotingPeriod) internal {
        if (_newVotingPeriod == 0) revert InvalidVotingPeriod();
        votingPeriod = _newVotingPeriod;
    }

    function _updateQuorumThreshold(uint256 _newQuorumThreshold) internal {
        quorumThreshold = _newQuorumThreshold;
    }

    function _updateBasisNumerator(uint256 _newBasisNumerator) internal {
        if (
            _newBasisNumerator >= BASIS_DENOMINATOR ||
            _newBasisNumerator < BASIS_DENOMINATOR / 2
        ) revert InvalidBasisNumerator();

        basisNumerator = _newBasisNumerator;
    }

    function _addAdapter(address _adapter) internal {
        if (_adapter == address(0)) revert AdapterIsZeroAddress();
        for (uint256 i = 0; i < tokenAdapters.length; i++) {
            if (address(tokenAdapters[i]) == _adapter)
                revert AdapterAlreadyExists();
        }
        tokenAdapters.push(ITokenAdapterBaseV1(_adapter));
        emit AdapterAdded(address(_adapter), tokenAdapters.length - 1);
    }

    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165, Version) returns (bool) {
        return
            interfaceId == type(IStrategyV1).interfaceId ||
            interfaceId == type(IStrategyBaseV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
