// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {LockupLinear, Broker} from "../../sablier/types/DataTypes.sol";

interface IDecentHatsModuleUtils {
    // --- Structs ---

    struct SablierStreamParams {
        address sablier;
        address sender;
        address asset;
        LockupLinear.Timestamps timestamps;
        Broker broker;
        uint128 totalAmount;
        bool cancelable;
        bool transferable;
    }

    struct HatParams {
        address wearer;
        string details;
        string imageURI;
        SablierStreamParams[] sablierStreamsParams;
        uint128 termEndDateTs; // If 0, this is an untermed Hat
        uint32 maxSupply;
        bool isMutable;
    }

    struct CreateRoleHatsParams {
        address hatsProtocol;
        address erc6551Registry;
        address hatsAccountImplementation;
        uint256 topHatId;
        address topHatAccount;
        address keyValuePairs;
        address hatsModuleFactory;
        address hatsElectionsEligibilityImplementation;
        uint256 adminHatId;
        HatParams[] hats;
    }
}
