// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IVotesERC20StakedV1} from "../../interfaces/decent/deployables/IVotesERC20StakedV1.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20VotesUpgradeable, VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract VotesERC20StakedV1 is
    IVotesERC20StakedV1,
    IVersion,
    ERC20VotesUpgradeable,
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    DeploymentBlockV1,
    ERC165
{
    using SafeERC20 for IERC20;

    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.VotesERC20Staked.main
    struct VotesERC20StakedStorage {
        IERC20 stakedToken;
        uint256 minimumStakingPeriod;
        uint256 totalStaked;
        mapping(address staker => StakerData stakerData) stakerData;
        address[] rewardsTokens;
        mapping(address rewardsToken => RewardsTokenData rewardsTokenData) rewardsTokenDatas;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.VotesERC20Staked.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant VOTES_ERC20_STAKED_STORAGE_LOCATION =
        0x83aa32448e81663c7ed9dd6086fc9a74efff7a034dc2ffef9e3a5d9c41ab2400;

    function _getVotesERC20StakedStorage()
        internal
        pure
        returns (VotesERC20StakedStorage storage $)
    {
        assembly {
            $.slot := VOTES_ERC20_STAKED_STORAGE_LOCATION
        }
    }

    address internal constant NATIVE_ASSET =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 internal constant PRECISION = 10 ** 18;

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    receive() external payable {}

    constructor() {
        _disableInitializers();
    }

    function initialize(
        Metadata calldata metadata_,
        address owner_,
        address stakedToken_,
        uint256 minimumStakingPeriod_,
        address[] calldata rewardsTokens_
    ) public virtual override initializer {
        __ERC20_init(metadata_.name, metadata_.symbol);
        __ERC20Votes_init();
        __UUPSUpgradeable_init();
        __Ownable_init(owner_);
        __DeploymentBlockV1_init();

        _updateMinimumStakingPeriod(minimumStakingPeriod_);
        _addRewardsTokens(rewardsTokens_);

        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        $.stakedToken = IERC20(stakedToken_);
    }

    // ======================================================================
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IVotesERC20StakedV1
    // ======================================================================

    // --- Pure Functions ---

    function CLOCK_MODE()
        public
        pure
        virtual
        override(IVotesERC20StakedV1, VotesUpgradeable)
        returns (string memory)
    {
        return "mode=timestamp";
    }

    // --- View Functions ---

    function clock()
        public
        view
        virtual
        override(IVotesERC20StakedV1, VotesUpgradeable)
        returns (uint48)
    {
        return uint48(block.timestamp);
    }

    function stakedToken() public view virtual override returns (address) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        return address($.stakedToken);
    }

    function minimumStakingPeriod()
        public
        view
        virtual
        override
        returns (uint256)
    {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        return $.minimumStakingPeriod;
    }

    function totalStaked() public view virtual override returns (uint256) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        return $.totalStaked;
    }

    function rewardsTokens()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        return $.rewardsTokens;
    }

    function rewardsTokenData(
        address token_
    ) public view virtual override returns (uint256, uint256, uint256) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        RewardsTokenData storage _rewardsTokenData = $.rewardsTokenDatas[
            token_
        ];

        if (!_rewardsTokenData.enabled) revert InvalidRewardsToken(token_);

        return (
            _rewardsTokenData.rewardsRate,
            _rewardsTokenData.rewardsDistributed,
            _rewardsTokenData.rewardsClaimed
        );
    }

    function distributableRewards()
        public
        view
        virtual
        override
        returns (uint256[] memory)
    {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        uint256[] memory distributableRewards_ = new uint256[](
            $.rewardsTokens.length
        );

        for (uint256 i = 0; i < $.rewardsTokens.length; ) {
            distributableRewards_[i] = _distributableRewards(
                $.rewardsTokens[i]
            );

            unchecked {
                ++i;
            }
        }

        return distributableRewards_;
    }

    function distributableRewards(
        address[] calldata rewardsTokens_
    ) public view virtual override returns (uint256[] memory) {
        uint256[] memory distributableRewards_ = new uint256[](
            rewardsTokens_.length
        );

        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        for (uint256 i = 0; i < rewardsTokens_.length; ) {
            address token = rewardsTokens_[i];
            if (!$.rewardsTokenDatas[token].enabled)
                revert InvalidRewardsToken(token);

            distributableRewards_[i] = _distributableRewards(token);

            unchecked {
                ++i;
            }
        }

        return distributableRewards_;
    }

    function stakerData(
        address staker_
    ) public view virtual override returns (uint256, uint256) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        StakerData storage stakerData_ = $.stakerData[staker_];

        return (stakerData_.stakedAmount, stakerData_.lastStakeTimestamp);
    }

    function stakerRewardsData(
        address token_,
        address staker_
    ) public view virtual override returns (uint256, uint256) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        RewardsTokenData storage rewardsTokenData_ = $.rewardsTokenDatas[
            token_
        ];

        if (!rewardsTokenData_.enabled) revert InvalidRewardsToken(token_);

        return (
            rewardsTokenData_.stakerRewardsRates[staker_],
            rewardsTokenData_.stakerAccumulatedRewards[staker_]
        );
    }

    function claimableRewards(
        address staker_
    ) public view virtual override returns (uint256[] memory) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        uint256[] memory claimableRewards_ = new uint256[](
            $.rewardsTokens.length
        );

        for (uint256 i = 0; i < $.rewardsTokens.length; ) {
            claimableRewards_[i] = _claimableRewards(
                staker_,
                $.rewardsTokens[i]
            );

            unchecked {
                ++i;
            }
        }

        return claimableRewards_;
    }

    function claimableRewards(
        address staker_,
        address[] calldata tokens_
    ) public view virtual override returns (uint256[] memory) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        uint256[] memory claimableRewards_ = new uint256[](tokens_.length);

        for (uint256 i = 0; i < tokens_.length; ) {
            address token = tokens_[i];
            if (!$.rewardsTokenDatas[token].enabled)
                revert InvalidRewardsToken(token);

            claimableRewards_[i] = _claimableRewards(staker_, token);

            unchecked {
                ++i;
            }
        }

        return claimableRewards_;
    }

    // --- State-Changing Functions ---

    function addRewardsTokens(
        address[] calldata rewardsTokens_
    ) public virtual override onlyOwner {
        _addRewardsTokens(rewardsTokens_);
    }

    function updateMinimumStakingPeriod(
        uint256 newMinimumStakingPeriod_
    ) public virtual override onlyOwner {
        _updateMinimumStakingPeriod(newMinimumStakingPeriod_);
    }

    function stake(uint256 amount_) public virtual override {
        if (amount_ == 0) revert ZeroStake();

        _accumulateRewards(msg.sender);

        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        StakerData storage stakerData_ = $.stakerData[msg.sender];

        stakerData_.stakedAmount += amount_;
        stakerData_.lastStakeTimestamp = block.timestamp;
        $.totalStaked += amount_;

        _mint(msg.sender, amount_);

        $.stakedToken.safeTransferFrom(msg.sender, address(this), amount_);

        emit Staked(msg.sender, amount_);
    }

    function unstake(uint256 amount_) public virtual override {
        if (amount_ == 0) revert ZeroUnstake();

        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        StakerData storage stakerData_ = $.stakerData[msg.sender];

        if (
            block.timestamp <
            stakerData_.lastStakeTimestamp + $.minimumStakingPeriod
        ) revert MinimumStakingPeriod();

        _accumulateRewards(msg.sender);

        stakerData_.stakedAmount -= amount_;
        $.totalStaked -= amount_;

        _burn(msg.sender, amount_);

        $.stakedToken.safeTransfer(msg.sender, amount_);

        emit Unstaked(msg.sender, amount_);
    }

    function distributeRewards() public virtual override {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        if ($.totalStaked == 0) revert ZeroStaked();

        for (uint256 i = 0; i < $.rewardsTokens.length; ) {
            _distributeRewards($.rewardsTokens[i]);

            unchecked {
                ++i;
            }
        }
    }

    function distributeRewards(
        address[] calldata tokens_
    ) public virtual override {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        if ($.totalStaked == 0) revert ZeroStaked();

        for (uint256 i = 0; i < tokens_.length; ) {
            address token = tokens_[i];
            if (!$.rewardsTokenDatas[token].enabled)
                revert InvalidRewardsToken(token);

            _distributeRewards(token);

            unchecked {
                ++i;
            }
        }
    }

    function claimRewards(address recipient_) public virtual override {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        for (uint256 i = 0; i < $.rewardsTokens.length; ) {
            _claimRewards(msg.sender, recipient_, $.rewardsTokens[i]);

            unchecked {
                ++i;
            }
        }
    }

    function claimRewards(
        address recipient_,
        address[] calldata tokens_
    ) public virtual override {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        for (uint256 i = 0; i < tokens_.length; ) {
            address token = tokens_[i];
            if (!$.rewardsTokenDatas[token].enabled)
                revert InvalidRewardsToken(token);

            _claimRewards(msg.sender, recipient_, token);

            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // ERC20VotesUpgradeable
    // ======================================================================

    // --- State-Changing Functions ---

    function transfer(address, uint256) public virtual override returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(
        address,
        address,
        uint256
    ) public virtual override returns (bool) {
        revert NonTransferable();
    }

    function approve(address, uint256) public virtual override returns (bool) {
        revert NonTransferable();
    }

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
            interfaceId_ == type(IVotesERC20StakedV1).interfaceId ||
            interfaceId_ == type(IERC20).interfaceId ||
            interfaceId_ == type(IVotes).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _claimRewards(
        address _claimer,
        address _recipient,
        address _token
    ) internal virtual {
        uint256 amountToClaim = _claimableRewards(_claimer, _token);

        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        RewardsTokenData storage token = $.rewardsTokenDatas[_token];

        token.stakerAccumulatedRewards[_claimer] = 0;
        token.stakerRewardsRates[_claimer] = token.rewardsRate;

        if (amountToClaim == 0) return;

        token.rewardsClaimed += amountToClaim;
        if (_token == NATIVE_ASSET) {
            (bool success, ) = _recipient.call{value: amountToClaim}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(_token).safeTransfer(_recipient, amountToClaim);
        }

        emit RewardsClaimed(_claimer, _token, _recipient, amountToClaim);
    }

    function _distributeRewards(address token_) internal virtual {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        RewardsTokenData storage token = $.rewardsTokenDatas[token_];

        uint256 amountToDistribute = _distributableRewards(token_);

        if (amountToDistribute == 0) return;

        uint256 newRewardsRate = token.rewardsRate +
            (amountToDistribute * PRECISION) /
            $.totalStaked;

        token.rewardsDistributed += amountToDistribute;
        token.rewardsRate = newRewardsRate;

        emit RewardsDistributed(token_, amountToDistribute, newRewardsRate);
    }

    function _addRewardsTokens(
        address[] calldata rewardsTokens_
    ) internal virtual {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        for (uint256 i = 0; i < rewardsTokens_.length; ) {
            address token = rewardsTokens_[i];

            if ($.rewardsTokenDatas[token].enabled)
                revert DuplicateRewardsToken();

            $.rewardsTokens.push(token);
            $.rewardsTokenDatas[token].enabled = true;

            emit RewardsTokenAdded(token);

            unchecked {
                ++i;
            }
        }
    }

    function _accumulateRewards(address staker_) internal virtual {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        for (uint256 i = 0; i < $.rewardsTokens.length; ) {
            RewardsTokenData storage token = $.rewardsTokenDatas[
                $.rewardsTokens[i]
            ];

            token.stakerAccumulatedRewards[staker_] +=
                ($.stakerData[staker_].stakedAmount *
                    (token.rewardsRate - token.stakerRewardsRates[staker_])) /
                PRECISION;

            token.stakerRewardsRates[staker_] = token.rewardsRate;

            unchecked {
                ++i;
            }
        }
    }

    function _updateMinimumStakingPeriod(
        uint256 newMinimumStakingPeriod_
    ) internal virtual {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        $.minimumStakingPeriod = newMinimumStakingPeriod_;
        emit MinimumStakingPeriodUpdated(newMinimumStakingPeriod_);
    }

    function _distributableRewards(
        address token_
    ) internal view virtual returns (uint256) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();

        RewardsTokenData storage _rewardsTokenData = $.rewardsTokenDatas[
            token_
        ];

        if (!_rewardsTokenData.enabled) revert InvalidRewardsToken(token_);

        uint256 thisBalance;
        if (token_ == NATIVE_ASSET) {
            thisBalance = address(this).balance;
        } else if (token_ == address($.stakedToken)) {
            thisBalance =
                IERC20(token_).balanceOf(address(this)) -
                $.totalStaked;
        } else {
            thisBalance = IERC20(token_).balanceOf(address(this));
        }

        return
            thisBalance +
            _rewardsTokenData.rewardsClaimed -
            _rewardsTokenData.rewardsDistributed;
    }

    function _claimableRewards(
        address staker_,
        address token_
    ) internal view virtual returns (uint256) {
        VotesERC20StakedStorage storage $ = _getVotesERC20StakedStorage();
        RewardsTokenData storage token = $.rewardsTokenDatas[token_];

        return
            token.stakerAccumulatedRewards[staker_] +
            (($.stakerData[staker_].stakedAmount *
                (token.rewardsRate - token.stakerRewardsRates[staker_])) /
                PRECISION);
    }
}
