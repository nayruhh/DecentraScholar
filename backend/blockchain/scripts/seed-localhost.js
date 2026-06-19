import { network } from "hardhat";

const PAPER_REGISTRY = process.env.PAPER_REGISTRY_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const REVIEW_MANAGER = process.env.REVIEW_MANAGER_ADDRESS || "0x0165878A594ca255338adfa4d48449f69242Eb8F";
const DST_TREASURY = process.env.DST_TREASURY_ADDRESS || "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

const { ethers } = await network.connect("localhost");

async function main() {
  const [signer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("PaperRegistry", PAPER_REGISTRY, signer);
  const treasury = await ethers.getContractAt("DSTTreasury", DST_TREASURY, signer);
  void registry;
  void REVIEW_MANAGER;

  const treasuryBalance = await ethers.provider.getBalance(await treasury.getAddress());
  if (treasuryBalance < ethers.parseEther("25")) {
    const fundTx = await treasury.fundTreasury({ value: ethers.parseEther("100") });
    await fundTx.wait();
  }

  console.log("Localhost seed completed without sample papers.");
  console.log(`Treasury liquidity: ${ethers.formatEther(await ethers.provider.getBalance(await treasury.getAddress()))} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
