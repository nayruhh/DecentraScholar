import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  Wallet,
  decodeBytes32String,
  encodeBytes32String,
  getAddress,
  id,
} from "ethers";
import { getMetaMaskProvider } from "./injectedWallet";

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const ADDRESSES_STORAGE_KEY = "decentraScholarContracts";
const LOCAL_CHAIN_IDS = new Set([31337, 1337]);
const LOCAL_CHAIN_HEX = "0x7a69";

async function ensureLocalHardhatNetwork(provider) {
  const currentChainId = Number(
    await provider.request({ method: "eth_chainId" })
  );

  if (LOCAL_CHAIN_IDS.has(currentChainId)) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LOCAL_CHAIN_HEX }],
    });
    return;
  } catch (switchError) {
    const code = Number(switchError?.code);
    if (code !== 4902) {
      throw new Error("Switch MetaMask to the local Hardhat network (Chain ID 31337).");
    }
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: LOCAL_CHAIN_HEX,
        chainName: "Hardhat Local",
        nativeCurrency: {
          name: "ETH",
          symbol: "ETH",
          decimals: 18,
        },
        rpcUrls: [DEFAULT_RPC_URL],
      },
    ],
  });
}

const PAPER_REGISTRY_ABI = [
  "event PaperPublished(bytes32 indexed paperId, address indexed publisher, string doi)",
  "function submitPaper(bytes32 paperId, string title, string category, string abstractCid, string submissionMetadataCid)",
  "function getPaper(bytes32 paperId) view returns ((bytes32 paperId,address author,string title,string category,string abstractCid,string submissionMetadataCid,string publicationMetadataCid,string doi,uint64 submittedAt,uint64 publishedAt,uint8 status))",
  "function isPublished(bytes32 paperId) view returns (bool)",
  "function publishPaper(bytes32 paperId, string doi, string publicationMetadataCid)",
];

const REVIEW_MANAGER_ABI = [
  // Coordinator actions
  "function createSession(bytes32 paperId, address[] reviewers, bool[] revealOnPublication, uint64 deadline, uint8 revisionCycle) returns (uint256)",
  "function setRebuttalPhase(uint256 sessionId, bytes32 reason)",
  "function requestReplacementReview(uint256 sessionId, uint64 nextDeadline, bool highPriority, bytes32 reason)",
  "function markRoundIncomplete(uint256 sessionId, uint64 nextDeadline, bool highPriority, bytes32 reason)",
  "function markRoundFailed(uint256 sessionId, uint64 nextDeadline, bool highPriority, bytes32 reason)",
  "function setHighPriority(uint256 sessionId, bool highPriority, bytes32 reason)",
  "function extendDeadline(uint256 sessionId, uint64 nextDeadline, bytes32 reason)",
  "function finalizeSession(uint256 sessionId, uint8 decision, bytes32 reason)",
  // Reviewer actions (signed by reviewer wallet)
  "function joinReview(uint256 sessionId, bool identityMayReveal)",
  "function acceptAssignment(uint256 sessionId)",
  "function declineAssignment(uint256 sessionId)",
  "function submitReview(uint256 sessionId, uint8 vote, string reviewCid)",
  // Author actions (signed by author wallet)
  "function submitRebuttal(uint256 sessionId, string rebuttalCid)",
  // Views
  "function nextSessionId() view returns (uint256)",
  "function getSession(uint256 sessionId) view returns ((uint256 sessionId,bytes32 paperId,uint64 deadline,uint8 revisionCycle,uint8 decision,uint8 phase,uint8 roundStatus,bool highPriority,bool finalized,bytes32 resolutionReason,string rebuttalCid))",
  "function getSessionByPaperId(bytes32 paperId) view returns ((uint256 sessionId,bytes32 paperId,uint64 deadline,uint8 revisionCycle,uint8 decision,uint8 phase,uint8 roundStatus,bool highPriority,bool finalized,bytes32 resolutionReason,string rebuttalCid))",
  "function getReviewSlot(uint256 sessionId, uint256 slotIndex) view returns ((address reviewer,bool identityMayReveal,bool accepted,bool declined,bool submitted,uint8 vote,string reviewCid,bool rebuttalSubmitted,uint8 rebuttalVote,string rebuttalCid))",
  "function clearReviewerSlot(uint256 sessionId, uint256 slotIndex)",
  "function getReviewerCount(uint256 sessionId) view returns (uint256)",
  "function isEjectedFromSession(uint256 sessionId, address reviewer) view returns (bool)",
  "function paperIdToSessionId(bytes32 paperId) view returns (uint256)",
  // Events
  "event SessionCreated(uint256 indexed sessionId, bytes32 indexed paperId, uint8 revisionCycle)",
  "event ReviewerJoined(uint256 indexed sessionId, address indexed reviewer, uint256 slotIndex)",
  "event AssignmentAccepted(uint256 indexed sessionId, address indexed reviewer)",
  "event AssignmentDeclined(uint256 indexed sessionId, address indexed reviewer)",
  "event ReviewSubmitted(uint256 indexed sessionId, address indexed reviewer, uint8 vote, string reviewCid)",
  "event RebuttalSubmitted(uint256 indexed sessionId, bytes32 indexed paperId, string rebuttalCid)",
  "event SessionStateUpdated(uint256 indexed sessionId, bytes32 indexed paperId, uint8 phase, uint8 roundStatus, bool highPriority, bytes32 reason)",
  "event SessionFinalized(uint256 indexed sessionId, bytes32 indexed paperId, uint8 decision, bytes32 reason)",
];

const READER_INTERACTIONS_ABI = [
  "function bookmarks(bytes32 paperId, address reader) view returns (bool)",
  "function userRatings(bytes32 paperId, address reader) view returns (uint8)",
  "function getPaperStats(bytes32 paperId) view returns ((uint64 reads,uint64 downloads,uint32 ratingCount,uint32 ratingTotalHalfSteps))",
  "function getAverageRatingHalfSteps(bytes32 paperId) view returns (uint256)",
  "function setBookmark(bytes32 paperId, bool saved)",
  "function recordRead(bytes32 paperId)",
  "function submitRating(bytes32 paperId, uint8 halfSteps)",
];

const DST_TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const DST_TREASURY_ABI = [
  "function weiPerToken() view returns (uint256)",
  "function getEthCost(uint256 tokenAmount) view returns (uint256)",
  "function buy(uint256 tokenAmount) payable",
  "function redeem(uint256 tokenAmount)",
];

const DST_PROTOCOL_VAULT_ABI = [
  "function owner() view returns (address)",
  "function coordinators(address account) view returns (bool)",
  "function feeVaultBalance() view returns (uint256)",
  "function getPaperFunding(bytes32 paperId) view returns ((uint256 totalSubmitted,uint256 priorityFeesSubmitted,uint256 rewardPoolRemaining,uint256 feeVaultAccrued))",
  "function getReviewerStake(bytes32 paperId, address reviewer) view returns ((uint256 amount,bool active))",
  "function reserveSubmissionFee(bytes32 paperId, uint256 totalAmount)",
  "function reservePriorityFee(bytes32 paperId, uint256 totalAmount)",
  "function lockReviewerStake(bytes32 paperId, uint256 amount)",
  "function settleReviewer(bytes32 paperId, address reviewer, uint256 rewardAmount, uint256 slashedAmount)",
];

const COORDINATOR_VAULT_ABI = [
  "function getReviewerStake(bytes32 paperId, address reviewer) view returns ((uint256 amount,bool active))",
  "function settleReviewer(bytes32 paperId, address reviewer, uint256 rewardAmount, uint256 slashedAmount)",
];

const REVIEWER_REPUTATION_ABI = [
  "function getReputation(address reviewer) view returns (int16 reviewerRep, uint32 total, uint32 onTime, uint32 late, uint32 missed)",
  "function recordSubmission(address reviewer, bool onTime)",
  "function recordNoShow(address reviewer)",
];

const PAPER_REGISTRY_FULL_ABI = [
  ...PAPER_REGISTRY_ABI,
  "function acknowledgeDecision(bytes32 paperId)",
  "function hasAcknowledgedDecision(bytes32 paperId, address author) view returns (bool)",
  "event DecisionAcknowledged(bytes32 indexed paperId, address indexed author)",
  "function paperExists(bytes32 paperId) view returns (bool)",
  "function getPaperAuthor(bytes32 paperId) view returns (address)",
];

function getInjectedProvider() {
  return getMetaMaskProvider();
}

function readStoredAddresses() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ADDRESSES_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getConfiguredContractAddresses() {
  const stored = readStoredAddresses();
  return {
    paperRegistry:
      import.meta.env.VITE_PAPER_REGISTRY_ADDRESS ||
      stored.paperRegistry ||
      "",
    readerInteractions:
      import.meta.env.VITE_READER_INTERACTIONS_ADDRESS ||
      stored.readerInteractions ||
      "",
    reviewManager:
      import.meta.env.VITE_REVIEW_MANAGER_ADDRESS ||
      stored.reviewManager ||
      "",
    reviewerReputation:
      import.meta.env.VITE_REVIEWER_REPUTATION_ADDRESS ||
      stored.reviewerReputation ||
      "",
    dstToken:
      import.meta.env.VITE_DST_TOKEN_ADDRESS ||
      stored.dstToken ||
      "",
    dstTreasury:
      import.meta.env.VITE_DST_TREASURY_ADDRESS ||
      stored.dstTreasury ||
      "",
    dstProtocolVault:
      import.meta.env.VITE_DST_PROTOCOL_VAULT_ADDRESS ||
      stored.dstProtocolVault ||
      "",
    rpcUrl:
      import.meta.env.VITE_CHAIN_RPC_URL ||
      stored.rpcUrl ||
      DEFAULT_RPC_URL,
  };
}

export function setConfiguredContractAddresses(addresses) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADDRESSES_STORAGE_KEY, JSON.stringify(addresses || {}));
}

export function hasConfiguredContracts() {
  const addresses = getConfiguredContractAddresses();
  return Boolean(addresses.paperRegistry && addresses.readerInteractions && addresses.reviewManager);
}

export function hasConfiguredDstContracts() {
  const addresses = getConfiguredContractAddresses();
  return Boolean(addresses.dstToken && addresses.dstTreasury && addresses.dstProtocolVault);
}

export function encodePaperIdForContract(paperId) {
  const raw = String(paperId || "").trim();
  if (!raw) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (new TextEncoder().encode(raw).length <= 31) {
    return encodeBytes32String(raw);
  }
  return id(raw);
}

export function decodePaperIdFromContract(rawPaperId) {
  const raw = String(rawPaperId || "").trim();
  if (!raw || /^0x0{64}$/i.test(raw)) return "";
  try {
    return decodeBytes32String(raw);
  } catch {
    return raw;
  }
}

export async function getCurrentWalletAddress() {
  const provider = getInjectedProvider();
  if (!provider) return "";
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    const address = accounts?.[0];
    return address ? getAddress(address) : "";
  } catch {
    return "";
  }
}

export function getReadOnlyContracts() {
  const addresses = getConfiguredContractAddresses();
  if (
    !addresses.paperRegistry ||
    !addresses.readerInteractions ||
    !addresses.reviewManager ||
    !addresses.dstToken ||
    !addresses.dstTreasury ||
    !addresses.dstProtocolVault
  ) return null;

  const provider = new JsonRpcProvider(addresses.rpcUrl || DEFAULT_RPC_URL);
  return {
    provider,
    addresses,
    paperRegistry: new Contract(addresses.paperRegistry, PAPER_REGISTRY_FULL_ABI, provider),
    readerInteractions: new Contract(addresses.readerInteractions, READER_INTERACTIONS_ABI, provider),
    reviewManager: new Contract(addresses.reviewManager, REVIEW_MANAGER_ABI, provider),
    reviewerReputation: addresses.reviewerReputation
      ? new Contract(addresses.reviewerReputation, REVIEWER_REPUTATION_ABI, provider)
      : null,
    dstToken: new Contract(addresses.dstToken, DST_TOKEN_ABI, provider),
    dstTreasury: new Contract(addresses.dstTreasury, DST_TREASURY_ABI, provider),
    dstProtocolVault: new Contract(addresses.dstProtocolVault, DST_PROTOCOL_VAULT_ABI, provider),
  };
}

// Dev-only: Hardhat account[0] is the protocol coordinator.
// Private key is publicly known test data — never use on a real network.
const DEV_COORDINATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export function getCoordinatorContracts() {
  const addresses = getConfiguredContractAddresses();
  const provider = new JsonRpcProvider(addresses.rpcUrl || DEFAULT_RPC_URL);
  const coordinator = new Wallet(DEV_COORDINATOR_KEY, provider);
  return {
    reviewManager: addresses.reviewManager
      ? new Contract(addresses.reviewManager, REVIEW_MANAGER_ABI, coordinator)
      : null,
    dstProtocolVault: new Contract(addresses.dstProtocolVault, COORDINATOR_VAULT_ABI, coordinator),
    reviewerReputation: addresses.reviewerReputation
      ? new Contract(addresses.reviewerReputation, REVIEWER_REPUTATION_ABI, coordinator)
      : null,
  };
}

export async function getWritableContracts() {
  const addresses = getConfiguredContractAddresses();
  if (
    !addresses.paperRegistry ||
    !addresses.readerInteractions ||
    !addresses.reviewManager ||
    !addresses.dstToken ||
    !addresses.dstTreasury ||
    !addresses.dstProtocolVault
  ) {
    throw new Error("Contract addresses are not configured.");
  }

  const injected = getInjectedProvider();
  if (!injected) {
    throw new Error("MetaMask not detected.");
  }

  await ensureLocalHardhatNetwork(injected);
  await injected.request({ method: "eth_requestAccounts" });

  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId || 0);

  if (!LOCAL_CHAIN_IDS.has(chainId)) {
    throw new Error("Switch MetaMask to the local Hardhat network (Chain ID 31337).");
  }

  const [paperRegistryCode, readerInteractionsCode, reviewManagerCode, dstTokenCode, dstTreasuryCode, dstProtocolVaultCode] = await Promise.all([
    provider.getCode(addresses.paperRegistry),
    provider.getCode(addresses.readerInteractions),
    provider.getCode(addresses.reviewManager),
    provider.getCode(addresses.dstToken),
    provider.getCode(addresses.dstTreasury),
    provider.getCode(addresses.dstProtocolVault),
  ]);

  if (
    paperRegistryCode === "0x" ||
    readerInteractionsCode === "0x" ||
    reviewManagerCode === "0x" ||
    dstTokenCode === "0x" ||
    dstTreasuryCode === "0x" ||
    dstProtocolVaultCode === "0x"
  ) {
    throw new Error("Configured contract addresses are not deployed on the current MetaMask network.");
  }

  return {
    provider,
    signer,
    addresses,
    paperRegistry: new Contract(addresses.paperRegistry, PAPER_REGISTRY_FULL_ABI, signer),
    readerInteractions: new Contract(addresses.readerInteractions, READER_INTERACTIONS_ABI, signer),
    reviewManager: new Contract(addresses.reviewManager, REVIEW_MANAGER_ABI, signer),
    reviewerReputation: addresses.reviewerReputation
      ? new Contract(addresses.reviewerReputation, REVIEWER_REPUTATION_ABI, signer)
      : null,
    dstToken: new Contract(addresses.dstToken, DST_TOKEN_ABI, signer),
    dstTreasury: new Contract(addresses.dstTreasury, DST_TREASURY_ABI, signer),
    dstProtocolVault: new Contract(addresses.dstProtocolVault, DST_PROTOCOL_VAULT_ABI, signer),
  };
}
