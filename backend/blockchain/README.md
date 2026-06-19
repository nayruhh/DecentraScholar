# DecentraScholar Smart Contracts

This blockchain package now mirrors the current frontend paper workflow instead of the sample `Counter` contract.

## Contract map

### `PaperRegistry.sol`
- Stores the canonical paper record.
- Tracks the lifecycle: `Submitted -> UnderReview -> RevisionRequested/Accepted/Rejected -> Published`.
- Lets an author submit and update a paper before publication.
- Lets an accepted paper be officially published by the author, owner, or editor.
- Stores publication fields that the frontend currently keeps in local state, such as title, category, DOI, and metadata CIDs.

### `ReviewManager.sol`
- Creates review sessions for a paper.
- Assigns reviewers and stores whether a reviewer may reveal identity after publication.
- Records submitted review payload references.
- Finalizes a session as `Accepted`, `Rejected`, or `RevisionRequested`.
- Pushes the resulting paper state back into `PaperRegistry`.

### `ReaderInteractions.sol`
- Tracks per-reader bookmarks.
- Tracks reads, downloads, and ratings for published papers.
- Enforces the frontend download rule on-chain: maximum `3` downloads per paper per reader per `24 hours`.
- Stores one rating per reader and maintains aggregate rating totals.

## Frontend to contract mapping

Current frontend logic in files such as:
- `frontend/src/pages/dashboard/tabs/paperStore.js`
- `frontend/src/pages/author/AuthorWorkspace.jsx`

maps to chain responsibilities like this:

### Publication flow
- `submitPaper(...)` in `PaperRegistry`
  Replaces locally created paper draft records.
- `createSession(...)` and `finalizeSession(...)` in `ReviewManager`
  Replaces local review session state and accepted/rejected/revision decisions.
- `publishPaper(...)` in `PaperRegistry`
  Replaces writing to `officialPublishedPapers` in local storage.

### Reader actions
- `setBookmark(...)` in `ReaderInteractions`
  Replaces `toggleSavePaper(...)`.
- `registerDownload(...)` and `getDownloadPolicy(...)` in `ReaderInteractions`
  Replace `markPaperDownloaded(...)` and `getPaperDownloadPolicy(...)`.
- `submitRating(...)` in `ReaderInteractions`
  Replaces `ratePaper(...)`.
- `recordRead(...)` in `ReaderInteractions`
  Provides an on-chain version of the read counter shown in browse/detail views.

## Tradeoffs

This contract set is a direct mapping of the current frontend logic, not a final production architecture.

Important implications:
- Strings and metadata are expensive on-chain. In production, most paper content should live off-chain in IPFS/Arweave, with only hashes/CIDs on-chain.
- On-chain download limits can account for access attempts, but they cannot by themselves stop file sharing after someone has already obtained the file.
- Bookmarks are user preference data. Keeping them on-chain is possible, but it is costlier than storing them client-side.
- Reviewer comments and identities are represented as references (`bytes32 reviewCid`) rather than full plaintext review objects.

## Intended IPFS lifecycle

For future implementation, the intended storage policy is:

- On submission:
  - author pays the submission fee
  - the actual PDF is uploaded to IPFS
  - the platform pins the manuscript temporarily
  - the resulting submission CID is stored in backend / contract metadata
  - visibility remains restricted to the author and assigned reviewers

- If accepted:
  - the final accepted version becomes the official publication artifact
  - that final version is pinned long-term
  - the paper is exposed publicly on the platform
  - the final `publicationMetadataCid` is written on-chain

- If rejected:
  - keep the fact that the submission existed and its status/history
  - do not expose the PDF publicly
  - unpin the manuscript after a grace period
  - optionally allow the author to download their own copy before cleanup

## Running tests

```powershell
npx.cmd hardhat test
```

## Deployment

Ignition module:
- `ignition/modules/DecentraScholar.ts`

Example local deploy:

```powershell
npx.cmd hardhat ignition deploy ignition/modules/DecentraScholar.ts
```
