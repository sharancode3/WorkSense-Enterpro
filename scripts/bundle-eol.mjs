// Shared EOL normalization for the function-bundle drift check.
// Files checked out with CRLF (Windows) must compare equal to LF output; real
// code drift must still fail. Deterministic across platforms.
export function normalizeEol(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Compare a generated bundle string against what is on disk. */
export function sameBundle(expected, onDisk) {
  return normalizeEol(expected) === normalizeEol(onDisk);
}

/** Returns a human-readable drift reason, or null when the bundles match. */
export function driftReason(expected, onDisk) {
  if (sameBundle(expected, onDisk)) return null;
  const a = normalizeEol(expected);
  const b = normalizeEol(onDisk);
  const i = [...a].findIndex((c, idx) => b[idx] !== c);
  return `mismatch at character ${Math.max(0, i)} (code "${a[i] ?? "<end>"}" vs "${b[i] ?? "<end>"}")`;
}
