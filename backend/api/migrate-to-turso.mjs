/**
 * One-time migration: copies all data from the local SQLite file to Turso.
 * Run once: node migrate-to-turso.mjs
 *
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env (or environment).
 */

import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency)
try {
  const envPath = path.join(__dirname, ".env");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
} catch {
  // ignore if .env missing
}

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || TURSO_URL.startsWith("file:")) {
  console.error("TURSO_DATABASE_URL is not set or is a local file. Set it to a libsql://... URL.");
  process.exit(1);
}

// Try .sqlite first (older server versions used this name), fall back to .db
const LOCAL_DB_PATH = (() => {
  const candidates = [
    path.join(__dirname, "data", "reader-interactions.sqlite"),
    path.join(__dirname, "data", "reader-interactions.db"),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p); // just check it exists and is readable
      return p;
    } catch {
      // try next
    }
  }
  throw new Error("No local SQLite database found in data/");
})();

console.log(`Reading from: ${LOCAL_DB_PATH}`);
console.log(`Writing to:   ${TURSO_URL}\n`);

const localDb = new DatabaseSync(LOCAL_DB_PATH);
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

async function migrateTable(tableName, rows, buildInsert) {
  if (!rows.length) {
    console.log(`  ${tableName}: 0 rows (skipping)`);
    return;
  }
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const { sql, args } = buildInsert(row);
      await turso.execute({ sql, args });
      inserted++;
    } catch (err) {
      // UNIQUE constraint = already exists, skip
      if (String(err?.message || "").includes("UNIQUE")) {
        skipped++;
      } else {
        console.warn(`  ${tableName} row error:`, err.message, row);
      }
    }
  }
  console.log(`  ${tableName}: ${inserted} inserted, ${skipped} skipped (already existed)`);
}

// ── paper_stats ────────────────────────────────────────────────────────────────
const paperStats = localDb.prepare("SELECT * FROM paper_stats").all();
await migrateTable("paper_stats", paperStats, (r) => ({
  sql: `INSERT OR IGNORE INTO paper_stats
        (paper_id, download_count, rating_count, rating_total, average_rating, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
  args: [r.paper_id, r.download_count, r.rating_count, r.rating_total, r.average_rating, r.updated_at],
}));

// ── paper_ratings ──────────────────────────────────────────────────────────────
const paperRatings = localDb.prepare("SELECT * FROM paper_ratings").all();
await migrateTable("paper_ratings", paperRatings, (r) => ({
  sql: `INSERT OR IGNORE INTO paper_ratings
        (paper_id, identity_key, rating, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
  args: [r.paper_id, r.identity_key, r.rating, r.created_at, r.updated_at],
}));

// ── paper_download_events ──────────────────────────────────────────────────────
const downloadEvents = localDb.prepare("SELECT * FROM paper_download_events").all();
await migrateTable("paper_download_events", downloadEvents, (r) => ({
  sql: `INSERT INTO paper_download_events
        (paper_id, identity_key, downloaded_at)
        VALUES (?, ?, ?)`,
  args: [r.paper_id, r.identity_key, r.downloaded_at],
}));

// ── paper_artifacts ────────────────────────────────────────────────────────────
const artifacts = localDb.prepare("SELECT * FROM paper_artifacts").all();
await migrateTable("paper_artifacts", artifacts, (r) => ({
  sql: `INSERT OR IGNORE INTO paper_artifacts
        (paper_id, author_wallet, stage, manuscript_cid, abstract_cid, metadata_cid,
         file_name, mime_type, visibility, pin_status, source_metadata_cid,
         created_at, updated_at, cleanup_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    r.paper_id, r.author_wallet, r.stage, r.manuscript_cid, r.abstract_cid, r.metadata_cid,
    r.file_name, r.mime_type, r.visibility, r.pin_status, r.source_metadata_cid,
    r.created_at, r.updated_at, r.cleanup_after,
  ],
}));

// ── artifact_access_grants ─────────────────────────────────────────────────────
const accessGrants = localDb.prepare("SELECT * FROM artifact_access_grants").all();
await migrateTable("artifact_access_grants", accessGrants, (r) => ({
  sql: `INSERT OR IGNORE INTO artifact_access_grants
        (paper_id, wallet_address, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
  args: [r.paper_id, r.wallet_address, r.role, r.created_at, r.updated_at],
}));

// ── wallet_identities ──────────────────────────────────────────────────────────
const walletIdentities = localDb.prepare("SELECT * FROM wallet_identities").all();
await migrateTable("wallet_identities", walletIdentities, (r) => ({
  sql: `INSERT OR IGNORE INTO wallet_identities
        (wallet_address, email, verified_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
  args: [r.wallet_address, r.email, r.verified_at, r.created_at, r.updated_at],
}));

// ── otp_sessions ───────────────────────────────────────────────────────────────
let otpRows = [];
try {
  otpRows = localDb.prepare("SELECT * FROM otp_sessions").all();
} catch {
  // table may not exist in older DBs
}
await migrateTable("otp_sessions", otpRows, (r) => ({
  sql: `INSERT OR IGNORE INTO otp_sessions
        (wallet_address, email, otp_hash, expires_at, last_sent_at, attempts_left, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [r.wallet_address, r.email, r.otp_hash, r.expires_at, r.last_sent_at, r.attempts_left, r.created_at, r.updated_at],
}));

console.log("\nMigration complete.");
localDb.close();
