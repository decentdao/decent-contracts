// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ICounterSignV1} from "../../interfaces/decent/deployables/ICounterSignV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/*
Design discussion: https://docs.google.com/document/d/1xp8w25O7CnsMf3cVPX_AZ3XT0k6DaAaWWl50p-VCj9A/edit?usp=sharing
*/

contract CounterSignV1 is Initializable, ICounterSignV1 {
    string private agreementUrl;
    uint256 private expirationTimestamp;
    bool private executed;

    address[] private signers;
    mapping(address => string) private entityNames;
    mapping(address => string) private signerPersonalNames;
    mapping(address => Transaction[]) private signerTransactions;
    mapping(address => bool) public signedAddresses;

    Transaction[] private finalAgreementTransactions;

    modifier onlyBeforeExpiry() {
        require(block.timestamp < expirationTimestamp, "Agreement expired");
        _;
    }

    function initialize(bytes memory params) external initializer {
        (
            address[] memory _signers,
            string[] memory _entityNames,
            Transaction[][] memory _signerTxs,
            uint256 _expiration,
            string memory _agreementUrl,
            Transaction[] memory _finalTxs
        ) = abi.decode(
                params,
                (
                    address[],
                    string[],
                    Transaction[][],
                    uint256,
                    string,
                    Transaction[]
                )
            );

        require(
            _signers.length == _entityNames.length,
            "Signers and names mismatch"
        );
        require(
            _signers.length == _signerTxs.length,
            "Signers and transactions mismatch"
        );

        signers = _signers;
        expirationTimestamp = _expiration;
        agreementUrl = _agreementUrl;
        for (uint256 i = 0; i < _finalTxs.length; i++) {
            finalAgreementTransactions.push(_finalTxs[i]);
        }

        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            entityNames[signer] = _entityNames[i];

            Transaction[] memory txs = _signerTxs[i];
            for (uint256 j = 0; j < txs.length; j++) {
                signerTransactions[signer].push(txs[j]);
            }
        }
    }

    function getAgreementUrl() external view override returns (string memory) {
        return agreementUrl;
    }

    function signAgreement(
        string memory name
    ) external override onlyBeforeExpiry {
        require(_isSigner(msg.sender), "Not a signer");
        require(!signedAddresses[msg.sender], "Already signed");

        signedAddresses[msg.sender] = true;
        signerPersonalNames[msg.sender] = name;

        Transaction[] storage txs = signerTransactions[msg.sender];
        for (uint256 i = 0; i < txs.length; i++) {
            _executeTransaction(txs[i]);
        }
    }

    function executeAgreement() external override {
        require(getIsExecutable(), "Not all signed");
        require(!executed, "Already executed");

        for (uint256 i = 0; i < finalAgreementTransactions.length; i++) {
            _executeTransaction(finalAgreementTransactions[i]);
        }
        executed = true;
    }

    function getSigners() external view override returns (address[] memory) {
        return signers;
    }

    function getHasSigned(
        address signerAddress
    ) external view override returns (bool) {
        return signedAddresses[signerAddress];
    }

    function getIsExecutable() public view override returns (bool) {
        for (uint256 i = 0; i < signers.length; i++) {
            if (!signedAddresses[signers[i]]) return false;
        }
        return true;
    }

    function getHasExecuted() external view override returns (bool) {
        return executed;
    }

    function getSignerEntityName(
        address signerAddress
    ) external view returns (string memory) {
        return entityNames[signerAddress];
    }

    function getSignerName(
        address signerAddress
    ) external view returns (string memory) {
        return signerPersonalNames[signerAddress];
    }

    function _isSigner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == addr) return true;
        }
        return false;
    }

    function _executeTransaction(Transaction memory txn) internal {
        bool success;
        if (txn.operation == Operation.Call) {
            (success, ) = txn.to.call{value: txn.value}(txn.data);
        } else if (txn.operation == Operation.DelegateCall) {
            (success, ) = txn.to.delegatecall(txn.data);
        }
        require(success, "Transaction execution failed");
    }

    receive() external payable {}
}
