/**
 * The conflict map's intensity scale, shared by the 2D and 3D maps and the legend.
 * Colour carries the meaning and the label carries it too, so no one has to tell the
 * tones apart to read the map.
 */
export const INTENSITY_STYLE: Record<1 | 2 | 3 | 4, { label: string; fill: string; opacity: number; line: string; lineOpacity: number; text: string }> = {
  1: { label: "Low", fill: "#f2d24b", opacity: 0.22, line: "#f7e27a", lineOpacity: 0.7, text: "watch-level reports only" },
  2: { label: "Moderate", fill: "#f2994a", opacity: 0.32, line: "#ffb36b", lineOpacity: 0.85, text: "an elevated report, or several watch-level ones" },
  3: { label: "High", fill: "#e0572a", opacity: 0.42, line: "#ff7a4d", lineOpacity: 0.95, text: "a critical report, or several elevated ones" },
  4: { label: "Severe", fill: "#b3121f", opacity: 0.55, line: "#ff4d5a", lineOpacity: 1, text: "several critical reports" },
};

/** Active conflict from UCDP (organised violence in the last 90 days), graded by killed. A separate purple scale, so
 *  it never reads as an alert. A country with an alert shows the alert colour, since that is the newer signal. */
export const ACTIVE_INTENSITY_STYLE: Record<1 | 2 | 3 | 4, { label: string; fill: string; opacity: number; line: string; lineOpacity: number; text: string }> = {
  1: { label: "Low", fill: "#9b8ad0", opacity: 0.2, line: "#b9a9e3", lineOpacity: 0.7, text: "under 20 killed in 90 days" },
  2: { label: "Moderate", fill: "#7d62c4", opacity: 0.3, line: "#9d86dc", lineOpacity: 0.85, text: "20 to 99 killed" },
  3: { label: "High", fill: "#5b3fb0", opacity: 0.4, line: "#7e62d0", lineOpacity: 0.95, text: "100 to 499 killed" },
  4: { label: "Severe", fill: "#3b1f8c", opacity: 0.52, line: "#6a4fc0", lineOpacity: 1, text: "500 or more killed" },
};

/** Tooltip text for one province or country; a trend (new, worsening, steady, improving) is added when given. */
export function intensityTooltip(p: { name: string; countryName?: string; intensity: 1 | 2 | 3 | 4; counts: { watch: number; elevated: number; critical: number }; trend?: string }): string {
  const place = p.countryName ? `${p.name}, ${p.countryName}` : p.name;
  const parts = [`${p.counts.critical} critical`, `${p.counts.elevated} elevated`, `${p.counts.watch} watch`];
  const trend = p.trend ? `, ${p.trend}` : "";
  return `${place}: ${INTENSITY_STYLE[p.intensity].label} intensity${trend} (${parts.join(", ")}, last 48 hours)`;
}
