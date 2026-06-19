import { decodeBytes32String } from "ethers";
import {
  encodePaperIdForContract,
  getReadOnlyContracts,
  getWritableContracts,
} from "./decentraScholarContracts";

export async function submitPaperOnChain({
  paperId,
  title,
  category,
  abstractCid = "",
  submissionMetadataCid = "",
}) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  if (!String(title || "").trim()) throw new Error("Paper title is required.");
  if (!String(category || "").trim()) throw new Error("Paper category is required.");

  const contracts = await getWritableContracts();
  const tx = await contracts.paperRegistry.submitPaper(
    encodedPaperId,
    String(title || "").trim(),
    String(category || "").trim(),
    String(abstractCid || "").trim(),
    String(submissionMetadataCid || "").trim()
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt, paperId: encodedPaperId };
}

export async function publishPaperOnChain({
  paperId,
  doi,
  publicationMetadataCid = "",
}) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  if (!String(doi || "").trim()) throw new Error("DOI is required.");

  const contracts = await getWritableContracts();
  const tx = await contracts.paperRegistry.publishPaper(
    encodedPaperId,
    String(doi || "").trim(),
    String(publicationMetadataCid || "").trim()
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt, paperId: encodedPaperId };
}

export async function fetchPaperOnChain(paperId) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) return null;
  const contracts = getReadOnlyContracts();
  if (!contracts?.paperRegistry) return null;

  const paper = await contracts.paperRegistry.getPaper(encodedPaperId);
  return {
    paperId: decodeContractPaperId(paper.paperId),
    author: paper.author,
    title: paper.title,
    category: paper.category,
    abstractCid: paper.abstractCid,
    submissionMetadataCid: paper.submissionMetadataCid,
    publicationMetadataCid: paper.publicationMetadataCid,
    doi: paper.doi,
    submittedAt: Number(paper.submittedAt || 0),
    publishedAt: Number(paper.publishedAt || 0),
    status: Number(paper.status || 0),
  };
}


export async function acknowledgeDecisionOnChain(paperId) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId) throw new Error("Paper ID is required.");
  const contracts = await getWritableContracts();
  const tx = await contracts.paperRegistry.acknowledgeDecision(encodedPaperId);
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

export async function hasAcknowledgedDecisionOnChain(paperId, authorAddress) {
  const encodedPaperId = encodePaperIdForContract(paperId);
  if (!encodedPaperId || !authorAddress) return false;
  const contracts = getReadOnlyContracts();
  if (!contracts?.paperRegistry) return false;
  return contracts.paperRegistry.hasAcknowledgedDecision(encodedPaperId, authorAddress);
}

function decodeContractPaperId(rawPaperId) {
  const raw = String(rawPaperId || "").trim();
  if (!raw || /^0x0{64}$/i.test(raw)) return "";
  try {
    return decodeBytes32String(raw);
  } catch {
    // Hash-derived paper ids are non-reversible. Return the raw bytes32 id in that case.
    return raw;
  }
}
