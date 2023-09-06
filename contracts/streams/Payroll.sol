//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { Module, Enum } from "@gnosis.pm/zodiac/contracts/core/Module.sol";

contract Payroll is Module {

    event PayrollSetUp(
        address indexed creator,
        address indexed owner,
        address indexed avatar,
        address target,
        address tokenAddress
    );

    event ContributorRegistered(
        address indexed contributor,
        uint256 payPerSecond,
        uint256 startTimestamp,
        uint256 endTimestamp
    );

    event PaymentUpdated(
        address indexed _contributor, 
        uint256 _payPerSecond, 
        uint256 _payUpdateTimestamp
    );

    event EndTimeUpdated(
        address indexed _contributor, 
        uint256 endTimestamp
    );

    event Withdrawal(
        address indexed _contributor,
        address indexed _toAddress,
        uint256 _amount
    );

    error AlreadyRegistered();
    error EndTimeBeforeStart();
    error ZeroEndTime();
    error PaymentFailed();

    uint256 public constant MAX_TIMESTAMP = type(uint256).max;

    address public paymentToken;

    struct Contributor {
        uint256 payPerSecond;
        uint256 endTimestamp;
        uint256 lastWithdrawTimestamp;
    }

    mapping(address => Contributor) public contributors;

    constructor() {
      _disableInitializers();
    }

    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            address _avatar,
            address _target,
            address _tokenAddress
        ) = abi.decode(
            initializeParams, (address, address, address, address)
        );

        __Ownable_init();
        avatar = _avatar;
        target = _target;
        transferOwnership(_owner);
        paymentToken = _tokenAddress;

        emit PayrollSetUp(msg.sender, _owner, _avatar, _target, _tokenAddress);
    }

    function registerContributor(
        address _contributor,
        uint256 _payPerSecond,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) external onlyOwner {
        _registerContributor(
            _contributor, 
            _payPerSecond, 
            _startTimestamp, 
            _endTimestamp
        );
    }

    function registerContributorIndefinite(
        address _contributor,
        uint256 _payPerSecond,
        uint256 _startTimestamp
    ) external onlyOwner {
        _registerContributor(
            _contributor, 
            _payPerSecond, 
            _startTimestamp, 
            MAX_TIMESTAMP
        );
    }

    function registerContributorsIndefinite (
        address[] memory _contributors,
        uint256[] memory _paymentsPerSecond,
        uint256 _startTimestamp
    ) external onlyOwner {
      for (uint i = 0; i < _contributors.length;) {
         _registerContributor(
            _contributors[i], 
            _paymentsPerSecond[i], 
            _startTimestamp,
            MAX_TIMESTAMP
        );
        unchecked { ++i; }       
      }
    }

    // note: updating payment for future date will pay out for time
    // that has not yet elapsed
    function updatePayment(
        address _contributor, 
        uint256 _payPerSecond, 
        uint256 _payUpdateTimestamp
    ) external onlyOwner {
        _withdraw(_contributor, _contributor, _payUpdateTimestamp);
        contributors[_contributor].payPerSecond = _payPerSecond;

        emit PaymentUpdated(_contributor, _payPerSecond, _payUpdateTimestamp);
    }

    function updateEndTime(
        address _contributor, 
        uint256 _endTimestamp
    ) external onlyOwner {
        if (_endTimestamp < block.timestamp) {
            // updating end time for a past date requires paying the 
            // contributor out to today, and updating the end time to 
            // today. this is to avoid rugging a contributor who has
            // already earned time
            _withdraw(_contributor, _contributor, block.timestamp);
            emit EndTimeUpdated(_contributor, block.timestamp);
        } else {
            contributors[_contributor].endTimestamp = _endTimestamp;
            emit EndTimeUpdated(_contributor, _endTimestamp);
        }
    }

    function withdraw() external {
        _withdraw(msg.sender, msg.sender, block.timestamp);
    }

    function withdraw(address _toAddress) external {
        _withdraw(msg.sender, _toAddress, block.timestamp);
    }

    function _registerContributor(
        address _contributor,
        uint256 _payPerSecond,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) internal {
        if (contributors[_contributor].endTimestamp != 0) revert AlreadyRegistered();
        if (_startTimestamp > _endTimestamp) revert EndTimeBeforeStart();
        if (_endTimestamp == 0) revert ZeroEndTime();

        contributors[_contributor] = Contributor(
            _payPerSecond,
            _endTimestamp,
            // "last withdrawal" is initialized to the start
            // of payments, so contributors can earn back pay
            // if their start date has already elapsed
            _startTimestamp
        );

        emit ContributorRegistered(_contributor, _payPerSecond, _startTimestamp, _endTimestamp);
    }

    // with draw $ between last withdraw and _untilTimestamp
    function _withdraw(
        address _contributor, 
        address _toAddress, 
        uint256 _untilTimestamp
    ) internal {
        uint256 amountToPay = _claimable(_contributor, _untilTimestamp);

        bytes memory data = abi.encode("transfer(address to, uint256 value)", _toAddress, amountToPay);
        
        if(!exec(paymentToken, 0, data, Enum.Operation(0))) revert PaymentFailed();

        contributors[_contributor].lastWithdrawTimestamp = _untilTimestamp;

        emit Withdrawal(_contributor,  _toAddress, amountToPay);
    }

    // calculate amount claimbable between last withdraw and _untilTimestamp
    function _claimable(
        address _contributor, 
        uint256 _untilTimestamp
    ) internal view returns(uint) {
        Contributor memory contributor = contributors[_contributor];

        if (_untilTimestamp < contributor.lastWithdrawTimestamp) return 0;

        uint256 endTime = contributor.endTimestamp;
        uint256 payableTime = _untilTimestamp > endTime ? endTime : _untilTimestamp;
        uint256 elapsedSeconds = payableTime - contributor.lastWithdrawTimestamp;

        return elapsedSeconds * contributor.payPerSecond;
    }
}
