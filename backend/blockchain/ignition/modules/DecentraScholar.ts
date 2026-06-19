import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DecentraScholarModule", (m) => {
  const owner = m.getAccount(0);
  const weiPerDst = m.getParameter("weiPerDst", 1_000_000_000_000_000n);

  const dstToken = m.contract("DSTToken", [owner]);
  const dstProtocolVault = m.contract("DSTProtocolVault", [owner, dstToken]);
  const registry = m.contract("PaperRegistry", [owner]);
  const reviewManager = m.contract("ReviewManager", [owner, registry]);
  const reviewerReputation = m.contract("ReviewerReputation", [owner]);
  const interactions = m.contract("ReaderInteractions", [owner, registry]);
  const dstTreasury = m.contract("DSTTreasury", [owner, dstToken, weiPerDst]);

  m.call(registry, "setReviewManager", [reviewManager]);
  m.call(dstToken, "setMinter", [dstTreasury, true]);
  m.call(dstProtocolVault, "setCoordinator", [owner, true]);
  m.call(reviewerReputation, "setCoordinator", [owner, true]);
  m.call(reviewManager, "setCoordinator", [owner, true]);

  return { dstToken, dstProtocolVault, dstTreasury, registry, reviewManager, reviewerReputation, interactions };
});
