// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IBaseStrategyV1} from "../../interfaces/decent/deployables/IBaseStrategyV1.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * Base voting and verification strategy for use in the [Azorius](./Azorius.md) contract.
 * Meant to be used as an Abstract class along with another implementation.
 *
 * This is a base class which offers hooks into the [Azorius](./Azorius.md) contract,
 * offering capability for custom voting rules.
 */
abstract contract BaseStrategyV1 is
    IBaseStrategyV1,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ERC165
{
    /** The Azorius contract address for this Strategy contract. */
    address public proposalInitializer;

    event StrategySetUp(address indexed azorius, address indexed owner);

    error ProposalInitializerUnauthorizedAccount(address account);
    error InvalidProposalInitializer(address initializer);

    /** Modifier that ensures transactions are being called only by Azorius. */
    modifier onlyProposalInitializer() {
        if (msg.sender != proposalInitializer)
            revert ProposalInitializerUnauthorizedAccount(msg.sender);
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _proposalInitializer
    ) public virtual initializer {
        if (address(_proposalInitializer) == address(0))
            revert InvalidProposalInitializer(_proposalInitializer);
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        proposalInitializer = _proposalInitializer;
    }

    /**
     * @dev Function that authorizes an upgrade to a new implementation.
     * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    /** @inheritdoc IBaseStrategyV1*/
    function initializeProposal(bytes memory _data) external virtual;

    /** @inheritdoc IBaseStrategyV1*/
    function isPassed(uint32 _proposalId) external view virtual returns (bool);

    /** @inheritdoc IBaseStrategyV1*/
    function isProposer(address _address) external view virtual returns (bool);

    /** @inheritdoc IBaseStrategyV1*/
    function getVotingTimestamps(
        uint32 _proposalId
    ) external view virtual returns (uint48 startTime, uint48 endTime);

    /** @inheritdoc ERC165*/
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IBaseStrategyV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
