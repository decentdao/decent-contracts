"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const getInterfaceSelector = (iface) => {
    return Object.keys(iface.functions)
        .reduce((p, c) => p.xor(ethers_1.BigNumber.from(iface.getSighash(iface.functions[c]))), ethers_1.BigNumber.from(0))
        .toHexString();
};
exports.default = getInterfaceSelector;
