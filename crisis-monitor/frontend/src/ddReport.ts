import type { DdOutcome } from "./api";

export const OUTCOME_LABEL: Record<DdOutcome, string> = {
  potential_sanctions_match: "Potential sanctions match",
  pep_indicators: "Public office indicators",
  adverse_media: "Serious adverse media",
  review: "Needs review",
  incomplete: "Incomplete: some sources unavailable",
  no_adverse_indicators: "No adverse indicators found in sources checked",
};

