import { network } from "hardhat";

const DST_TREASURY =
  process.env.DST_TREASURY_ADDRESS || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

const { ethers } = await network.connect("localhost");

async function main() {
  const [signer] = await ethers.getSigners();
  const treasury = await ethers.getContractAt("DSTTreasury", DST_TREASURY, signer);
  const tokenAmount = ethers.parseUnits("25", 18);
  const weiPerToken = await treasury.weiPerToken();
  const ethCost = await treasury.getEthCost(tokenAmount);
  console.log(
    JSON.stringify(
      {
        treasury: DST_TREASURY,
        weiPerToken: weiPerToken.toString(),
        tokenAmount: tokenAmount.toString(),
        ethCostWei: ethCost.toString(),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
