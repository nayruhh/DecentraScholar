// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";

interface IPaperRegistryReviewHook {
    function beginReview(bytes32 paperId) external;
    function recordReviewDecision(bytes32 paperId, uint8 decision) external;
    function getPaperAuthor(bytes32 paperId) external view returns (address);
}

contract ReviewManager is OwnableLite {
    enum Decision {
        Pending,
        Accepted,
        Rejected,
        RevisionRequested,
        Abandoned
    }

    enum SessionPhase {
        Pending,
        BlindReview,
        Rebuttal,
        ReplacementReview,
        Decided
    }

    enum RoundStatus {
        Active,
        HighPriority,
        Incomplete,
        Failed,
        ReplacementRequested
    }

    struct ReviewSlot {
        address reviewer;
        bool identityMayReveal;
        bool accepted;
        bool declined;
        bool submitted;
        uint8 vote;
        string reviewCid;
        // Rebuttal round fields — set only during the Rebuttal phase
        bool rebuttalSubmitted;
        uint8 rebuttalVote;
        string rebuttalCid;
    }

    struct Session {
        uint256 sessionId;
        bytes32 paperId;
        uint64 deadline;
        uint8 revisionCycle;
        Decision decision;
        SessionPhase phase;
        RoundStatus roundStatus;
        bool highPriority;
        bool finalized;
        bytes32 resolutionReason;
        string rebuttalCid;
    }

    IPaperRegistryReviewHook public immutable registry;
    uint256 public nextSessionId = 1;

    mapping(address => bool) public coordinators;
    mapping(uint256 => Session) private sessions;
    mapping(uint256 => ReviewSlot[]) private sessionSlots;
    mapping(bytes32 => uint256) public paperIdToSessionId;
    mapping(uint256 => mapping(address => bool)) private _ejectedReviewers;
    mapping(bytes32 => mapping(address => bool)) public assignedReviewers;
    mapping(bytes32 => bool) public hasTiebreaker;

    event CoordinatorUpdated(address indexed coordinator, bool allowed);
    event SessionCreated(uint256 indexed sessionId, bytes32 indexed paperId, uint8 revisionCycle);
    event ReviewerJoined(uint256 indexed sessionId, address indexed reviewer, uint256 slotIndex);
    event AssignmentAccepted(uint256 indexed sessionId, address indexed reviewer);
    event AssignmentDeclined(uint256 indexed sessionId, address indexed reviewer);
    event ReviewSubmitted(uint256 indexed sessionId, address indexed reviewer, uint8 vote, string reviewCid);
    event RebuttalSubmitted(uint256 indexed sessionId, bytes32 indexed paperId, string rebuttalCid);
    event ReviewersAssigned(bytes32 indexed paperId, address[] reviewers);
    event TiebreakerAssigned(bytes32 indexed paperId, address indexed reviewer);
    event SessionStateUpdated(
        uint256 indexed sessionId,
        bytes32 indexed paperId,
        SessionPhase phase,
        RoundStatus roundStatus,
        bool highPriority,
        bytes32 reason
    );
    event SessionFinalized(
        uint256 indexed sessionId,
        bytes32 indexed paperId,
        Decision decision,
        bytes32 reason
    );

    error Unauthorized();
    error InvalidArrayLength();
    error SessionMissing();
    error InvalidDecision();
    error AlreadySubmitted();
    error AlreadyFinalized();
    error ReviewerNotAssigned();
    error AlreadyAccepted();
    error AlreadyDeclined();
    error NotPaperAuthor();
    error NotInRebuttalPhase();
    error SlotNotAvailable();
    error AlreadyJoined();
    error NotEligible();
    error ReviewerEjected();

    constructor(address initialOwner, address registryAddress) OwnableLite(initialOwner) {
        registry = IPaperRegistryReviewHook(registryAddress);
    }

    modifier onlyCoordinator() {
        if (msg.sender != owner && !coordinators[msg.sender]) revert Unauthorized();
        _;
    }

    function setCoordinator(address coordinator, bool allowed) external onlyOwner {
        coordinators[coordinator] = allowed;
        emit CoordinatorUpdated(coordinator, allowed);
    }

    /// @notice Records system-assigned reviewers for a paper in the on-chain mapping.
    ///         Called by the coordinator after selecting reviewers off-chain.
    function assignReviewers(bytes32 paperId, address[] calldata reviewers) external onlyCoordinator {
        for (uint256 i = 0; i < reviewers.length; i++) {
            assignedReviewers[paperId][reviewers[i]] = true;
        }
        emit ReviewersAssigned(paperId, reviewers);
    }

    /// @notice Records a tie-breaker reviewer for a deadlocked rebuttal panel.
    function assignTiebreaker(bytes32 paperId, address reviewer) external onlyCoordinator {
        assignedReviewers[paperId][reviewer] = true;
        hasTiebreaker[paperId] = true;
        emit TiebreakerAssigned(paperId, reviewer);
    }

    // -------------------------------------------------------------------------
    // Coordinator actions
    // -------------------------------------------------------------------------

    function createSession(
        bytes32 paperId,
        address[] calldata reviewers,
        bool[] calldata revealOnPublication,
        uint64 deadline,
        uint8 revisionCycle
    ) external onlyCoordinator returns (uint256 sessionId) {
        // reviewers may be empty (self-select mode) or pre-assigned.
        // If non-empty, arrays must be the same length.
        if (reviewers.length > 0 && reviewers.length != revealOnPublication.length) {
            revert InvalidArrayLength();
        }

        sessionId = nextSessionId++;
        sessions[sessionId] = Session({
            sessionId: sessionId,
            paperId: paperId,
            deadline: deadline,
            revisionCycle: revisionCycle,
            decision: Decision.Pending,
            phase: SessionPhase.BlindReview,
            roundStatus: RoundStatus.Active,
            highPriority: false,
            finalized: false,
            resolutionReason: bytes32(0),
            rebuttalCid: ""
        });

        paperIdToSessionId[paperId] = sessionId;

        if (reviewers.length > 0) {
            // Pre-assigned mode: push named reviewer slots
            for (uint256 i = 0; i < reviewers.length; i++) {
                assignedReviewers[paperId][reviewers[i]] = true;
                sessionSlots[sessionId].push(
                    ReviewSlot({
                        reviewer: reviewers[i],
                        identityMayReveal: revealOnPublication[i],
                        accepted: false,
                        declined: false,
                        submitted: false,
                        vote: 0,
                        reviewCid: "",
                        rebuttalSubmitted: false,
                        rebuttalVote: 0,
                        rebuttalCid: ""
                    })
                );
            }
            emit ReviewersAssigned(paperId, reviewers);
        } else {
            // Self-select mode: create 3 empty slots (address(0) = open)
            for (uint256 i = 0; i < 3; i++) {
                sessionSlots[sessionId].push(
                    ReviewSlot({
                        reviewer: address(0),
                        identityMayReveal: false,
                        accepted: false,
                        declined: false,
                        submitted: false,
                        vote: 0,
                        reviewCid: "",
                        rebuttalSubmitted: false,
                        rebuttalVote: 0,
                        rebuttalCid: ""
                    })
                );
            }
        }

        registry.beginReview(paperId);
        emit SessionCreated(sessionId, paperId, revisionCycle);
        emit SessionStateUpdated(
            sessionId,
            paperId,
            SessionPhase.BlindReview,
            RoundStatus.Active,
            false,
            bytes32(0)
        );
    }

    function setRebuttalPhase(uint256 sessionId, bytes32 reason) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();

        session.phase = SessionPhase.Rebuttal;
        session.roundStatus = RoundStatus.Active;
        session.resolutionReason = reason;

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
    }

    function requestReplacementReview(
        uint256 sessionId,
        uint64 nextDeadline,
        bool highPriority,
        bytes32 reason
    ) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (nextDeadline == 0) revert InvalidDecision();

        session.deadline = nextDeadline;
        session.phase = SessionPhase.ReplacementReview;
        session.roundStatus = RoundStatus.ReplacementRequested;
        session.highPriority = highPriority;
        session.resolutionReason = reason;

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
    }

    function markRoundIncomplete(
        uint256 sessionId,
        uint64 nextDeadline,
        bool highPriority,
        bytes32 reason
    ) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (nextDeadline == 0) revert InvalidDecision();

        session.deadline = nextDeadline;
        session.phase = SessionPhase.ReplacementReview;
        session.roundStatus = RoundStatus.Incomplete;
        session.highPriority = highPriority;
        session.resolutionReason = reason;

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
    }

    function markRoundFailed(
        uint256 sessionId,
        uint64 nextDeadline,
        bool highPriority,
        bytes32 reason
    ) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (nextDeadline == 0) revert InvalidDecision();

        session.deadline = nextDeadline;
        session.phase = SessionPhase.ReplacementReview;
        session.roundStatus = RoundStatus.Failed;
        session.highPriority = highPriority;
        session.resolutionReason = reason;

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
    }

    function setHighPriority(
        uint256 sessionId,
        bool highPriority,
        bytes32 reason
    ) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();

        session.highPriority = highPriority;
        if (session.roundStatus == RoundStatus.Active || session.roundStatus == RoundStatus.HighPriority) {
            session.roundStatus = highPriority ? RoundStatus.HighPriority : RoundStatus.Active;
        }
        session.resolutionReason = reason;

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
    }

    function extendDeadline(uint256 sessionId, uint64 nextDeadline, bytes32 reason) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (nextDeadline == 0) revert InvalidDecision();

        session.deadline = nextDeadline;
        session.resolutionReason = reason;

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
    }

    function finalizeSession(uint256 sessionId, Decision decision, bytes32 reason) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (decision == Decision.Pending) revert InvalidDecision();

        session.finalized = true;
        session.decision = decision;
        session.phase = SessionPhase.Decided;
        session.roundStatus = RoundStatus.Active;
        session.resolutionReason = reason;
        registry.recordReviewDecision(session.paperId, uint8(decision));

        emit SessionStateUpdated(
            sessionId,
            session.paperId,
            session.phase,
            session.roundStatus,
            session.highPriority,
            reason
        );
        emit SessionFinalized(sessionId, session.paperId, decision, reason);
    }

    // -------------------------------------------------------------------------
    // Reviewer actions — signed by the reviewer's own wallet
    // -------------------------------------------------------------------------

    /// @notice Reviewer accepts their assigned review slot.
    function acceptAssignment(uint256 sessionId) external {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();

        address author = registry.getPaperAuthor(session.paperId);
        require(msg.sender != author, "Author cannot review own paper");

        ReviewSlot[] storage slots = sessionSlots[sessionId];
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].reviewer == msg.sender) {
                if (slots[i].accepted) revert AlreadyAccepted();
                if (slots[i].declined) revert AlreadyDeclined();
                slots[i].accepted = true;
                emit AssignmentAccepted(sessionId, msg.sender);
                return;
            }
        }
        revert ReviewerNotAssigned();
    }

    /// @notice Reviewer declines their assigned review slot.
    function declineAssignment(uint256 sessionId) external {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();

        ReviewSlot[] storage slots = sessionSlots[sessionId];
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].reviewer == msg.sender) {
                if (slots[i].declined) revert AlreadyDeclined();
                slots[i].declined = true;
                emit AssignmentDeclined(sessionId, msg.sender);
                return;
            }
        }
        revert ReviewerNotAssigned();
    }

    /// @notice Reviewer self-selects into an open slot (address(0)) in a session.
    ///         Used in the self-select flow where sessions are created with empty slots.
    ///         The caller must not already be in the session, must not be the paper author,
    ///         and must not have a conflict of interest (checked off-chain via staking).
    function joinReview(uint256 sessionId, bool identityMayReveal) external {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (session.phase != SessionPhase.BlindReview && session.phase != SessionPhase.ReplacementReview) {
            revert SlotNotAvailable();
        }

        // Paper author cannot review their own submission
        address author = registry.getPaperAuthor(session.paperId);
        if (msg.sender == author) revert NotEligible();

        ReviewSlot[] storage slots = sessionSlots[sessionId];

        // Ensure caller is not already in any slot
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].reviewer == msg.sender) revert AlreadyJoined();
        }

        // Prevent an ejected reviewer from rejoining the same session
        if (_ejectedReviewers[sessionId][msg.sender]) revert ReviewerEjected();

        // Find first open slot (address(0))
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].reviewer == address(0)) {
                slots[i].reviewer = msg.sender;
                slots[i].identityMayReveal = identityMayReveal;
                slots[i].accepted = true; // self-select = auto-accepted
                assignedReviewers[session.paperId][msg.sender] = true;
                emit ReviewerJoined(sessionId, msg.sender, i);
                return;
            }
        }

        revert SlotNotAvailable();
    }

    /// @notice Reviewer submits their review or rebuttal vote.
    ///         During BlindReview: sets submitted/vote/reviewCid (one-time).
    ///         During Rebuttal: sets rebuttalSubmitted/rebuttalVote/rebuttalCid (one-time).
    function submitReview(uint256 sessionId, uint8 vote, string calldata reviewCid) external {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        require(assignedReviewers[session.paperId][msg.sender], "Not assigned to this paper");

        ReviewSlot[] storage slots = sessionSlots[sessionId];
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].reviewer == msg.sender) {
                if (session.phase == SessionPhase.Rebuttal) {
                    if (slots[i].rebuttalSubmitted) revert AlreadySubmitted();
                    slots[i].rebuttalSubmitted = true;
                    slots[i].rebuttalVote = vote;
                    slots[i].rebuttalCid = reviewCid;
                } else {
                    if (slots[i].submitted) revert AlreadySubmitted();
                    slots[i].submitted = true;
                    slots[i].vote = vote;
                    slots[i].reviewCid = reviewCid;
                }
                emit ReviewSubmitted(sessionId, msg.sender, vote, reviewCid);
                return;
            }
        }
        revert ReviewerNotAssigned();
    }

    /// @notice Coordinator clears a reviewer slot so another reviewer can self-select.
    ///         Used after a no-show is detected to reopen the slot.
    function clearReviewerSlot(uint256 sessionId, uint256 slotIndex) external onlyCoordinator {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        ReviewSlot[] storage slots = sessionSlots[sessionId];
        require(slotIndex < slots.length, "Invalid slot index");
        address ejected = slots[slotIndex].reviewer;
        if (ejected != address(0)) {
            _ejectedReviewers[sessionId][ejected] = true;
            assignedReviewers[session.paperId][ejected] = false;
        }
        slots[slotIndex].reviewer = address(0);
        slots[slotIndex].identityMayReveal = false;
        slots[slotIndex].accepted = false;
        slots[slotIndex].declined = false;
        slots[slotIndex].submitted = false;
        slots[slotIndex].vote = 0;
        slots[slotIndex].reviewCid = "";
        slots[slotIndex].rebuttalSubmitted = false;
        slots[slotIndex].rebuttalVote = 0;
        slots[slotIndex].rebuttalCid = "";
    }

    // -------------------------------------------------------------------------
    // Author actions — signed by the paper author's own wallet
    // -------------------------------------------------------------------------

    /// @notice Author submits their rebuttal response during the Rebuttal phase.
    ///         The rebuttalCid must point to the IPFS-pinned rebuttal document.
    function submitRebuttal(uint256 sessionId, string calldata rebuttalCid) external {
        Session storage session = _requireSession(sessionId);
        if (session.finalized) revert AlreadyFinalized();
        if (session.phase != SessionPhase.Rebuttal) revert NotInRebuttalPhase();

        address author = registry.getPaperAuthor(session.paperId);
        if (msg.sender != author) revert NotPaperAuthor();

        session.rebuttalCid = rebuttalCid;
        emit RebuttalSubmitted(sessionId, session.paperId, rebuttalCid);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getSession(uint256 sessionId) external view returns (Session memory) {
        return _requireSession(sessionId);
    }

    function getSessionByPaperId(bytes32 paperId) external view returns (Session memory) {
        uint256 sessionId = paperIdToSessionId[paperId];
        return _requireSession(sessionId);
    }

    function getReviewSlot(uint256 sessionId, uint256 slotIndex) external view returns (ReviewSlot memory) {
        Session storage session = _requireSession(sessionId);
        session;
        return sessionSlots[sessionId][slotIndex];
    }

    function getReviewerCount(uint256 sessionId) external view returns (uint256) {
        Session storage session = _requireSession(sessionId);
        session;
        return sessionSlots[sessionId].length;
    }

    function isEjectedFromSession(uint256 sessionId, address reviewer) external view returns (bool) {
        return _ejectedReviewers[sessionId][reviewer];
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _requireSession(uint256 sessionId) internal view returns (Session storage session) {
        session = sessions[sessionId];
        if (session.sessionId == 0) revert SessionMissing();
    }
}
