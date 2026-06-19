import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { startChainListener } from "./chainListener.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3001);
// Coordinator wallet is excluded from reviewer assignments — it runs the system and cannot review.
const COORDINATOR_WALLET_ADDRESS = (
  process.env.COORDINATOR_WALLET_ADDRESS || "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
).toLowerCase().trim();
const REJECTED_ARTIFACT_GRACE_DAYS = Number(process.env.REJECTED_ARTIFACT_GRACE_DAYS || 14);
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_S = 45;
const MAX_VERIFY_ATTEMPTS = 5;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const artifactDir = path.join(dataDir, "artifacts");
mkdirSync(dataDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(dataDir, "reader-interactions.db")}`,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS paper_stats (
    paper_id TEXT PRIMARY KEY,
    download_count INTEGER NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    rating_total REAL NOT NULL DEFAULT 0,
    average_rating REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS paper_ratings (
    paper_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    rating REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (paper_id, identity_key)
  );

  CREATE TABLE IF NOT EXISTS paper_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    author_wallet TEXT NOT NULL,
    stage TEXT NOT NULL,
    manuscript_cid TEXT NOT NULL,
    abstract_cid TEXT,
    metadata_cid TEXT NOT NULL UNIQUE,
    file_name TEXT,
    mime_type TEXT,
    visibility TEXT NOT NULL,
    pin_status TEXT NOT NULL,
    source_metadata_cid TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cleanup_after TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_paper_artifacts_lookup
  ON paper_artifacts (paper_id, stage, created_at);

  CREATE TABLE IF NOT EXISTS artifact_access_grants (
    paper_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (paper_id, wallet_address, role)
  );

  CREATE INDEX IF NOT EXISTS idx_artifact_access_lookup
  ON artifact_access_grants (paper_id, wallet_address);

  CREATE TABLE IF NOT EXISTS wallet_identities (
    wallet_address TEXT PRIMARY KEY,
    email TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS review_sessions (
    session_id TEXT NOT NULL,
    author_wallet TEXT NOT NULL,
    session_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, author_wallet)
  );

  CREATE INDEX IF NOT EXISTS idx_review_sessions_wallet
  ON review_sessions (author_wallet);

  CREATE TABLE IF NOT EXISTS submission_metadata (
    metadata_id TEXT NOT NULL,
    author_wallet TEXT NOT NULL,
    title_key TEXT NOT NULL,
    paper_id TEXT,
    metadata_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (metadata_id, author_wallet)
  );

  CREATE INDEX IF NOT EXISTS idx_submission_metadata_wallet
  ON submission_metadata (author_wallet);

  CREATE INDEX IF NOT EXISTS idx_submission_metadata_paper
  ON submission_metadata (paper_id);

  CREATE TABLE IF NOT EXISTS otp_sessions (
    wallet_address TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    last_sent_at INTEGER NOT NULL,
    attempts_left INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log_events (
    id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL,
    event_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, wallet_address)
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_wallet
  ON audit_log_events (wallet_address, timestamp);

  CREATE TABLE IF NOT EXISTS reviewer_reputation (
    wallet_address TEXT PRIMARY KEY,
    reviewer_rep INTEGER NOT NULL DEFAULT 50,
    stats_data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wallet_profiles (
    wallet_address TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviewer_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    reviewer_wallet TEXT NOT NULL,
    reviewer_email TEXT NOT NULL,
    author_wallet TEXT NOT NULL,
    author_email TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    is_tiebreaker INTEGER NOT NULL DEFAULT 0,
    paper_title TEXT NOT NULL DEFAULT '',
    UNIQUE(paper_id, reviewer_wallet)
  );

  CREATE INDEX IF NOT EXISTS idx_reviewer_assignments_wallet
  ON reviewer_assignments (reviewer_wallet, status);

  CREATE INDEX IF NOT EXISTS idx_reviewer_assignments_paper
  ON reviewer_assignments (paper_id);

  CREATE TABLE IF NOT EXISTS assignment_timing_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    reviewer_wallet TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL,
    time_delta_seconds INTEGER NOT NULL,
    flag_level TEXT NOT NULL DEFAULT 'none',
    flag_reason TEXT
  );
`);

// Add paper_title column to existing reviewer_assignments tables created before this field existed.
try {
  await db.execute("ALTER TABLE reviewer_assignments ADD COLUMN paper_title TEXT NOT NULL DEFAULT ''");
} catch {
  // Column already exists — safe to ignore.
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizePaperId(value) {
  return String(value || "").trim();
}

function normalizeIdentityKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRating(value) {
  const numeric = Math.round(Number(value || 0) * 2) / 2;
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) return null;
  return numeric;
}

function normalizeWallet(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTitleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const REVIEW_PHASE_ORDER = {
  pending: 0,
  submitted: 0,
  blind_review: 1,
  rebuttal: 2,
  replacement_review: 3,
  decided: 4,
};

function selectAdvancedReviewPhase(left, right) {
  const leftPhase = String(left || "").trim();
  const rightPhase = String(right || "").trim();
  const leftOrder = REVIEW_PHASE_ORDER[leftPhase] ?? 0;
  const rightOrder = REVIEW_PHASE_ORDER[rightPhase] ?? 0;
  return leftOrder >= rightOrder ? leftPhase : rightPhase;
}

function hasReviewValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function scoreReviewerSlot(slot) {
  if (!slot || typeof slot !== "object") return 0;
  return (
    (hasReviewValue(slot.vote) ? 16 : 0) +
    (slot.submitted || slot.submittedDate ? 16 : 0) +
    (slot.reviewCid ? 8 : 0) +
    (slot.reviewHash ? 4 : 0) +
    (slot.summary || slot.strengths || slot.weaknesses || slot.requiredChanges ? 4 : 0) +
    (slot.reviewerWallet ? 2 : 0) +
    (slot.accepted || slot.requestStatus === "accepted" ? 1 : 0)
  );
}

function mergeReviewerSlot(existingSlot, incomingSlot) {
  if (!existingSlot) return incomingSlot;
  if (!incomingSlot) return existingSlot;
  return scoreReviewerSlot(incomingSlot) > scoreReviewerSlot(existingSlot)
    ? { ...existingSlot, ...incomingSlot }
    : { ...incomingSlot, ...existingSlot };
}

function mergeReviewerSlots(existingSlots, incomingSlots) {
  const existing = Array.isArray(existingSlots) ? existingSlots : [];
  const incoming = Array.isArray(incomingSlots) ? incomingSlots : [];
  const maxLength = Math.max(existing.length, incoming.length);
  return Array.from({ length: maxLength }, (_, index) =>
    mergeReviewerSlot(existing[index], incoming[index])
  ).filter(Boolean);
}

function mergeReviewSessionData(existingSession, incomingSession) {
  if (!existingSession || typeof existingSession !== "object") return incomingSession;
  if (!incomingSession || typeof incomingSession !== "object") return existingSession;
  const existingDecision = String(existingSession.decision || "").trim();
  const incomingDecision = String(incomingSession.decision || "").trim();
  return {
    ...existingSession,
    ...incomingSession,
    officiallyPublished:
      Boolean(existingSession.officiallyPublished) || Boolean(incomingSession.officiallyPublished),
    finalized: Boolean(existingSession.finalized) || Boolean(incomingSession.finalized),
    phase: selectAdvancedReviewPhase(existingSession.phase, incomingSession.phase),
    decision: existingDecision || incomingDecision,
    reviewers: mergeReviewerSlots(existingSession.reviewers, incomingSession.reviewers),
  };
}

function normalizeEmail(value) {
  return String(value || "").trim();
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "Email is required.";
  if (email.length < 6) return "Email must be at least 6 characters long.";
  if (email.length > 254) return "Email must be 254 characters or fewer.";
  if (/\s/.test(email)) return "Email cannot contain spaces.";
  const atCount = (email.match(/@/g) || []).length;
  if (atCount !== 1) return "Email must contain exactly one @ symbol.";
  const [localPart, domainPart] = email.split("@");
  if (!localPart || !domainPart) return "Email must include text before and after @.";
  const domainLabels = domainPart.split(".");
  if (domainLabels.length < 2 || domainLabels[domainLabels.length - 1].length < 2) {
    return "Email must have a valid domain extension (e.g. .com, .edu, .org).";
  }
  return "";
}

function generateOtp() {
  const n = Math.floor(Math.random() * 1000000);
  return String(n).padStart(6, "0");
}

function hashOtp(code) {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return String(h);
}

function normalizeCid(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("ipfs://") ? raw : "";
}

function createCid(buffer) {
  return `ipfs://${createHash("sha256").update(buffer).digest("hex")}`;
}

function artifactPathForCid(cid, extension = ".bin") {
  return path.join(artifactDir, `${sanitizeCidForPath(cid)}${extension}`);
}

function sanitizeCidForPath(cid) {
  return String(cid || "").replace(/^ipfs:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function writeArtifactBuffer(buffer, extension = ".bin", externalCid = null) {
  const cid = externalCid ? (externalCid.startsWith("ipfs://") ? externalCid : `ipfs://${externalCid}`) : createCid(buffer);
  writeFileSync(artifactPathForCid(cid, extension), buffer);
  return cid;
}

function writeArtifactJson(payload) {
  const buffer = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const cid = createCid(buffer);
  writeFileSync(artifactPathForCid(cid, ".json"), buffer);
  return cid;
}

function normalizeBase64(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : raw;
}

function decodeBase64File(value) {
  const normalized = normalizeBase64(value);
  if (!normalized) return null;
  try {
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

function toIsoDateTime(date) {
  return new Date(date).toISOString();
}

function addDaysToIsoDateTime(baseDate, days) {
  const next = new Date(baseDate);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return toIsoDateTime(next);
}

function mapArtifactRow(row) {
  if (!row) return null;
  return {
    paperId: row.paper_id,
    authorWallet: row.author_wallet,
    stage: row.stage,
    manuscriptCid: row.manuscript_cid,
    abstractCid: row.abstract_cid || "",
    metadataCid: row.metadata_cid,
    fileName: row.file_name || "",
    mimeType: row.mime_type || "",
    visibility: row.visibility,
    pinStatus: row.pin_status,
    sourceMetadataCid: row.source_metadata_cid || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cleanupAfter: row.cleanup_after || null,
  };
}

function mapWalletIdentityRow(row) {
  if (!row) {
    return {
      walletAddress: "",
      email: "",
      verifiedAt: null,
      isVerified: false,
    };
  }
  return {
    walletAddress: row.wallet_address,
    email: row.email || "",
    verifiedAt: row.verified_at || null,
    isVerified: Boolean(row.verified_at && row.email),
  };
}

function mapArtifactAccessGrantRow(row) {
  if (!row) return null;
  return {
    paperId: row.paper_id,
    walletAddress: row.wallet_address,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOtpSessionRow(row) {
  if (!row) return null;
  return {
    walletAddress: row.wallet_address,
    email: row.email,
    expiresAt: Number(row.expires_at || 0),
    lastSentAt: Number(row.last_sent_at || 0),
    attemptsLeft: Number(row.attempts_left || 0),
  };
}

function getRemainingCooldownSeconds(lastSentAt) {
  if (!lastSentAt) return 0;
  const elapsed = Math.floor((Date.now() - Number(lastSentAt || 0)) / 1000);
  return Math.max(0, RESEND_COOLDOWN_S - elapsed);
}

function normalizeWalletList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeWallet(value))
        .filter(Boolean)
    )
  );
}

async function getStatsForPaper(paperId, identityKey = "") {
  const statsResult = await db.execute({
    sql: `SELECT paper_id, download_count, rating_count, rating_total, average_rating, updated_at
          FROM paper_stats WHERE paper_id = ?`,
    args: [paperId],
  });
  const row = statsResult.rows[0];

  let userRatingRow = null;
  if (identityKey) {
    const userRatingResult = await db.execute({
      sql: `SELECT rating FROM paper_ratings WHERE paper_id = ? AND identity_key = ?`,
      args: [paperId, identityKey],
    });
    userRatingRow = userRatingResult.rows[0] || null;
  }

  return {
    paperId,
    downloadCount: Number(row?.download_count || 0),
    ratingCount: Number(row?.rating_count || 0),
    ratingTotal: Number(row?.rating_total || 0),
    averageRating: Number(row?.average_rating || 0),
    userRating: Number(userRatingRow?.rating || 0),
  };
}

async function upsertAggregatedStats(paperId) {
  const ratingsResult = await db.execute({
    sql: `SELECT COUNT(*) AS rating_count, COALESCE(SUM(rating), 0) AS rating_total, COALESCE(AVG(rating), 0) AS average_rating
          FROM paper_ratings WHERE paper_id = ?`,
    args: [paperId],
  });
  const ratings = ratingsResult.rows[0];

  await db.execute({
    sql: `INSERT INTO paper_stats (paper_id, rating_count, rating_total, average_rating, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(paper_id) DO UPDATE SET
            rating_count = excluded.rating_count,
            rating_total = excluded.rating_total,
            average_rating = excluded.average_rating,
            updated_at = CURRENT_TIMESTAMP`,
    args: [
      paperId,
      Number(ratings?.rating_count || 0),
      Number(ratings?.rating_total || 0),
      Number(ratings?.average_rating || 0),
    ],
  });
}

const ASSIGNMENT_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const ACCEPT_BLOCK_SECONDS = 30;
const ACCEPT_SUSPICIOUS_SECONDS = 120;
const REVIEWER_MIN_AGE_HOURS = 1; // accounts created within this window are ineligible

async function sendAssignmentEmail(reviewerEmail, paperId, isTiebreaker = false) {
  const subject = isTiebreaker
    ? "[DecentraScholar] Tie-Breaker Review Assignment"
    : "[DecentraScholar] New Paper Review Assignment";
  const body = isTiebreaker
    ? `You have been selected as a tie-breaker reviewer for paper ${paperId}.\n\nA 2-reviewer panel reached a deadlock. Your single vote will decide the outcome.\n\nLog in to DecentraScholar and visit the Reviewer Workspace to accept or decline within 3 days.`
    : `You have been assigned to review a paper on DecentraScholar (paper ID: ${paperId}).\n\nLog in and visit the Reviewer Workspace to accept or decline within 3 days. Missing the deadline will expire this assignment with no penalty.`;

  const logLine = `[ASSIGNMENT EMAIL] ${new Date().toISOString()} | to: ${reviewerEmail} | subject: ${subject}\n${body}\n---\n`;
  console.log(logLine.trim());
  appendFileSync(path.join(dataDir, "assignment-emails.log"), logLine);

  // Real SMTP path — only active when SMTP_HOST is configured.
  if (process.env.SMTP_HOST) {
    try {
      const net = await import("node:net");
      await new Promise((resolve, reject) => {
        const socket = net.default.createConnection(
          Number(process.env.SMTP_PORT || 587),
          process.env.SMTP_HOST
        );
        const lines = [
          `EHLO decentrascholar`,
          `AUTH LOGIN`,
          Buffer.from(process.env.SMTP_USER || "").toString("base64"),
          Buffer.from(process.env.SMTP_PASS || "").toString("base64"),
          `MAIL FROM:<${process.env.SMTP_FROM || "noreply@decentrascholar.local"}>`,
          `RCPT TO:<${reviewerEmail}>`,
          `DATA`,
          `From: DecentraScholar <${process.env.SMTP_FROM || "noreply@decentrascholar.local"}>`,
          `To: ${reviewerEmail}`,
          `Subject: ${subject}`,
          ``,
          body,
          `.`,
          `QUIT`,
        ];
        let idx = 0;
        socket.on("data", () => {
          if (idx < lines.length) socket.write(lines[idx++] + "\r\n");
          else { socket.end(); resolve(); }
        });
        socket.on("error", reject);
        socket.on("close", resolve);
      });
      console.log(`[AssignmentEmail] Sent via SMTP to ${reviewerEmail}`);
    } catch (err) {
      console.warn(`[AssignmentEmail] SMTP failed (logged to file):`, err?.message);
    }
  }
}

async function checkExpiredAssignments() {
  const now = Date.now();
  const expiredResult = await db.execute({
    sql: `SELECT id, paper_id, author_wallet, author_email FROM reviewer_assignments
          WHERE status = 'pending' AND expires_at < ?`,
    args: [now],
  });
  for (const row of expiredResult.rows) {
    await db.execute({
      sql: `UPDATE reviewer_assignments SET status = 'expired' WHERE id = ?`,
      args: [row.id],
    });
    console.log(`[Assignments] Assignment expired for paper ${row.paper_id}`);
  }
}

async function assignReviewers(paperId, authorWallet, count = 3, isTiebreaker = false, paperTitle = "") {
  const normalizedAuthorWallet = normalizeWallet(authorWallet);
  const authorIdentityResult = await db.execute({
    sql: `SELECT email FROM wallet_identities WHERE wallet_address = ? LIMIT 1`,
    args: [normalizedAuthorWallet],
  });
  const authorEmail = normalizeEmail(authorIdentityResult.rows[0]?.email || "");

  const existingResult = await db.execute({
    sql: `SELECT reviewer_wallet FROM reviewer_assignments WHERE paper_id = ?`,
    args: [paperId],
  });
  const excludedWallets = new Set(
    existingResult.rows.map((r) => normalizeWallet(r.reviewer_wallet))
  );
  excludedWallets.add(normalizedAuthorWallet);
  excludedWallets.add(COORDINATOR_WALLET_ADDRESS);

  const eligibleResult = await db.execute({
    sql: `SELECT wallet_address, email FROM wallet_identities
          WHERE verified_at IS NOT NULL AND verified_at != ''
            AND wallet_address != ?
            ${authorEmail ? "AND email != ?" : ""}
            AND datetime(created_at) < datetime('now', '-${REVIEWER_MIN_AGE_HOURS} hour')
          ORDER BY RANDOM()
          LIMIT ?`,
    args: authorEmail
      ? [normalizedAuthorWallet, authorEmail, count + 20]
      : [normalizedAuthorWallet, count + 20],
  });

  const candidates = eligibleResult.rows.filter(
    (r) => !excludedWallets.has(normalizeWallet(r.wallet_address))
  );
  const selected = candidates.slice(0, count);

  const now = Date.now();
  const expiresAt = now + ASSIGNMENT_EXPIRY_MS;
  const assigned = [];

  for (const candidate of selected) {
    const reviewerWallet = normalizeWallet(candidate.wallet_address);
    const reviewerEmail = normalizeEmail(candidate.email || "");
    try {
      await db.execute({
        sql: `INSERT INTO reviewer_assignments
                (paper_id, reviewer_wallet, reviewer_email, author_wallet, author_email,
                 assigned_at, expires_at, status, is_tiebreaker, paper_title)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
              ON CONFLICT(paper_id, reviewer_wallet) DO NOTHING`,
        args: [
          paperId, reviewerWallet, reviewerEmail,
          normalizedAuthorWallet, authorEmail,
          now, expiresAt,
          isTiebreaker ? 1 : 0,
          String(paperTitle || ""),
        ],
      });
      assigned.push({ wallet: reviewerWallet, email: reviewerEmail });
      console.log(`[Assignments] Assigned reviewer ${reviewerWallet} to paper ${paperId}${isTiebreaker ? " (tiebreaker)" : ""}`);
      if (reviewerEmail) {
        sendAssignmentEmail(reviewerEmail, paperId, isTiebreaker).catch(() => {});
      }
    } catch (err) {
      console.warn(`[Assignments] Could not assign ${reviewerWallet}:`, err?.message);
    }
  }

  if (assigned.length < count) {
    console.warn(`[Assignments] Only ${assigned.length}/${count} reviewers found for paper ${paperId}`);
  }

  return { assigned, needed: count, paperId };
}

async function createSubmissionArtifacts(body) {
  const paperId = normalizePaperId(body.paperId);
  const authorWallet = normalizeWallet(body.authorWallet);
  const title = String(body.title || "").trim();
  const category = String(body.category || "").trim();
  const abstract = String(body.abstract || "").trim();
  const fileName = String(body.fileName || "").trim();
  const mimeType = String(body.mimeType || "application/pdf").trim() || "application/pdf";
  const reviewDeadline = String(body.reviewDeadline || "").trim();
  const fileBuffer = decodeBase64File(body.fileContentBase64);

  if (!paperId || !authorWallet || !title || !category || !fileName || !fileBuffer) {
    return { error: "paperId, authorWallet, title, category, fileName, and fileContentBase64 are required." };
  }

  const manuscriptCid = await pinToIPFS(fileBuffer, fileName);
  const abstractCid = abstract
    ? await pinToIPFS(Buffer.from(abstract, "utf8"), "abstract.txt")
    : "";

  const metadataPayload = {
    stage: "submission",
    visibility: "private",
    pinStatus: "temporary",
    paperId,
    authorWallet,
    title,
    category,
    abstractCid,
    manuscriptCid,
    fileName,
    mimeType,
    reviewDeadline,
    uploadedAt: toIsoDateTime(Date.now()),
    keywords: Array.isArray(body.keywords) ? body.keywords : [],
    collaborators: Array.isArray(body.collaborators) ? body.collaborators : [],
    aiGeneratedDisclosure:
      body.aiGeneratedDisclosure && typeof body.aiGeneratedDisclosure === "object"
        ? body.aiGeneratedDisclosure
        : { used: false, details: "" },
  };

  const metadataBuffer = Buffer.from(JSON.stringify(metadataPayload, null, 2), "utf8");
  const submissionMetadataCid = await pinToIPFS(metadataBuffer, "submission-metadata.json");

  await db.execute({
    sql: `INSERT INTO paper_artifacts (
            paper_id, author_wallet, stage, manuscript_cid, abstract_cid, metadata_cid,
            file_name, mime_type, visibility, pin_status, source_metadata_cid,
            created_at, updated_at, cleanup_after
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
    args: [
      paperId,
      authorWallet,
      "submission",
      manuscriptCid,
      abstractCid || null,
      submissionMetadataCid,
      fileName,
      mimeType,
      "private",
      "temporary",
      null,
      null,
    ],
  });

  await db.execute({
    sql: `INSERT INTO artifact_access_grants (paper_id, wallet_address, role, created_at, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(paper_id, wallet_address, role) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
    args: [paperId, authorWallet, "author"],
  });

  return {
    paperId,
    authorWallet,
    manuscriptCid,
    abstractCid,
    submissionMetadataCid,
    visibility: "private",
    pinStatus: "temporary",
  };
}

async function createPublicationArtifacts(body) {
  const paperId = normalizePaperId(body.paperId);
  const doi = String(body.doi || "").trim();
  const sourceMetadataCid = normalizeCid(body.submissionMetadataCid);

  if (!paperId || !doi) {
    return { error: "paperId and doi are required." };
  }

  let sourceArtifact;
  if (sourceMetadataCid) {
    const r = await db.execute({
      sql: `SELECT * FROM paper_artifacts WHERE metadata_cid = ? LIMIT 1`,
      args: [sourceMetadataCid],
    });
    sourceArtifact = r.rows[0] || null;
  } else {
    const r = await db.execute({
      sql: `SELECT * FROM paper_artifacts WHERE paper_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
      args: [paperId, "submission"],
    });
    sourceArtifact = r.rows[0] || null;
  }

  if (!sourceArtifact) {
    return { error: "No submission artifact exists for this paper." };
  }

  const sourceMetadataPath = artifactPathForCid(sourceArtifact.metadata_cid, ".json");
  const sourcePayload = JSON.parse(readFileSync(sourceMetadataPath, "utf8"));
  const publicationPayload = {
    ...sourcePayload,
    stage: "publication",
    visibility: "public",
    pinStatus: "long_term",
    doi,
    publicationAt: toIsoDateTime(Date.now()),
    sourceSubmissionMetadataCid: sourceArtifact.metadata_cid,
  };
  const publicationMetadataCid = writeArtifactJson(publicationPayload);

  await db.execute({
    sql: `INSERT INTO paper_artifacts (
            paper_id, author_wallet, stage, manuscript_cid, abstract_cid, metadata_cid,
            file_name, mime_type, visibility, pin_status, source_metadata_cid,
            created_at, updated_at, cleanup_after
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
    args: [
      paperId,
      sourceArtifact.author_wallet,
      "publication",
      sourceArtifact.manuscript_cid,
      sourceArtifact.abstract_cid,
      publicationMetadataCid,
      sourceArtifact.file_name,
      sourceArtifact.mime_type,
      "public",
      "long_term",
      sourceArtifact.metadata_cid,
      null,
    ],
  });

  return {
    paperId,
    manuscriptCid: sourceArtifact.manuscript_cid,
    abstractCid: sourceArtifact.abstract_cid || "",
    publicationMetadataCid,
    visibility: "public",
    pinStatus: "long_term",
    publishedAt: toIsoDateTime(Date.now()),
  };
}

async function pinToIPFS(buffer, filename) {
  if (!process.env.PINATA_JWT) throw new Error("PINATA_JWT is not configured.");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const mimeType = filename.endsWith(".json") ? "application/json" : "application/octet-stream";
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: mimeType }), filename);
    formData.append("network", "public");

    const response = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
      body: formData,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Pinata error (${response.status}): ${payload?.error?.details || payload?.error?.reason || JSON.stringify(payload)}`
      );
    }

    const cid = payload?.data?.cid;
    if (!cid) throw new Error("Pinata returned no CID.");

    // Cache locally so artifact serving works without hitting Pinata every time.
    const ext = path.extname(filename) || ".bin";
    writeArtifactBuffer(buffer, ext, cid);

    console.log(`[pinToIPFS] Pinned: ipfs://${cid}`);
    return `ipfs://${cid}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createOfficialPublicationArtifacts(body) {
  const paperId = normalizePaperId(body.paperId);
  const authorWallet = normalizeWallet(body.authorWallet);
  const doi = String(body.doi || "").trim();
  const sourceMetadataCid = normalizeCid(body.submissionMetadataCid);
  const publishedAuthorName = String(body.publishedAuthorName || "").trim();
  const publishCollaboratorNames = Boolean(body.publishCollaboratorNames);
  const publishedReviewerNames = Array.isArray(body.publishedReviewerNames)
    ? body.publishedReviewerNames.map((n) => String(n || "").trim()).filter(Boolean)
    : [];

  if (!paperId) return { error: "paperId is required.", statusCode: 400 };
  if (!authorWallet) return { error: "authorWallet is required.", statusCode: 400 };
  if (!doi) return { error: "doi is required.", statusCode: 400 };

  const rawSubmissionCid = String(body.submissionMetadataCid || "").trim();
  if (rawSubmissionCid && !sourceMetadataCid) {
    return { error: "submissionMetadataCid must be in ipfs://... format.", statusCode: 400 };
  }

  // Step 1: Verify author
  let submissionRow;
  if (sourceMetadataCid) {
    const r = await db.execute({
      sql: `SELECT * FROM paper_artifacts WHERE metadata_cid = ? LIMIT 1`,
      args: [sourceMetadataCid],
    });
    submissionRow = r.rows[0] || null;
  } else {
    const r = await db.execute({
      sql: `SELECT * FROM paper_artifacts WHERE paper_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
      args: [paperId, "submission"],
    });
    submissionRow = r.rows[0] || null;
  }

  if (!submissionRow) {
    return { error: "No manuscript found for this paper.", statusCode: 400 };
  }
  if (normalizeWallet(submissionRow.author_wallet) !== authorWallet) {
    return { error: "You are not the author of this paper.", statusCode: 403 };
  }

  // Step 2: Idempotency — return existing CID if already published
  const existingPubResult = await db.execute({
    sql: `SELECT * FROM paper_artifacts WHERE paper_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
    args: [paperId, "publication"],
  });
  const existingPublication = existingPubResult.rows[0] || null;
  if (existingPublication) {
    return {
      paperId,
      manuscriptCid: existingPublication.manuscript_cid,
      publicationMetadataCid: existingPublication.metadata_cid,
      publishedAt: existingPublication.created_at,
    };
  }

  // Step 3: Read submission metadata to build publication metadata
  const sourceMetadataPath = artifactPathForCid(submissionRow.metadata_cid, ".json");
  let sourcePayload;
  try {
    sourcePayload = JSON.parse(readFileSync(sourceMetadataPath, "utf8"));
  } catch {
    return { error: "No manuscript found for this paper.", statusCode: 400 };
  }

  // Step 4: Reuse the manuscript CID from submission (already pinned to IPFS at upload time).
  const manuscriptCid = submissionRow.manuscript_cid;

  // Step 5: Assemble publication metadata
  const now = toIsoDateTime(Date.now());
  const collaborators = publishCollaboratorNames
    ? Array.isArray(sourcePayload.collaborators) ? sourcePayload.collaborators : []
    : [];

  const publicationMetadata = {
    stage: "publication",
    visibility: "public",
    pinStatus: "long_term",

    paperId,
    doi,
    venue: "DecentraScholar Journal",
    version: "v1.0",
    publicationAt: now,
    publishedAt: now,

    title: sourcePayload.title || "",
    category: sourcePayload.category || "",
    abstract: sourcePayload.abstract || "",
    keywords: Array.isArray(sourcePayload.keywords) ? sourcePayload.keywords : [],
    fileName: submissionRow.file_name || "paper.pdf",
    mimeType: submissionRow.mime_type || "application/pdf",

    publishedAuthorName: publishedAuthorName || authorWallet,
    publishedAuthorWallet: authorWallet,
    publishCollaboratorNames,
    collaborators,

    publishedReviewerNames,

    aiGeneratedDisclosure: sourcePayload.aiGeneratedDisclosure || { used: false, details: "" },

    reviewRoundCount: 1, // TODO: derive from review session when revision cycle is implemented
    finalDecision: "accepted", // TODO: derive from review session decision when revision cycle is implemented

    manuscriptCid,
    sourceSubmissionMetadataCid: submissionRow.metadata_cid,
  };

  // Step 6: Pin metadata JSON
  let publicationMetadataCid;
  try {
    const metadataBuffer = Buffer.from(JSON.stringify(publicationMetadata, null, 2), "utf8");
    publicationMetadataCid = await pinToIPFS(metadataBuffer, "metadata.json");
  } catch (err) {
    console.error("[createOfficialPublicationArtifacts] Failed to pin metadata:", err);
    return { error: "Failed to store publication metadata. Please try again.", statusCode: 500 };
  }

  // Step 7: Insert publication artifact row
  await db.execute({
    sql: `INSERT INTO paper_artifacts (
            paper_id, author_wallet, stage, manuscript_cid, abstract_cid, metadata_cid,
            file_name, mime_type, visibility, pin_status, source_metadata_cid,
            created_at, updated_at, cleanup_after
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
    args: [
      paperId,
      authorWallet,
      "publication",
      manuscriptCid,
      submissionRow.abstract_cid || "",
      publicationMetadataCid,
      submissionRow.file_name || "paper.pdf",
      submissionRow.mime_type || "application/pdf",
      "public",
      "long_term",
      submissionRow.metadata_cid,
      null,
    ],
  });

  return {
    paperId,
    manuscriptCid,
    publicationMetadataCid,
    publishedAt: now,
  };
}

async function getPublishedPapers() {
  // Select only the latest artifact row per paper_id to avoid duplicates from repeated publishes.
  const result = await db.execute({
    sql: `SELECT metadata_cid FROM paper_artifacts
          WHERE stage = 'publication' AND visibility = 'public'
            AND id IN (
              SELECT MAX(id) FROM paper_artifacts
              WHERE stage = 'publication' AND visibility = 'public'
              GROUP BY paper_id
            )
          ORDER BY created_at DESC`,
    args: [],
  });

  const results = [];
  for (const row of result.rows) {
    try {
      const metadataPath = artifactPathForCid(row.metadata_cid, ".json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      results.push(metadata);
    } catch (err) {
      console.warn(`[getPublishedPapers] Skipping metadata_cid=${row.metadata_cid}:`, err.message);
    }
  }
  return results;
}

async function getWalletIdentity(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) {
    return {
      walletAddress: "",
      email: "",
      verifiedAt: null,
      isVerified: false,
    };
  }
  const result = await db.execute({
    sql: `SELECT wallet_address, email, verified_at, created_at, updated_at
          FROM wallet_identities WHERE wallet_address = ? LIMIT 1`,
    args: [wallet],
  });
  return mapWalletIdentityRow(result.rows[0] || null);
}

async function getWalletIdentityByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const result = await db.execute({
    sql: `SELECT wallet_address, email, verified_at, created_at, updated_at
          FROM wallet_identities WHERE email = ? LIMIT 1`,
    args: [normalizedEmail],
  });
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    walletAddress: row.wallet_address,
    email: row.email || "",
    verifiedAt: row.verified_at || null,
    isVerified: Boolean(row.verified_at && row.email),
  };
}

async function getOtpSession(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return null;
  const result = await db.execute({
    sql: `SELECT wallet_address, email, otp_hash, expires_at, last_sent_at, attempts_left, created_at, updated_at
          FROM otp_sessions WHERE wallet_address = ? LIMIT 1`,
    args: [wallet],
  });
  const row = result.rows[0] || null;
  if (!row) return null;
  if (Date.now() > Number(row.expires_at || 0)) {
    await db.execute({
      sql: `DELETE FROM otp_sessions WHERE wallet_address = ?`,
      args: [wallet],
    });
    return null;
  }
  return mapOtpSessionRow(row);
}

async function getOtpSessionByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const result = await db.execute({
    sql: `SELECT wallet_address, email, otp_hash, expires_at, last_sent_at, attempts_left, created_at, updated_at
          FROM otp_sessions WHERE email = ? LIMIT 1`,
    args: [normalizedEmail],
  });
  const row = result.rows[0] || null;
  if (!row) return null;
  if (Date.now() > Number(row.expires_at || 0)) {
    await db.execute({
      sql: `DELETE FROM otp_sessions WHERE wallet_address = ?`,
      args: [row.wallet_address],
    });
    return null;
  }
  return {
    walletAddress: row.wallet_address,
    email: row.email,
    expiresAt: Number(row.expires_at || 0),
    lastSentAt: Number(row.last_sent_at || 0),
    attemptsLeft: Number(row.attempts_left || 0),
  };
}

async function validateEmailWalletLink(walletAddress, email) {
  const normalizedWallet = normalizeWallet(walletAddress);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedWallet || !normalizedEmail) {
    return null;
  }

  const linkedIdentity = await getWalletIdentityByEmail(normalizedEmail);
  if (linkedIdentity?.walletAddress && linkedIdentity.walletAddress !== normalizedWallet) {
    return {
      error: "This email is already linked to another wallet.",
      statusCode: 409,
    };
  }

  const activeOtpSession = await getOtpSessionByEmail(normalizedEmail);
  if (activeOtpSession?.walletAddress && activeOtpSession.walletAddress !== normalizedWallet) {
    return {
      error: "This email already has an active verification session for another wallet.",
      statusCode: 409,
    };
  }

  return null;
}

async function requestOtp(body) {
  const walletAddress = normalizeWallet(body.walletAddress);
  const email = normalizeEmail(body.email);
  const emailError = validateEmail(email);

  if (!walletAddress) {
    return { error: "walletAddress is required.", statusCode: 400 };
  }
  if (emailError) {
    return { error: emailError, statusCode: 400 };
  }

  const emailWalletError = await validateEmailWalletLink(walletAddress, email);
  if (emailWalletError) {
    return emailWalletError;
  }

  const existingResult = await db.execute({
    sql: `SELECT wallet_address, email, otp_hash, expires_at, last_sent_at, attempts_left, created_at, updated_at
          FROM otp_sessions WHERE wallet_address = ? LIMIT 1`,
    args: [walletAddress],
  });
  const existing = existingResult.rows[0] || null;
  const remainingCooldown = existing ? getRemainingCooldownSeconds(existing.last_sent_at) : 0;
  if (remainingCooldown > 0) {
    return {
      error: `Please wait ${remainingCooldown}s before resending a code.`,
      statusCode: 429,
      cooldown: remainingCooldown,
    };
  }

  const code = generateOtp();
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;
  await db.execute({
    sql: `INSERT INTO otp_sessions (wallet_address, email, otp_hash, expires_at, last_sent_at, attempts_left, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(wallet_address) DO UPDATE SET
            email = excluded.email,
            otp_hash = excluded.otp_hash,
            expires_at = excluded.expires_at,
            last_sent_at = excluded.last_sent_at,
            attempts_left = excluded.attempts_left,
            updated_at = CURRENT_TIMESTAMP`,
    args: [walletAddress, email, hashOtp(code), expiresAt, now, MAX_VERIFY_ATTEMPTS],
  });
  const otpLogLine = `[DEV OTP] ${new Date().toISOString()} | ${email} | ${walletAddress} | code: ${code}\n`;
  console.log(otpLogLine.trim());
  appendFileSync(path.join(dataDir, "otp-dev.log"), otpLogLine);

  return {
    ok: true,
    walletAddress,
    email,
    expiresAt,
    lastSentAt: now,
    attemptsLeft: MAX_VERIFY_ATTEMPTS,
    cooldown: RESEND_COOLDOWN_S,
  };
}

async function verifyOtp(body) {
  const walletAddress = normalizeWallet(body.walletAddress);
  const code = String(body.code || "").trim();
  if (!walletAddress || !code) {
    return { error: "walletAddress and code are required.", statusCode: 400 };
  }

  const sessionResult = await db.execute({
    sql: `SELECT wallet_address, email, otp_hash, expires_at, last_sent_at, attempts_left, created_at, updated_at
          FROM otp_sessions WHERE wallet_address = ? LIMIT 1`,
    args: [walletAddress],
  });
  const session = sessionResult.rows[0] || null;
  if (!session) {
    return { error: "No verification session found. Please request a new code.", statusCode: 400 };
  }
  if (Date.now() > Number(session.expires_at || 0)) {
    await db.execute({
      sql: `DELETE FROM otp_sessions WHERE wallet_address = ?`,
      args: [walletAddress],
    });
    return { error: "Code expired. Please request a new code.", statusCode: 400 };
  }
  if (Number(session.attempts_left || 0) <= 0) {
    return { error: "Too many incorrect attempts. Please request a new code.", statusCode: 400 };
  }

  const latestEmailWalletError = await validateEmailWalletLink(walletAddress, session.email);
  if (latestEmailWalletError) {
    return latestEmailWalletError;
  }

  const otpHash = hashOtp(code);
  if (otpHash !== String(session.otp_hash || "")) {
    const nextAttempts = Math.max(0, Number(session.attempts_left || 0) - 1);
    await db.execute({
      sql: `UPDATE otp_sessions SET attempts_left = ?, updated_at = CURRENT_TIMESTAMP WHERE wallet_address = ?`,
      args: [nextAttempts, walletAddress],
    });
    return {
      error: `Incorrect code. Attempts left: ${nextAttempts}`,
      statusCode: 400,
      attemptsLeft: nextAttempts,
    };
  }

  const verifiedAt = toIsoDateTime(Date.now());
  await db.execute({
    sql: `INSERT INTO wallet_identities (wallet_address, email, verified_at, created_at, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(wallet_address) DO UPDATE SET
            email = excluded.email,
            verified_at = excluded.verified_at,
            updated_at = CURRENT_TIMESTAMP`,
    args: [walletAddress, session.email, verifiedAt],
  });
  await db.execute({
    sql: `DELETE FROM otp_sessions WHERE wallet_address = ?`,
    args: [walletAddress],
  });

  return {
    ok: true,
    identity: await getWalletIdentity(walletAddress),
  };
}

async function resetOtpSession(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return { error: "walletAddress is required.", statusCode: 400 };
  await db.execute({
    sql: `DELETE FROM otp_sessions WHERE wallet_address = ?`,
    args: [wallet],
  });
  return { ok: true, walletAddress: wallet };
}

async function resetWalletIdentity(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return { error: "walletAddress is required.", statusCode: 400 };
  await db.execute({
    sql: `DELETE FROM otp_sessions WHERE wallet_address = ?`,
    args: [wallet],
  });
  await db.execute({
    sql: `DELETE FROM wallet_identities WHERE wallet_address = ?`,
    args: [wallet],
  });
  return { ok: true, walletAddress: wallet };
}

async function syncArtifactAccess(body) {
  const paperId = normalizePaperId(body.paperId);
  const authorWallet = normalizeWallet(body.authorWallet);
  const reviewerWallets = normalizeWalletList(body.reviewerWallets);

  if (!paperId) {
    return { error: "paperId is required.", statusCode: 400 };
  }

  if (authorWallet) {
    await db.execute({
      sql: `INSERT INTO artifact_access_grants (paper_id, wallet_address, role, created_at, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(paper_id, wallet_address, role) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      args: [paperId, authorWallet, "author"],
    });
  }

  await db.execute({
    sql: `DELETE FROM artifact_access_grants WHERE paper_id = ? AND role = 'reviewer'`,
    args: [paperId],
  });

  for (const reviewerWallet of reviewerWallets) {
    await db.execute({
      sql: `INSERT INTO artifact_access_grants (paper_id, wallet_address, role, created_at, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(paper_id, wallet_address, role) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      args: [paperId, reviewerWallet, "reviewer"],
    });
  }

  const grantsResult = await db.execute({
    sql: `SELECT paper_id, wallet_address, role, created_at, updated_at
          FROM artifact_access_grants WHERE paper_id = ?
          ORDER BY role ASC, wallet_address ASC`,
    args: [paperId],
  });

  return {
    ok: true,
    paperId,
    grants: grantsResult.rows.map(mapArtifactAccessGrantRow).filter(Boolean),
  };
}

async function canAccessPrivateArtifacts({ paperId, requesterWallet, submissionArtifact, publicationArtifact }) {
  const wallet = normalizeWallet(requesterWallet);
  if (!paperId) return false;
  if (!wallet) return false;

  if (wallet === normalizeWallet(submissionArtifact?.author_wallet || publicationArtifact?.author_wallet)) {
    return true;
  }

  const result = await db.execute({
    sql: `SELECT role FROM artifact_access_grants WHERE paper_id = ? AND wallet_address = ? LIMIT 1`,
    args: [paperId, wallet],
  });
  return Boolean(result.rows[0]);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendNoContent(res);
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    const walletIdentityMatch = url.pathname.match(/^\/api\/auth\/wallets\/([^/]+)$/);
    if (req.method === "GET" && walletIdentityMatch) {
      const walletAddress = normalizeWallet(decodeURIComponent(walletIdentityMatch[1]));
      sendJson(res, 200, await getWalletIdentity(walletAddress));
      return;
    }

    const walletResetMatch = url.pathname.match(/^\/api\/auth\/wallets\/([^/]+)\/reset-email$/);
    if (req.method === "POST" && walletResetMatch) {
      const walletAddress = normalizeWallet(decodeURIComponent(walletResetMatch[1]));
      const result = await resetWalletIdentity(walletAddress);
      if (result?.error) {
        sendJson(res, result.statusCode || 400, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    const otpSessionMatch = url.pathname.match(/^\/api\/auth\/otp\/session\/([^/]+)$/);
    if (req.method === "GET" && otpSessionMatch) {
      const walletAddress = normalizeWallet(decodeURIComponent(otpSessionMatch[1]));
      sendJson(res, 200, { session: await getOtpSession(walletAddress) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/otp/request") {
      const body = await readJsonBody(req);
      const result = await requestOtp(body);
      if (result?.error) {
        sendJson(res, result.statusCode || 400, {
          error: result.error,
          attemptsLeft: result.attemptsLeft,
          cooldown: result.cooldown,
        });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/otp/verify") {
      const body = await readJsonBody(req);
      const result = await verifyOtp(body);
      if (result?.error) {
        sendJson(res, result.statusCode || 400, {
          error: result.error,
          attemptsLeft: result.attemptsLeft,
        });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/otp/reset") {
      const body = await readJsonBody(req);
      const result = await resetOtpSession(body.walletAddress);
      if (result?.error) {
        sendJson(res, result.statusCode || 400, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ipfs/access/sync") {
      const body = await readJsonBody(req);
      const result = await syncArtifactAccess(body);
      if (result?.error) {
        sendJson(res, result.statusCode || 400, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ipfs/reviews") {
      const body = await readJsonBody(req);
      const { paperId, reviewerWallet, vote, summary, strengths, weaknesses, requiredChanges, submittedDate, reviewHash } = body;
      if (!paperId || !reviewerWallet || !vote) {
        sendJson(res, 400, { error: "paperId, reviewerWallet, and vote are required." });
        return;
      }
      const reviewDoc = {
        paperId,
        reviewerWallet: String(reviewerWallet).toLowerCase(),
        vote,
        summary: summary || "",
        strengths: strengths || "",
        weaknesses: weaknesses || "",
        requiredChanges: requiredChanges || "",
        submittedDate: submittedDate || new Date().toISOString().split("T")[0],
        reviewHash: reviewHash || "",
        pinnedAt: new Date().toISOString(),
      };
      const reviewBuffer = Buffer.from(JSON.stringify(reviewDoc, null, 2), "utf8");
      const reviewCid = await pinToIPFS(reviewBuffer, `review-${reviewHash || Date.now()}.json`);
      sendJson(res, 201, { reviewCid });
      return;
    }

    const reviewArtifactMatch = url.pathname.match(/^\/api\/ipfs\/reviews\/([^/]+)$/);
    if (req.method === "GET" && reviewArtifactMatch) {
      const rawCid = decodeURIComponent(reviewArtifactMatch[1] || "");
      const cid = rawCid.startsWith("ipfs://") ? rawCid : `ipfs://${rawCid}`;
      try {
        const payload = JSON.parse(readFileSync(artifactPathForCid(cid, ".json"), "utf8"));
        sendJson(res, 200, { review: payload });
      } catch {
        sendJson(res, 404, { error: "Review artifact not found." });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ipfs/submissions") {
      const body = await readJsonBody(req);
      const result = await createSubmissionArtifacts(body);
      if (result?.error) {
        sendJson(res, 400, { error: result.error });
        return;
      }
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/papers/published") {
      const papers = await getPublishedPapers();
      sendJson(res, 200, { papers });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ipfs/publications/official") {
      const body = await readJsonBody(req);
      const result = await createOfficialPublicationArtifacts(body);
      if (result?.error) {
        sendJson(res, result.statusCode || 400, { error: result.error });
        return;
      }
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ipfs/publications") {
      const body = await readJsonBody(req);
      const result = await createPublicationArtifacts(body);
      if (result?.error) {
        sendJson(res, 400, { error: result.error });
        return;
      }
      sendJson(res, 201, result);
      return;
    }

    const artifactMatch = url.pathname.match(/^\/api\/ipfs\/papers\/([^/]+)\/artifacts$/);
    if (req.method === "GET" && artifactMatch) {
      const paperId = normalizePaperId(decodeURIComponent(artifactMatch[1]));
      const requesterWallet = normalizeWallet(url.searchParams.get("requesterWallet") || "");

      const subResult = await db.execute({
        sql: `SELECT * FROM paper_artifacts WHERE paper_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
        args: [paperId, "submission"],
      });
      const submissionRow = subResult.rows[0] || null;

      const pubResult = await db.execute({
        sql: `SELECT * FROM paper_artifacts WHERE paper_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
        args: [paperId, "publication"],
      });
      const publicationRow = pubResult.rows[0] || null;

      const submission = mapArtifactRow(submissionRow);
      const publication = mapArtifactRow(publicationRow);

      const privateAccessAllowed = await canAccessPrivateArtifacts({
        paperId,
        requesterWallet,
        submissionArtifact: submissionRow,
        publicationArtifact: publicationRow,
      });

      if (privateAccessAllowed) {
        sendJson(res, 200, {
          paperId,
          access: "private",
          submission,
          publication,
        });
        return;
      }

      if (publication?.visibility === "public") {
        sendJson(res, 200, {
          paperId,
          access: "public",
          submission: null,
          publication,
        });
        return;
      }

      sendJson(res, 403, {
        error: "forbidden",
        paperId,
      });
      return;
    }

    const rejectMatch = url.pathname.match(/^\/api\/ipfs\/papers\/([^/]+)\/reject$/);
    if (req.method === "POST" && rejectMatch) {
      const paperId = normalizePaperId(decodeURIComponent(rejectMatch[1]));
      if (!paperId) {
        sendJson(res, 400, { error: "paperId is required." });
        return;
      }
      const cleanupAfter = addDaysToIsoDateTime(Date.now(), REJECTED_ARTIFACT_GRACE_DAYS);
      await db.execute({
        sql: `UPDATE paper_artifacts
              SET pin_status = 'eligible_for_cleanup', cleanup_after = ?, updated_at = CURRENT_TIMESTAMP
              WHERE paper_id = ? AND stage = 'submission' AND pin_status IN ('temporary', 'private')`,
        args: [cleanupAfter, paperId],
      });
      sendJson(res, 200, {
        ok: true,
        paperId,
        cleanupAfter,
        policy: "eligible_for_cleanup_after_grace_period",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/papers/stats") {
      const ids = String(url.searchParams.get("ids") || "")
        .split(",")
        .map(normalizePaperId)
        .filter(Boolean);
      const identityKey = normalizeIdentityKey(url.searchParams.get("identityKey") || "");
      const stats = {};
      for (const paperId of ids) {
        stats[paperId] = await getStatsForPaper(paperId, identityKey);
      }
      sendJson(res, 200, { stats });
      return;
    }

    const ratingMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/rating$/);
    if (req.method === "POST" && ratingMatch) {
      const paperId = normalizePaperId(decodeURIComponent(ratingMatch[1]));
      const body = await readJsonBody(req);
      const identityKey = normalizeIdentityKey(body.identityKey);
      const rating = normalizeRating(body.rating);

      if (!paperId || !identityKey || rating == null) {
        sendJson(res, 400, { error: "paperId, identityKey, and a 1-5 half-step rating are required." });
        return;
      }

      await db.execute({
        sql: `INSERT INTO paper_ratings (paper_id, identity_key, rating, created_at, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT(paper_id, identity_key) DO UPDATE SET
                rating = excluded.rating,
                updated_at = CURRENT_TIMESTAMP`,
        args: [paperId, identityKey, rating],
      });
      await upsertAggregatedStats(paperId);
      sendJson(res, 200, await getStatsForPaper(paperId, identityKey));
      return;
    }

    // GET /api/review-sessions?walletAddress=0x...
    // Returns all review sessions, optionally filtered to a single author wallet.
    if (req.method === "GET" && url.pathname === "/api/review-sessions") {
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      const result = await db.execute({
        sql: wallet
          ? `SELECT session_data FROM review_sessions WHERE author_wallet = ? ORDER BY updated_at DESC`
          : `SELECT session_data FROM review_sessions ORDER BY updated_at DESC`,
        args: wallet ? [wallet] : [],
      });
      const sessions = result.rows.map((row) => {
        try { return JSON.parse(row.session_data); } catch { return null; }
      }).filter(Boolean);
      sendJson(res, 200, { sessions });
      return;
    }

    // GET /api/submission-metadata?walletAddress=0x...
    // Returns all author submission metadata for a wallet.
    if (req.method === "GET" && url.pathname === "/api/submission-metadata") {
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      if (!wallet) {
        sendJson(res, 400, { error: "walletAddress is required." });
        return;
      }
      const result = await db.execute({
        sql: `SELECT metadata_data FROM submission_metadata WHERE author_wallet = ? ORDER BY updated_at DESC`,
        args: [wallet],
      });
      const items = result.rows.map((row) => {
        try { return JSON.parse(row.metadata_data); } catch { return null; }
      }).filter(Boolean);
      sendJson(res, 200, { items });
      return;
    }

    // PUT /api/submission-metadata/:metadataId
    // Upserts a single author submission metadata blob.
    const submissionMetadataMatch = url.pathname.match(/^\/api\/submission-metadata\/([^/]+)$/);
    if (req.method === "PUT" && submissionMetadataMatch) {
      const metadataId = decodeURIComponent(submissionMetadataMatch[1]);
      const body = await readJsonBody(req);
      const wallet = normalizeWallet(body.authorWallet);
      const title = String(body.title || "").trim();
      const titleKey = normalizeTitleKey(body.titleKey || title);
      const paperId = String(body.paperId || "").trim() || null;
      if (!metadataId || !wallet || !titleKey || !title) {
        sendJson(res, 400, { error: "metadataId, authorWallet, and title are required." });
        return;
      }
      const metadataData = JSON.stringify(body);
      await db.execute({
        sql: `INSERT INTO submission_metadata (metadata_id, author_wallet, title_key, paper_id, metadata_data, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT(metadata_id, author_wallet) DO UPDATE SET
                title_key = excluded.title_key,
                paper_id = excluded.paper_id,
                metadata_data = excluded.metadata_data,
                updated_at = CURRENT_TIMESTAMP`,
        args: [metadataId, wallet, titleKey, paperId, metadataData],
      });
      sendJson(res, 200, { ok: true, metadataId, authorWallet: wallet });
      return;
    }

    // DELETE /api/submission-metadata/:metadataId?walletAddress=0x...
    if (req.method === "DELETE" && submissionMetadataMatch) {
      const metadataId = decodeURIComponent(submissionMetadataMatch[1]);
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      if (!metadataId || !wallet) {
        sendJson(res, 400, { error: "metadataId and walletAddress are required." });
        return;
      }
      await db.execute({
        sql: `DELETE FROM submission_metadata WHERE metadata_id = ? AND author_wallet = ?`,
        args: [metadataId, wallet],
      });
      sendJson(res, 200, { ok: true, metadataId, authorWallet: wallet });
      return;
    }

    // PUT /api/review-sessions/:sessionId
    // Upserts a single review session (full JSON blob).
    const reviewSessionMatch = url.pathname.match(/^\/api\/review-sessions\/([^/]+)$/);
    if (req.method === "PUT" && reviewSessionMatch) {
      const sessionId = decodeURIComponent(reviewSessionMatch[1]);
      const body = await readJsonBody(req);
      const wallet = normalizeWallet(body.authorWallet);
      if (!sessionId || !wallet) {
        sendJson(res, 400, { error: "sessionId and authorWallet are required." });
        return;
      }
      const existingResult = await db.execute({
        sql: `SELECT session_data FROM review_sessions WHERE session_id = ? AND author_wallet = ? LIMIT 1`,
        args: [sessionId, wallet],
      });
      let existingSession = null;
      try {
        existingSession = existingResult.rows?.[0]?.session_data
          ? JSON.parse(existingResult.rows[0].session_data)
          : null;
      } catch {
        existingSession = null;
      }
      const mergedSession = mergeReviewSessionData(existingSession, body);
      const sessionData = JSON.stringify(mergedSession);
      await db.execute({
        sql: `INSERT INTO review_sessions (session_id, author_wallet, session_data, created_at, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT(session_id, author_wallet) DO UPDATE SET
                session_data = excluded.session_data,
                updated_at = CURRENT_TIMESTAMP`,
        args: [sessionId, wallet, sessionData],
      });
      sendJson(res, 200, { ok: true, sessionId, authorWallet: wallet });
      return;
    }

    // DELETE /api/review-sessions/:sessionId?walletAddress=0x...
    if (req.method === "DELETE" && reviewSessionMatch) {
      const sessionId = decodeURIComponent(reviewSessionMatch[1]);
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      if (!sessionId || !wallet) {
        sendJson(res, 400, { error: "sessionId and walletAddress are required." });
        return;
      }
      await db.execute({
        sql: `DELETE FROM review_sessions WHERE session_id = ? AND author_wallet = ?`,
        args: [sessionId, wallet],
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // GET /api/audit-log?walletAddress=0x...
    if (req.method === "GET" && url.pathname === "/api/audit-log") {
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      if (!wallet) { sendJson(res, 400, { error: "walletAddress is required." }); return; }
      const result = await db.execute({
        sql: `SELECT event_data FROM audit_log_events WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT 500`,
        args: [wallet],
      });
      const events = result.rows.map((r) => JSON.parse(r.event_data));
      sendJson(res, 200, { events });
      return;
    }

    // POST /api/audit-log — append one event
    if (req.method === "POST" && url.pathname === "/api/audit-log") {
      const body = await readJsonBody(req);
      const wallet = normalizeWallet(body.walletAddress || "");
      const event = body.event;
      if (!wallet || !event?.id) { sendJson(res, 400, { error: "walletAddress and event.id are required." }); return; }
      await db.execute({
        sql: `INSERT OR IGNORE INTO audit_log_events (id, wallet_address, timestamp, status, event_data) VALUES (?, ?, ?, ?, ?)`,
        args: [event.id, wallet, event.timestamp || new Date().toISOString(), event.status || "", JSON.stringify(event)],
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // GET /api/reputation?walletAddress=0x...
    if (req.method === "GET" && url.pathname === "/api/reputation") {
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      if (!wallet) { sendJson(res, 400, { error: "walletAddress is required." }); return; }
      const result = await db.execute({
        sql: `SELECT reviewer_rep, stats_data FROM reviewer_reputation WHERE wallet_address = ?`,
        args: [wallet],
      });
      if (result.rows.length === 0) {
        sendJson(res, 200, { reviewerRep: 50, reviewerStats: { total: 0, onTime: 0, late: 0, missed: 0 } });
      } else {
        const row = result.rows[0];
        sendJson(res, 200, { reviewerRep: row.reviewer_rep, reviewerStats: JSON.parse(row.stats_data) });
      }
      return;
    }

    // PUT /api/reputation — upsert reputation for a wallet
    if (req.method === "PUT" && url.pathname === "/api/reputation") {
      const body = await readJsonBody(req);
      const wallet = normalizeWallet(body.walletAddress || "");
      if (!wallet) { sendJson(res, 400, { error: "walletAddress is required." }); return; }
      const reviewerRep = Number(body.reviewerRep ?? 50);
      const statsData = JSON.stringify(body.reviewerStats || {});
      await db.execute({
        sql: `INSERT INTO reviewer_reputation (wallet_address, reviewer_rep, stats_data, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(wallet_address) DO UPDATE SET reviewer_rep=excluded.reviewer_rep, stats_data=excluded.stats_data, updated_at=CURRENT_TIMESTAMP`,
        args: [wallet, reviewerRep, statsData],
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // GET /api/profile?walletAddress=0x...
    if (req.method === "GET" && url.pathname === "/api/profile") {
      const wallet = normalizeWallet(url.searchParams.get("walletAddress") || "");
      if (!wallet) { sendJson(res, 400, { error: "walletAddress is required." }); return; }
      const result = await db.execute({
        sql: `SELECT display_name FROM wallet_profiles WHERE wallet_address = ?`,
        args: [wallet],
      });
      const displayName = result.rows.length > 0 ? result.rows[0].display_name : "";
      sendJson(res, 200, { displayName });
      return;
    }

    // PUT /api/profile — upsert display name for a wallet
    if (req.method === "PUT" && url.pathname === "/api/profile") {
      const body = await readJsonBody(req);
      const wallet = normalizeWallet(body.walletAddress || "");
      const displayName = String(body.displayName || "").trim();
      if (!wallet) { sendJson(res, 400, { error: "walletAddress is required." }); return; }
      await db.execute({
        sql: `INSERT INTO wallet_profiles (wallet_address, display_name, updated_at)
              VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(wallet_address) DO UPDATE SET display_name=excluded.display_name, updated_at=CURRENT_TIMESTAMP`,
        args: [wallet, displayName],
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // GET /api/assignments/my-papers?wallet=0x...
    if (req.method === "GET" && url.pathname === "/api/assignments/my-papers") {
      const wallet = normalizeWallet(url.searchParams.get("wallet") || "");
      if (!wallet) { sendJson(res, 400, { error: "wallet is required." }); return; }
      await checkExpiredAssignments();
      const result = await db.execute({
        sql: `SELECT ra.paper_id, ra.assigned_at, ra.expires_at, ra.status, ra.is_tiebreaker,
                     COALESCE(NULLIF(ra.paper_title, ''), json_extract(sm.metadata_data, '$.title'), '') AS paper_title
              FROM reviewer_assignments ra
              LEFT JOIN submission_metadata sm ON sm.paper_id = ra.paper_id
              WHERE ra.reviewer_wallet = ? AND ra.author_wallet != ra.reviewer_wallet
                AND ra.status IN ('pending', 'accepted')
              ORDER BY ra.assigned_at DESC`,
        args: [wallet],
      });
      const assignments = result.rows.map((r) => ({
        paperId: r.paper_id,
        assignedAt: Number(r.assigned_at),
        expiresAt: Number(r.expires_at),
        status: r.status,
        isTiebreaker: Boolean(r.is_tiebreaker),
        paperTitle: String(r.paper_title || ""),
      }));
      sendJson(res, 200, { assignments });
      return;
    }

    // POST /api/assignments/accept
    if (req.method === "POST" && url.pathname === "/api/assignments/accept") {
      await checkExpiredAssignments();
      const body = await readJsonBody(req);
      const paperId = normalizePaperId(body.paperId);
      const reviewerWallet = normalizeWallet(body.reviewerWallet);
      if (!paperId || !reviewerWallet) {
        sendJson(res, 400, { error: "paperId and reviewerWallet are required." });
        return;
      }
      const assignmentResult = await db.execute({
        sql: `SELECT id, assigned_at, status, author_wallet FROM reviewer_assignments
              WHERE paper_id = ? AND reviewer_wallet = ? LIMIT 1`,
        args: [paperId, reviewerWallet],
      });
      const assignment = assignmentResult.rows[0] || null;
      if (!assignment) {
        sendJson(res, 404, { error: "Assignment not found." });
        return;
      }
      if (normalizeWallet(assignment.author_wallet) === normalizeWallet(reviewerWallet)) {
        sendJson(res, 403, { error: "Authors cannot accept review assignments for their own papers." });
        return;
      }
      if (assignment.status !== "pending") {
        sendJson(res, 409, { error: `Assignment is already ${assignment.status}.` });
        return;
      }
      const assignedAt = Number(assignment.assigned_at);
      const now = Date.now();
      const timeDelta = Math.floor((now - assignedAt) / 1000);
      let flagLevel = "none";
      if (timeDelta < ACCEPT_BLOCK_SECONDS) {
        await db.execute({
          sql: `INSERT INTO assignment_timing_log
                  (paper_id, reviewer_wallet, assigned_at, accepted_at, time_delta_seconds, flag_level, flag_reason)
                VALUES (?, ?, ?, ?, ?, 'blocked', 'accepted_too_quickly')`,
          args: [paperId, reviewerWallet, assignedAt, now, timeDelta],
        });
        sendJson(res, 429, {
          error: "cooldown",
          message: "Please wait a moment before accepting this assignment.",
          retryAfterSeconds: ACCEPT_BLOCK_SECONDS - timeDelta,
        });
        return;
      }
      if (timeDelta < ACCEPT_SUSPICIOUS_SECONDS) {
        flagLevel = "suspicious";
      }
      await db.execute({
        sql: `INSERT INTO assignment_timing_log
                (paper_id, reviewer_wallet, assigned_at, accepted_at, time_delta_seconds, flag_level)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [paperId, reviewerWallet, assignedAt, now, timeDelta, flagLevel],
      });
      await db.execute({
        sql: `UPDATE reviewer_assignments SET status = 'accepted' WHERE id = ?`,
        args: [assignment.id],
      });
      sendJson(res, 200, { ok: true, paperId, reviewerWallet });
      return;
    }

    // POST /api/assignments/decline
    if (req.method === "POST" && url.pathname === "/api/assignments/decline") {
      const body = await readJsonBody(req);
      const paperId = normalizePaperId(body.paperId);
      const reviewerWallet = normalizeWallet(body.reviewerWallet);
      if (!paperId || !reviewerWallet) {
        sendJson(res, 400, { error: "paperId and reviewerWallet are required." });
        return;
      }
      const assignmentResult = await db.execute({
        sql: `SELECT id, author_wallet, paper_title FROM reviewer_assignments
              WHERE paper_id = ? AND reviewer_wallet = ? AND status = 'pending' LIMIT 1`,
        args: [paperId, reviewerWallet],
      });
      const assignment = assignmentResult.rows[0] || null;
      if (!assignment) {
        sendJson(res, 404, { error: "Pending assignment not found." });
        return;
      }
      await db.execute({
        sql: `UPDATE reviewer_assignments SET status = 'declined' WHERE id = ?`,
        args: [assignment.id],
      });
      const replacement = await assignReviewers(paperId, assignment.author_wallet, 1, false, assignment.paper_title || "");
      console.log(`[Assignments] Replacement triggered for paper ${paperId}: ${replacement.assigned.length} found`);
      sendJson(res, 200, { ok: true, paperId, reviewerWallet, replacementAssigned: replacement.assigned.length });
      return;
    }

    // GET /api/admin/timing-flags — for demo/audit purposes
    if (req.method === "GET" && url.pathname === "/api/admin/timing-flags") {
      const result = await db.execute({
        sql: `SELECT paper_id, reviewer_wallet, assigned_at, accepted_at, time_delta_seconds, flag_level, flag_reason
              FROM assignment_timing_log WHERE flag_level != 'none' ORDER BY accepted_at DESC LIMIT 200`,
        args: [],
      });
      sendJson(res, 200, { flags: result.rows });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Reader interactions API listening on http://${HOST}:${PORT}`);
  startChainListener({ assignReviewers, checkExpiredAssignments, db }).catch((err) => {
    console.error("[ChainListener] Failed to start:", err?.message);
  });
});
