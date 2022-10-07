//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/IClaimSubsidiary.sol";
import "./VotesToken.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract ClaimSubsidiary is IClaimSubsidiary, Initializable {
    using SafeERC20 for IERC20;

    address public cToken;
    address public pToken;
    uint256 public snapId;
    uint256 public pAllocation;
    mapping(address => bool) isSnapClaimed;

    /// @notice Initilize Claim Contract
    /// @param _metaFactory Address funding claimContract
    /// @param _pToken Address of the parent token used for snapshot reference
    /// @param _cToken Address of child Token being claimed
    /// @param _pAllocation Total tokens allocated for pToken holders
    function initialize(
        address _metaFactory,
        address _pToken,
        address _cToken,
        uint256 _pAllocation
    ) external initializer {
        cToken = _cToken;
        _createSubsidiary(_metaFactory, _pToken, _cToken, _pAllocation);
    }

    ////////////////////////// SnapShot //////////////////////////////////
    /// @notice This function allows pToken holders to claim cTokens
    /// @param claimer Address which is being claimed for
    function claimSnap(address claimer) external {
        uint256 amount = calculateClaimAmount(claimer); // Get user balance
        if (amount == 0) revert NoAllocation();
        isSnapClaimed[claimer] = true;
        IERC20(cToken).safeTransfer(claimer, amount); // transfer user balance
        emit SnapClaimed(pToken, cToken, claimer, amount);
    }

    //////////////////// View Functions //////////////////////////
    /// @notice Calculate a users cToken allocation
    /// @param claimer Address which is being claimed for
    /// @return cTokenAllocation Users cToken allocation
    function calculateClaimAmount(address claimer)
        public
        view
        returns (uint256 cTokenAllocation)
    {
        cTokenAllocation = isSnapClaimed[claimer] ? 0 :
            (VotesToken(pToken).balanceOfAt(claimer, snapId) * pAllocation) /
            VotesToken(pToken).totalSupplyAt(snapId);
    }

    //////////////////// Internal Functions //////////////////////////
    /// @notice This function creates a cToken and assigns a snapshot Id for pToken holder claims
    /// @param _pToken Address of the parent token used for snapshot reference
    /// @param _cToken Address of child Token being claimed
    /// @param _pAllocation Total tokens allocated for pToken holders
    /// @return _snapId snapId number
    function _createSubsidiary(
        address _metaFactory,
        address _pToken,
        address _cToken,
        uint256 _pAllocation
    ) internal returns (uint256 _snapId) {
        IERC20(_cToken).transferFrom(_metaFactory, address(this), _pAllocation);
        _snapId = VotesToken(_pToken).captureSnapShot();
        pToken = _pToken;
        snapId = _snapId;
        pAllocation = _pAllocation;
        emit SnapAdded(_pToken, _cToken, _pAllocation);
    }

    /// @dev This empty reserved space is put in place to allow future versions to add new
    /// variables without shifting down storage in the inheritance chain.
    /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
    uint256[48] private __gap;
}
