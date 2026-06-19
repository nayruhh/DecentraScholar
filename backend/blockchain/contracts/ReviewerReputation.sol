// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";

/// @title ReviewerReputation
/// @notice Tracks reviewer reputation scores and submission statistics on-chain.
///         Scores range 0–100, defaulting to 50. Only authorized coordinators
///         can update scores (called after review settlement).
contract ReviewerReputation is OwnableLite {
    int16 public constant DEFAULT_REP = 50;
    int16 public constant MAX_REP = 100;
    int16 public constant MIN_REP = 0;

    struct Reputation {
        int16  reviewerRep;
        uint32 total;
        uint32 onTime;
        uint32 late;
        uint32 missed;
        bool   initialized;
    }

    mapping(address => bool)       public coordinators;
    mapping(address => Reputation) private reputations;

    event CoordinatorUpdated(address indexed coordinator, bool allowed);
    event ReputationUpdated(
        address indexed reviewer,
        int16   reviewerRep,
        uint32  total,
        uint32  onTime,
        uint32  late,
        uint32  missed
    );

    error Unauthorized();

    constructor(address initialOwner) OwnableLite(initialOwner) {}

    modifier onlyCoordinator() {
        if (!coordinators[msg.sender] && msg.sender != owner) revert Unauthorized();
        _;
    }

    function setCoordinator(address coordinator, bool allowed) external onlyOwner {
        if (coordinator == address(0)) revert ZeroAddress();
        coordinators[coordinator] = allowed;
        emit CoordinatorUpdated(coordinator, allowed);
    }

    function _getOrInit(address reviewer) internal returns (Reputation storage rep) {
        rep = reputations[reviewer];
        if (!rep.initialized) {
            rep.reviewerRep = DEFAULT_REP;
            rep.initialized = true;
        }
    }

    /// @notice Record an on-time or late review submission. Called after settlement.
    function recordSubmission(address reviewer, bool onTime) external onlyCoordinator {
        Reputation storage rep = _getOrInit(reviewer);
        rep.total += 1;
        if (onTime) {
            rep.onTime += 1;
            int16 next = rep.reviewerRep + 2;
            rep.reviewerRep = next > MAX_REP ? MAX_REP : next;
        } else {
            rep.late += 1;
            int16 next = rep.reviewerRep - 4;
            rep.reviewerRep = next < MIN_REP ? MIN_REP : next;
        }
        emit ReputationUpdated(reviewer, rep.reviewerRep, rep.total, rep.onTime, rep.late, rep.missed);
    }

    /// @notice Record a reviewer no-show (missed deadline). Called after settlement.
    function recordNoShow(address reviewer) external onlyCoordinator {
        Reputation storage rep = _getOrInit(reviewer);
        rep.missed += 1;
        int16 next = rep.reviewerRep - 10;
        rep.reviewerRep = next < MIN_REP ? MIN_REP : next;
        emit ReputationUpdated(reviewer, rep.reviewerRep, rep.total, rep.onTime, rep.late, rep.missed);
    }

    /// @notice Read a reviewer's current reputation.
    function getReputation(address reviewer)
        external
        view
        returns (
            int16  reviewerRep,
            uint32 total,
            uint32 onTime,
            uint32 late,
            uint32 missed
        )
    {
        Reputation storage rep = reputations[reviewer];
        reviewerRep = rep.initialized ? rep.reviewerRep : DEFAULT_REP;
        total  = rep.total;
        onTime = rep.onTime;
        late   = rep.late;
        missed = rep.missed;
    }
}
