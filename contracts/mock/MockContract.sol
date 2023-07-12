//SPDX-License-Identifier: Unlicense

pragma solidity ^0.8.19;

/**
 * Mock contract for testing, deployed to Goerli at:
 * 0x6EAdD7E8eF9C4fE4309BF9f3e452B4D8F220DA94
 */
contract MockContract {

    event DidSomething(string message);

    error Reverting();

    function doSomething() public {
        doSomethingWithParam("doSomething()");
    }

    function doSomethingWithParam(string memory _message) public {
        emit DidSomething(_message);
    }

    function returnSomething(string memory _s) external pure returns(string memory) {
        return _s;
    }

    function revertSomething() external {
        revert Reverting();
    }
}
