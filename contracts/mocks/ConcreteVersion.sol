// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {Version} from "../Version.sol";

contract ConcreteVersion is Version {
    uint16 private _version;

    function setVersion(uint16 newVersion) public {
        _version = newVersion;
    }

    function getVersion()
        public
        view
        virtual
        override(Version)
        returns (uint16)
    {
        return _version;
    }
}
