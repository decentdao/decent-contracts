// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {
    ITokenSaleV1
} from "../../interfaces/decent/deployables/ITokenSaleV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {IVerifierV1} from "../../interfaces/decent/services/IVerifierV1.sol";
import {
    IVotingTokenLockupPlans
} from "../../interfaces/hedgey/IVotingTokenLockupPlans.sol";
import {
    DeploymentBlockInitializable
} from "../../DeploymentBlockInitializable.sol";
import {InitializerEventEmitter} from "../../InitializerEventEmitter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TokenSaleV1
 * @notice Implementation of a token sale with buyer verification
 * @dev Supports time-based token sales with configurable parameters
 * @custom:security-contact security@decent-dao.org
 */
contract TokenSaleV1 is
    ITokenSaleV1,
    IVersion,
    DeploymentBlockInitializable,
    InitializerEventEmitter,
    ERC165
{
    using SafeERC20 for IERC20;

    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for TokenSaleV1 following EIP-7201
     * @dev Contains all agreement configuration and signer state
     * @custom:storage-location erc7201:Decent.TokenSale.main
     */
    struct TokenSaleStorage {
        bool sellerSettled;
        uint48 saleStartTimestamp;
        uint48 saleEndTimestamp;
        address commitmentToken;
        address saleToken;
        address verifier;
        address saleProceedsReceiver;
        address protocolFeeReceiver;
        uint256 minimumCommitment;
        uint256 maximumCommitment;
        uint256 minimumTotalCommitment;
        uint256 maximumTotalCommitment;
        uint256 saleTokenPrice;
        uint256 commitmentTokenProtocolFee;
        uint256 saleTokenProtocolFee;
        uint256 totalCommitments;
        HedgeyLockupParams hedgeyLockupParams;
        mapping(address account => uint256 commitmentAmount) commitments;
        mapping(address account => bool settled) settled;
    }

    /**
     * @dev Storage slot for TokenSaleStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.TokenSale.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant TOKEN_SALE_STORAGE_LOCATION =
        0x2865da5af25c19b16f2ad5c9327e4a38930870c11de8367bfc68d9a873251900;

    /**
     * @dev Returns the storage struct for TokenSaleV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     * @return $ The storage struct for TokenSaleV1
     */
    function _getTokenSaleStorage()
        internal
        pure
        returns (TokenSaleStorage storage $)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            $.slot := TOKEN_SALE_STORAGE_LOCATION
        }
    }

    /** @notice Address used to represent native ETH */
    address internal constant NATIVE_ASSET =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /** @notice Precision for sale token price calculations (18 decimals) */
    uint256 internal constant PRECISION = 10 ** 18;

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    /**
     * @notice Ensures the caller has passed verification
     * @dev Calls the verifier contract to check verification status
     * @param verifyingSignature_ The verifier signature attesting to verification status
     * @param signatureExpiration_ The expiration timestamp of the signature
     */
    modifier isVerified(
        bytes calldata verifyingSignature_,
        uint48 signatureExpiration_
    ) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        IVerifierV1($.verifier).verify(
            msg.sender,
            signatureExpiration_,
            verifyingSignature_
        );
        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    /**
     * @notice Disables initializers on implementation contract deployment
     * @dev Prevents the implementation contract from being initialized
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function initialize(
        InitializerParams memory params_
    ) public virtual override initializer {
        if (params_.saleStartTimestamp > params_.saleEndTimestamp)
            revert InvalidSaleTimestamps();

        if (params_.saleStartTimestamp < block.timestamp)
            revert InvalidSaleStartTimestamp();

        if (params_.minimumCommitment > params_.maximumCommitment)
            revert InvalidCommitmentAmounts();

        if (params_.minimumTotalCommitment > params_.maximumTotalCommitment)
            revert InvalidTotalCommitmentAmounts();

        if (
            params_.commitmentTokenProtocolFee > PRECISION ||
            params_.saleTokenProtocolFee > PRECISION
        ) revert InvalidProtocolFee();

        __InitializerEventEmitter_init(abi.encode(params_));
        __DeploymentBlockInitializable_init();

        // if hedgey lockup is enabled, validate the params
        if (params_.hedgeyLockupParams.enabled) {
            uint256 minimumLockupAmount = (params_.minimumCommitment *
                PRECISION) / params_.saleTokenPrice;

            _validateHedgeyParams(
                minimumLockupAmount,
                params_.hedgeyLockupParams.start,
                params_.hedgeyLockupParams.cliff,
                (minimumLockupAmount *
                    params_.hedgeyLockupParams.ratePercentage) / PRECISION,
                params_.hedgeyLockupParams.period
            );
        }

        TokenSaleStorage storage $ = _getTokenSaleStorage();

        $.saleStartTimestamp = params_.saleStartTimestamp;
        $.saleEndTimestamp = params_.saleEndTimestamp;
        $.commitmentToken = params_.commitmentToken;
        $.saleToken = params_.saleToken;
        $.verifier = params_.verifier;
        $.saleProceedsReceiver = params_.saleProceedsReceiver;
        $.protocolFeeReceiver = params_.protocolFeeReceiver;
        $.minimumCommitment = params_.minimumCommitment;
        $.maximumCommitment = params_.maximumCommitment;
        $.minimumTotalCommitment = params_.minimumTotalCommitment;
        $.maximumTotalCommitment = params_.maximumTotalCommitment;
        $.saleTokenPrice = params_.saleTokenPrice;
        $.commitmentTokenProtocolFee = params_.commitmentTokenProtocolFee;
        $.saleTokenProtocolFee = params_.saleTokenProtocolFee;
        $.hedgeyLockupParams = params_.hedgeyLockupParams;

        // calculate the amount of sale tokens for this contract to escrow
        // this is the maximum amount of sale tokens that can be sold plus the sale token protocol fee
        uint256 saleTokenEscrowAmount = (params_.maximumTotalCommitment *
            (PRECISION + params_.saleTokenProtocolFee)) /
            params_.saleTokenPrice;

        // transfer sale tokens from holder to this contract
        IERC20(params_.saleToken).safeTransferFrom(
            params_.saleTokenHolder,
            address(this),
            saleTokenEscrowAmount
        );
    }

    // ======================================================================
    // ITokenSaleV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleState() public view virtual override returns (SaleState) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();

        if (block.timestamp < $.saleStartTimestamp) {
            return SaleState.NOT_STARTED;
        } else if ($.totalCommitments >= $.maximumTotalCommitment) {
            return SaleState.SUCCEEDED;
        } else if (block.timestamp > $.saleEndTimestamp) {
            // sale has ended
            if ($.totalCommitments >= $.minimumTotalCommitment) {
                return SaleState.SUCCEEDED;
            } else {
                return SaleState.FAILED;
            }
        } else {
            return SaleState.ACTIVE;
        }
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function sellerSettled() external view virtual override returns (bool) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.sellerSettled;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleStartTimestamp()
        external
        view
        virtual
        override
        returns (uint48)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.saleStartTimestamp;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleEndTimestamp()
        external
        view
        virtual
        override
        returns (uint48)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.saleEndTimestamp;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function commitmentToken()
        external
        view
        virtual
        override
        returns (address)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.commitmentToken;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleToken() external view virtual override returns (address) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.saleToken;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function verifier() external view virtual override returns (address) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.verifier;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleProceedsReceiver()
        external
        view
        virtual
        override
        returns (address)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.saleProceedsReceiver;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function protocolFeeReceiver()
        external
        view
        virtual
        override
        returns (address)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.protocolFeeReceiver;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function minimumCommitment()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.minimumCommitment;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function maximumCommitment()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.maximumCommitment;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function minimumTotalCommitment()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.minimumTotalCommitment;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function maximumTotalCommitment()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.maximumTotalCommitment;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleTokenPrice() external view virtual override returns (uint256) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.saleTokenPrice;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function commitmentTokenProtocolFee()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.commitmentTokenProtocolFee;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function saleTokenProtocolFee()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.saleTokenProtocolFee;
    }
    /**
     * @inheritdoc ITokenSaleV1
     */
    function totalCommitments()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.totalCommitments;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function commitments(
        address account_
    ) external view virtual override returns (uint256) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.commitments[account_];
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function settled(
        address account_
    ) external view virtual override returns (bool) {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.settled[account_];
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function hedgeyLockupEnabled()
        external
        view
        virtual
        override
        returns (bool)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.hedgeyLockupParams.enabled;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function hedgeyLockupStart()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.hedgeyLockupParams.start;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function hedgeyLockupCliff()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.hedgeyLockupParams.cliff;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function hedgeyLockupRatePercentage()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.hedgeyLockupParams.ratePercentage;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function hedgeyLockupPeriod()
        external
        view
        virtual
        override
        returns (uint256)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.hedgeyLockupParams.period;
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function hedgeyVotingTokenLockupPlans()
        external
        view
        virtual
        override
        returns (address)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();
        return $.hedgeyLockupParams.votingTokenLockupPlans;
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc ITokenSaleV1
     */
    function increaseCommitmentNative(
        bytes calldata verifyingSignature_,
        uint48 signatureExpiration_
    )
        public
        payable
        virtual
        override
        isVerified(verifyingSignature_, signatureExpiration_)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();

        if ($.commitmentToken != NATIVE_ASSET) revert InvalidCommitmentToken();

        _increaseCommitment(msg.sender, msg.value);
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function increaseCommitmentERC20(
        uint256 increaseAmount_,
        bytes calldata verifyingSignature_,
        uint48 signatureExpiration_
    )
        public
        virtual
        override
        isVerified(verifyingSignature_, signatureExpiration_)
    {
        TokenSaleStorage storage $ = _getTokenSaleStorage();

        if ($.commitmentToken == NATIVE_ASSET) revert InvalidCommitmentToken();

        _increaseCommitment(msg.sender, increaseAmount_);

        IERC20($.commitmentToken).safeTransferFrom(
            msg.sender,
            address(this),
            increaseAmount_
        );
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function buyerSettle(address recipient_) public virtual override {
        TokenSaleStorage storage $ = _getTokenSaleStorage();

        if ($.settled[msg.sender]) revert AlreadySettled();

        if ($.commitments[msg.sender] == 0) revert ZeroCommitment();

        $.settled[msg.sender] = true;

        SaleState state = saleState();

        if (state == SaleState.SUCCEEDED) {
            // calculate the amount of sale tokens purchased by the buyer
            uint256 saleTokenAmount = ($.commitments[msg.sender] * PRECISION) /
                $.saleTokenPrice;

            if ($.hedgeyLockupParams.enabled) {
                // approve hedgey lockup plan to transfer the sale token
                IERC20($.saleToken).approve(
                    $.hedgeyLockupParams.votingTokenLockupPlans,
                    saleTokenAmount
                );

                // create hedgey lockup plan for the caller
                uint256 hedgeyLockupPlanId = IVotingTokenLockupPlans(
                    $.hedgeyLockupParams.votingTokenLockupPlans
                ).createPlan(
                        recipient_,
                        $.saleToken,
                        saleTokenAmount,
                        $.hedgeyLockupParams.start,
                        $.hedgeyLockupParams.cliff,
                        (saleTokenAmount *
                            $.hedgeyLockupParams.ratePercentage) / PRECISION,
                        $.hedgeyLockupParams.period
                    );

                emit SuccessfulSaleBuyerSettledHedgey(
                    msg.sender,
                    recipient_,
                    saleTokenAmount,
                    hedgeyLockupPlanId
                );
            } else {
                // send the caller their purchased sale tokens
                IERC20($.saleToken).safeTransfer(recipient_, saleTokenAmount);

                emit SuccessfulSaleBuyerSettled(
                    msg.sender,
                    recipient_,
                    saleTokenAmount
                );
            }
        } else if (state == SaleState.FAILED) {
            // sale failed, refund the caller their commitment tokens
            uint256 commitmentTokenAmount = $.commitments[msg.sender];

            _transferTokenOrNative(
                $.commitmentToken,
                recipient_,
                commitmentTokenAmount
            );

            emit FailedSaleBuyerSettled(
                msg.sender,
                recipient_,
                commitmentTokenAmount
            );
        } else {
            revert SaleNotEnded();
        }
    }

    /**
     * @inheritdoc ITokenSaleV1
     */
    function sellerSettle() public virtual override {
        TokenSaleStorage storage $ = _getTokenSaleStorage();

        if ($.sellerSettled) revert AlreadySettled();

        $.sellerSettled = true;

        SaleState state = saleState();

        if (state == SaleState.SUCCEEDED) {
            uint256 commitmentTokenBalance;
            if ($.commitmentToken == NATIVE_ASSET) {
                commitmentTokenBalance = address(this).balance;
            } else {
                commitmentTokenBalance = IERC20($.commitmentToken).balanceOf(
                    address(this)
                );
            }

            uint256 commitmentTokenProtocolFeeAmount = (commitmentTokenBalance *
                $.commitmentTokenProtocolFee) / PRECISION;

            // send commitment token protocol fee to protocolFeeReceiver
            _transferTokenOrNative(
                $.commitmentToken,
                $.protocolFeeReceiver,
                commitmentTokenProtocolFeeAmount
            );

            uint256 commitmentTokenAmountToSeller = commitmentTokenBalance -
                commitmentTokenProtocolFeeAmount;

            // send (commitments - protocol fee) to saleProceedsReceiver
            _transferTokenOrNative(
                $.commitmentToken,
                $.saleProceedsReceiver,
                commitmentTokenAmountToSeller
            );

            uint256 saleTokenSold = ($.totalCommitments * PRECISION) /
                $.saleTokenPrice;

            uint256 saleTokenProtocolFeeAmount = (saleTokenSold *
                $.saleTokenProtocolFee) / PRECISION;

            // send sale token protocol fee to protocolFeeReceiver
            IERC20($.saleToken).safeTransfer(
                $.protocolFeeReceiver,
                saleTokenProtocolFeeAmount
            );

            uint256 saleTokenEscrowAmount = ($.maximumTotalCommitment *
                (PRECISION + $.saleTokenProtocolFee)) / $.saleTokenPrice;

            uint256 leftoverSaleTokenAmount = saleTokenEscrowAmount -
                saleTokenSold -
                saleTokenProtocolFeeAmount;

            // send unsold sale tokens to saleProceedsReceiver
            IERC20($.saleToken).safeTransfer(
                $.saleProceedsReceiver,
                leftoverSaleTokenAmount
            );

            emit SuccessfulSaleSellerSettled(
                msg.sender,
                commitmentTokenProtocolFeeAmount,
                commitmentTokenAmountToSeller,
                saleTokenProtocolFeeAmount,
                leftoverSaleTokenAmount
            );
        } else if (state == SaleState.FAILED) {
            // transfer entire balance of sale tokens to saleProceedsReceiver
            // no protocol fees taken on failed sale
            uint256 saleTokenAmount = IERC20($.saleToken).balanceOf(
                address(this)
            );

            IERC20($.saleToken).safeTransfer(
                $.saleProceedsReceiver,
                saleTokenAmount
            );

            emit FailedSaleSellerSettled(msg.sender, saleTokenAmount);
        } else {
            revert SaleNotEnded();
        }
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    /**
     * @inheritdoc IVersion
     */
    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports ITokenSaleV1, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(ITokenSaleV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Validates Hedgey vesting parameters and calculates end time
     * @dev Ensures all parameters create a valid vesting schedule
     * @param start_ Start time of vesting
     * @param cliff_ Absolute cliff time
     * @param amount_ Total amount to vest
     * @param rate_ Amount vested per period
     * @param period_ Duration of each vesting period
     * @custom:throws InvalidAmount if amount is zero
     * @custom:throws InvalidRate if rate is zero
     * @custom:throws RateExceedsAmount if rate is greater than amount
     * @custom:throws InvalidPeriod if period is zero
     * @custom:throws CliffExceedsEnd if cliff time exceeds vesting end time
     */
    function _validateHedgeyParams(
        uint256 amount_,
        uint256 start_,
        uint256 cliff_,
        uint256 rate_,
        uint256 period_
    ) internal pure {
        if (amount_ == 0) revert InvalidAmount();
        if (rate_ == 0) revert InvalidRate();
        if (rate_ > amount_) revert RateExceedsAmount();
        if (period_ == 0) revert InvalidPeriod();
        if (cliff_ < start_) revert CliffBeforeStart();

        // Calculate vesting end time
        uint256 end = (amount_ % rate_ == 0)
            ? (amount_ / rate_) * period_ + start_
            : ((amount_ / rate_) * period_) + period_ + start_;

        if (cliff_ > end) revert CliffExceedsEnd();
    }

    /**
     * @notice Transfers tokens or native assets to a recipient
     * @param token_ Token address or NATIVE_ASSET constant
     * @param to_ Recipient address
     * @param amount_ Amount to transfer
     */
    function _transferTokenOrNative(
        address token_,
        address to_,
        uint256 amount_
    ) internal {
        if (token_ == NATIVE_ASSET) {
            (bool success, ) = to_.call{value: amount_}("");
            if (!success) {
                revert TransferFailed();
            }
        } else {
            IERC20(token_).safeTransfer(to_, amount_);
        }
    }

    /**
     * @notice Internal function to increase a user's commitment
     * @param account_ Address of the committing user
     * @param increaseAmount_ Amount to increase commitment by
     */
    function _increaseCommitment(
        address account_,
        uint256 increaseAmount_
    ) internal {
        TokenSaleStorage storage $ = _getTokenSaleStorage();

        if (saleState() != SaleState.ACTIVE) revert SaleNotActive();

        if (increaseAmount_ == 0) revert ZeroAmount();

        if ($.totalCommitments + increaseAmount_ > $.maximumTotalCommitment)
            revert MaximumTotalCommitment();

        uint256 previousCommitment = $.commitments[account_];

        // revert if new commitment amount is less than minimum commitment,
        // unless commitment makes total commitments reach maximum total commitment
        if (
            previousCommitment + increaseAmount_ < $.minimumCommitment &&
            $.totalCommitments + increaseAmount_ != $.maximumTotalCommitment
        ) revert MinimumCommitment();

        if (previousCommitment + increaseAmount_ > $.maximumCommitment)
            revert MaximumCommitment();

        // update state
        $.commitments[account_] += increaseAmount_;
        $.totalCommitments += increaseAmount_;

        emit CommitmentIncreased(account_, increaseAmount_);
    }
}
