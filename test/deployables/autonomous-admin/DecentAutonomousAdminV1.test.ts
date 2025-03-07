import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DecentAutonomousAdminV1,
  DecentAutonomousAdminV1__factory,
  MockHats,
  MockHats__factory,
  MockHatsElectionsEligibility,
  MockHatsElectionsEligibility__factory,
} from '../../../typechain-types';
import { topHatIdToHatId } from '../../helpers';

describe('DecentAutonomousAdminHatV1', function () {
  // Signer accounts
  let deployer: SignerWithAddress;
  let firstWearer: SignerWithAddress;
  let randomUser: SignerWithAddress;
  let secondWearer: SignerWithAddress;

  // Contract instances
  let hatsProtocol: MockHats;
  let hatsElectionModule: MockHatsElectionsEligibility;
  let decentAutonomousAdminInstance: DecentAutonomousAdminV1;

  // Variables
  let roleHatId: bigint;

  let firstTermEnd: number;
  let nextTermEnd: number;

  beforeEach(async function () {
    // Get signers
    [deployer, firstWearer, secondWearer, randomUser] = await ethers.getSigners();

    // Deploy MockHatsAutoAdmin (Mock Hats Protocol)
    hatsProtocol = await new MockHats__factory(deployer).deploy();

    // Create Top Hat, mint to deployer
    const topHatId = topHatIdToHatId((await hatsProtocol.lastTopHatId()) + 1n);
    await hatsProtocol.mintTopHat(deployer.address, 'Details', 'imageURI');

    // Create Admin Hat
    const adminHatId = await hatsProtocol.getNextId(topHatId);
    await hatsProtocol.createHat(
      topHatId, // top hat id
      'Details', // Hat details
      1, // Max supply
      '0x0000000000000000000000000000000000004a75', // Eligibility module (none)
      '0x0000000000000000000000000000000000004a75', // Toggle module (none)
      true, // Is mutable
      'imageURI', // Image URI
    );

    // Deploy DecentAutonomousAdminHat contract
    decentAutonomousAdminInstance = await new DecentAutonomousAdminV1__factory(deployer).deploy();
    const autonomousAdminAddress = await decentAutonomousAdminInstance.getAddress();

    // Mint the admin hat to autonomous admin contract
    await hatsProtocol.mintHat(adminHatId, autonomousAdminAddress);

    // Deploy MockHatsElectionEligibility (Eligibility Module)
    hatsElectionModule = await new MockHatsElectionsEligibility__factory(deployer).deploy();

    // setup the first term
    firstTermEnd = (await time.latest()) + 100;
    await hatsElectionModule._setUp(
      ethers.AbiCoder.defaultAbiCoder().encode(['uint128'], [firstTermEnd]),
    );
    await hatsElectionModule.elect(firstTermEnd, [await firstWearer.getAddress()]);

    // Create User Hat under the admin hat
    roleHatId = await hatsProtocol.getNextId(adminHatId);
    await hatsProtocol.createHat(
      adminHatId, // Admin hat id
      'Details', // Hat details
      1, // Max supply
      await hatsElectionModule.getAddress(), // Eligibility module (election module)
      '0x0000000000000000000000000000000000004a75', // Toggle module (none)
      false, // Is mutable
      'imageURI', // Image URI
    );

    // Mint the role hat to currentWearer
    await hatsProtocol.mintHat(roleHatId, await firstWearer.getAddress());
  });

  describe('triggerStartNextTerm', function () {
    describe('when the new wearer is different from the old wearer', function () {
      beforeEach(async () => {
        // set up the next election
        nextTermEnd = firstTermEnd + 100;
        await hatsElectionModule.setNextTerm(nextTermEnd);
        await hatsElectionModule.elect(nextTermEnd, [await secondWearer.getAddress()]);
      });

      describe('before the first term is over', function () {
        it('should have correct wearers', async () => {
          expect(await hatsProtocol.isWearerOfHat(firstWearer.address, roleHatId)).to.equal(true);
          expect(await hatsProtocol.isWearerOfHat(secondWearer.address, roleHatId)).to.equal(false);
        });
      });

      describe('after the first term is over', function () {
        beforeEach(async () => {
          // Wait until the first term is over
          await time.setNextBlockTimestamp(firstTermEnd + 1);
        });

        describe('with a valid current wearer', function () {
          beforeEach(async () => {
            await decentAutonomousAdminInstance.triggerStartNextTerm({
              currentWearer: await firstWearer.getAddress(),
              nominatedWearer: secondWearer.address,
              hatsProtocol: await hatsProtocol.getAddress(),
              hatId: roleHatId,
            });
          });

          it('should have correct wearers after triggering next term', async () => {
            expect(await hatsProtocol.isWearerOfHat(firstWearer.address, roleHatId)).to.equal(
              false,
            );
            expect(await hatsProtocol.isWearerOfHat(secondWearer.address, roleHatId)).to.equal(
              true,
            );
          });
        });

        describe('with invalid current wearer', function () {
          it('should revert if the current wearer is not the wearer of the hat', async () => {
            await expect(
              decentAutonomousAdminInstance.triggerStartNextTerm({
                currentWearer: await randomUser.getAddress(),
                nominatedWearer: secondWearer.address,
                hatsProtocol: await hatsProtocol.getAddress(),
                hatId: roleHatId,
              }),
            ).to.be.revertedWithCustomError(hatsProtocol, 'AllHatsWorn');
          });
        });
      });
    });

    describe('when the new wearer is the same as the old wearer', function () {
      beforeEach(async () => {
        // set up the next election
        nextTermEnd = firstTermEnd + 100;
        await hatsElectionModule.setNextTerm(nextTermEnd);
        await hatsElectionModule.elect(nextTermEnd, [await firstWearer.getAddress()]);

        // Wait until the first term is over
        await time.setNextBlockTimestamp(firstTermEnd + 1);

        // trigger the next term
        await decentAutonomousAdminInstance.triggerStartNextTerm({
          currentWearer: await firstWearer.getAddress(),
          nominatedWearer: firstWearer.address,
          hatsProtocol: await hatsProtocol.getAddress(),
          hatId: roleHatId,
        });
      });

      it('should result in original wearer still wearing hat', async () => {
        expect(await hatsProtocol.isWearerOfHat(firstWearer.address, roleHatId)).to.equal(true);
      });
    });
  });

  describe('Version', function () {
    it('Should have a version', async function () {
      const version = await decentAutonomousAdminInstance.getVersion();
      void expect(version).to.equal(1);
    });
  });
});
