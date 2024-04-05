import { Contract, utils, BigNumber, Signer, ethers } from "ethers";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { AddressZero } from "@ethersproject/constants";
import {
  GnosisSafeProxyFactory,
  IAzorius,
  MockContract__factory,
} from "../typechain-types";
import { getMockContract } from "./GlobalSafeDeployments.test";

export interface MetaTransaction {
  to: string;
  value: string | number | BigNumber;
  data: string;
  operation: number;
}

export interface SafeTransaction extends MetaTransaction {
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: string;
  refundReceiver: string;
  nonce: string | BigNumber;
}

export interface SafeSignature {
  signer: string;
  data: string;
}

export const predictGnosisSafeAddress = async (
  calldata: string,
  saltNum: string | BigNumber,
  singleton: string,
  gnosisFactory: GnosisSafeProxyFactory
): Promise<string> => {
  return ethers.utils.getCreate2Address(
    gnosisFactory.address,
    ethers.utils.solidityKeccak256(
      ["bytes", "uint256"],
      [ethers.utils.solidityKeccak256(["bytes"], [calldata]), saltNum]
    ),
    ethers.utils.solidityKeccak256(
      ["bytes", "uint256"],
      [await gnosisFactory.proxyCreationCode(), singleton]
    )
  );
};

export const calculateProxyAddress = (
  factory: Contract,
  masterCopy: string,
  initData: string,
  saltNonce: string
): string => {
  const masterCopyAddress = masterCopy.toLowerCase().replace(/^0x/, "");
  const byteCode =
    "0x602d8060093d393df3363d3d373d3d3d363d73" +
    masterCopyAddress +
    "5af43d82803e903d91602b57fd5bf3";

  const salt = ethers.utils.solidityKeccak256(
    ["bytes32", "uint256"],
    [ethers.utils.solidityKeccak256(["bytes"], [initData]), saltNonce]
  );

  return ethers.utils.getCreate2Address(
    factory.address,
    salt,
    ethers.utils.keccak256(byteCode)
  );
};

export const safeSignTypedData = async (
  signer: Signer & TypedDataSigner,
  safe: Contract,
  safeTx: SafeTransaction
): Promise<SafeSignature> => {
  if (!signer.provider) {
    throw Error("Provider required to retrieve chainId");
  }
  const cid = (await signer.provider.getNetwork()).chainId;
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data: await signer._signTypedData(
      { verifyingContract: safe.address, chainId: cid },
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
  signatures.sort((left, right) =>
    left.signer.toLowerCase().localeCompare(right.signer.toLowerCase())
  );
  let signatureBytes = "0x";
  for (const sig of signatures) {
    signatureBytes += sig.data.slice(2);
  }
  return signatureBytes;
};

export const buildContractCall = (
  contract: Contract,
  method: string,
  params: any[],
  nonce: number,
  delegateCall?: boolean,
  overrides?: Partial<SafeTransaction>
): SafeTransaction => {
  const data = contract.interface.encodeFunctionData(method, params);
  return buildSafeTransaction(
    Object.assign(
      {
        to: contract.address,
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
  value?: BigNumber | number | string;
  data?: string;
  operation?: number;
  safeTxGas?: number | string;
  baseGas?: number | string;
  gasPrice?: number | string;
  gasToken?: string;
  refundReceiver?: string;
  nonce: BigNumber;
}): SafeTransaction => {
  return {
    to: template.to,
    value: template.value || 0,
    data: template.data || "0x",
    operation: template.operation || 0,
    safeTxGas: template.safeTxGas || 0,
    baseGas: template.baseGas || 0,
    gasPrice: template.gasPrice || 0,
    gasToken: template.gasToken || AddressZero,
    refundReceiver: template.refundReceiver || AddressZero,
    nonce: template.nonce,
  };
};

export const encodeMultiSend = (txs: MetaTransaction[]): string => {
  return (
    "0x" +
    txs
      .map((tx) => {
        const data = utils.arrayify(tx.data);
        const encoded = utils.solidityPack(
          ["uint8", "address", "uint256", "uint256", "bytes"],
          [tx.operation, tx.to, tx.value, data.length, data]
        );
        return encoded.slice(2);
      })
      .join("")
  );
};

export const mockTransaction = (): IAzorius.TransactionStruct => {
  return {
    to: getMockContract().address,
    value: BigNumber.from(0),
    // eslint-disable-next-line camelcase
    data: MockContract__factory.createInterface().encodeFunctionData(
      "doSomething"
    ),
    operation: 0,
  };
};

export const mockRevertTransaction = (): IAzorius.TransactionStruct => {
  return {
    to: getMockContract().address,
    value: BigNumber.from(0),
    // eslint-disable-next-line camelcase
    data: MockContract__factory.createInterface().encodeFunctionData(
      "revertSomething"
    ),
    operation: 0,
  };
};
