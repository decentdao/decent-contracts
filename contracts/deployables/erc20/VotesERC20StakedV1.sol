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
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    using SafeERC20 for IERC20;

    address internal constant NATIVE_ASSET =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 internal constant PRECISION = 10 ** 18;

    IERC20 internal _stakedToken;
    uint256 internal _minimumStakingPeriod;
    uint256 internal _totalStaked;
    mapping(address staker => StakerData stakerData) internal _stakerData;
    address[] internal _rewardsTokens;
    mapping(address rewardsToken => RewardsTokenData rewardsTokenData)
        internal _rewardsTokenDatas;

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
        _stakedToken = IERC20(stakedToken_);
        _updateMinimumStakingPeriod(minimumStakingPeriod_);
        _addRewardsTokens(rewardsTokens_);
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
        return address(_stakedToken);
    }

    function minimumStakingPeriod()
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _minimumStakingPeriod;
    }

    function totalStaked() public view virtual override returns (uint256) {
        return _totalStaked;
    }

    function rewardsTokens()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        return _rewardsTokens;
    }

    function rewardsTokenData(
        address token_
    ) public view virtual override returns (uint256, uint256, uint256) {
        if (!_rewardsTokenDatas[token_].enabled)
            revert InvalidRewardsToken(token_);

        return (
            _rewardsTokenDatas[token_].rewardsRate,
            _rewardsTokenDatas[token_].rewardsDistributed,
            _rewardsTokenDatas[token_].rewardsClaimed
        );
    }

    function distributableRewards()
        public
        view
        virtual
        override
        returns (uint256[] memory)
    {
        uint256[] memory distributableRewards_ = new uint256[](
            _rewardsTokens.length
        );

        for (uint256 i = 0; i < _rewardsTokens.length; ) {
            distributableRewards_[i] = _distributableRewards(_rewardsTokens[i]);

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

        for (uint256 i = 0; i < rewardsTokens_.length; ) {
            address token = rewardsTokens_[i];
            if (!_rewardsTokenDatas[token].enabled)
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
        return (
            _stakerData[staker_].stakedAmount,
            _stakerData[staker_].lastStakeTimestamp
        );
    }

    function stakerRewardsData(
        address token_,
        address staker_
    ) public view virtual override returns (uint256, uint256) {
        if (!_rewardsTokenDatas[token_].enabled)
            revert InvalidRewardsToken(token_);

        return (
            _rewardsTokenDatas[token_].stakerRewardsRates[staker_],
            _rewardsTokenDatas[token_].stakerAccumulatedRewards[staker_]
        );
    }

    function claimableRewards(
        address staker_
    ) public view virtual override returns (uint256[] memory) {
        uint256[] memory claimableRewards_ = new uint256[](
            _rewardsTokens.length
        );
        for (uint256 i = 0; i < _rewardsTokens.length; ) {
            claimableRewards_[i] = _claimableRewards(
                staker_,
                _rewardsTokens[i]
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
        uint256[] memory claimableRewards_ = new uint256[](tokens_.length);
        for (uint256 i = 0; i < tokens_.length; ) {
            address token = tokens_[i];
            if (!_rewardsTokenDatas[token].enabled)
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

        _stakerData[msg.sender].stakedAmount += amount_;
        _stakerData[msg.sender].lastStakeTimestamp = block.timestamp;
        _totalStaked += amount_;

        _mint(msg.sender, amount_);

        _stakedToken.safeTransferFrom(msg.sender, address(this), amount_);

        emit Staked(msg.sender, amount_);
    }

    function unstake(uint256 amount_) public virtual override {
        if (amount_ == 0) revert ZeroUnstake();
        if (
            block.timestamp <
            _stakerData[msg.sender].lastStakeTimestamp + _minimumStakingPeriod
        ) revert MinimumStakingPeriod();

        _accumulateRewards(msg.sender);

        _stakerData[msg.sender].stakedAmount -= amount_;
        _totalStaked -= amount_;

        _burn(msg.sender, amount_);

        _stakedToken.safeTransfer(msg.sender, amount_);

        emit Unstaked(msg.sender, amount_);
    }

    function distributeRewards() public virtual override {
        if (_totalStaked == 0) revert ZeroStaked();

        for (uint256 i = 0; i < _rewardsTokens.length; ) {
            _distributeRewards(_rewardsTokens[i]);

            unchecked {
                ++i;
            }
        }
    }

    function distributeRewards(
        address[] calldata tokens_
    ) public virtual override {
        if (_totalStaked == 0) revert ZeroStaked();

        for (uint256 i = 0; i < tokens_.length; ) {
            address token = tokens_[i];
            if (!_rewardsTokenDatas[token].enabled)
                revert InvalidRewardsToken(token);

            _distributeRewards(token);

            unchecked {
                ++i;
            }
        }
    }

    function claimRewards(address recipient_) public virtual override {
        for (uint256 i = 0; i < _rewardsTokens.length; ) {
            _claimRewards(msg.sender, recipient_, _rewardsTokens[i]);

            unchecked {
                ++i;
            }
        }
    }

    function claimRewards(
        address recipient_,
        address[] calldata tokens_
    ) public virtual override {
        for (uint256 i = 0; i < tokens_.length; ) {
            address token = tokens_[i];
            if (!_rewardsTokenDatas[token].enabled)
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

        RewardsTokenData storage token = _rewardsTokenDatas[_token];

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
        RewardsTokenData storage token = _rewardsTokenDatas[token_];

        uint256 amountToDistribute = _distributableRewards(token_);

        if (amountToDistribute == 0) return;

        uint256 newRewardsRate = token.rewardsRate +
            (amountToDistribute * PRECISION) /
            _totalStaked;

        token.rewardsDistributed += amountToDistribute;
        token.rewardsRate = newRewardsRate;

        emit RewardsDistributed(token_, amountToDistribute, newRewardsRate);
    }

    function _addRewardsTokens(
        address[] calldata rewardsTokens_
    ) internal virtual {
        for (uint256 i = 0; i < rewardsTokens_.length; ) {
            if (_rewardsTokenDatas[rewardsTokens_[i]].enabled)
                revert DuplicateRewardsToken();

            _rewardsTokens.push(rewardsTokens_[i]);

            _rewardsTokenDatas[rewardsTokens_[i]].enabled = true;

            emit RewardsTokenAdded(rewardsTokens_[i]);

            unchecked {
                ++i;
            }
        }
    }

    function _accumulateRewards(address staker_) internal virtual {
        for (uint256 i = 0; i < _rewardsTokens.length; ) {
            RewardsTokenData storage token = _rewardsTokenDatas[
                _rewardsTokens[i]
            ];

            token.stakerAccumulatedRewards[staker_] +=
                (_stakerData[staker_].stakedAmount *
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
        _minimumStakingPeriod = newMinimumStakingPeriod_;
        emit MinimumStakingPeriodUpdated(newMinimumStakingPeriod_);
    }

    function _distributableRewards(
        address token_
    ) internal view virtual returns (uint256) {
        if (!_rewardsTokenDatas[token_].enabled)
            revert InvalidRewardsToken(token_);

        uint256 thisBalance;
        if (token_ == NATIVE_ASSET) {
            thisBalance = address(this).balance;
        } else if (token_ == address(_stakedToken)) {
            thisBalance =
                IERC20(token_).balanceOf(address(this)) -
                _totalStaked;
        } else {
            thisBalance = IERC20(token_).balanceOf(address(this));
        }

        return
            thisBalance +
            _rewardsTokenDatas[token_].rewardsClaimed -
            _rewardsTokenDatas[token_].rewardsDistributed;
    }

    function _claimableRewards(
        address staker_,
        address token_
    ) internal view virtual returns (uint256) {
        RewardsTokenData storage token = _rewardsTokenDatas[token_];

        return
            token.stakerAccumulatedRewards[staker_] +
            ((_stakerData[staker_].stakedAmount *
                (token.rewardsRate - token.stakerRewardsRates[staker_])) /
                PRECISION);
    }
}
