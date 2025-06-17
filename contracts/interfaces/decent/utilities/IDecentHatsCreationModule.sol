// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentHatsModuleUtils} from "./IDecentHatsModuleUtils.sol";

interface IDecentHatsCreationModule {
    // --- Structs ---

    struct TopHatParams {
        string details;
        string imageURI;
    }

    struct AdminHatParams {
        string details;
        string imageURI;
        bool isMutable;
    }

    struct CreateTreeParams {
        address hatsProtocol;
        address erc6551Registry;
        address hatsModuleFactory;
        address systemDeployer;
        address keyValuePairs;
        address decentAutonomousAdminImplementation;
        address hatsAccountImplementation;
        address hatsElectionsEligibilityImplementation;
        TopHatParams topHat;
        AdminHatParams adminHat;
        IDecentHatsModuleUtils.HatParams[] hats;
    }

    // --- State-Changing Functions ---

    function createAndDeclareTree(
        CreateTreeParams calldata treeParams_
    ) external;
}
