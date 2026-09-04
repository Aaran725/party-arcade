// The Okabe-Ito qualitative palette — the standard, empirically-validated colorblind-safe
// categorical color set (the same 8 hues behind matplotlib/seaborn's "colorblind" palette).
// The reference palette's 8th color is black; swapped here for a near-white so it still
// reads against this app's dark background instead of disappearing into it.
export const PLAYER_COLORS = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#E5E5E5", // near-white (replaces the reference palette's black)
];

export function colorForIndex(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}
