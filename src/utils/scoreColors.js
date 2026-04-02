/**
 * Maps an opportunity score (0–100) to a hex color.
 * Red (low) → Orange → Yellow → Lime → Green (high)
 */
export function scoreToHex(score) {
  if (score == null) return '#4b5a72';

  // Color stops at 0, 25, 50, 75, 100
  const stops = [
    [0,   [239, 68,  68]],   // #ef4444 red
    [25,  [249, 115, 22]],   // #f97316 orange
    [50,  [234, 179, 8]],    // #eab308 yellow
    [75,  [132, 204, 22]],   // #84cc16 lime
    [100, [34,  197, 94]],   // #22c55e green
  ];

  const s = Math.max(0, Math.min(100, score));

  for (let i = 0; i < stops.length - 1; i++) {
    const [lo, colorLo] = stops[i];
    const [hi, colorHi] = stops[i + 1];
    if (s >= lo && s <= hi) {
      const t = (s - lo) / (hi - lo);
      const r = Math.round(colorLo[0] + t * (colorHi[0] - colorLo[0]));
      const g = Math.round(colorLo[1] + t * (colorHi[1] - colorLo[1]));
      const b = Math.round(colorLo[2] + t * (colorHi[2] - colorLo[2]));
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
  }

  return '#22c55e';
}

/**
 * Returns a CSS background/text color pair for score badges.
 */
export function scoreBadgeStyle(score) {
  const hex = scoreToHex(score);
  return { backgroundColor: hex + '22', color: hex, border: `1px solid ${hex}44` };
}
