import {
  Contract,
  Wallet,
  utils,
  BigNumber,
  BigNumberish,
  Signer,
  PopulatedTransaction,
  ethers,
} from "ethers";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { AddressZero } from "@ethersproject/constants";
import { Interface } from "ethers/lib/utils";

export const predictGnosisSafeAddress = async (
  factory: string,
  calldata: string,
  saltNum: string | BigNumber,
  singleton: string,
  gnosisFactory: Contract
): Promise<string> => {
  return ethers.utils.getCreate2Address(
    factory,
    ethers.utils.solidityKeccak256(
      ["bytes", "uint256"],
      [ethers.utils.solidityKeccak256(["bytes"], [calldata]), saltNum]
    ),
    ethers.utils.solidityKeccak256(
      ["bytes", "uint256"],
      [
        // eslint-disable-next-line camelcase
        await gnosisFactory.proxyCreationCode(),
        singleton,
      ]
    )
  );
};

export const predictGnosisSafeCallbackAddress = async (
  factory: string,
  calldata: string,
  saltNum: string | BigNumber,
  callback: string,
  singleton: string,
  gnosisFactory: Contract
): Promise<string> => {
  return ethers.utils.getCreate2Address(
    factory,
    ethers.utils.solidityKeccak256(
      ["bytes", "bytes"],
      [
        ethers.utils.solidityKeccak256(["bytes"], [calldata]),
        ethers.utils.solidityKeccak256(
          ["uint256", "address"],
          [saltNum, callback]
        ),
      ]
    ),
    ethers.utils.solidityKeccak256(
      ["bytes", "uint256"],
      [
        // eslint-disable-next-line camelcase
        await gnosisFactory.proxyCreationCode(),
        singleton,
      ]
    )
  );
};

export const calculateProxyAddress = (
  factory: Contract,
  masterCopy: string,
  initData: string,
  saltNonce: string
) => {
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

export const EIP_DOMAIN = {
  EIP712Domain: [
    { type: "uint256", name: "chainId" },
    { type: "address", name: "verifyingContract" },
  ],
};

export const EIP712_SAFE_TX_TYPE = {
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
};

export const EIP712_SAFE_MESSAGE_TYPE = {
  // "SafeMessage(bytes message)"
  SafeMessage: [{ type: "bytes", name: "message" }],
};

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
  nonce: string | number;
}

export interface SafeSignature {
  signer: string;
  data: string;
}

export const iface = new Interface([
  "function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) returns (GnosisSafeProxy proxy)",
  "function createProxyWithCallback(address _singleton,bytes memory initializer,uint256 saltNonce,address callback) public returns (address proxy)",
]);

export const ifaceSafe = new Interface([
  "event RemovedOwner(address owner)",
  "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)",
  "function execTransaction(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes memory signatures) public payable returns (bool success)",
  "function setGuard(address guard) external",
  "function addOwnerWithThreshold(address owner, uint256 _threshold) external",
  "function swapOwner(address prevOwner,address oldOwner,address newOwner) external",
  "function changeThreshold(uint256 _threshold) external",
  "function removeOwner(address prevOwner,address owner,uint256 _threshold) external",
  "function isOwner(address owner) public view returns (bool)",
  "function enableModule(address module) public",
  "function nonce() public view returns (uint256)",
]);

export const ifaceMultiSend = new Interface([
  "function multiSend(bytes memory transactions) public payable",
]);

export const ifaceFactory = new Interface([
  "function deployModule(address masterCopy,bytes memory initializer,uint256 saltNonce) public returns (address proxy)",
  "event ModuleProxyCreation(address indexed proxy,address indexed masterCopy)",
]);

export const usuliface = new Interface([
  "function setUp(bytes memory initParams) public",
]);

export const abi = [
  "event ProxyCreation(address proxy, address singleton)",
  "function createProxy(address singleton, bytes memory data) public returns (address proxy)",
  "function proxyRuntimeCode() public pure returns (bytes memory)",
  "function proxyCreationCode() public pure returns (bytes memory)",
  "function createProxyWithNonce(address _singleton,bytes memory initializer,uint256 saltNonce) returns (address proxy)",
  "function createProxyWithCallback(address _singleton,bytes memory initializer,uint256 saltNonce,address callback) public returns (address proxy)",
  "function calculateCreateProxyWithNonceAddress(address _singleton,bytes calldata initializer,uint256 saltNonce) external returns (address proxy)",
];

export const multisendABI = [
  "function multiSend(bytes memory transactions) public payable",
];

export const abiSafe = [
  "event ExecutionSuccess(bytes32 txHash, uint256 payment)",
  "event ChangedGuard(address guard)",
  "event RemovedOwner(address owner)",
  "event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)",
  "event EnabledModule(address module)",
  "event ExecutionFromModuleSuccess(address indexed module)",
  "event ExecutionFromModuleFailure(address indexed module)",
  "function getOwners() public view returns (address[] memory)",
  "function nonce() public view returns (uint256)",
  "function isOwner(address owner) public view returns (bool)",
  "function getThreshold() public view returns (uint256)",
  "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)",
  "function execTransaction(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes memory signatures) public payable returns (bool success)",
  "function getTransactionHash(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) public view returns (bytes32)",
  "function setGuard(address guard) external",
  "function enableModule(address module) public",
  "function removeOwner(address prevOwner,address owner,uint256 _threshold) external",
  "function isModuleEnabled(address module) public view returns (bool)",
];

export const abiFactory = [
  "event ModuleProxyCreation(address indexed proxy,address indexed masterCopy)",
  "function deployModule(address masterCopy,bytes memory initializer,uint256 saltNonce) public returns (address proxy)",
];

export const abiUsul = [
  "function owner() public view returns (address)",
  "function avatar() public view returns (address)",
  "function target() public view returns (address)",
];

export const calculateSafeDomainSeparator = (
  safe: Contract,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.hashDomain({
    verifyingContract: safe.address,
    chainId,
  });
};

export const preimageSafeTransactionHash = (
  safe: Contract,
  safeTx: SafeTransaction,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.encode(
    { verifyingContract: safe.address, chainId },
    EIP712_SAFE_TX_TYPE,
    safeTx
  );
};

export const calculateSafeTransactionHash = (
  safe: Contract,
  safeTx: SafeTransaction,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.hash(
    { verifyingContract: safe.address, chainId },
    EIP712_SAFE_TX_TYPE,
    safeTx
  );
};

export const calculateSafeMessageHash = (
  safe: Contract,
  message: string,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.hash(
    { verifyingContract: safe.address, chainId },
    EIP712_SAFE_MESSAGE_TYPE,
    { message }
  );
};

export const safeApproveHash = async (
  signer: Signer,
  safe: Contract,
  safeTx: SafeTransaction,
  skipOnChainApproval?: boolean
): Promise<SafeSignature> => {
  if (!skipOnChainApproval) {
    if (!signer.provider)
      throw Error("Provider required for on-chain approval");
    const chainId = (await signer.provider.getNetwork()).chainId;
    const typedDataHash = utils.arrayify(
      calculateSafeTransactionHash(safe, safeTx, chainId)
    );
    const signerSafe = safe.connect(signer);
    await signerSafe.approveHash(typedDataHash);
  }
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data:
      "0x000000000000000000000000" +
      signerAddress.slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01",
  };
};

export const safeSignTypedData = async (
  signer: Signer & TypedDataSigner,
  safe: Contract,
  safeTx: SafeTransaction,
  chainId?: BigNumberish
): Promise<SafeSignature> => {
  if (!chainId && !signer.provider)
    throw Error("Provider required to retrieve chainId");
  const cid = chainId || (await signer.provider!.getNetwork()).chainId;
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data: await signer._signTypedData(
      { verifyingContract: safe.address, chainId: cid },
      EIP712_SAFE_TX_TYPE,
      safeTx
    ),
  };
};

export const signHash = async (
  signer: Signer,
  hash: string
): Promise<SafeSignature> => {
  const typedDataHash = utils.arrayify(hash);
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data: (await signer.signMessage(typedDataHash))
      .replace(/1b$/, "1f")
      .replace(/1c$/, "20"),
  };
};

export const safeSignMessage = async (
  signer: Signer,
  safe: Contract,
  safeTx: SafeTransaction,
  chainId?: BigNumberish
): Promise<SafeSignature> => {
  const cid = chainId || (await signer.provider!.getNetwork()).chainId;
  return signHash(signer, calculateSafeTransactionHash(safe, safeTx, cid));
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

export const logGas = async (
  message: string,
  tx: Promise<any>,
  skip?: boolean
): Promise<any> => {
  return tx.then(async (result) => {
    const receipt = await result.wait();
    if (!skip)
      console.log(
        "           Used",
        receipt.gasUsed.toNumber(),
        `gas for >${message}<`
      );
    return result;
  });
};

export const executeTx = async (
  safe: Contract,
  safeTx: SafeTransaction,
  signatures: SafeSignature[],
  overrides?: any
): Promise<any> => {
  const signatureBytes = buildSignatureBytes(signatures);
  return safe.execTransaction(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    signatureBytes,
    overrides || {}
  );
};

export const populateExecuteTx = async (
  safe: Contract,
  safeTx: SafeTransaction,
  signatures: SafeSignature[],
  overrides?: any
): Promise<PopulatedTransaction> => {
  const signatureBytes = buildSignatureBytes(signatures);
  return safe.populateTransaction.execTransaction(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    signatureBytes,
    overrides || {}
  );
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

export const executeTxWithSigners = async (
  safe: Contract,
  tx: SafeTransaction,
  signers: Wallet[],
  overrides?: any
) => {
  const sigs = await Promise.all(
    signers.map((signer) => safeSignTypedData(signer, safe, tx))
  );
  return executeTx(safe, tx, sigs, overrides);
};

export const executeContractCallWithSigners = async (
  safe: Contract,
  contract: Contract,
  method: string,
  params: any[],
  signers: Wallet[],
  delegateCall?: boolean,
  overrides?: Partial<SafeTransaction>
) => {
  const tx = buildContractCall(
    contract,
    method,
    params,
    await safe.nonce(),
    delegateCall,
    overrides
  );
  return executeTxWithSigners(safe, tx, signers);
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
  nonce: number;
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

const encodeMetaTransaction = (tx: MetaTransaction): string => {
  const data = utils.arrayify(tx.data);
  const encoded = utils.solidityPack(
    ["uint8", "address", "uint256", "uint256", "bytes"],
    [tx.operation, tx.to, tx.value, data.length, data]
  );
  return encoded.slice(2);
};

export const encodeMultiSend = (txs: MetaTransaction[]): string => {
  return "0x" + txs.map((tx) => encodeMetaTransaction(tx)).join("");
};

export const buildMultiSendSafeTx = (
  multiSend: Contract,
  txs: MetaTransaction[],
  nonce: number,
  overrides?: Partial<SafeTransaction>
): SafeTransaction => {
  return buildContractCall(
    multiSend,
    "multiSend",
    [encodeMultiSend(txs)],
    nonce,
    true,
    overrides
  );
};
