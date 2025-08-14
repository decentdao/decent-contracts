import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IDeploymentBlock__factory,
  IERC165__factory,
  IVerifierV1__factory,
  IVersion__factory,
  VerifierV1,
  VerifierV1__factory,
} from '../../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';

describe('VerifierV1', () => {
  // signers
  let alice: SignerWithAddress;
  let verifierSigner: SignerWithAddress;
  let deployer: SignerWithAddress;
  let mockOperatingContract: SignerWithAddress;
  let owner: SignerWithAddress;

  // contracts
  let verifier: VerifierV1;

  beforeEach(async () => {
    // Get signers
    [alice, verifierSigner, deployer, mockOperatingContract, owner] = await ethers.getSigners();

    // deploy verifier
    verifier = await new VerifierV1__factory(deployer).deploy(
      owner.address,
      verifierSigner.address,
    );
  });

  describe('Ownership', function () {
    it('should allow owner to update signer', async function () {
      expect(await verifier.signer()).to.equal(verifierSigner.address);
      await verifier.connect(owner).updateSigner(alice.address);
      expect(await verifier.signer()).to.equal(alice.address);
    });

    it('should prevent non-owners from calling owner-only functions', async function () {
      await expect(
        verifier.connect(alice).updateSigner(alice.address),
      ).to.be.revertedWithCustomError(verifier, 'OwnableUnauthorizedAccount');
    });
  });

  describe('Verifications', () => {
    it('should not revert when the signature is valid', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      // Shouldn't revert
      await expect(
        verifier
          .connect(mockOperatingContract)
          .verify(alice.address, signatureExpiration, verifyingSignature),
      ).to.not.be.reverted;

      // Alice nonce should be incremented
      expect(await verifier.nonce(alice.address)).to.equal(1n);
    });

    it('should return true from checkVerify when the signature is valid', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      expect(
        await verifier.checkVerify(
          mockOperatingContract.address,
          alice.address,
          signatureExpiration,
          verifyingSignature,
        ),
      ).to.be.true;
    });

    it('should return false from checkVerify when the signature is invalid', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) - 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      expect(
        await verifier.checkVerify(
          mockOperatingContract.address,
          alice.address,
          signatureExpiration,
          verifyingSignature,
        ),
      ).to.be.false;
    });

    it('should revert when the signature is invalid', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      // invalid signature - message is signed by Alice rather than the verifier
      const verifyingSignature = await alice.signTypedData(domain, types, verificationMessage);

      await expect(
        verifier
          .connect(mockOperatingContract)
          .verify(alice.address, signatureExpiration, verifyingSignature),
      ).to.be.revertedWithCustomError(verifier, 'InvalidSignature');
    });

    it('should revert when caller is not the signed operator', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      await expect(
        verifier.connect(alice).verify(alice.address, signatureExpiration, verifyingSignature),
      ).to.be.revertedWithCustomError(verifier, 'InvalidSignature');
    });

    it('should revert when the signature has expired', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) - 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      await expect(
        verifier
          .connect(mockOperatingContract)
          .verify(alice.address, signatureExpiration, verifyingSignature),
      ).to.be.revertedWithCustomError(verifier, 'SignatureExpired');
    });

    it('should revert when the nonce is incorrect', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const wrongNonce = currentNonce + 1n; // Wrong nonce
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: wrongNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      await expect(
        verifier
          .connect(mockOperatingContract)
          .verify(alice.address, signatureExpiration, verifyingSignature),
      ).to.be.revertedWithCustomError(verifier, 'InvalidSignature');
    });

    it('should increment nonce after successful verification', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const initialNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: initialNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      await verifier
        .connect(mockOperatingContract)
        .verify(alice.address, signatureExpiration, verifyingSignature);

      // Nonce should be incremented
      expect(await verifier.nonce(alice.address)).to.equal(initialNonce + 1n);
    });

    it('should prevent replay attacks', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);

      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      await verifier
        .connect(mockOperatingContract)
        .verify(alice.address, signatureExpiration, verifyingSignature);

      // Second verification with same signature should fail due to nonce mismatch
      await expect(
        verifier
          .connect(mockOperatingContract)
          .verify(alice.address, signatureExpiration, verifyingSignature),
      ).to.be.revertedWithCustomError(verifier, 'InvalidSignature');
    });

    it('should emit SignatureVerified event on successful verification', async () => {
      const domain = {
        name: 'Verifier',
        version: '1',
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await verifier.getAddress(),
      };

      const types = {
        VerificationData: [
          { name: 'operator', type: 'address' },
          { name: 'account', type: 'address' },
          { name: 'signatureExpiration', type: 'uint48' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const currentNonce = await verifier.nonce(alice.address);
      const signatureExpiration = (await time.latest()) + 3600;

      const verificationMessage = {
        operator: mockOperatingContract.address,
        account: alice.address,
        signatureExpiration: signatureExpiration,
        nonce: currentNonce,
      };

      const verifyingSignature = await verifier.signTypedData(domain, types, verificationMessage);

      await expect(
        verifier
          .connect(mockOperatingContract)
          .verify(alice.address, signatureExpiration, verifyingSignature),
      )
        .to.emit(verifier, 'SignatureVerified')
        .withArgs(mockOperatingContract.address, alice.address, signatureExpiration, currentNonce);
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await verifier.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    runSupportsInterfaceTests({
      getContract: () => verifier,
      supportedInterfaceFactories: [
        IERC165__factory,
        IVerifierV1__factory,
        IVersion__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => verifier,
    });
  });
});
