// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHats} from "./interfaces/hats/full/IHats.sol";
import {IHatsElectionEligibility} from "./interfaces/hats/full/IHatsElectionEligibility.sol";
import {ISablierV2Lockup} from "./interfaces/sablier/full/ISablierV2Lockup.sol";

contract DecentAutonomousAdmin {
    string public constant NAME = "DecentAutonomousAdmin";
    string public version_ = "0.1.0";

    struct SablierStreamInfo {
        uint256 streamId;
        ISablierV2Lockup sablierV2Lockup;
    }
    struct TriggerStartArgs {
        address currentWearer;
        IHats userHatProtocol;
        uint256 userHatId;
        address nominatedWearer;
        SablierStreamInfo[] sablierStreamInfo;
    }

    // //////////////////////////////////////////////////////////////
    //                         initializer
    // //////////////////////////////////////////////////////////////
    function setUp() public {}

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
            _sablierStreamInfo[i].sablierV2Lockup.withdrawMax(
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
                .sablierV2Lockup
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
                .sablierV2Lockup
                .withdrawableAmountOf(_sablierStreamInfo[i].streamId);

            if (withdrawableAmount > 0) {
                streamsWithUnclaimedFunds[index] = _sablierStreamInfo[i];
                index++;
            }
        }

        return streamsWithUnclaimedFunds;
    }
}
