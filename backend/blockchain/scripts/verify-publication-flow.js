import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const PAPER_REGISTRY =
  process.env.PAPER_REGISTRY_ADDRESS || "0x59b670e9fA9D0A427751Af201D676719a970857b";
const REVIEW_MANAGER =
  process.env.REVIEW_MANAGER_ADDRESS || "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
const ARTIFACT_API_PORT = Number(process.env.ARTIFACT_API_PORT || 3002);
const ARTIFACT_API_BASE_URL =
  process.env.ARTIFACT_API_BASE_URL || `http://127.0.0.1:${ARTIFACT_API_PORT}`;
const MANAGE_ARTIFACT_API = process.env.MANAGE_ARTIFACT_API !== "false";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactApiCwd = path.resolve(__dirname, "../../api");

const { ethers } = await network.connect("localhost");

function buildPaperId() {
  const suffix = Date.now().toString().slice(-6);
  return `T${suffix}`;
}

function buildPdfBase64() {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 36 96 Td (DecentraScholar test PDF) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000208 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF`;
  return Buffer.from(pdf, "utf8").toString("base64");
}

async function createSubmissionArtifacts(paperId, authorWallet) {
  const reviewDeadline = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(`${ARTIFACT_API_BASE_URL}/api/ipfs/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      authorWallet,
      title: "CID Verification Flow for DecentralScholar",
      category: "Computer Science",
      abstract:
        "Integration test paper used to verify submission artifact CIDs and publication CID persistence on-chain.",
      fileName: "cid-verification-flow.pdf",
      mimeType: "application/pdf",
      fileContentBase64: buildPdfBase64(),
      reviewDeadline,
      keywords: ["ipfs", "publication", "verification"],
      collaborators: [],
      aiGeneratedDisclosure: { used: false, details: "" },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Submission artifact creation failed.");
  }
  return payload;
}

async function createPublicationArtifacts(paperId, submissionMetadataCid) {
  const response = await fetch(`${ARTIFACT_API_BASE_URL}/api/ipfs/publications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      doi: `10.5555/fyp.2026.${paperId.toLowerCase()}`,
      submissionMetadataCid,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Publication artifact creation failed.");
  }
  return payload;
}

async function waitForArtifactApi() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    try {
      const response = await fetch(`${ARTIFACT_API_BASE_URL}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Artifact API did not become healthy at ${ARTIFACT_API_BASE_URL}.`);
}

async function main() {
  let artifactApi = null;
  let artifactApiLogs = "";

  if (MANAGE_ARTIFACT_API) {
    artifactApi = spawn(process.execPath, ["server.js"], {
      cwd: artifactApiCwd,
      env: {
        ...process.env,
        PORT: String(ARTIFACT_API_PORT),
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    artifactApi.stdout.on("data", (chunk) => {
      artifactApiLogs += chunk.toString();
    });
    artifactApi.stderr.on("data", (chunk) => {
      artifactApiLogs += chunk.toString();
    });
  }

  try {
    await waitForArtifactApi();

  const [author, reviewerA, reviewerB, reviewerC] = await ethers.getSigners();
  const registry = await ethers.getContractAt("PaperRegistry", PAPER_REGISTRY, author);
  const reviewManager = await ethers.getContractAt("ReviewManager", REVIEW_MANAGER, author);

  const paperIdText = buildPaperId();
  const paperId = ethers.encodeBytes32String(paperIdText);

  const submissionArtifacts = await createSubmissionArtifacts(paperIdText, author.address);

  const submitTx = await registry.submitPaper(
    paperId,
    "CID Verification Flow for DecentraScholar",
    "Computer Science",
    submissionArtifacts.abstractCid,
    submissionArtifacts.submissionMetadataCid
  );
  await submitTx.wait();

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
  const createSessionTx = await reviewManager.createSession(
    paperId,
    [reviewerA.address, reviewerB.address, reviewerC.address],
    [true, true, true],
    deadline,
    1
  );
  await createSessionTx.wait();

  const nextSessionId = await reviewManager.nextSessionId();
  const sessionId = nextSessionId - 1n;

  await (await reviewManager.connect(reviewerA).submitReview(sessionId, 1, ethers.id(`${paperIdText}-review-a`))).wait();
  await (await reviewManager.connect(reviewerB).submitReview(sessionId, 1, ethers.id(`${paperIdText}-review-b`))).wait();
  await (await reviewManager.connect(reviewerC).submitReview(sessionId, 1, ethers.id(`${paperIdText}-review-c`))).wait();

  await (
    await reviewManager.finalizeSession(
      sessionId,
      1,
      ethers.encodeBytes32String("accepted")
    )
  ).wait();

  const publicationArtifacts = await createPublicationArtifacts(
    paperIdText,
    submissionArtifacts.submissionMetadataCid
  );

  const acceptedSession = await reviewManager.getSession(sessionId);

  const publishTx = await registry.publishPaper(
    paperId,
    `10.5555/fyp.2026.${paperIdText.toLowerCase()}`,
    publicationArtifacts.publicationMetadataCid
  );
  await publishTx.wait();

  const paper = await registry.getPaper(paperId);

  console.log(
    JSON.stringify(
      {
        paperId: paperIdText,
        sessionId: sessionId.toString(),
        submissionArtifacts: {
          manuscriptCid: submissionArtifacts.manuscriptCid,
          abstractCid: submissionArtifacts.abstractCid,
          submissionMetadataCid: submissionArtifacts.submissionMetadataCid,
          visibility: submissionArtifacts.visibility,
          pinStatus: submissionArtifacts.pinStatus,
        },
        publicationArtifacts: {
          publicationMetadataCid: publicationArtifacts.publicationMetadataCid,
          visibility: publicationArtifacts.visibility,
          pinStatus: publicationArtifacts.pinStatus,
        },
        acceptedReviewSession: {
          decision: Number(acceptedSession.decision),
          phase: Number(acceptedSession.phase),
          roundStatus: Number(acceptedSession.roundStatus),
          highPriority: acceptedSession.highPriority,
          finalized: acceptedSession.finalized,
        },
        onChainPaper: {
          status: Number(paper.status),
          abstractCid: paper.abstractCid,
          submissionMetadataCid: paper.submissionMetadataCid,
          publicationMetadataCid: paper.publicationMetadataCid,
          doi: paper.doi,
        },
        publicationCidMatches:
          paper.publicationMetadataCid === publicationArtifacts.publicationMetadataCid,
      },
      null,
      2
    )
  );
  } finally {
    if (artifactApi) {
      artifactApi.kill();
    }
    if (artifactApiLogs.trim()) {
      console.error(`[artifact-api]\n${artifactApiLogs.trim()}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
