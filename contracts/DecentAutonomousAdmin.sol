// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;
import "./interfaces/hats/IHats.sol";
import "./interfaces/hats/IHatsElectionEligibility.sol";
import "./interfaces/sablier/ISablierV2LockupLinear.sol";

contract DecentAutonomousAdmin {
    string public constant NAME = "DecentAutonomousAdmin";
    string public version_;
    uint256 public adminHatId;

    struct SablierStreamInfo {
        uint256 streamId;
        ISablierV2LockupLinear sablierV2LockupLinear;
    }
    struct TriggerStartArgs {
        address currentWearer;
        IHats userHatProtocol;
        uint256 userHatId;
        address nominatedWearer;
        SablierStreamInfo[] sablierStreamInfo;
    }

    // //////////////////////////////////////////////////////////////
    //                         Constructor
    // //////////////////////////////////////////////////////////////
    constructor(string memory _version) {
        version_ = _version;
    }

    // //////////////////////////////////////////////////////////////
    //                         Initializer
    // //////////////////////////////////////////////////////////////
    function setUp(uint256 _adminHatId) public {
        adminHatId = _adminHatId;
    }

    // //////////////////////////////////////////////////////////////
    //                         Public Functions
    // //////////////////////////////////////////////////////////////
    function triggerStartNextTerm(TriggerStartArgs calldata args) public {
        require(
            args.userHatProtocol.isWearerOfHat(
                args.currentWearer,
                args.userHatId
            ),
            "Not current wearer"
        );
        address hatsEligibilityModuleAddress = args
            .userHatProtocol
            .getHatEligibilityModule(args.userHatId);

        IHatsElectionEligibility hatsElectionModule = IHatsElectionEligibility(
            hatsEligibilityModuleAddress
        );

        hatsElectionModule.startNextTerm();

        // transfer user hat to self
        args.userHatProtocol.transferHat(
            args.userHatId,
            args.currentWearer,
            address(this)
        );

        // for each withdrawable stream, withdraw funds to current wearer of hat
        _flushUnclaimedFunds(
            _getStreamsWithUnclaimedFunds(args.sablierStreamInfo),
            args.currentWearer
        );

        // transfer hat to nominated wearer
        args.userHatProtocol.transferHat(
            args.userHatId,
            address(this),
            args.nominatedWearer
        );
    }

    // //////////////////////////////////////////////////////////////
    //                         Internal Functions
    // //////////////////////////////////////////////////////////////

    /**
     * @dev Withdraws unclaimed funds from Sablier streams.
     * @param _sablierStreamInfo SablierStreamInfo array
     */
    function _flushUnclaimedFunds(
        SablierStreamInfo[] memory _sablierStreamInfo,
        address withdrawTo
    ) internal {
        for (uint256 i = 0; i < _sablierStreamInfo.length; i++) {
            _sablierStreamInfo[i].sablierV2LockupLinear.withdrawMax(
                _sablierStreamInfo[i].streamId,
                withdrawTo
            );
        }
    }

    /**
     * @dev Returns an array of Sablier stream ids that have unclaimed funds.
     * @param _sablierStreamInfo SablierStreamInfo array
     * @return streamsWithUnclaimedFunds An array of SablierStreamInfo that have unclaimed funds
     */
    function _getStreamsWithUnclaimedFunds(
        SablierStreamInfo[] memory _sablierStreamInfo
    ) internal view returns (SablierStreamInfo[] memory) {
        uint256 streamsWithUnclaimedFundsCount = 0;

        for (uint256 i = 0; i < _sablierStreamInfo.length; i++) {
            uint128 withdrawableAmount = _sablierStreamInfo[i]
                .sablierV2LockupLinear
                .withdrawableAmountOf(_sablierStreamInfo[i].streamId);

            if (withdrawableAmount > 0) {
                streamsWithUnclaimedFundsCount++;
            }
        }

        SablierStreamInfo[]
            memory streamsWithUnclaimedFunds = new SablierStreamInfo[](
                streamsWithUnclaimedFundsCount
            );
        uint256 index = 0;

        for (uint256 i = 0; i < _sablierStreamInfo.length; i++) {
            uint128 withdrawableAmount = _sablierStreamInfo[i]
                .sablierV2LockupLinear
                .withdrawableAmountOf(_sablierStreamInfo[i].streamId);

            if (withdrawableAmount > 0) {
                streamsWithUnclaimedFunds[index] = _sablierStreamInfo[i];
                index++;
            }
        }

        return streamsWithUnclaimedFunds;
    }
}
