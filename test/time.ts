import hre from 'hardhat';

const advanceBlock = async () => {
  await hre.ethers.provider.send('evm_mine', []);
};

const advanceBlocks = async (blockCount: number) => {
  for (let i = 0; i < blockCount; i++) {
    await advanceBlock();
  }
};

const defaultExport = {
  advanceBlocks,
  advanceBlock,
};

export default defaultExport;
