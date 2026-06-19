import {
  deleteSubmissionMetadataEntry,
  fetchSubmissionMetadata,
  persistSubmissionMetadataEntry,
} from "../../../services/submissionMetadataApi";
import { fetchPaperOnChain } from "../../../services/paperRegistry";
import { resolveIpfsUrl } from "../../../services/ipfsGateway";


const SUBMISSION_METADATA_CHANGED_EVENT = "submission-metadata:changed";

const listeners = new Set();

let cachedItems = [];
let cachedSerialized = JSON.stringify(cachedItems);
let latestSyncRequestId = 0;

export function saveSubmissionMetadata(entry) {
  const title = String(entry?.title || "").trim();
  if (!title) return;

  const collaborators = Array.isArray(entry?.collaborators)
    ? entry.collaborators.map((name) => String(name || "").trim()).filter(Boolean)
    : [];

  const nextEntry = {
    authorWallet: normalizeWallet(entry?.authorWallet),
    title,
    titleKey: normalizeTitleKey(title),
    paperId: String(entry?.paperId || "").trim() || null,
    collaborators,
    abstract: String(entry?.abstract || "").trim(),
    researchField: String(entry?.researchField || "").trim(),
    keywords: Array.isArray(entry?.keywords)
      ? entry.keywords.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [],
    fileName: String(entry?.fileName || "").trim() || null,
    plagiarismSimilarity: normalizePercent(entry?.plagiarismSimilarity),
    plagiarismCheckedAt: String(entry?.plagiarismCheckedAt || "").trim() || null,
    reviewDeadline: normalizeDate(entry?.reviewDeadline),
    aiGeneratedDisclosure: {
      used: Boolean(entry?.aiGeneratedDisclosure?.used),
      details: String(entry?.aiGeneratedDisclosure?.details || "").trim(),
    },
    abstractCid: normalizeIpfsCid(entry?.abstractCid),
    submissionMetadataCid: normalizeIpfsCid(entry?.submissionMetadataCid),
    publicationMetadataCid: normalizeIpfsCid(entry?.publicationMetadataCid),
    manuscriptCid: normalizeIpfsCid(entry?.manuscriptCid),
    artifactVisibility: normalizeArtifactVisibility(entry?.artifactVisibility),
    artifactPinStatus: normalizeArtifactPinStatus(entry?.artifactPinStatus),
    publishedIpfsAt: String(entry?.publishedIpfsAt || "").trim() || null,
    rejectedCleanupAfter: normalizeIsoDateTime(entry?.rejectedCleanupAfter),
    rejectedCleanupScheduledAt: normalizeIsoDateTime(entry?.rejectedCleanupScheduledAt),
    updatedAt: new Date().toISOString(),
  };

  const existing = listSubmissionMetadata();
  const matchIndex = existing.findIndex(
    (item) =>
      buildSubmissionMetadataId(item) === buildSubmissionMetadataId(nextEntry)
  );

  if (matchIndex >= 0) {
    const previous = existing[matchIndex];
    const nextVersion = Number(previous.currentVersion || 1) + 1;
    const revisionDiff = buildRevisionDiff(previous, nextEntry);
    existing[matchIndex] = {
      ...previous,
      ...nextEntry,
      currentVersion: nextVersion,
      revisions: [
        ...(Array.isArray(previous.revisions) ? previous.revisions : []),
        {
          version: `v${nextVersion}.0`,
          submittedAt: nextEntry.updatedAt,
          diff: revisionDiff,
        },
      ],
    };
  } else {
    existing.unshift({
      ...nextEntry,
      currentVersion: 1,
      revisions: [
        {
          version: "v1.0",
          submittedAt: nextEntry.updatedAt,
          diff: {
            summary: "Initial submission",
            changedFields: ["title", "abstract", "keywords", "fileName", "reviewDeadline"],
            abstractWordDelta: estimateWordDelta("", nextEntry.abstract),
          },
        },
      ],
    });
  }

  persistCanonicalSubmissionMetadata(existing);
}

export function getSubmissionMetadataForPaper({ paperId, title }) {
  const normalizedPaperId = String(paperId || "").trim();
  const titleKey = normalizeTitleKey(title);
  const all = listSubmissionMetadata();
  return (
    all.find(
      (item) =>
        (normalizedPaperId && item.paperId === normalizedPaperId) ||
        (titleKey && item.titleKey === titleKey)
    ) || null
  );
}

export function listSubmissionMetadata() {
  return cachedItems.slice();
}

export function listSubmissionMetadataByWallet(walletAddress) {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet) return [];
  return listSubmissionMetadata().filter(
    (item) => resolveEntryAuthorWallet(item) === normalizedWallet
  );
}

export function removeSubmissionMetadata({ paperId, title }) {
  const normalizedPaperId = String(paperId || "").trim();
  const titleKey = normalizeTitleKey(title);
  const next = listSubmissionMetadata().filter(
    (item) =>
      !(
        (normalizedPaperId && item.paperId === normalizedPaperId) ||
        (titleKey && item.titleKey === titleKey)
      )
  );
  persistCanonicalSubmissionMetadata(next);
}

export function subscribeSubmissionMetadata(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  listener(listSubmissionMetadata());
  return () => {
    listeners.delete(listener);
  };
}

export async function syncSubmissionMetadataFromBackend(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  const requestId = ++latestSyncRequestId;
  if (!wallet) {
    replaceCachedItems([]);
    return;
  }

  let remoteItems;
  try {
    remoteItems = await fetchSubmissionMetadata(wallet);
  } catch {
    return;
  }

  if (requestId !== latestSyncRequestId) {
    return;
  }

  const merged = mergeSubmissionMetadata(remoteItems, cachedItems);
  replaceCachedItems(merged);

  for (const item of merged) {
    persistSubmissionMetadataEntry(buildSubmissionMetadataId(item), item).catch(() => {});
  }
}

export async function syncSubmissionMetadataFromChain(paperIds) {
  const ids = Array.isArray(paperIds) ? paperIds.filter(Boolean) : [];
  if (!ids.length) return;

  const results = await Promise.allSettled(
    ids.map(async (paperId) => {
      const onChain = await fetchPaperOnChain(paperId);
      const cid = onChain?.submissionMetadataCid;
      if (!cid) return null;

      const current = listSubmissionMetadata().find((item) => item.paperId === paperId);
      if (current?.submissionMetadataCid === cid && current?.manuscriptCid) return null;

      const url = resolveIpfsUrl(cid);
      if (!url) return null;

      const resp = await fetch(url);
      if (!resp.ok) return null;
      const ipfsMeta = await resp.json();

      return { paperId, submissionMetadataCid: cid, ipfsMeta };
    })
  );

  const snapshot = listSubmissionMetadata();
  let changed = false;

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { paperId, submissionMetadataCid, ipfsMeta } = result.value;

    const idx = snapshot.findIndex((item) => item.paperId === paperId);
    if (idx < 0) continue;

    const entry = snapshot[idx];
    snapshot[idx] = {
      ...entry,
      submissionMetadataCid,
      manuscriptCid: normalizeIpfsCid(ipfsMeta?.manuscriptCid) || entry.manuscriptCid,
      abstractCid: normalizeIpfsCid(ipfsMeta?.abstractCid) || entry.abstractCid,
      fileName: String(ipfsMeta?.fileName || entry.fileName || "").trim() || null,
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }

  if (changed) {
    replaceCachedItems(snapshot);
  }
}

function normalizeTitleKey(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveEntryAuthorWallet(entry) {
  const explicitWallet = normalizeWallet(entry?.authorWallet);
  if (explicitWallet) return explicitWallet;

  const paperId = String(entry?.paperId || "").trim();
  const prefix = paperId.split("|")[0];
  const inferredWallet = normalizeWallet(prefix);
  if (inferredWallet) return inferredWallet;

  return "";
}

function normalizeWallet(wallet) {
  const raw = String(wallet || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw : "";
}

function normalizePercent(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw * 100) / 100));
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ts = new Date(`${raw}T00:00:00Z`).getTime();
  if (!Number.isFinite(ts)) return null;
  return raw;
}

function normalizeIpfsCid(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.startsWith("ipfs://") ? raw : null;
}

function normalizeArtifactVisibility(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "public" ? "public" : "private";
}

function normalizeArtifactPinStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["temporary", "long_term", "eligible_for_cleanup"].includes(raw)) return raw;
  return "temporary";
}

function normalizeIsoDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function estimateWordDelta(previousText, nextText) {
  const prev = String(previousText || "").trim().split(/\s+/).filter(Boolean).length;
  const next = String(nextText || "").trim().split(/\s+/).filter(Boolean).length;
  return next - prev;
}

function buildRevisionDiff(previous, nextEntry) {
  const changedFields = [];
  if (String(previous.title || "") !== String(nextEntry.title || "")) changedFields.push("title");
  if (String(previous.abstract || "") !== String(nextEntry.abstract || "")) changedFields.push("abstract");
  if (String(previous.fileName || "") !== String(nextEntry.fileName || "")) changedFields.push("fileName");
  if (String(previous.researchField || "") !== String(nextEntry.researchField || "")) changedFields.push("researchField");
  if (String(previous.plagiarismSimilarity || "") !== String(nextEntry.plagiarismSimilarity || "")) {
    changedFields.push("plagiarismSimilarity");
  }
  if (String(previous.reviewDeadline || "") !== String(nextEntry.reviewDeadline || "")) {
    changedFields.push("reviewDeadline");
  }
  if (String(previous.manuscriptCid || "") !== String(nextEntry.manuscriptCid || "")) {
    changedFields.push("manuscriptCid");
  }
  if (String(previous.submissionMetadataCid || "") !== String(nextEntry.submissionMetadataCid || "")) {
    changedFields.push("submissionMetadataCid");
  }
  if (String(previous.publicationMetadataCid || "") !== String(nextEntry.publicationMetadataCid || "")) {
    changedFields.push("publicationMetadataCid");
  }
  if (String(previous.artifactPinStatus || "") !== String(nextEntry.artifactPinStatus || "")) {
    changedFields.push("artifactPinStatus");
  }
  if (
    Boolean(previous.aiGeneratedDisclosure?.used) !== Boolean(nextEntry.aiGeneratedDisclosure?.used) ||
    String(previous.aiGeneratedDisclosure?.details || "") !== String(nextEntry.aiGeneratedDisclosure?.details || "")
  ) {
    changedFields.push("aiGeneratedDisclosure");
  }

  const prevKeywords = Array.isArray(previous.keywords) ? previous.keywords : [];
  const nextKeywords = Array.isArray(nextEntry.keywords) ? nextEntry.keywords : [];
  if (prevKeywords.join("|") !== nextKeywords.join("|")) changedFields.push("keywords");

  const summary =
    changedFields.length === 0
      ? "No material metadata changes"
      : `Updated ${changedFields.length} field${changedFields.length > 1 ? "s" : ""}`;

  return {
    summary,
    changedFields,
    abstractWordDelta: estimateWordDelta(previous.abstract || "", nextEntry.abstract || ""),
  };
}


function sanitizeSubmissionMetadata(items) {
  return Array.isArray(items)
    ? items
      .map(normalizeCachedSubmissionMetadata)
      .filter(Boolean)
    : [];
}

function normalizeCachedSubmissionMetadata(entry) {
  const title = String(entry?.title || "").trim();
  const authorWallet = resolveEntryAuthorWallet(entry);
  if (!title || !authorWallet) return null;
  return {
    ...entry,
    authorWallet,
    title,
    titleKey: normalizeTitleKey(entry?.titleKey || title),
    paperId: String(entry?.paperId || "").trim() || null,
    collaborators: Array.isArray(entry?.collaborators)
      ? entry.collaborators.map((name) => String(name || "").trim()).filter(Boolean)
      : [],
    keywords: Array.isArray(entry?.keywords)
      ? entry.keywords.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [],
    abstract: String(entry?.abstract || "").trim(),
    researchField: String(entry?.researchField || "").trim(),
    fileName: String(entry?.fileName || "").trim() || null,
    plagiarismSimilarity: normalizePercent(entry?.plagiarismSimilarity),
    plagiarismCheckedAt: String(entry?.plagiarismCheckedAt || "").trim() || null,
    reviewDeadline: normalizeDate(entry?.reviewDeadline),
    aiGeneratedDisclosure: {
      used: Boolean(entry?.aiGeneratedDisclosure?.used),
      details: String(entry?.aiGeneratedDisclosure?.details || "").trim(),
    },
    abstractCid: normalizeIpfsCid(entry?.abstractCid),
    submissionMetadataCid: normalizeIpfsCid(entry?.submissionMetadataCid),
    publicationMetadataCid: normalizeIpfsCid(entry?.publicationMetadataCid),
    manuscriptCid: normalizeIpfsCid(entry?.manuscriptCid),
    artifactVisibility: normalizeArtifactVisibility(entry?.artifactVisibility),
    artifactPinStatus: normalizeArtifactPinStatus(entry?.artifactPinStatus),
    publishedIpfsAt: String(entry?.publishedIpfsAt || "").trim() || null,
    rejectedCleanupAfter: normalizeIsoDateTime(entry?.rejectedCleanupAfter),
    rejectedCleanupScheduledAt: normalizeIsoDateTime(entry?.rejectedCleanupScheduledAt),
    currentVersion: Number(entry?.currentVersion || 1),
    revisions: Array.isArray(entry?.revisions) ? entry.revisions : [],
    updatedAt: normalizeIsoDateTime(entry?.updatedAt) || new Date().toISOString(),
  };
}

function buildSubmissionMetadataId(entry) {
  return String(entry?.paperId || entry?.titleKey || "").trim();
}

function mergeSubmissionMetadata(...collections) {
  const byId = new Map();
  for (const collection of collections) {
    for (const item of sanitizeSubmissionMetadata(collection)) {
      const id = buildSubmissionMetadataId(item);
      if (!id) continue;
      const existing = byId.get(id);
      byId.set(id, pickPreferredEntry(existing, item));
    }
  }
  return Array.from(byId.values()).sort((left, right) =>
    String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""))
  );
}

function pickPreferredEntry(existing, incoming) {
  if (!existing) return incoming;
  const existingTs = new Date(existing.updatedAt || 0).getTime();
  const incomingTs = new Date(incoming.updatedAt || 0).getTime();
  if (incomingTs >= existingTs) {
    return {
      ...existing,
      ...incoming,
      revisions:
        Array.isArray(incoming.revisions) && incoming.revisions.length >= (existing.revisions || []).length
          ? incoming.revisions
          : existing.revisions,
    };
  }
  return existing;
}

function emitSubmissionMetadataChanged() {
  const snapshot = cachedItems.slice();
  for (const listener of listeners) {
    listener(snapshot);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SUBMISSION_METADATA_CHANGED_EVENT));
  }
}

function replaceCachedItems(items) {
  const sanitized = sanitizeSubmissionMetadata(items);
  const serialized = JSON.stringify(sanitized);
  if (serialized === cachedSerialized) return false;
  cachedItems = sanitized;
  cachedSerialized = serialized;
  emitSubmissionMetadataChanged();
  return true;
}

function persistCanonicalSubmissionMetadata(items) {
  const previousItems = cachedItems.slice();
  if (!replaceCachedItems(items)) return;

  const nextIds = new Set(cachedItems.map(buildSubmissionMetadataId).filter(Boolean));
  for (const item of cachedItems) {
    const metadataId = buildSubmissionMetadataId(item);
    if (!metadataId) continue;
    persistSubmissionMetadataEntry(metadataId, item).catch(() => {});
  }
  for (const item of previousItems) {
    const metadataId = buildSubmissionMetadataId(item);
    if (!metadataId || nextIds.has(metadataId)) continue;
    deleteSubmissionMetadataEntry(metadataId, item.authorWallet).catch(() => {});
  }
}
