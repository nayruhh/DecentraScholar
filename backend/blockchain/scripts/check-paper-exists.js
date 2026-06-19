import { network } from "hardhat";

const PAPER_REGISTRY =
  process.env.PAPER_REGISTRY_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PAPER_ID = process.env.PAPER_ID || "P001";

const { ethers } = await network.connect("localhost");

async function main() {
  const [signer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("PaperRegistry", PAPER_REGISTRY, signer);
  const encodedPaperId = ethers.encodeBytes32String(PAPER_ID);
  const exists = await registry.paperExists(encodedPaperId);
  console.log(
    JSON.stringify(
      {
        paperId: PAPER_ID,
        exists,
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
