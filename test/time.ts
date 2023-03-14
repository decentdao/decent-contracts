import { ethers } from "hardhat";

const advanceBlocks = async (blockCount: number) => {
  for (let i = 0; i < blockCount; i++) {
    await advanceBlock();
  }
};

const advanceBlock = async () => {
  await ethers.provider.send("evm_mine", []);
};

const latest = async () => {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
};

const increase = async (duration: number) => {
  await increaseTo((await latest()) + duration);
};

const increaseTo = async (to: number) => {
  await ethers.provider.send("evm_setNextBlockTimestamp", [to]);
  await advanceBlock();
};

const defaultExport = {
  advanceBlocks,
  advanceBlock,
  latest,
  increase,
  increaseTo,
};

export default defaultExport;
