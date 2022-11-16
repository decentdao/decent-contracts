"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const ethers_1 = require("ethers");
const hardhat_1 = require("hardhat");
const typechain_types_1 = require("../typechain-types");
const helpers_1 = require("./helpers");
describe("Gnosis Safe", () => {
    // Factories
    let gnosisFactory;
    // Deployed contracts
    let childGnosisSafe;
    let parentGnosisSafe;
    let vetoGuard;
    let vetoMultisigVoting;
    let votesToken;
    // Wallets
    let deployer;
    let parentMultisigOwner1;
    let parentMultisigOwner2;
    let parentMultisigOwner3;
    let childMultisigOwner1;
    let childMultisigOwner2;
    let childMultisigOwner3;
    let vetoGuardOwner;
    // Gnosis
    let createParentGnosisSetupCalldata;
    let createChildGnosisSetupCalldata;
    const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
    const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
    const threshold = 2;
    const saltNum = ethers_1.BigNumber.from("0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c");
    beforeEach(async () => {
        // Fork Goerli to use contracts deployed on Goerli
        await hardhat_1.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.GOERLI_PROVIDER
                            ? process.env.GOERLI_PROVIDER
                            : "",
                        blockNumber: 7387621,
                    },
                },
            ],
        });
        [
            deployer,
            parentMultisigOwner1,
            parentMultisigOwner2,
            parentMultisigOwner3,
            childMultisigOwner1,
            childMultisigOwner2,
            childMultisigOwner3,
            vetoGuardOwner,
        ] = await hardhat_1.ethers.getSigners();
        // Get deployed Gnosis Safe
        gnosisFactory = new hardhat_1.ethers.Contract(gnosisFactoryAddress, helpers_1.abi, deployer);
        createParentGnosisSetupCalldata = helpers_1.ifaceSafe.encodeFunctionData("setup", [
            [
                parentMultisigOwner1.address,
                parentMultisigOwner2.address,
                parentMultisigOwner3.address,
            ],
            threshold,
            hardhat_1.ethers.constants.AddressZero,
            hardhat_1.ethers.constants.HashZero,
            hardhat_1.ethers.constants.AddressZero,
            hardhat_1.ethers.constants.AddressZero,
            0,
            hardhat_1.ethers.constants.AddressZero,
        ]);
        createChildGnosisSetupCalldata = helpers_1.ifaceSafe.encodeFunctionData("setup", [
            [
                childMultisigOwner1.address,
                childMultisigOwner2.address,
                childMultisigOwner3.address,
            ],
            threshold,
            hardhat_1.ethers.constants.AddressZero,
            hardhat_1.ethers.constants.HashZero,
            hardhat_1.ethers.constants.AddressZero,
            hardhat_1.ethers.constants.AddressZero,
            0,
            hardhat_1.ethers.constants.AddressZero,
        ]);
        const predictedParentGnosisSafeAddress = await (0, helpers_1.predictGnosisSafeAddress)(gnosisFactory.address, createParentGnosisSetupCalldata, saltNum, gnosisSingletonAddress, gnosisFactory);
        const predictedChildGnosisSafeAddress = await (0, helpers_1.predictGnosisSafeAddress)(gnosisFactory.address, createChildGnosisSetupCalldata, saltNum, gnosisSingletonAddress, gnosisFactory);
        // Deploy Parent Gnosis Safe
        await gnosisFactory.createProxyWithNonce(gnosisSingletonAddress, createParentGnosisSetupCalldata, saltNum);
        // Deploy Child Gnosis Safe
        await gnosisFactory.createProxyWithNonce(gnosisSingletonAddress, createChildGnosisSetupCalldata, saltNum);
        // Get Parent Gnosis Safe contract
        parentGnosisSafe = new hardhat_1.ethers.Contract(predictedParentGnosisSafeAddress, helpers_1.abiSafe, deployer);
        // Get Child Gnosis Safe contract
        childGnosisSafe = new hardhat_1.ethers.Contract(predictedChildGnosisSafeAddress, helpers_1.abiSafe, deployer);
        // Deploy token, allocate supply to two token vetoers and Gnosis Safe
        votesToken = await new typechain_types_1.VotesToken__factory(deployer).deploy();
        const abiCoder = new hardhat_1.ethers.utils.AbiCoder(); // encode data
        const votesTokenSetupData = abiCoder.encode(["string", "string", "address[]", "uint256[]"], ["DCNT", "DCNT", [childGnosisSafe.address], [1000]]);
        await votesToken.setUp(votesTokenSetupData);
        // Deploy VetoERC20Voting contract
        vetoMultisigVoting = await new typechain_types_1.VetoMultisigVoting__factory(deployer).deploy();
        // Deploy VetoGuard contract with a 10 block delay between queuing and execution
        const vetoGuardSetupData = abiCoder.encode(["uint256", "address", "address", "address"], [
            10,
            vetoGuardOwner.address,
            vetoMultisigVoting.address,
            childGnosisSafe.address,
        ]);
        vetoGuard = await new typechain_types_1.VetoGuard__factory(deployer).deploy();
        await vetoGuard.setUp(vetoGuardSetupData);
        // Initialize VetoERC20Voting contract
        const vetoMultisigVotingSetupData = abiCoder.encode([
            "address",
            "uint256",
            "uint256",
            "uint256",
            "uint256",
            "address",
            "address",
        ], [
            vetoGuardOwner.address,
            2,
            2,
            10,
            100,
            parentGnosisSafe.address,
            vetoGuard.address,
        ]);
        await vetoMultisigVoting.setUp(vetoMultisigVotingSetupData);
        // Create transaction to set the guard address
        const setGuardData = childGnosisSafe.interface.encodeFunctionData("setGuard", [vetoGuard.address]);
        const tx = (0, helpers_1.buildSafeTransaction)({
            to: childGnosisSafe.address,
            data: setGuardData,
            safeTxGas: 1000000,
            nonce: await childGnosisSafe.nonce(),
        });
        const sigs = [
            await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
            await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
        ];
        const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
        // Execute transaction that adds the veto guard to the Safe
        await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes)).to.emit(childGnosisSafe, "ExecutionSuccess");
        // Gnosis Safe received the 1,000 tokens
        (0, chai_1.expect)(await votesToken.balanceOf(childGnosisSafe.address)).to.eq(1000);
    });
    describe("VetoGuard Functionality", () => {
        it("Supports ERC-165", async () => {
            // Supports IVetoGuard interface
            (0, chai_1.expect)(await vetoGuard.supportsInterface("0xfac0f7cd")).to.eq(true);
            // Supports IGuard interface
            (0, chai_1.expect)(await vetoGuard.supportsInterface("0xe6d7a83a")).to.eq(true);
            // Supports IERC-165 interface
            (0, chai_1.expect)(await vetoGuard.supportsInterface("0x01ffc9a7")).to.eq(true);
            // Doesn't support random interface
            (0, chai_1.expect)(await vetoGuard.supportsInterface("0x00000000")).to.eq(false);
        });
        it("A transaction can be queued and executed", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await vetoGuard.queueTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await childGnosisSafe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            (0, chai_1.expect)(await votesToken.balanceOf(childGnosisSafe.address)).to.eq(0);
            (0, chai_1.expect)(await votesToken.balanceOf(deployer.address)).to.eq(1000);
        });
        it("A transaction cannot be executed if it hasn't yet been queued", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes)).to.be.revertedWith("Transaction has not been queued yet");
        });
        it("A transaction cannot be queued if the signatures aren't valid", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            // Only 1 signer signs, while the threshold is 2
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await (0, chai_1.expect)(vetoGuard.queueTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes)).to.be.revertedWith("GS020");
        });
        it("A transaction cannot be executed if the delay period has not been reached yet", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await vetoGuard.queueTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes)).to.be.revertedWith("Transaction delay period has not completed yet");
        });
        it("A transaction can be executed if it has received some veto votes, but not above the threshold", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await vetoGuard.queueTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            const txHash = await vetoMultisigVoting.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver);
            // Vetoer 1 casts 1 veto vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash, false);
            // 1 veto vote have been cast
            (0, chai_1.expect)(await vetoMultisigVoting.transactionVetoVotes(txHash)).to.eq(1);
            (0, chai_1.expect)(await vetoMultisigVoting.getIsVetoed(txHash)).to.eq(false);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await childGnosisSafe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            (0, chai_1.expect)(await votesToken.balanceOf(deployer.address)).to.eq(1000);
            (0, chai_1.expect)(await votesToken.balanceOf(childGnosisSafe.address)).to.eq(0);
        });
        it("A transaction cannot be executed if it has received more veto votes than the threshold", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await vetoGuard.queueTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            const txHash = await vetoMultisigVoting.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver);
            // Vetoer 1 casts 1 veto vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash, false);
            // Vetoer 2 casts 1 veto vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner2)
                .castVetoVote(txHash, false);
            // 2 veto votes have been cast
            (0, chai_1.expect)(await vetoMultisigVoting.transactionVetoVotes(txHash)).to.eq(2);
            (0, chai_1.expect)(await vetoMultisigVoting.getIsVetoed(txHash)).to.eq(true);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes)).to.be.revertedWith("Transaction has been vetoed");
        });
        it("A vetoed transaction does not prevent another transaction from being executed", async () => {
            // Create transaction to set the guard address
            const tokenTransferData1 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tokenTransferData2 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 999]);
            const tx1 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData1,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const tx2 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData2,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs1 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx1),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx1),
            ];
            const signatureBytes1 = (0, helpers_1.buildSignatureBytes)(sigs1);
            const sigs2 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx2),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx2),
            ];
            const signatureBytes2 = (0, helpers_1.buildSignatureBytes)(sigs2);
            await vetoGuard.queueTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1);
            const txHash1 = await vetoMultisigVoting.getTransactionHash(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver);
            // Vetoer 1 casts 1 veto vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash1, false);
            // Vetoer 2 casts 1 veto vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner2)
                .castVetoVote(txHash1, false);
            // 2 veto votes have been cast
            (0, chai_1.expect)(await vetoMultisigVoting.transactionVetoVotes(txHash1)).to.eq(2);
            (0, chai_1.expect)(await vetoMultisigVoting.getIsVetoed(txHash1)).to.eq(true);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.be.revertedWith("Transaction has been vetoed");
            // Tx1 has been vetoed, now try to queue and execute tx2
            await vetoGuard.queueTransaction(tx2.to, tx2.value, tx2.data, tx2.operation, tx2.safeTxGas, tx2.baseGas, tx2.gasPrice, tx2.gasToken, tx2.refundReceiver, signatureBytes2);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await childGnosisSafe.execTransaction(tx2.to, tx2.value, tx2.data, tx2.operation, tx2.safeTxGas, tx2.baseGas, tx2.gasPrice, tx2.gasToken, tx2.refundReceiver, signatureBytes2);
            (0, chai_1.expect)(await votesToken.balanceOf(deployer.address)).to.eq(999);
            (0, chai_1.expect)(await votesToken.balanceOf(childGnosisSafe.address)).to.eq(1);
        });
        it("A vetoer cannot cast veto votes more than once", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx),
            ];
            const signatureBytes = (0, helpers_1.buildSignatureBytes)(sigs);
            await vetoGuard.queueTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatureBytes);
            const txHash = await vetoMultisigVoting.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver);
            // Vetoer 1 casts 1 veto vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash, false);
            await (0, chai_1.expect)(vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash, false)).to.be.revertedWith("User has already voted");
        });
        it("A veto vote cannot be cast if the transaction has not been queued yet", async () => {
            // Create transaction to set the guard address
            const tokenTransferData = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData,
                safeTxGas: 1000000,
                nonce: await parentGnosisSafe.nonce(),
            });
            const txHash = await vetoMultisigVoting.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver);
            await (0, chai_1.expect)(vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash, false)).to.be.revertedWith("Transaction has not yet been queued");
        });
    });
    describe("Frozen Functionality", () => {
        it("A frozen DAO cannot execute any transactions", async () => {
            // Create transaction to set the guard address
            const tokenTransferData1 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tokenTransferData2 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 999]);
            const tx1 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData1,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const tx2 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData2,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs1 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx1),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx1),
            ];
            const signatureBytes1 = (0, helpers_1.buildSignatureBytes)(sigs1);
            const sigs2 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx2),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx2),
            ];
            const signatureBytes2 = (0, helpers_1.buildSignatureBytes)(sigs2);
            await vetoGuard.queueTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1);
            const txHash1 = await vetoMultisigVoting.getTransactionHash(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver);
            // Vetoer 1 casts 1 veto vote and 1 freeze vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner1)
                .castVetoVote(txHash1, true);
            // Vetoer 2 casts 1 veto vote and 1 freeze vote
            await vetoMultisigVoting
                .connect(parentMultisigOwner2)
                .castVetoVote(txHash1, true);
            // 2 veto votes have been cast
            (0, chai_1.expect)(await vetoMultisigVoting.transactionVetoVotes(txHash1)).to.eq(2);
            // 2 freeze votes have been cast
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(2);
            (0, chai_1.expect)(await vetoMultisigVoting.getIsVetoed(txHash1)).to.eq(true);
            // Check that the DAO has been frozen
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(true);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.be.revertedWith("Transaction has been vetoed");
            // Queue tx2
            await vetoGuard.queueTransaction(tx2.to, tx2.value, tx2.data, tx2.operation, tx2.safeTxGas, tx2.baseGas, tx2.gasPrice, tx2.gasToken, tx2.refundReceiver, signatureBytes2);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx2.to, tx2.value, tx2.data, tx2.operation, tx2.safeTxGas, tx2.baseGas, tx2.gasPrice, tx2.gasToken, tx2.refundReceiver, signatureBytes2)).to.be.revertedWith("DAO is frozen");
        });
        it("A DAO may be frozen independently of a veto ", async () => {
            // Vetoer 1 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            // Vetoer 2 casts 1 freeze votes
            await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();
            // 2 freeze votes have been cast
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(2);
            // Check that the DAO has been frozen
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(true);
            // Create transaction to set the guard address
            const tokenTransferData1 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx1 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData1,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs1 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx1),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx1),
            ];
            const signatureBytes1 = (0, helpers_1.buildSignatureBytes)(sigs1);
            await vetoGuard.queueTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.be.revertedWith("DAO is frozen");
        });
        it("A DAO may execute txs during a freeze proposal period if the freeze threshold is not met", async () => {
            // Vetoer 1 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            // Check that the DAO has not been frozen
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(false);
            // Create transaction to set the guard address
            const tokenTransferData1 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx1 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData1,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs1 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx1),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx1),
            ];
            const signatureBytes1 = (0, helpers_1.buildSignatureBytes)(sigs1);
            await vetoGuard.queueTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.emit(childGnosisSafe, "ExecutionSuccess");
        });
        it("Freeze vars set properly during init", async () => {
            // Frozen Params init correctly
            (0, chai_1.expect)(await vetoMultisigVoting.freezeVotesThreshold()).to.eq(2);
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalBlockDuration()).to.eq(10);
            (0, chai_1.expect)(await vetoMultisigVoting.freezeBlockDuration()).to.eq(100);
            (0, chai_1.expect)(await vetoMultisigVoting.owner()).to.eq(vetoGuardOwner.address);
        });
        it("Updates state properly due to freeze actions", async () => {
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(0);
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalCreatedBlock()).to.eq(0);
            // Vetoer 1 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(false);
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(1);
            const latestBlock = await hardhat_1.ethers.provider.getBlock("latest");
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalCreatedBlock()).to.eq(latestBlock.number);
            await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(true);
        });
        it("Casting a vote after the freeze voting period resets state", async () => {
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(0);
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalCreatedBlock()).to.eq(0);
            // Vetoer 1 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(false);
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(1);
            let latestBlock = await hardhat_1.ethers.provider.getBlock("latest");
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalCreatedBlock()).to.eq(latestBlock.number);
            for (let i = 0; i < 10; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(1);
            latestBlock = await hardhat_1.ethers.provider.getBlock("latest");
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalCreatedBlock()).to.eq(latestBlock.number);
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(false);
        });
        it("A user cannot vote twice to freeze a DAO during the same voting period", async () => {
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            await (0, chai_1.expect)(vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote()).to.be.revertedWith("User has already voted");
            (0, chai_1.expect)(await vetoMultisigVoting.freezeProposalVoteCount()).to.eq(1);
        });
        it("Previously Frozen DAOs may execute TXs after the freeze period has elapsed", async () => {
            // Vetoer 1 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            // Vetoer 2 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();
            // Check that the DAO has been frozen
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(true);
            // Create transaction to set the guard address
            const tokenTransferData1 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx1 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData1,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs1 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx1),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx1),
            ];
            const signatureBytes1 = (0, helpers_1.buildSignatureBytes)(sigs1);
            await vetoGuard.queueTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.be.revertedWith("DAO is frozen");
            for (let i = 0; i < 100; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            // Check that the DAO has been unFrozen
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(false);
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.emit(childGnosisSafe, "ExecutionSuccess");
        });
        it("Defrosted DAOs may execute txs", async () => {
            // Vetoer 1 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();
            // Vetoer 2 casts 1 freeze vote
            await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();
            // Check that the DAO has been frozen
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(true);
            await vetoMultisigVoting.connect(vetoGuardOwner).defrost();
            (0, chai_1.expect)(await vetoMultisigVoting.isFrozen()).to.eq(false);
            // Create transaction to set the guard address
            const tokenTransferData1 = votesToken.interface.encodeFunctionData("transfer", [deployer.address, 1000]);
            const tx1 = (0, helpers_1.buildSafeTransaction)({
                to: votesToken.address,
                data: tokenTransferData1,
                safeTxGas: 1000000,
                nonce: await childGnosisSafe.nonce(),
            });
            const sigs1 = [
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner1, childGnosisSafe, tx1),
                await (0, helpers_1.safeSignTypedData)(childMultisigOwner2, childGnosisSafe, tx1),
            ];
            const signatureBytes1 = (0, helpers_1.buildSignatureBytes)(sigs1);
            await vetoGuard.queueTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1);
            // Mine blocks to surpass the execution delay
            for (let i = 0; i < 9; i++) {
                await hardhat_1.network.provider.send("evm_mine");
            }
            // Check that the DAO has been unFrozen
            await (0, chai_1.expect)(childGnosisSafe.execTransaction(tx1.to, tx1.value, tx1.data, tx1.operation, tx1.safeTxGas, tx1.baseGas, tx1.gasPrice, tx1.gasToken, tx1.refundReceiver, signatureBytes1)).to.emit(childGnosisSafe, "ExecutionSuccess");
        });
        it("You must be a parent multisig owner to cast a freeze vote", async () => {
            await (0, chai_1.expect)(vetoMultisigVoting.connect(vetoGuardOwner).castFreezeVote()).to.be.revertedWith("User is not an owner");
        });
        it("Only owner methods must be called by the owner", async () => {
            await (0, chai_1.expect)(vetoMultisigVoting.connect(childMultisigOwner1).defrost()).to.be.revertedWith("Ownable: caller is not the owner");
            await (0, chai_1.expect)(vetoMultisigVoting
                .connect(childMultisigOwner1)
                .updateVetoVotesThreshold(0)).to.be.revertedWith("Ownable: caller is not the owner");
            await (0, chai_1.expect)(vetoMultisigVoting
                .connect(childMultisigOwner1)
                .updateFreezeVotesThreshold(0)).to.be.revertedWith("Ownable: caller is not the owner");
            await (0, chai_1.expect)(vetoMultisigVoting
                .connect(childMultisigOwner1)
                .updateFreezeProposalBlockDuration(0)).to.be.revertedWith("Ownable: caller is not the owner");
            await (0, chai_1.expect)(vetoMultisigVoting
                .connect(childMultisigOwner1)
                .updateFreezeBlockDuration(0)).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });
});
