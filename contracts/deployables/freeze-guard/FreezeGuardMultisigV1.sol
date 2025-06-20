// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IFreezeGuardMultisigV1} from "../../interfaces/decent/deployables/IFreezeGuardMultisigV1.sol";
import {IFreezeGuardBaseV1} from "../../interfaces/decent/deployables/IFreezeGuardBaseV1.sol";
import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {ISafe} from "../../interfaces/safe/ISafe.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IGuard} from "@gnosis-guild/zodiac/contracts/interfaces/IGuard.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract FreezeGuardMultisigV1 is
    IFreezeGuardMultisigV1,
    IVersion,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.FreezeGuardMultisig.main
    struct FreezeGuardMultisigStorage {
        IFreezeVotingBaseV1 freezeVoting;
        uint32 timelockPeriod;
        uint32 executionPeriod;
        ISafe childGnosisSafe;
        mapping(bytes32 signaturesHash => uint48 timelockedTimestamp) transactionTimelocked;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.FreezeGuardMultisig.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant FREEZE_GUARD_MULTISIG_STORAGE_LOCATION =
        0xb27bf83f95540c9e5ad158f8f59db4886f77b3163b8b8808bcf0da8eb5fd2200;

    function _getFreezeGuardMultisigStorage()
        internal
        pure
        returns (FreezeGuardMultisigStorage storage $)
    {
        assembly {
            $.slot := FREEZE_GUARD_MULTISIG_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint32 timelockPeriod_,
        uint32 executionPeriod_,
        address owner_,
        address freezeVoting_,
        address childGnosisSafe_
    ) public virtual override initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __DeploymentBlockV1_init();
        _updateTimelockPeriod(timelockPeriod_);
        _updateExecutionPeriod(executionPeriod_);

        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        $.freezeVoting = IFreezeVotingBaseV1(freezeVoting_);
        $.childGnosisSafe = ISafe(childGnosisSafe_);
    }

    // ======================================================================
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IFreezeGuardMultisigV1
    // ======================================================================

    // --- View Functions ---

    function timelockPeriod() public view virtual override returns (uint32) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return $.timelockPeriod;
    }

    function executionPeriod() public view virtual override returns (uint32) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return $.executionPeriod;
    }

    function childGnosisSafe() public view virtual override returns (address) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return address($.childGnosisSafe);
    }

    function getTransactionTimelocked(
        bytes32 signaturesHash_
    ) public view virtual override returns (uint48) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return $.transactionTimelocked[signaturesHash_];
    }

    // --- State-Changing Functions ---

    function timelockTransaction(
        address to_,
        uint256 value_,
        bytes memory data_,
        Enum.Operation operation,
        uint256 safeTxGas_,
        uint256 baseGas_,
        uint256 gasPrice_,
        address gasToken_,
        address payable refundReceiver_,
        bytes calldata signatures_,
        uint256 nonce_
    ) public virtual override {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        if ($.transactionTimelocked[keccak256(signatures_)] != 0)
            revert AlreadyTimelocked();

        bytes memory transactionHashData = $
            .childGnosisSafe
            .encodeTransactionData(
                to_,
                value_,
                data_,
                operation,
                safeTxGas_,
                baseGas_,
                gasPrice_,
                gasToken_,
                refundReceiver_,
                nonce_
            );

        bytes32 transactionHash = keccak256(transactionHashData);

        $.childGnosisSafe.checkSignatures(
            transactionHash,
            transactionHashData,
            signatures_
        );

        $.transactionTimelocked[keccak256(signatures_)] = uint48(
            block.timestamp
        );

        emit TransactionTimelocked(msg.sender, transactionHash, signatures_);
    }

    function updateTimelockPeriod(
        uint32 timelockPeriod_
    ) public virtual override onlyOwner {
        _updateTimelockPeriod(timelockPeriod_);
    }

    function updateExecutionPeriod(
        uint32 executionPeriod_
    ) public virtual override onlyOwner {
        _updateExecutionPeriod(executionPeriod_);
    }

    // ======================================================================
    // IFreezeGuardBaseV1
    // ======================================================================

    // --- View Functions ---

    function freezeVoting() public view virtual override returns (address) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return address($.freezeVoting);
    }

    // ======================================================================
    // IGuard
    // ======================================================================

    // --- View Functions ---

    function checkTransaction(
        address,
        uint256,
        bytes memory,
        Enum.Operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory signatures_,
        address
    ) public view virtual override {
        bytes32 signaturesHash = keccak256(signatures_);

        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        if ($.transactionTimelocked[signaturesHash] == 0)
            revert NotTimelocked();

        if (
            block.timestamp <
            $.transactionTimelocked[signaturesHash] + $.timelockPeriod
        ) revert Timelocked();

        if (
            block.timestamp >
            $.transactionTimelocked[signaturesHash] +
                $.timelockPeriod +
                $.executionPeriod
        ) revert Expired();

        if ($.freezeVoting.isFrozen()) revert DAOFrozen();
    }

    function checkAfterExecution(bytes32, bool) public view virtual override {}

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeGuardMultisigV1).interfaceId ||
            interfaceId_ == type(IFreezeGuardBaseV1).interfaceId ||
            interfaceId_ == type(IGuard).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _updateTimelockPeriod(uint32 timelockPeriod_) internal virtual {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        $.timelockPeriod = timelockPeriod_;
        emit TimelockPeriodUpdated(timelockPeriod_);
    }

    function _updateExecutionPeriod(uint32 executionPeriod_) internal virtual {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        $.executionPeriod = executionPeriod_;
        emit ExecutionPeriodUpdated(executionPeriod_);
    }
}
