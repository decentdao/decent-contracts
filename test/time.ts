import { ethers } from "hardhat";

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

const duration = {
  seconds: function (val: number) {
    return val;
  },
  minutes: function (val: number) {
    return val * this.seconds(60);
  },
  hours: function (val: number) {
    return val * this.minutes(60);
  },
  days: function (val: number) {
    return val * this.hours(24);
  },
  weeks: function (val: number) {
    return val * this.days(7);
  },
  years: function (val: number) {
    return val * this.days(365);
  },
};

const defaultExport = {
  advanceBlock,
  latest,
  increase,
  increaseTo,
  duration,
};

export default defaultExport;
