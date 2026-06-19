# DecentraScholar

DecentraScholar is a full-stack prototype of a decentralised academic publishing platform. It combines Ethereum smart contracts, IPFS content-addressed storage, and a DST (DecentraScholar Token) economy to implement a complete paper lifecycle — submission, reviewer assignment, blind peer review, rebuttal, and publication — without relying on a central publisher.

---

## Abstract

Academic publishing suffers from centralisation risks, opaque review processes, and slow dissemination pipelines. DecentraScholar addresses these by implementing a hybrid architecture in which trust-critical state lives on-chain (submission records, reviewer commitments, token accounting, reputation scores) while mutable or privacy-sensitive data is stored off-chain (reviewer identities, review text before reveal, user profiles, interaction metadata).

The platform implements:
- A three-reviewer consensus model with a blind rebuttal stage and an automatic tiebreaker
- DST staking and slashing to incentivise timely, honest reviews
- On-chain reputation scoring that adjusts reviewer standing after each decision
- IPFS content pinning via Pinata for paper artefacts and review CIDs
- A reader interaction layer (save, rate, cite) that feeds on-chain usage signals
- A coordinator wallet pattern where a backend chain listener drives lifecycle transitions

All eight functional test scenarios pass on Hardhat 3 (local chain ID 31337).

---

## Contents

- [Architecture](#architecture)
- [Smart Contracts](#smart-contracts)
- [Technology Stack](#technology-stack)
- [Consensus Rules](#consensus-rules)
- [API Endpoints](#api-endpoints)
- [Test Results](#test-results)
- [Quick Start](#quick-start)
- [Setup](#setup)
- [Demo Flow](#demo-flow)
- [Troubleshooting](#troubleshooting)
- [Future Work](#future-work)

---

## Architecture

DecentraScholar uses a three-layer hybrid architecture:

```
┌─────────────────────────────────────────────────┐
│  Frontend  (React 19 + Vite 7, port 5173)        │
│  – Author workspace  – Reviewer workspace         │
│  – Reader browse     – Profile / DST wallet       │
└────────────────────┬────────────────────────────┘
                     │ HTTP / ethers.js
┌────────────────────▼────────────────────────────┐
│  Backend  (Node.js 20 built-in http, port 3001)  │
│  – REST API      – Chain listener (coordinator)  │
│  – Turso / libSQL cloud database                 │
└──────────┬──────────────────────┬───────────────┘
           │ libSQL               │ ethers.js
    ┌──────▼──────┐      ┌────────▼────────────────┐
    │  Turso DB   │      │  Hardhat local chain     │
    │  (off-chain │      │  7 Solidity contracts    │
    │   metadata) │      │  chain ID 31337          │
    └─────────────┘      └─────────────────────────┘
```

**On-chain (trust-critical):** paper registry, review sessions, DST token and treasury, reviewer reputation, reader interaction signals.

**Off-chain (mutable / private):** reviewer identities during blind review, review text before reveal, user profiles, email OTP verification, interaction metadata.

---

## Smart Contracts

Seven Solidity 0.8.28 contracts deployed in order via Hardhat Ignition:

| Contract | Responsibility |
|---|---|
| `DSTToken.sol` | ERC-20 utility token (DST) |
| `DSTTreasury.sol` | ETH ↔ DST swap pool; submission fee collection |
| `PaperRegistry.sol` | Paper submission, on-chain metadata, access control |
| `ReviewManager.sol` | Review sessions, vote tallying, rebuttal, tiebreaker |
| `DSTProtocolVault.sol` | Reviewer stake escrow and reward/slash distribution |
| `ReviewerReputation.sol` | On-chain reputation scores per reviewer address |
| `ReaderInteractions.sol` | Save, rate, and cite events for published papers |

### DST Token Economy

| Action | Effect |
|---|---|
| Paper submission | Author pays DST fee to treasury |
| Reviewer stake | Locked per assignment; returned + reward on completion |
| No-show / non-submission | Partial stake slashed |
| Fee distribution on accept | 75 % to reviewers, 25 % retained in protocol vault |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19, Vite 7 |
| Styling | Tailwind CSS 4 |
| Routing | React Router 7 |
| Animations | Framer Motion 12 |
| Blockchain client | ethers.js 6 |
| Wallet | MetaMask (browser extension) |
| Backend runtime | Node.js 20 (built-in `http` module) |
| Database | Turso / libSQL (distributed SQLite) |
| Smart contracts | Solidity 0.8.28 |
| Contract toolchain | Hardhat 3, Hardhat Ignition |
| IPFS pinning | Pinata HTTP API |
| Test framework | Hardhat + Chai |

---

## Consensus Rules

ReviewManager implements a two-round consensus model. Round 1 collects three blind votes (Accept / Reject). If the outcome is ambiguous, a rebuttal window opens and a second round vote is collected.

| Round 1 votes | Rebuttal vote | Final outcome |
|---|---|---|
| 3 Accept | — | **Accepted** |
| 3 Reject | — | **Rejected** |
| 2 Accept, 1 Reject | — | **Accepted** |
| 1 Accept, 2 Reject | — | **Rejected** |
| 2 Accept, 1 Reject | Reject (tiebreaker) | **Rejected** |
| 1 Accept, 2 Reject | Accept (tiebreaker) | **Accepted** |
| 2 Accept, 1 Reject | Accept (confirms majority) | **Accepted** |
| 1 Accept, 2 Reject | Reject (confirms majority) | **Rejected** |

A tiebreaker is triggered when the rebuttal vote contradicts the Round 1 majority. A randomly selected reviewer casts the deciding vote.

---

## API Endpoints

The Node.js backend exposes a REST API on `http://127.0.0.1:3001`:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/register` | Register wallet + email |
| `POST` | `/api/verify-otp` | Verify OTP and activate identity |
| `GET` | `/api/identity/:address` | Fetch identity record |
| `POST` | `/api/papers` | Store paper metadata |
| `GET` | `/api/papers` | List all papers |
| `GET` | `/api/papers/:id` | Get single paper |
| `GET` | `/api/reviewer-assignments/:address` | Get assignments for reviewer |
| `POST` | `/api/reviewer-assignments` | Create assignment record |
| `PATCH` | `/api/reviewer-assignments/:id` | Update assignment status |
| `GET` | `/api/review-sessions/:paperId` | Get session for paper |
| `POST` | `/api/reviews` | Store review submission |
| `GET` | `/api/reviews/:sessionId` | Get reviews for session |
| `GET` | `/api/reader-interactions/:paperId` | Get interaction counts |
| `POST` | `/api/reader-interactions` | Record reader interaction |

---

## Test Results

Eight functional test scenarios covering the complete paper lifecycle:

| ID | Scenario | Result |
|---|---|---|
| T1 | Full publish flow (submit → assign → 3 reviews → accept) | PASS |
| T2 | Fee split (75 % reviewer reward, 25 % vault retention) | PASS |
| T3 | Reviewer assignment guard (duplicate / wrong-role rejection) | PASS |
| T4 | Consensus: 2 Accept + 1 Reject → Accepted without rebuttal | PASS |
| T5 | Rebuttal deadlock + tiebreaker resolution | PASS |
| T6 | No-show slashing (reviewer misses deadline) | PASS |
| T7 | PaperRegistry access control (only owner can update) | PASS |
| T8 | ReaderInteractions guards (only published papers accept events) | PASS |

Run tests from `Software/backend/blockchain`:

```powershell
npm.cmd test
```

---

## Quick Start

Open PowerShell in the `Software` folder:

```powershell
powershell -ExecutionPolicy Bypass -File "run-local.ps1"
```

Wait until the script prints:

```
Backend API is ready on http://127.0.0.1:3001
Frontend is ready on http://127.0.0.1:5173
```

Then open `http://127.0.0.1:5173` in your browser.

Add MetaMask with:

```
RPC URL:  http://127.0.0.1:8545
Chain ID: 31337
```

Import any of the demo private keys printed by the script. **Account 0 is the system coordinator — use accounts 1–19 for testing author and reviewer roles.**

---

## Setup

See [SETUP.md](SETUP.md) for full prerequisites, dependency installation, environment variable configuration, MetaMask account table, and a step-by-step test flow.

---

## Demo Flow

1. Run `run-local.ps1` and open the frontend.
2. Connect an author wallet (account 1) and register with an email.
3. Buy DST tokens from the Profile tab.
4. Go to the Author workspace and submit a paper (pays DST fee).
5. Wait a few seconds — the backend chain listener assigns three reviewers automatically.
6. Switch MetaMask to an assigned reviewer account, accept the assignment, and stake DST.
7. Repeat for the second and third reviewer.
8. Each reviewer submits a blind review.
9. The chain listener tallies votes and finalises the session (or opens rebuttal if split).
10. Switch back to the author — the Author workspace shows the decision and review feedback.

### Clean Reset Before a Demo

1. Stop the stack with `Ctrl+C`.
2. Restart with `powershell -ExecutionPolicy Bypass -File "run-local.ps1"`.
3. Clear browser localStorage for `127.0.0.1:5173`, or use an incognito window.

Do not delete `wallet_identities` rows unless you want to re-register all demo accounts.

---

## Troubleshooting

### MetaMask shows "execution reverted"

You are on the wrong MetaMask account, or the local chain was restarted.

Fix: **Settings → Advanced → Clear activity tab data**, confirm you are on Chain ID 31337, then refresh the page.

### Paper uploads but no reviewers are assigned

The chain listener missed the `PaperSubmitted` event or the backend was not ready at submission time.

Fix: leave the Hardhat node running, restart the backend, then resubmit the paper.

### Reviewer declines but no replacement appears

The declined-slot listener has not run yet.

Fix: wait 10–20 seconds and refresh the reviewer workspace. If unchanged, restart `run-local.ps1`.

### Paper appears twice in Reviewer Active Reviews

Browser localStorage still has an old local session alongside the chain-discovered session for the same paper.

Fix: refresh the page. If still duplicated, clear localStorage for `127.0.0.1:5173` and reconnect MetaMask.

### Author review feedback is blank

Review text has not hydrated from the pinned CID yet, or the session has not reached `decided`.

Fix: refresh the author workspace and wait a few seconds for session sync.

### MetaMask account looks correct but the app says wrong account

Fix: disconnect the site in MetaMask, refresh the frontend, and reconnect the correct account. Confirm the email/wallet registration matches the account you are testing.

### Frontend shows old papers after database cleanup

The browser still has old sessions in localStorage.

Fix: use an incognito window, or clear site data for `127.0.0.1:5173`.

### Backend cannot reach Turso

Check that `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set correctly in `backend/api/.env`, then restart the stack.

### Pinata / IPFS upload fails

Check that `PINATA_JWT` is set in `backend/api/.env`. Without a valid JWT the system falls back to local review storage; the review flow still works end-to-end.

### Useful verification commands

```powershell
# Run smart contract tests
cd backend\blockchain
npm.cmd test

# Check frontend builds cleanly
cd frontend
npm.cmd run build

# Syntax-check backend entry points
cd backend\api
node --check server.js
node --check chainListener.js
```

---

## Future Work

- **Decentralised identity** — replace email OTP with a self-sovereign identity standard (W3C DID) to eliminate the central email verification step.
- **On-chain IPFS CID registry** — store paper and review CIDs in the smart contracts rather than only in the off-chain database, strengthening tamper-evidence guarantees.
- **DAO governance** — replace hardcoded fee percentages and staking parameters with on-chain governance votes by DST holders.
- **Multi-chain deployment** — deploy to a public testnet (e.g. Sepolia) or Layer 2 (e.g. Arbitrum) to reduce gas costs and allow broader access without a local Hardhat node.
- **Reviewer reputation as verifiable credentials** — issue non-transferable tokens representing verified reviewer standing, usable across platforms.
- **Automated pre-submission checks** — integrate an off-chain oracle to run plagiarism and format screening before a paper enters the review queue.
- **Field-of-expertise matching** — extend the reviewer assignment algorithm to weight candidates by declared domain expertise stored on-chain.
