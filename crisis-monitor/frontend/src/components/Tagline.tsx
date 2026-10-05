import { Fragment } from "react";
import { ArrowRight } from "lucide-react";

const STEPS = ["Signals", "Insight", "Foresight"];

/** The site tagline — "Signals → Insight → Foresight" — with the arrows in
 *  the theme's accent colour (--signal, the same teal as "Lens" in the
 *  wordmark). Shared by the top bar and the sign-in screen so the two can
 *  never drift apart. */
export default function Tagline({ fontSize = 10.5 }: { fontSize?: number }) {
  return (
    <span
      className="eyebrow"
      aria-label="Signals to Insight to Foresight"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize, lineHeight: 1.3, whiteSpace: "nowrap" }}
    >
      {STEPS.map((step, i) => (
        <Fragment key={step}>
          {i > 0 && <ArrowRight size={fontSize + 3} strokeWidth={2.6} color="var(--signal)" aria-hidden="true" />}
          <span aria-hidden="true">{step}</span>
        </Fragment>
      ))}
    </span>
  );
}
