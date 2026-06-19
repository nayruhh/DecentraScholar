import { truncateAddress } from "../utils";
import {
  decodePaperIdFromContract,
  getReadOnlyContracts,
} from "../../../services/decentraScholarContracts";
import {
  fetchPaperStats,
  getReaderIdentityKey,
  submitPaperRating,
} from "../../../services/readerInteractionsApi";
import { loadWalletAddress } from "../../../services/browserSession";
import {
  encodePaperIdForContract,
  getWritableContracts,
} from "../../../services/decentraScholarContracts";
import { resolveIpfsUrl } from "../../../services/ipfsGateway";
import { fetchPublishedPapers as fetchPublishedPapersFromApi } from "../../../services/publicationArtifactsApi";

const INTERACTIONS_KEY = "paperInteractions";
const PAPER_CHANGED_EVENT = "papers:changed";

let cachedPublishedPapers = [];
let refreshPromise = null;
const listeners = new Set();
let pollingId = null;

export function loadPublishedPapers() {
  return cachedPublishedPapers;
}

export function getPublishedPaperById(paperId) {
  return cachedPublishedPapers.find((paper) => paper.paperId === paperId) || null;
}

function mapApiMetadataToPaper(meta) {
  const keywords = Array.isArray(meta.keywords) ? meta.keywords : [];
  return {
    id: `backend-${String(meta.paperId || "").toLowerCase()}`,
    paperId: meta.paperId || "",
    source: "backend",
    category: meta.category || "General",
    title: meta.title || "",
    authorName: meta.publishedAuthorName || truncateAddress(meta.publishedAuthorWallet || ""),
    authorWallet: truncateAddress(meta.publishedAuthorWallet || ""),
    authorWalletFull: String(meta.publishedAuthorWallet || "").trim().toLowerCase(),
    date: meta.publishedAt ? meta.publishedAt.split("T")[0] : "-",
    reads: 0,
    downloads: 0,
    stars: 0,
    ratingCount: 0,
    tags: keywords.length ? keywords : ["peer-reviewed"],
    abstract: String(meta.abstract || "").trim() || "This paper has completed peer review.",
    reviewCompleted: true,
    officiallyPublished: true,
    doi: meta.doi || "",
    venue: meta.venue || "",
    version: meta.version || "",
    manuscriptCid: meta.manuscriptCid || "",
    publicationMetadataCid: meta.manuscriptCid || "",
    collaborators: Array.isArray(meta.collaborators) ? meta.collaborators : [],
    reviewedBy: Array.isArray(meta.publishedReviewerNames) ? meta.publishedReviewerNames : [],
  };
}

export async function refreshPublishedPapers() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const interactions = loadInteractions();

    // Chain and backend run in parallel. Chain entries take precedence
    // (dedupeByPaperId keeps the first occurrence). This way neither source
    // can block the other — if the chain node is slow or unreachable, the
    // backend result still loads immediately.
    const [chainResult, backendResult] = await Promise.allSettled([
      loadPublishedPapersFromChain(),
      fetchPublishedPapersFromApi()
        .then((papers) => papers.map((meta) => mapApiMetadataToPaper(meta)))
        .catch(() => []),
    ]);
    const chainPapers = chainResult.status === "fulfilled" ? chainResult.value : [];
    const backendPapers = backendResult.status === "fulfilled" ? backendResult.value : [];

    const mergedBase = dedupeByPaperId([...chainPapers, ...backendPapers]);
    const statsByPaperId = await loadSharedStatsForPapers(mergedBase);
    const merged = mergedBase
      .map((paper) => applyLocalInteractions(paper, interactions[paper.paperId]))
      .map((paper) => applySharedStats(paper, statsByPaperId[paper.paperId]));

    cachedPublishedPapers = merged;
    notifyListeners();
    return merged;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function toggleSavePaper(paperId) {
  const currentPaper = getPublishedPaperById(paperId);
  const nextSaved = !Boolean(currentPaper?.saved);

  const interactions = loadInteractions();
  const current = interactions[paperId] || {};
  interactions[paperId] = {
    ...current,
    saved: nextSaved,
  };
  persistInteractions(interactions);
  cachedPublishedPapers = cachedPublishedPapers.map((paper) =>
    paper.paperId === paperId ? { ...paper, saved: nextSaved } : paper
  );
  notifyListeners();
  return nextSaved;
}

export async function ratePaper(paperId, rating) {
  const safeRating = normalizeHalfRating(Number(rating));
  if (!Number.isFinite(safeRating) || safeRating < 1 || safeRating > 5) return null;

  const walletAddress = String(loadWalletAddress() || "").trim().toLowerCase();
  if (!walletAddress) {
    throw new Error("You must connect your wallet to rate papers.");
  }

  const paper = cachedPublishedPapers.find((p) => p.paperId === paperId);
  if (paper?.authorWalletFull && paper.authorWalletFull === walletAddress) {
    throw new Error("You cannot rate your own paper.");
  }

  // Submit rating on-chain via ReaderInteractions.submitRating — wallet = msg.sender, one per wallet per paper
  const halfSteps = Math.round(safeRating * 2); // 1.0–5.0 → 2–10
  try {
    const contracts = await getWritableContracts();
    const paperIdBytes32 = encodePaperIdForContract(paperId);
    const tx = await contracts.readerInteractions.submitRating(paperIdBytes32, halfSteps);
    await tx.wait();
  } catch (chainErr) {
    const msg = String(chainErr?.message || "");
    // Paper not yet registered on-chain (e.g. submitted before current deployment) — fall back to backend only
    if (!msg.includes("PaperNotPublished") && !msg.includes("missing revert") && !msg.includes("CALL_EXCEPTION")) {
      throw chainErr;
    }
  }

  // Mirror to backend so display stats (average, count) stay in sync
  const result = await submitPaperRating(paperId, safeRating, walletAddress);
  cachedPublishedPapers = cachedPublishedPapers.map((paper) =>
    paper.paperId === paperId ? applySharedStats(paper, result) : paper
  );
  notifyListeners();
  return {
    userRating: normalizeHalfRating(Number(result.userRating || safeRating)),
    average: normalizeHalfRating(Number(result.averageRating || safeRating)),
    count: Number(result.ratingCount || 0),
  };
}

export async function trackPaperRead(paperId) {
  void paperId;
}

export function subscribePaperChanges(listener) {
  listeners.add(listener);
  listener(cachedPublishedPapers);
  refreshPublishedPapers().catch(() => {});

  if (!pollingId && typeof window !== "undefined") {
    pollingId = window.setInterval(() => {
      refreshPublishedPapers().catch(() => {});
    }, 15000);
  }

  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }

  const onStorage = (event) => {
    if (
      event.key === INTERACTIONS_KEY ||
      event.key === "walletAddress"
    ) {
      refreshPublishedPapers().catch(() => {});
    }
  };

  window.addEventListener(PAPER_CHANGED_EVENT, refreshFromEvent);
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener(PAPER_CHANGED_EVENT, refreshFromEvent);
    window.removeEventListener("storage", onStorage);
    if (listeners.size === 0 && pollingId) {
      window.clearInterval(pollingId);
      pollingId = null;
    }
  };
}

function refreshFromEvent() {
  refreshPublishedPapers().catch(() => {});
}

function notifyListeners() {
  for (const listener of listeners) {
    listener(cachedPublishedPapers);
  }
}

async function loadPublishedPapersFromChain() {
  const contracts = getReadOnlyContracts();
  if (!contracts) return [];

  try {
    const { paperRegistry } = contracts;
    const events = await paperRegistry.queryFilter(paperRegistry.filters.PaperPublished());
    const paperIds = Array.from(new Set(events.map((event) => String(event.args?.paperId || ""))));

    const chainPapers = await Promise.all(
      paperIds.map(async (chainPaperId, index) => {
        const paper = await paperRegistry.getPaper(chainPaperId);
        const readablePaperId = decodePaperIdFromContract(paper.paperId);

        // Base data from the chain (always available)
        const base = {
          id: `chain-${index}-${readablePaperId || chainPaperId.slice(0, 10)}`,
          paperId: readablePaperId || chainPaperId,
          chainPaperId,
          source: "chain",
          category: paper.category || "General",
          title: paper.title || readablePaperId || "Untitled",
          authorName: truncateAddress(paper.author),
          authorWallet: truncateAddress(paper.author),
          authorWalletFull: String(paper.author || "").trim().toLowerCase(),
          date: formatChainDate(paper.publishedAt),
          reads: 0,
          downloads: 0,
          stars: 0,
          ratingCount: 0,
          tags: [],
          abstract: "This paper was published on-chain.",
          reviewCompleted: true,
          officiallyPublished: true,
          doi: paper.doi || "",
          manuscriptCid: "",
          publicationMetadataCid: paper.publicationMetadataCid || "",
          collaborators: [],
          reviewedBy: [],
        };

        // Enrich with full metadata from IPFS if the CID is available on-chain
        const metadataCid = String(paper.publicationMetadataCid || "").trim();
        if (metadataCid) {
          try {
            const url = resolveIpfsUrl(metadataCid);
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (response.ok) {
              const meta = await response.json();
              return { ...base, ...mapApiMetadataToPaper(meta) };
            }
          } catch {
            // IPFS fetch failed — use chain-only data
          }
        }

        return base;
      })
    );

    return chainPapers;
  } catch (error) {
    console.warn("Failed to load published papers from chain:", error);
    return [];
  }
}

function formatChainDate(value) {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  return new Date(ts * 1000).toISOString().split("T")[0];
}


function loadInteractions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INTERACTIONS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistInteractions(next) {
  localStorage.setItem(INTERACTIONS_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PAPER_CHANGED_EVENT));
  }
}

function dedupeByPaperId(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.paperId) continue;
    if (!map.has(item.paperId)) map.set(item.paperId, item);
  }
  return Array.from(map.values());
}

function applyLocalInteractions(paper, interaction) {
  return {
    ...paper,
    saved: Boolean(interaction?.saved),
    userRating: normalizeHalfRating(Number(paper.userRating || 0)),
    stars: normalizeHalfRating(Number(paper.stars || 0)),
  };
}

async function loadSharedStatsForPapers(papers) {
  const paperIds = (papers || []).map((paper) => paper.paperId).filter(Boolean);
  if (paperIds.length === 0) return {};
  try {
    return await fetchPaperStats(paperIds, getReaderIdentityKey());
  } catch (error) {
    console.warn("Failed to load shared reader interaction stats:", error);
    return {};
  }
}

function applySharedStats(paper, stats) {
  if (!stats) {
    return {
      ...paper,
      downloads: Number(paper.downloads || 0),
      userRating: normalizeHalfRating(Number(paper.userRating || 0)),
      stars: normalizeHalfRating(Number(paper.stars || 0)),
    };
  }

  return {
    ...paper,
    downloads: Number(stats.downloadCount || 0),
    userRating: normalizeHalfRating(Number(stats.userRating || 0)),
    stars: normalizeHalfRating(Number(stats.averageRating || paper.stars || 0)),
  };
}

function roundTo2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeHalfRating(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num * 2) / 2;
  if (rounded < 0) return 0;
  if (rounded > 5) return 5;
  return roundTo2(rounded);
}
