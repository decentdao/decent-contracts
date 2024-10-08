import { ethers, solidityPackedKeccak256 } from "ethers";
import {
  ERC6551Registry,
  GnosisSafeL2,
  GnosisSafeProxyFactory,
  IAzorius,
  MockContract__factory,
  MockHatsAccount__factory,
} from "../typechain-types";
import { getMockContract } from "./GlobalSafeDeployments.test";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import hre from "hardhat";

export interface MetaTransaction {
  to: string;
  value: string | number | bigint;
  data: string;
  operation: number;
}

export interface SafeTransaction extends MetaTransaction {
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: string;
  refundReceiver: string;
  nonce: string | bigint;
}

export interface SafeSignature {
  signer: string;
  data: string;
}

export const predictGnosisSafeAddress = async (
  calldata: string,
  saltNum: string | bigint,
  singleton: string,
  gnosisFactory: GnosisSafeProxyFactory
): Promise<string> => {
  return ethers.getCreate2Address(
    await gnosisFactory.getAddress(),
    ethers.solidityPackedKeccak256(
      ["bytes", "uint256"],
      [ethers.solidityPackedKeccak256(["bytes"], [calldata]), saltNum]
    ),
    ethers.solidityPackedKeccak256(["bytes", "uint256"], [await gnosisFactory.proxyCreationCode(), singleton])
  );
};

export const calculateProxyAddress = async (
  factory: ethers.BaseContract,
  masterCopy: string,
  initData: string,
  saltNonce: string
): Promise<string> => {
  const masterCopyAddress = masterCopy.toLowerCase().replace(/^0x/, "");
  const byteCode = "0x602d8060093d393df3363d3d373d3d3d363d73" + masterCopyAddress + "5af43d82803e903d91602b57fd5bf3";

  const salt = ethers.solidityPackedKeccak256(
    ["bytes32", "uint256"],
    [ethers.solidityPackedKeccak256(["bytes"], [initData]), saltNonce]
  );

  return ethers.getCreate2Address(await factory.getAddress(), salt, ethers.keccak256(byteCode));
};

export const safeSignTypedData = async (
  signer: ethers.Signer,
  safe: ethers.BaseContract,
  safeTx: SafeTransaction
): Promise<SafeSignature> => {
  if (!signer.provider) {
    throw Error("Provider required to retrieve chainId");
  }
  const cid = (await signer.provider.getNetwork()).chainId;
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data: await signer.signTypedData(
      { verifyingContract: await safe.getAddress(), chainId: cid },
      {
        // "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
        SafeTx: [
          { type: "address", name: "to" },
          { type: "uint256", name: "value" },
          { type: "bytes", name: "data" },
          { type: "uint8", name: "operation" },
          { type: "uint256", name: "safeTxGas" },
          { type: "uint256", name: "baseGas" },
          { type: "uint256", name: "gasPrice" },
          { type: "address", name: "gasToken" },
          { type: "address", name: "refundReceiver" },
          { type: "uint256", name: "nonce" },
        ],
      },
      safeTx
    ),
  };
};

export const buildSignatureBytes = (signatures: SafeSignature[]): string => {
  signatures.sort((left, right) => left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()));
  let signatureBytes = "0x";
  for (const sig of signatures) {
    signatureBytes += sig.data.slice(2);
  }
  return signatureBytes;
};

export const buildContractCall = async (
  contract: ethers.BaseContract,
  method: string,
  params: any[],
  nonce: number,
  delegateCall?: boolean,
  overrides?: Partial<SafeTransaction>
): Promise<SafeTransaction> => {
  const data = contract.interface.encodeFunctionData(method, params);
  return buildSafeTransaction(
    Object.assign(
      {
        to: await contract.getAddress(),
        data,
        operation: delegateCall ? 1 : 0,
        nonce,
      },
      overrides
    )
  );
};

export const buildSafeTransaction = (template: {
  to: string;
  value?: bigint | number | string;
  data?: string;
  operation?: number;
  safeTxGas?: number | string;
  baseGas?: number | string;
  gasPrice?: number | string;
  gasToken?: string;
  refundReceiver?: string;
  nonce: bigint;
}): SafeTransaction => {
  return {
    to: template.to,
    value: template.value || 0,
    data: template.data || "0x",
    operation: template.operation || 0,
    safeTxGas: template.safeTxGas || 0,
    baseGas: template.baseGas || 0,
    gasPrice: template.gasPrice || 0,
    gasToken: template.gasToken || ethers.ZeroAddress,
    refundReceiver: template.refundReceiver || ethers.ZeroAddress,
    nonce: template.nonce,
  };
};

export const encodeMultiSend = (txs: MetaTransaction[]): string => {
  return (
    "0x" +
    txs
      .map((tx) => {
        const data = ethers.getBytes(tx.data);
        const encoded = ethers.solidityPacked(
          ["uint8", "address", "uint256", "uint256", "bytes"],
          [tx.operation, tx.to, tx.value, data.length, data]
        );
        return encoded.slice(2);
      })
      .join("")
  );
};

export const mockTransaction = async (): Promise<IAzorius.TransactionStruct> => {
  return {
    to: await getMockContract().getAddress(),
    value: 0n,
    // eslint-disable-next-line camelcase
    data: MockContract__factory.createInterface().encodeFunctionData("doSomething"),
    operation: 0,
  };
};

export const mockRevertTransaction = async (): Promise<IAzorius.TransactionStruct> => {
  return {
    to: await getMockContract().getAddress(),
    value: 0n,
    // eslint-disable-next-line camelcase
    data: MockContract__factory.createInterface().encodeFunctionData("revertSomething"),
    operation: 0,
  };
};

export const executeSafeTransaction = async ({
  safe,
  to,
  transactionData,
  signers,
}: {
  safe: GnosisSafeL2;
  to: string;
  transactionData: string;
  signers: SignerWithAddress[];
}) => {
  const safeTx = buildSafeTransaction({
    to,
    data: transactionData,
    nonce: await safe.nonce(),
  });
  console.log("safeIx");

  const sigs = await Promise.all(signers.map(async (signer) => await safeSignTypedData(signer, safe, safeTx)));

  const tx = await safe.execTransaction(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    buildSignatureBytes(sigs)
  );

  console.log("done?");

  return tx;
};

export const getHatAccount = async (
  hatId: bigint,
  erc6551RegistryImplementation: ERC6551Registry,
  mockHatsAccountImplementationAddress: string,
  mockHatsAddress: string,
  decentHatsAddress: string
) => {
  const salt = solidityPackedKeccak256(
    ["string", "uint256", "address"],
    ["DecentHats_0_1_0", await hre.getChainId(), decentHatsAddress]
  );

  const hatAccountAddress = await erc6551RegistryImplementation.account(
    mockHatsAccountImplementationAddress,
    salt,
    await hre.getChainId(),
    mockHatsAddress,
    hatId
  );

  const hatAccount = MockHatsAccount__factory.connect(hatAccountAddress, hre.ethers.provider);

  return hatAccount;
};
