const API_BASE_URL =
  import.meta.env.VITE_READER_INTERACTIONS_API_URL || "http://127.0.0.1:3001";

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",").pop() : result;
      resolve(base64 || "");
    };
    reader.readAsDataURL(file);
  });
}

export async function createSubmissionArtifacts({
  paperId,
  authorWallet,
  title,
  category,
  abstract,
  file,
  reviewDeadline,
  keywords = [],
  collaborators = [],
  aiGeneratedDisclosure = { used: false, details: "" },
}) {
  if (!file) {
    throw new Error("Please reselect the PDF before submitting. Browser security does not restore file bytes automatically.");
  }

  const fileContentBase64 = await fileToBase64(file);
  const response = await fetch(`${API_BASE_URL}/api/ipfs/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      authorWallet,
      title,
      category,
      abstract,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      fileContentBase64,
      reviewDeadline,
      keywords,
      collaborators,
      aiGeneratedDisclosure,
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not create submission artifacts.");
  }
  return payload;
}

export async function createPublicationArtifacts({
  paperId,
  doi,
  submissionMetadataCid,
}) {
  const response = await fetch(`${API_BASE_URL}/api/ipfs/publications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      doi,
      submissionMetadataCid,
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not create publication artifacts.");
  }
  return payload;
}

export async function createOfficialPublicationArtifacts({
  paperId,
  authorWallet,
  doi,
  submissionMetadataCid,
  publishedAuthorName,
  publishCollaboratorNames,
  publishedReviewerNames,
}) {
  const response = await fetch(`${API_BASE_URL}/api/ipfs/publications/official`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      authorWallet,
      doi,
      submissionMetadataCid,
      publishedAuthorName,
      publishCollaboratorNames,
      publishedReviewerNames,
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not create publication artifacts.");
  }
  return payload;
}

export async function fetchPublishedPapers() {
  const response = await fetch(`${API_BASE_URL}/api/papers/published`);
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not fetch published papers.");
  }
  return Array.isArray(payload?.papers) ? payload.papers : [];
}

export async function pinReviewToIpfs({
  paperId,
  reviewerWallet,
  vote,
  summary,
  strengths,
  weaknesses,
  requiredChanges,
  submittedDate,
  reviewHash,
}) {
  const response = await fetch(`${API_BASE_URL}/api/ipfs/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      reviewerWallet,
      vote,
      summary,
      strengths,
      weaknesses,
      requiredChanges,
      submittedDate,
      reviewHash,
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not pin review to IPFS.");
  }
  return payload.reviewCid;
}

export async function fetchReviewFromIpfs(reviewCid) {
  const raw = String(reviewCid || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/^ipfs:\/\//, "");
  const response = await fetch(`${API_BASE_URL}/api/ipfs/reviews/${encodeURIComponent(normalized)}`);
  const payload = await parseJson(response);
  if (!response.ok) return null;
  return payload?.review || null;
}

export async function pinRebuttalToIpfs({
  paperId,
  reviewerWallet,
  vote,
  rebuttalComment,
  submittedDate,
  rebuttalHash,
}) {
  const response = await fetch(`${API_BASE_URL}/api/ipfs/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId,
      reviewerWallet,
      vote,
      summary: rebuttalComment,
      submittedDate,
      reviewHash: rebuttalHash,
      phase: "rebuttal",
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not pin rebuttal to IPFS.");
  }
  return payload.reviewCid;
}

export async function scheduleRejectedArtifactCleanup(paperId) {
  const response = await fetch(
    `${API_BASE_URL}/api/ipfs/papers/${encodeURIComponent(paperId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Could not schedule rejected artifact cleanup.");
  }
  return payload;
}
