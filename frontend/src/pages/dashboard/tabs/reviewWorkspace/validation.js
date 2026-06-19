const BANNED_WORDS = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "pussy",
  "cunt",
  "motherfucker",
];

export function getContentValidationError(text, label) {
  if (!text) return "";

  if (containsBannedWord(text)) {
    return `${label} contains inappropriate language. Please remove it.`;
  }

  if (containsGibberishWord(text)) {
    return `${label} contains a suspicious long gibberish word. Please use meaningful words.`;
  }

  return "";
}

function containsBannedWord(text) {
  const normalized = String(text).toLowerCase();
  return BANNED_WORDS.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    return pattern.test(normalized);
  });
}

function containsGibberishWord(text) {
  const words = String(text).toLowerCase().match(/[a-z]{8,}/g) || [];
  return words.some((word) => isSuspiciousLongWord(word));
}

function isSuspiciousLongWord(word) {
  if (word.length < 12) return false;

  const vowels = (word.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / word.length;
  const uniqueRatio = new Set(word).size / word.length;
  const maxConsonantRun = getMaxConsonantRun(word);

  return maxConsonantRun >= 4 || uniqueRatio < 0.34 || (vowelRatio < 0.30 && uniqueRatio < 0.50);
}

function getMaxConsonantRun(word) {
  let best = 0;
  let run = 0;
  for (const ch of word) {
    if (/[aeiou]/.test(ch)) {
      run = 0;
    } else {
      run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}
