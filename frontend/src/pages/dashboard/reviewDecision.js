export const REVIEW_VOTE = Object.freeze({
  ACCEPT: "accept",
  NEUTRAL: "neutral",
  REJECT: "reject",
});

function countVotes(votes) {
  return votes.reduce(
    (acc, vote) => {
      if (vote === REVIEW_VOTE.ACCEPT) acc.accept += 1;
      if (vote === REVIEW_VOTE.NEUTRAL) acc.neutral += 1;
      if (vote === REVIEW_VOTE.REJECT) acc.reject += 1;
      return acc;
    },
    { accept: 0, neutral: 0, reject: 0 }
  );
}

function evaluateThreeReviewerVotes(votes) {
  const counts = countVotes(votes);

  if (counts.accept >= 2) {
    return { status: "accepted", counts };
  }

  if (counts.reject >= 2) {
    return { status: "rejected", counts };
  }

  return { status: "disputed", counts };
}

function evaluateBinaryRebuttalVotes(votes) {
  if (!Array.isArray(votes) || votes.some((vote) => vote !== REVIEW_VOTE.ACCEPT && vote !== REVIEW_VOTE.REJECT)) {
    return { status: "pending", counts: { accept: 0, reject: 0 } };
  }

  const counts = votes.reduce(
    (acc, vote) => {
      if (vote === REVIEW_VOTE.ACCEPT) acc.accept += 1;
      if (vote === REVIEW_VOTE.REJECT) acc.reject += 1;
      return acc;
    },
    { accept: 0, reject: 0 }
  );

  if (counts.accept >= 2) {
    return { status: "accepted", counts };
  }

  if (counts.reject >= 2) {
    return { status: "rejected", counts };
  }

  return { status: "pending", counts };
}

export function evaluateReviewOutcome({
  votes,
  rebuttalVotes,
  reviewDeadlinePassed = false,
  panelIsValid = true,
}) {
  const governance = {
    threeReviewerOnly: true,
    canAuthorChangeCondition: false,
    canOriginalThreeReviewersChangeCondition: true,
  };

  if (!panelIsValid) {
    return {
      phase: "terminal",
      finalStatus: "abandoned",
      governance,
      initial: null,
      rebuttal: null,
      payout: null,
    };
  }

  const initial = evaluateThreeReviewerVotes(votes);

  if (initial.status !== "disputed") {
    return {
      phase: "initial",
      finalStatus: initial.status,
      governance,
      initial,
      rebuttal: null,
      payout: null,
    };
  }

  const rebuttal = rebuttalVotes ? evaluateBinaryRebuttalVotes(rebuttalVotes) : null;

  if (rebuttal && (rebuttal.status === "accepted" || rebuttal.status === "rejected")) {
    return {
      phase: "rebuttal",
      finalStatus: rebuttal.status,
      governance,
      initial,
      rebuttal,
      payout: null,
    };
  }

  if (!rebuttalVotes) {
    if (reviewDeadlinePassed) {
      return {
        phase: "terminal",
        finalStatus: "abandoned",
        governance,
        initial,
        rebuttal: null,
        payout: null,
      };
    }
    return {
      phase: "rebuttal",
      finalStatus: "awaiting-reviewer-rebuttal",
      governance,
      initial,
      rebuttal: null,
      payout: null,
    };
  }

  if (reviewDeadlinePassed) {
    return {
      phase: "terminal",
      finalStatus: "abandoned",
      governance,
      initial,
      rebuttal,
      payout: null,
    };
  }

  return {
    phase: "rebuttal",
    finalStatus: "awaiting-reviewer-rebuttal",
    governance,
    initial,
    rebuttal,
    payout: null,
  };
}
