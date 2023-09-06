import { ethers, network } from "hardhat";
import {
  multisendABI,
  SAFE_FACTORY_ADDRESS,
  abi,
  abiFactory,
  ifaceSafe,
  predictGnosisSafeAddress,
  SAFE_SINGLETON_ADDRESS,
  abiSafe,
  MetaTransaction,
  buildContractCall,
  encodeMultiSend,
  calculateProxyAddress,
} from "./helpers";
import { BigNumber, Contract } from "ethers";
import {
  MockERC20,
  MockERC20__factory,
  Payroll,
  Payroll__factory,
} from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export const SALT_NUM = BigNumber.from(
  "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
);

export async function forkGoerli(): Promise<void> {
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.GOERLI_PROVIDER
            ? process.env.GOERLI_PROVIDER
            : "",
        },
      },
    ],
  });
}

export async function deploySafeAndPayroll(): Promise<{
  owner: SignerWithAddress;
  safe: Contract;
  payroll: Payroll;
  token: MockERC20;
}> {
  const [deployer, owner] = await ethers.getSigners();

  const multiSend = new ethers.Contract(
    "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
    multisendABI,
    owner
  );
  const gnosisFactory = new ethers.Contract(
    SAFE_FACTORY_ADDRESS,
    abi,
    deployer
  );

  const createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
    [owner.address, multiSend.address],
    1,
    ethers.constants.AddressZero,
    ethers.constants.HashZero,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    0,
    ethers.constants.AddressZero,
  ]);
  const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
    gnosisFactory.address,
    createGnosisSetupCalldata,
    SALT_NUM,
    SAFE_SINGLETON_ADDRESS,
    gnosisFactory
  );

  const safe = new ethers.Contract(
    predictedGnosisSafeAddress,
    abiSafe,
    deployer
  );

  const moduleFactory = new ethers.Contract(
    "0x00000000000DC7F163742Eb4aBEf650037b1f588",
    abiFactory,
    deployer
  );

  const token = await new MockERC20__factory(deployer).deploy();

  const setModuleCalldata =
    // eslint-disable-next-line camelcase
    Payroll__factory.createInterface().encodeFunctionData("setUp", [
      new ethers.utils.AbiCoder().encode(
        ["address", "address", "address", "address"],
        [owner.address, safe.address, safe.address, token.address]
      ),
    ]);

  let payroll = await new Payroll__factory(deployer).deploy();
  const predictedPayroll = calculateProxyAddress(
    moduleFactory,
    payroll.address,
    setModuleCalldata,
    "10031021"
  );
  payroll = await ethers.getContractAt("Payroll", predictedPayroll);

  const txs: MetaTransaction[] = [
    buildContractCall(
      gnosisFactory,
      "createProxyWithNonce",
      [SAFE_SINGLETON_ADDRESS, createGnosisSetupCalldata, SALT_NUM],
      0,
      false
    ),
    buildContractCall(
      moduleFactory,
      "deployModule",
      [payroll.address, setModuleCalldata, "10031021"],
      0,
      false
    ),
  ];

  await multiSend.multiSend(encodeMultiSend(txs));

  return { owner, safe, payroll, token };
}
