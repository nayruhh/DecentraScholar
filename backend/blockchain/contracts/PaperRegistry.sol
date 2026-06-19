// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";

contract PaperRegistry is OwnableLite {
    enum PaperStatus {
        None,
        Submitted,
        UnderReview,
        RevisionRequested,
        Accepted,
        Rejected,
        Published,
        Abandoned
    }

    struct Paper {
        bytes32 paperId;
        address author;
        string title;
        string category;
        // Submission CIDs are intended for review-stage artifacts. In the production workflow,
        // the manuscript PDF should be pinned to IPFS at submission time but kept private/unlisted
        // until acceptance/publication.
        string abstractCid;
        string submissionMetadataCid;
        // This CID should point only to the final accepted publication package that is pinned
        // long-term for public access. Rejected manuscripts should never receive a public
        // publication CID.
        string publicationMetadataCid;
        string doi;
        uint64 submittedAt;
        uint64 publishedAt;
        PaperStatus status;
    }

    mapping(bytes32 => Paper) private papers;
    mapping(address => bool) public editors;
    address public reviewManager;
    mapping(bytes32 => mapping(address => bool)) public decisionAcknowledged;

    event EditorUpdated(address indexed editor, bool allowed);
    event ReviewManagerUpdated(address indexed reviewManager);
    event PaperSubmitted(bytes32 indexed paperId, address indexed author, string title);
    event PaperUpdated(bytes32 indexed paperId, string abstractCid, string submissionMetadataCid);
    event PaperStatusUpdated(bytes32 indexed paperId, PaperStatus status);
    event PaperPublished(bytes32 indexed paperId, address indexed publisher, string doi);

    event DecisionAcknowledged(bytes32 indexed paperId, address indexed author);

    error Unauthorized();
    error PaperAlreadyExists();
    error PaperMissing();
    error InvalidStatus();
    error EmptyString();
    constructor(address initialOwner) OwnableLite(initialOwner) {}

    modifier onlyEditorOrOwner() {
        if (msg.sender != owner && !editors[msg.sender]) revert Unauthorized();
        _;
    }

    modifier onlyReviewManager() {
        if (msg.sender != reviewManager) revert Unauthorized();
        _;
    }

    function setEditor(address editor, bool allowed) external onlyOwner {
        if (editor == address(0)) revert ZeroAddress();
        editors[editor] = allowed;
        emit EditorUpdated(editor, allowed);
    }

    function setReviewManager(address nextReviewManager) external onlyOwner {
        if (nextReviewManager == address(0)) revert ZeroAddress();
        reviewManager = nextReviewManager;
        emit ReviewManagerUpdated(nextReviewManager);
    }

    function submitPaper(
        bytes32 paperId,
        string calldata title,
        string calldata category,
        string calldata abstractCid,
        string calldata submissionMetadataCid
    ) external {
        if (paperId == bytes32(0)) revert EmptyString();
        if (bytes(title).length == 0 || bytes(category).length == 0) revert EmptyString();
        if (papers[paperId].paperId != bytes32(0)) revert PaperAlreadyExists();

        papers[paperId] = Paper({
            paperId: paperId,
            author: msg.sender,
            title: title,
            category: category,
            abstractCid: abstractCid,
            submissionMetadataCid: submissionMetadataCid,
            publicationMetadataCid: "",
            doi: "",
            submittedAt: uint64(block.timestamp),
            publishedAt: 0,
            status: PaperStatus.Submitted
        });

        emit PaperSubmitted(paperId, msg.sender, title);
    }

    function updateSubmission(
        bytes32 paperId,
        string calldata abstractCid,
        string calldata submissionMetadataCid
    ) external {
        Paper storage paper = _requirePaper(paperId);
        if (msg.sender != paper.author) revert Unauthorized();
        if (paper.status == PaperStatus.Published) revert InvalidStatus();

        paper.abstractCid = abstractCid;
        paper.submissionMetadataCid = submissionMetadataCid;

        emit PaperUpdated(paperId, abstractCid, submissionMetadataCid);
    }

    function beginReview(bytes32 paperId) external onlyReviewManager {
        Paper storage paper = _requirePaper(paperId);
        if (
            paper.status != PaperStatus.Submitted &&
            paper.status != PaperStatus.RevisionRequested &&
            paper.status != PaperStatus.Abandoned
        ) revert InvalidStatus();

        paper.status = PaperStatus.UnderReview;
        emit PaperStatusUpdated(paperId, paper.status);
    }

    function recordReviewDecision(bytes32 paperId, uint8 decision) external onlyReviewManager {
        Paper storage paper = _requirePaper(paperId);
        if (paper.status != PaperStatus.UnderReview) revert InvalidStatus();

        if (decision == 1) {
            paper.status = PaperStatus.Accepted;
        } else if (decision == 2) {
            paper.status = PaperStatus.Rejected;
        } else if (decision == 3) {
            paper.status = PaperStatus.RevisionRequested;
        } else if (decision == 4) {
            paper.status = PaperStatus.Abandoned;
        } else {
            revert InvalidStatus();
        }

        emit PaperStatusUpdated(paperId, paper.status);
    }

    function publishPaper(
        bytes32 paperId,
        string calldata doi,
        string calldata publicationMetadataCid
    ) external {
        Paper storage paper = _requirePaper(paperId);
        if (paper.status != PaperStatus.Accepted) revert InvalidStatus();
        if (msg.sender != paper.author && msg.sender != owner && !editors[msg.sender]) {
            revert Unauthorized();
        }
        // Future implementation policy:
        // See Software/NEXT_IMPLEMENTATION.md for the consolidated plan.
        // - call this only after the accepted final manuscript has been pinned to IPFS
        // - write the final public publication CID here
        // - rejected papers should keep their submission record but should not progress to this step

        paper.status = PaperStatus.Published;
        paper.doi = doi;
        paper.publicationMetadataCid = publicationMetadataCid;
        paper.publishedAt = uint64(block.timestamp);

        emit PaperPublished(paperId, msg.sender, doi);
        emit PaperStatusUpdated(paperId, paper.status);
    }


    function getPaper(bytes32 paperId) external view returns (Paper memory) {
        return _requirePaper(paperId);
    }

    function getPaperAuthor(bytes32 paperId) external view returns (address) {
        return papers[paperId].author;
    }

    function isPublished(bytes32 paperId) external view returns (bool) {
        return papers[paperId].status == PaperStatus.Published;
    }

    function paperExists(bytes32 paperId) external view returns (bool) {
        return papers[paperId].paperId != bytes32(0);
    }

    /// @notice Author acknowledges the review decision for their paper.
    ///         Replaces the localStorage-based authorReviewedDecisionAcks.
    function acknowledgeDecision(bytes32 paperId) external {
        Paper storage paper = _requirePaper(paperId);
        if (msg.sender != paper.author) revert Unauthorized();
        decisionAcknowledged[paperId][msg.sender] = true;
        emit DecisionAcknowledged(paperId, msg.sender);
    }

    /// @notice Check whether the paper's author has acknowledged the review decision.
    function hasAcknowledgedDecision(bytes32 paperId, address author) external view returns (bool) {
        return decisionAcknowledged[paperId][author];
    }

    function _requirePaper(bytes32 paperId) internal view returns (Paper storage paper) {
        paper = papers[paperId];
        if (paper.paperId == bytes32(0)) revert PaperMissing();
    }
}
