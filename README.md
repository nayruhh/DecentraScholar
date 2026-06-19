# DecentraScholar Demo Guide

DecentraScholar is a full-stack prototype for paper submission, reviewer assignment, blind review, rebuttal, publication, and reader interaction using:

- Hardhat local blockchain
- Solidity smart contracts
- Node backend API
- Turso/libSQL database
- Vite React frontend
- Pinata/IPFS artifacts when configured

## Quick Start

Open PowerShell in the `Software` folder:

```powershell
powershell -ExecutionPolicy Bypass -File "run-local.ps1"
```

Wait until the script prints:

```txt
Backend API is ready on http://127.0.0.1:3001
Frontend is ready on http://127.0.0.1:5173
```

Then open:

```txt
http://127.0.0.1:5173
```

Use MetaMask with:

```txt
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
```

Import the demo private keys printed by `run-local.ps1`. Account `0` is the coordinator/system wallet, so use other accounts for author and reviewer testing.

## Normal Demo Flow

1. Start `run-local.ps1`.
2. Open the frontend.
3. Connect an author wallet.
4. Buy DST if required.
5. Upload and submit a paper.
6. Wait a few seconds for the chain listener to assign reviewers.
7. Switch MetaMask to an assigned reviewer.
8. Accept the review assignment and stake DST.
9. Submit blind reviews from reviewers.
10. The backend chain listener finalizes or moves the session to rebuttal based on votes.
11. The author can view final review feedback after the session is decided.

## Clean Demo Reset

For a clean demo, clear old app state before presenting:

1. Stop the stack with `Ctrl+C`.
2. Clear demo database rows, but keep wallet identities.
3. Restart:

```powershell
powershell -ExecutionPolicy Bypass -File "run-local.ps1"
```

4. Clear browser localStorage for `127.0.0.1:5173`, or use an incognito window.

Do not delete `wallet_identities` unless you want to re-register all demo accounts.

## If Something Fails

### 1. MetaMask Shows "Smart Contract Rejected" or "execution reverted"

Most likely causes:

- You are on the wrong MetaMask account.
- MetaMask is still using old transaction state after a local chain reset.
- The review session was created before the backend listener caught up.

Fix:

1. Confirm MetaMask is on `http://127.0.0.1:8545`, Chain ID `31337`.
2. Confirm the connected wallet is the assigned reviewer.
3. In MetaMask, go to `Settings -> Advanced -> Clear activity tab data`.
4. Refresh the frontend.
5. If it still fails, stop and restart `run-local.ps1`.

### 2. Paper Uploads but No Reviewers Are Assigned

Most likely cause:

- The chain listener missed the `PaperSubmitted` event or the backend was not ready.

Fix:

1. Leave the Hardhat node running.
2. Restart the backend/local stack.
3. Reupload the paper if the previous one has no review session.
4. Check that the backend console prints assignment messages.

Expected good state:

- `reviewer_assignments` has three rows for the paper.
- `ReviewManager.paperIdToSessionId(paperId)` returns a non-zero session ID.
- Each assigned reviewer has `assignedMapping=true`.

### 3. Reviewer Declines but Replacement Does Not Appear

Most likely causes:

- The declined-slot listener has not run yet.
- Browser cache is showing stale assignment data.

Fix:

1. Wait 10-20 seconds.
2. Refresh the reviewer workspace.
3. If still unchanged, restart `run-local.ps1`.

Expected good state:

- The declined reviewer row is `declined`.
- A new reviewer row is `pending`.
- The old on-chain slot is cleared to `0x0000000000000000000000000000000000000000`.
- The paper must not finalize until the replacement review path is resolved.

### 4. Paper Appears Twice in Reviewer Active Reviews

Most likely cause:

- Browser localStorage still has an old local session and a chain-discovered session for the same paper.

Fix:

1. Refresh the page.
2. If it remains duplicated, clear localStorage for `127.0.0.1:5173`.
3. Reopen the frontend and reconnect MetaMask.

### 5. Author Review Feedback Is Blank

Most likely causes:

- Review text has not hydrated from the pinned review CID yet.
- The frontend is showing stale cached review session data.

Fix:

1. Refresh the author workspace.
2. Wait a few seconds for session sync.
3. If still blank, restart the backend and refresh again.

Author review feedback is only visible after the review session reaches `decided`.

### 6. MetaMask Account Looks Correct but App Says Wrong Account

Fix:

1. Disconnect the site in MetaMask.
2. Refresh the frontend.
3. Reconnect the correct account.
4. Make sure the email/wallet registration matches the account you are testing.

### 7. Frontend Shows Old Papers After Database Cleanup

Most likely cause:

- The browser still has old sessions in localStorage.

Fix:

Use an incognito window, or clear site data for:

```txt
127.0.0.1:5173
```

### 8. Backend Cannot Reach Turso

Most likely causes:

- Internet connection issue.
- Turso credentials in `backend/api/.env` are missing or invalid.

Fix:

1. Check `backend/api/.env`.
2. Confirm `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are correct.
3. Restart `run-local.ps1`.

### 9. Pinata/IPFS Upload Fails

Most likely cause:

- `PINATA_JWT` is missing or invalid.

Fix:

1. Check `backend/api/.env`.
2. Confirm `PINATA_JWT` is set.
3. Restart the backend/local stack.

## Useful Verification Commands

From `Software/backend/blockchain`:

```powershell
npm.cmd test
```

From `Software/frontend`:

```powershell
npm.cmd run build
```

From `Software/backend/api`:

```powershell
node --check server.js
node --check chainListener.js
```

## Demo Rules of Thumb

- Restart the full stack before a formal demo.
- Use incognito mode to avoid stale frontend cache.
- Use the exact account that received the assignment email/row.
- Do not use account `0` as a reviewer; it is the coordinator.
- If the chain was reset, old DB rows may not match the current chain.
- If behavior looks impossible, clear localStorage and restart the stack before debugging further.

