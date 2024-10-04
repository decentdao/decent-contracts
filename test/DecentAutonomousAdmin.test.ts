import { ModuleProxyFactory } from "../typechain-types/@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory"
import {
  DecentAutonomousAdmin,
  DecentAutonomousAdmin__factory,
  MockHatsAutoAdmin,
  MockHatsAutoAdmin__factory,
  MockHatsElectionEligibility,
  MockHatsElectionEligibility__factory,
  ModuleProxyFactory__factory,
} from "../typechain-types"
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers"
import { expect } from "chai"
import hre from "hardhat"

describe("DecentAutonomousAdminHat", function () {
  // Signer accounts
  let deployer: SignerWithAddress
  let currentWearer: SignerWithAddress
  let randomUser: SignerWithAddress
  let nominatedWearer: SignerWithAddress

  // Contract instances
  let hatsProtocol: MockHatsAutoAdmin
  let hatsElectionModule: MockHatsElectionEligibility
  let adminHat: DecentAutonomousAdmin
  let adminHatMasterCopy: DecentAutonomousAdmin
  let moduleProxyFactory: ModuleProxyFactory

  // Variables
  let userHatId: bigint

  beforeEach(async function () {
    // Get signers
    ;[deployer, currentWearer, nominatedWearer, randomUser] = await hre.ethers.getSigners()

    moduleProxyFactory = await new ModuleProxyFactory__factory(deployer).deploy()
    // Deploy MockHatsAutoAdmin (Mock Hats Protocol)
    hatsProtocol = await new MockHatsAutoAdmin__factory(deployer).deploy()

    // Deploy MockHatsElectionEligibility (Eligibility Module)
    hatsElectionModule = await new MockHatsElectionEligibility__factory(deployer).deploy()

    // Create Admin Hat
    const createAdminTx = await hatsProtocol.createHat(
      await hatsProtocol.getAddress(), // Admin address (self-administered)
      "Details", // Hat details
      100, // Max supply
      hre.ethers.ZeroAddress, // Eligibility module (none)
      hre.ethers.ZeroAddress, // Toggle module (none)
      true, // Is mutable
      "imageURI" // Image URI
    )
    const createAdminTxReceipt = await createAdminTx.wait()
    const adminHatId = createAdminTxReceipt?.toJSON().logs[0].args[0]

    // Deploy DecentAutonomousAdminHat contract with the admin hat ID
    adminHat = await new DecentAutonomousAdmin__factory(deployer).deploy("TEST", adminHatId)
    const adminHatAddress = await adminHat.getAddress()
    // Mint the admin hat to adminHatWearer
    await hatsProtocol.mintHat(adminHatId, adminHatAddress)

    // Create User Hat under the admin hat
    const createUserTx = await hatsProtocol.createHat(
      adminHatAddress, // Admin address (adminHat contract)
      "Details", // Hat details
      100, // Max supply
      await hatsElectionModule.getAddress(), // Eligibility module (election module)
      hre.ethers.ZeroAddress, // Toggle module (none)
      false, // Is mutable
      "imageURI" // Image URI
    )

    const createUserTxReceipt = await createUserTx.wait()
    userHatId = createUserTxReceipt?.toJSON().logs[0].args[0]

    // Mint the user hat to currentWearer
    await hatsProtocol.mintHat(userHatId, await currentWearer.getAddress())
  })

  describe("triggerStartNextTerm", function () {
    it("should correctly validate current wearer and transfer", async function () {
      const args = {
        currentWearer: currentWearer.address,
        userHatProtocol: await hatsProtocol.getAddress(),
        userHatId: userHatId,
        nominatedWearer: nominatedWearer.address,
        sablierStreamInfo: [], // No Sablier stream info for this test
      }

      // Call triggerStartNextTerm on the adminHat contract
      await adminHat.triggerStartNextTerm(args)

      // Verify the hat is now worn by the nominated wearer
      expect(await hatsProtocol.isWearerOfHat(nominatedWearer.address, userHatId)).to.be.true
    })
    it("should correctly invalidate random address as current wearer", async function () {
      const args = {
        currentWearer: randomUser.address,
        userHatProtocol: await hatsProtocol.getAddress(),
        userHatId: userHatId,
        nominatedWearer: nominatedWearer.address,
        sablierStreamInfo: [], // No Sablier stream info for this test
      }

      // Verify the hat is now worn by the current wearer
      await expect(adminHat.connect(randomUser).triggerStartNextTerm(args)).to.be.revertedWith(
        "Not current wearer"
      )
    })
  })
})
