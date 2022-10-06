//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IGnosisWrapper {
    function initialize(address _accessControl, address _gnosisSafe) external;
    function gnosisSafe() external view returns(address);
}
