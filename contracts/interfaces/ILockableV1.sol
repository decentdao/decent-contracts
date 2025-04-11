// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

interface ILockableV1 {
    function lock(bool _locked) external;

    function locked() external view returns (bool);

    function whitelist(address account, bool isWhitelisted) external;

    function whitelisted(address account) external view returns (bool);
}
