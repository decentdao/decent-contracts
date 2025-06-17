// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IDecentSablierStreamManagementModule {
    // --- State-Changing Functions ---

    function withdrawMaxFromStream(
        address sablier_,
        address recipientHatAccount_,
        uint256 streamId_,
        address to_
    ) external;

    function cancelStream(address sablier_, uint256 streamId_) external;
}
