import { utils, BigNumber } from "ethers";

const getInterfaceSelector = (iface: utils.Interface): string => {
  return Object.keys(iface.functions)
    .reduce(
      (p, c) => p.xor(BigNumber.from(iface.getSighash(iface.functions[c]))),
      BigNumber.from(0)
    )
    .toHexString();
};

export default getInterfaceSelector;
