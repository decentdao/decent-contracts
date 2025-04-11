// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

interface ILockable {
    function lock(bool _locked) external;

    function whitelist(address account, bool isWhitelisted) external;

    function locked() external view returns (bool);

    function whitelisted(address account) external view returns (bool);
}
