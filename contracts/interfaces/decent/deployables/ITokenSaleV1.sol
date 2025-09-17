// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title ITokenSaleV1
 * @notice Interface for a public token sale contract with signature-based verification
 * @dev Implements a time-based token sale with configurable parameters including:
 * - Sale duration with start and end timestamps
 * - Minimum and maximum commitment amounts per user
 * - Minimum and maximum total commitment amounts for the sale
 * - Verification requirement via external verifier
 * - Configurable protocol fee and receiver
 * - Support for both native assets (ETH) and ERC20 tokens as payment
 */
interface ITokenSaleV1 {
    // --- Errors ---

    /**
     * @notice Thrown when the sale start timestamp is in the past during initialization
     */
    error InvalidSaleStartTimestamp();

    /**
     * @notice Thrown when the sale end timestamp is not after the start timestamp
     */
    error InvalidSaleTimestamps();

    /**
     * @notice Thrown when minimum commitment exceeds maximum commitment
     */
    error InvalidCommitmentAmounts();

    /**
     * @notice Thrown when minimum total commitment exceeds maximum total commitment
     */
    error InvalidTotalCommitmentAmounts();

    /**
     * @notice Thrown when a token or native asset transfer fails
     */
    error TransferFailed();

    /**
     * @notice Thrown when attempting to commit during inactive sale period
     */
    error SaleNotActive();

    /**
     * @notice Thrown when attempting to settle before the sale has ended
     */
    error SaleNotEnded();

    /**
     * @notice Thrown when Hedgey vesting amount is zero
     */
    error InvalidAmount();

    /**
     * @notice Thrown when Hedgey vesting rate is zero
     */
    error InvalidRate();

    /**
     * @notice Thrown when Hedgey vesting rate exceeds amount
     */
    error RateExceedsAmount();

    /**
     * @notice Thrown when Hedgey vesting period is zero
     */
    error InvalidPeriod();

    /**
     * @notice Thrown when Hedgey vesting cliff exceeds end time
     */
    error CliffExceedsEnd();

    /**
     * @notice Thrown when Hedgey vesting cliff is before the start time
     */
    error CliffBeforeStart();

    /**
     * @notice Thrown when attempting to settle an already settled account
     */
    error AlreadySettled();

    /**
     * @notice Thrown when remaining commitment would be below minimum (unless going to zero)
     */
    error MinimumCommitment();

    /**
     * @notice Thrown when commitment would exceed maximum per user
     */
    error MaximumCommitment();

    /**
     * @notice Thrown when total commitments would exceed maximum for the sale
     */
    error MaximumTotalCommitment();

    /**
     * @notice Thrown when an amount parameter is zero
     */
    error ZeroAmount();

    /**
     * @notice Thrown when user attempts to settle with zero commitment
     */
    error ZeroCommitment();

    /**
     * @notice Thrown when protocol fee exceeds 100% (PRECISION)
     */
    error InvalidProtocolFee();

    /**
     * @notice Thrown when using wrong commitment function for the token type
     */
    error InvalidCommitmentToken();

    // --- Structs ---

    /**
     * @notice Parameters for initializing hedgey lockup plan
     * @param enabled Whether to use hedgey lockup plan
     * @param start the start date of the lockup plan, unix time
     * @param cliff a cliff date which is a discrete date where tokens are not unlocked until this date, and then vest in a large single chunk on the cliff date
     * @param ratePercentage the percentage of the total token amount that vest in a single period
     * @param period the amount of time in between each unlock time stamp, in seconds. A period of 1 means that tokens vest every second in a 'streaming' style.
     * @param votingTokenLockupPlans the address of the voting token lockup plans contract
     */
    struct HedgeyLockupParams {
        bool enabled;
        uint256 start;
        uint256 cliff;
        uint256 ratePercentage;
        uint256 period;
        address votingTokenLockupPlans;
    }

    /**
     * @notice Parameters for initializing the public sale contract
     * @param saleStartTimestamp Unix timestamp when the sale begins
     * @param saleEndTimestamp Unix timestamp when the sale ends
     * @param saleTokenHolder Address holding the sale tokens to be distributed
     * @param commitmentToken Address of the token users commit (use NATIVE_ASSET constant for ETH)
     * @param saleToken Address of the token being sold
     * @param verifier Address of the verification contract
     * @param saleProceedsReceiver Address that receives sale proceeds
     * @param protocolFeeReceiver Address that receives protocol fees
     * @param minimumCommitment Minimum commitment amount per user
     * @param maximumCommitment Maximum commitment amount per user
     * @param minimumTotalCommitment Minimum total commitments for successful sale
     * @param maximumTotalCommitment Maximum total commitments allowed
     * @param saleTokenPrice Price per sale token in commitment token units (with PRECISION decimals)
     * @param commitmentTokenProtocolFee Fee percentage taken from commitment token proceeds (with PRECISION decimals)
     * @param saleTokenProtocolFee Fee percentage taken from sale token (with PRECISION decimals)
     * @param hedgeyLockupParams Parameters for initializing hedgey lockup plan
     */
    struct InitializerParams {
        uint48 saleStartTimestamp;
        uint48 saleEndTimestamp;
        address saleTokenHolder;
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
        HedgeyLockupParams hedgeyLockupParams;
    }

    // --- Enums ---

    /**
     * @notice Represents the current state of the sale
     * @dev NOT_STARTED: Before saleStartTimestamp
     * @dev ACTIVE: Between start and end timestamps with capacity remaining
     * @dev SUCCEEDED: Reached maximum total commitment OR (sale ended AND reached minimum total commitment)
     * @dev FAILED: Ended without reaching minimum commitment
     */
    enum SaleState {
        NOT_STARTED,
        ACTIVE,
        SUCCEEDED,
        FAILED
    }

    // --- Events ---

    /**
     * @notice Emitted when a user increases their commitment
     * @param account Address of the user
     * @param amount Amount of commitment increase
     */
    event CommitmentIncreased(address indexed account, uint256 amount);

    /**
     * @notice Emitted when a user settles after successful sale
     * @param account Address of the user
     * @param recipient Address receiving the sale tokens
     * @param saleTokenAmount Amount of sale tokens received
     */
    event SuccessfulSaleBuyerSettled(
        address indexed account,
        address indexed recipient,
        uint256 saleTokenAmount
    );

    /**
     * @notice Emitted when a user settles after successful sale
     * @param account Address of the user
     * @param recipient Address receiving the sale tokens
     * @param saleTokenAmount Amount of sale tokens received
     */
    event SuccessfulSaleBuyerSettledHedgey(
        address indexed account,
        address indexed recipient,
        uint256 saleTokenAmount,
        uint256 indexed hedgeyLockupPlanId
    );

    /**
     * @notice Emitted when a user settles after failed sale
     * @param account Address of the user
     * @param recipient Address receiving the refunded commitment
     * @param commitmentTokenAmount Amount of commitment tokens refunded
     */
    event FailedSaleBuyerSettled(
        address indexed account,
        address indexed recipient,
        uint256 commitmentTokenAmount
    );

    /**
     * @notice Emitted when seller settlement is performed after successful sale
     * @param caller Address that called sellerSettle
     * @param commitmentTokenProtocolFeeAmount Commitment token amount taken as protocol fee
     * @param commitmentTokenAmountToSeller Commitment token amount sent to saleProceedsReceiver
     * @param saleTokenProtocolFeeAmount Sale tokena amount taken as protocol fee
     * @param unsoldSaleTokenAmount Sale token amount sent to saleProceedsReceiver
     */
    event SuccessfulSaleSellerSettled(
        address indexed caller,
        uint256 commitmentTokenProtocolFeeAmount,
        uint256 commitmentTokenAmountToSeller,
        uint256 saleTokenProtocolFeeAmount,
        uint256 unsoldSaleTokenAmount
    );

    /**
     * @notice Emitted when seller settlement is performed after failed sale
     * @param seller Address that called sellerSettle
     * @param saleTokenAmount Amount of sale tokens returned
     */
    event FailedSaleSellerSettled(
        address indexed seller,
        uint256 saleTokenAmount
    );

    // --- Initializer Functions ---

    /**
     * @notice Initializes the public sale contract
     * @param params_ Initialization parameters
     */
    function initialize(InitializerParams memory params_) external;

    // --- View Functions ---

    /**
     * @notice Returns the current state of the sale
     * @return state Current sale state
     */
    function saleState() external view returns (SaleState state);

    /**
     * @notice Returns whether the seller has settled
     * @return settled True if seller has settled, false otherwise
     */
    function sellerSettled() external view returns (bool settled);

    /**
     * @notice Returns the sale start timestamp
     * @return timestamp Unix timestamp when sale starts
     */
    function saleStartTimestamp() external view returns (uint48 timestamp);

    /**
     * @notice Returns the sale end timestamp
     * @return timestamp Unix timestamp when sale ends
     */
    function saleEndTimestamp() external view returns (uint48 timestamp);

    /**
     * @notice Returns the commitment token address
     * @return token Address of the token used for commitments (or NATIVE_ASSET for ETH)
     */
    function commitmentToken() external view returns (address token);

    /**
     * @notice Returns the sale token address
     * @return token Address of the token being sold
     */
    function saleToken() external view returns (address token);

    /**
     * @notice Returns the verifier address
     * @return verifier Address of the verification contract
     */
    function verifier() external view returns (address verifier);

    /**
     * @notice Returns the sale proceeds receiver address
     * @return receiver Address that receives sale proceeds
     */
    function saleProceedsReceiver() external view returns (address receiver);

    /**
     * @notice Returns the protocol fee receiver address
     * @return receiver Address that receives protocol fees
     */
    function protocolFeeReceiver() external view returns (address receiver);

    /**
     * @notice Returns the minimum commitment per user
     * @return amount Minimum commitment amount
     */
    function minimumCommitment() external view returns (uint256 amount);

    /**
     * @notice Returns the maximum commitment per user
     * @return amount Maximum commitment amount
     */
    function maximumCommitment() external view returns (uint256 amount);

    /**
     * @notice Returns the minimum total commitment for successful sale
     * @return amount Minimum total commitment amount
     */
    function minimumTotalCommitment() external view returns (uint256 amount);

    /**
     * @notice Returns the maximum total commitment allowed
     * @return amount Maximum total commitment amount
     */
    function maximumTotalCommitment() external view returns (uint256 amount);

    /**
     * @notice Returns the price per sale token
     * @return price Price in commitment token units (with PRECISION decimals)
     */
    function saleTokenPrice() external view returns (uint256 price);

    /**
     * @notice Returns the commitment token protocol fee
     * @return fee Fee percentage (with PRECISION decimals)
     */
    function commitmentTokenProtocolFee() external view returns (uint256 fee);

    /**
     * @notice Returns the sale token protocol fee
     * @return fee Fee percentage (with PRECISION decimals)
     */
    function saleTokenProtocolFee() external view returns (uint256 fee);

    /**
     * @notice Returns the total commitments in the sale
     * @return total Total commitment amount
     */
    function totalCommitments() external view returns (uint256 total);

    /**
     * @notice Returns a user's commitment amount
     * @param account_ Address to query
     * @return amount Commitment amount
     */
    function commitments(
        address account_
    ) external view returns (uint256 amount);

    /**
     * @notice Returns whether a user has settled
     * @param account_ Address to query
     * @return hasSettled True if settled, false otherwise
     */
    function settled(address account_) external view returns (bool hasSettled);

    /**
     * @notice Returns whether Hedgey lockup is enabled
     * @return enabled True if Hedgey lockup is enabled, false otherwise
     */
    function hedgeyLockupEnabled() external view returns (bool enabled);

    /**
     * @notice Returns the Hedgey lockup start time
     * @return start Start time of the lockup plan
     */
    function hedgeyLockupStart() external view returns (uint256 start);

    /**
     * @notice Returns the Hedgey lockup cliff time
     * @return cliff Cliff time of the lockup plan
     */
    function hedgeyLockupCliff() external view returns (uint256 cliff);

    /**
     * @notice Returns the Hedgey lockup rate
     * @return ratePercentage Rate of percentage of tokens that vest per period
     */
    function hedgeyLockupRatePercentage()
        external
        view
        returns (uint256 ratePercentage);

    /**
     * @notice Returns the Hedgey lockup period
     * @return period Duration of each vesting period in seconds
     */
    function hedgeyLockupPeriod() external view returns (uint256 period);

    /**
     * @notice Returns the Hedgey voting token lockup plans contract address
     * @return votingTokenLockupPlans Address of the VotingTokenLockupPlans contract
     */
    function hedgeyVotingTokenLockupPlans()
        external
        view
        returns (address votingTokenLockupPlans);

    // --- State-Changing Functions ---

    /**
     * @notice Increases commitment using native asset (ETH)
     * @param verifyingSignature_ The verifier signature attesting to buyer status
     * @param signatureExpiration_ The expiration timestamp of the signature
     * @dev Reverts if commitment token is not NATIVE_ASSET
     */
    function increaseCommitmentNative(
        bytes calldata verifyingSignature_,
        uint48 signatureExpiration_
    ) external payable;

    /**
     * @notice Increases commitment using ERC20 tokens
     * @param increaseAmount_ Amount to increase commitment by
     * @param verifyingSignature_ The verifier signature attesting to buyer status
     * @param signatureExpiration_ The expiration timestamp of the signature
     * @dev Reverts if commitment token is NATIVE_ASSET
     */
    function increaseCommitmentERC20(
        uint256 increaseAmount_,
        bytes calldata verifyingSignature_,
        uint48 signatureExpiration_
    ) external;

    /**
     * @notice Buyer settles user's commitment after sale ends
     * @param recipient_ Address to receive tokens (sale tokens if successful, commitment tokens if failed)
     * @dev Can only be called after sale has ended
     */
    function buyerSettle(address recipient_) external;

    /**
     * @notice Seller settles sale proceeds and fees
     * @dev Can be called by anyone after sale has ended
     */
    function sellerSettle() external;
}
