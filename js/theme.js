// Pastel colour per day. `bg` is the soft background, `ink` a darker tone of the
// same colour for text, borders and map pins (kept dark enough to read outdoors).
export const DAY_PALETTE = [
  { name: "lavender", bg: "#ECE6FA", ink: "#5B3FA8" },   // ✈️ arrival
  { name: "sakura", bg: "#FDE1EA", ink: "#B0245F" },     // day 1
  { name: "sky", bg: "#DCEBFF", ink: "#1C5DAA" },        // day 2
  { name: "mint", bg: "#DAF3E3", ink: "#22703D" },       // day 3
  { name: "peach", bg: "#FFE6D2", ink: "#B24A0B" },      // day 4
  { name: "lilac", bg: "#F1E2FA", ink: "#7A2D99" },      // day 5
  { name: "lemon", bg: "#FFF3C4", ink: "#7A5D00" },      // extra days…
  { name: "aqua", bg: "#D6F2F0", ink: "#0B6E69" },
  { name: "rose", bg: "#FBE3E0", ink: "#A33A2E" },
];

/** Palette entry for a trip day: April 2027 days by their number, others by position. */
export function dayColor(d, i) {
  const n = d?.planKey && /^apr-d\d$/.test(d.planKey) ? Number(d.planKey.slice(5)) : i + 1;
  return DAY_PALETTE[n % DAY_PALETTE.length];
}

export const dayStyle = (c) => `--day-bg:${c.bg};--day-ink:${c.ink}`;
