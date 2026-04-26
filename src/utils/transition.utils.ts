export function calcTransitionDelta(
  likelihood25: number | null,
  likelihood100: number | null,
  time25: number | null,
  time100: number | null,
): number | null {
  if (
    likelihood25 == null ||
    likelihood100 == null ||
    time25 == null ||
    time100 == null
  ) {
    return null;
  }

  const denominator = time100 - time25;
  if (denominator === 0) {
    return null;
  }

  const numerator = likelihood100 - likelihood25;
  const delta = numerator / denominator;

  // Guard against weird numeric edge cases (NaN/Infinity)
  if (!Number.isFinite(delta)) {
    return null;
  }

  return delta;
}
