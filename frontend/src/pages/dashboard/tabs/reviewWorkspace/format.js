export function isSubmissionLate(submittedDate, deadline) {
  return String(submittedDate) > String(deadline);
}

export function getLateDays(submittedDate, deadline) {
  const submitted = new Date(`${submittedDate}T00:00:00Z`).getTime();
  const due = new Date(`${deadline}T00:00:00Z`).getTime();
  if (!Number.isFinite(submitted) || !Number.isFinite(due)) return 0;
  const diff = Math.ceil((submitted - due) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

export function roundTo2(value) {
  return Math.round(value * 100) / 100;
}

export function formatTokenAmount(value) {
  return roundTo2(Number(value || 0)).toFixed(2);
}

export function formatRating(value) {
  const normalized = Math.round(Number(value || 0) * 2) / 2;
  return normalized.toFixed(1);
}
