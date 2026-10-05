/**
 * The escalation codebook: the written criteria every escalation claim on
 * the platform has to meet, and the rules that turn coded reports into a
 * level.
 *
 * Two things read this file, and they read the SAME definitions:
 *   - the article-coding prompt (lib/escalationCoder.ts) is generated from
 *     INDICATORS and EXCLUSIONS, so the model is coding against exactly the
 *     criteria listed here;
 *   - decideLevel() below applies fixed, published thresholds to the coded
 *     reports. The model never assigns "elevated" or "critical" itself — it
 *     only records what the article says, with a quote for each indicator.
 *
 * Every incident shown to a user carries `criteriaMet` (the rule sentences
 * that fired) and the list of indicators with their supporting quotes and
 * sources, so "why is this flagged?" always has a concrete answer.
 */

export type IndicatorId =
  // Critical tier
  | "mass_atrocity"
  | "major_territorial_change"
  | "coup_or_mutiny"
  | "interstate_hostilities"
  | "ceasefire_collapse"
  // Military-posture tier
  | "air_or_drone_strike"
  | "heavy_weapons"
  | "armed_clash"
  | "offensive_or_advance"
  | "territorial_change"
  | "mobilisation_or_reinforcement"
  | "siege_or_blockade"
  | "ceasefire_violation"
  // Contextual tier
  | "attack_on_civilians"
  | "attack_on_security_forces"
  | "ied_or_bombing"
  | "intercommunal_violence"
  | "mass_displacement"
  | "emergency_measures";

export type IndicatorTier = "critical" | "posture" | "contextual";

export interface IndicatorDef {
  id: IndicatorId;
  label: string;
  tier: IndicatorTier;
  /** What must be reported, as a concrete event, for this to be coded. */
  definition: string;
}

export const INDICATORS: IndicatorDef[] = [
  {
    id: "mass_atrocity",
    label: "Mass atrocity",
    tier: "critical",
    definition:
      "A massacre or mass killing of civilians (10 or more civilians reported killed in one incident or one connected series of attacks), or ethnic cleansing / forced mass expulsion of a population.",
  },
  {
    id: "major_territorial_change",
    label: "Major territorial change",
    tier: "critical",
    definition:
      "Capture, fall or loss of a national, regional or state capital, another major town, or a strategic installation (airport, main military base or headquarters, border crossing, dam, oil or port facility).",
  },
  {
    id: "coup_or_mutiny",
    label: "Coup or mutiny",
    tier: "critical",
    definition: "A coup, attempted coup, mutiny, or other seizure or attempted seizure of power by armed actors.",
  },
  {
    id: "interstate_hostilities",
    label: "Interstate hostilities",
    tier: "critical",
    definition: "An armed exchange, strike, or armed incursion between the forces of two different states.",
  },
  {
    id: "ceasefire_collapse",
    label: "Ceasefire or peace deal collapse",
    tier: "critical",
    definition:
      "A ceasefire or peace agreement reported as collapsed, abandoned or formally withdrawn from, together with resumed fighting. (A single breach with the agreement still nominally in force is ceasefire_violation instead.)",
  },
  {
    id: "air_or_drone_strike",
    label: "Air or drone strike",
    tier: "posture",
    definition: "An airstrike, drone strike or other aerial bombardment that has taken place.",
  },
  {
    id: "heavy_weapons",
    label: "Heavy weapons use",
    tier: "posture",
    definition: "Use of artillery, shelling, mortars, rockets, tanks or other heavy weapons.",
  },
  {
    id: "armed_clash",
    label: "Armed clash",
    tier: "posture",
    definition: "Direct fighting between two organised armed actors (state forces, rebel or insurgent groups, militias). Not a protest, a riot, or ordinary crime.",
  },
  {
    id: "offensive_or_advance",
    label: "Offensive or advance",
    tier: "posture",
    definition: "A new offensive launched, or forces advancing on or moving against a named location.",
  },
  {
    id: "territorial_change",
    label: "Territorial change",
    tier: "posture",
    definition: "Capture, loss or recapture of a village, minor town, position, camp or route (anything below the major_territorial_change threshold).",
  },
  {
    id: "mobilisation_or_reinforcement",
    label: "Mobilisation or reinforcement",
    tier: "posture",
    definition:
      "Troop mobilisation, a military build-up, or reinforcements moved toward a front or contested area in a combat context. Routine peacekeeping rotations, training exercises, parades and disaster-relief deployments do NOT count.",
  },
  {
    id: "siege_or_blockade",
    label: "Siege or blockade",
    tier: "posture",
    definition: "A town, camp or area placed under or held under siege or blockade by an armed actor, or a supply route cut by armed action.",
  },
  {
    id: "ceasefire_violation",
    label: "Ceasefire violation",
    tier: "posture",
    definition: "A reported breach of a ceasefire, truce or cessation-of-hostilities agreement.",
  },
  {
    id: "attack_on_civilians",
    label: "Attack on civilians",
    tier: "contextual",
    definition: "An armed attack, raid or abduction by an organised armed actor targeting civilians, with fewer than 10 reported killed.",
  },
  {
    id: "attack_on_security_forces",
    label: "Attack on security forces",
    tier: "contextual",
    definition: "An ambush, raid or assault by an armed group on soldiers, police, peacekeepers or their bases or convoys.",
  },
  {
    id: "ied_or_bombing",
    label: "Bombing or IED",
    tier: "contextual",
    definition: "A bombing, suicide attack, car bomb, IED or landmine blast.",
  },
  {
    id: "intercommunal_violence",
    label: "Intercommunal violence",
    tier: "contextual",
    definition: "Armed violence between communities, ethnic militias or herder/farmer groups with reported deaths.",
  },
  {
    id: "mass_displacement",
    label: "Mass displacement",
    tier: "contextual",
    definition: "A new wave of displacement (thousands or more people) directly caused by fighting or attacks reported in the same article.",
  },
  {
    id: "emergency_measures",
    label: "Emergency security measures",
    tier: "contextual",
    definition: "A state of emergency, curfew or border closure imposed in response to armed violence or a military threat.",
  },
];

export const INDICATOR_BY_ID: Record<string, IndicatorDef> = Object.fromEntries(INDICATORS.map((i) => [i.id, i]));
export const INDICATOR_IDS = INDICATORS.map((i) => i.id);

/** What is NOT an escalation report, whatever words it uses. The coding
 *  prompt lists these verbatim; an article that is only one of these is
 *  rejected with the matching reason and never reaches scoring. */
export const EXCLUSIONS: { id: string; description: string }[] = [
  { id: "commentary_or_analysis", description: "Opinion, analysis, explainers, interviews or think-tank commentary that describe a conflict in general without reporting a specific new event." },
  { id: "retrospective", description: "Anniversaries, retrospectives, obituaries, history pieces, or reports whose events are more than 7 days old at publication." },
  { id: "diplomatic_or_political_only", description: "Statements, summits, sanctions, elections, appointments, negotiations or accusations with no armed event reported." },
  { id: "humanitarian_only", description: "Aid appeals, funding shortfalls, disease outbreaks or food-security reporting with no new armed event." },
  { id: "legal_or_court", description: "Trials, verdicts, arrests, investigations or human-rights reports about past events." },
  { id: "routine_military_activity", description: "Training exercises, parades, graduations, procurement, peacekeeping rotations, promotions, base visits." },
  { id: "crime_or_unrest_without_armed_actor", description: "Ordinary crime, protests, strikes or riots with no organised armed actor and no military or lethal security-force action." },
  { id: "outside_africa", description: "The event took place outside Africa, even if African forces, citizens or governments are mentioned." },
  { id: "threat_or_warning_only", description: "Threats, warnings, predictions or fears of violence where nothing has actually happened yet. (Reported troop movements that have actually occurred are mobilisation_or_reinforcement, not this.)" },
  { id: "not_security_related", description: "Business, sport, culture, weather, accidents and other non-security news, including figurative uses of conflict words." },
  { id: "unreadable", description: "The text is too short, garbled, paywalled or off-topic to code." },
];

// ── Level rules ──────────────────────────────────────────────────────────

/** Reports count toward an incident's level while their event is this recent. */
export const ACTIVE_WINDOW_HOURS = 72;
/** A single event with at least this many reported deaths is Critical. */
export const MASS_CASUALTY_THRESHOLD = 25;
/** A contextual-tier event with at least this many reported deaths is Elevated. */
export const NOTABLE_FATALITY_THRESHOLD = 5;
/** Distinct military-posture indicators, corroborated by two or more
 *  independent sources, that make an incident Critical. */
export const MULTI_DOMAIN_POSTURE_COUNT = 3;

export type EscalationLevel = "none" | "watch" | "elevated" | "critical";
export type Trajectory = "escalation" | "continuation" | "de-escalation" | "unclear";
export type Confidence = "high" | "medium" | "low";

export interface ScoringReport {
  /** Independent-source key — the publisher's domain. Two articles from the
   *  same outlet are one source. */
  sourceKey: string;
  indicators: IndicatorId[];
  fatalities: number | null;
  trajectory: Trajectory;
  confidence: Confidence;
}

export interface LevelDecision {
  level: EscalationLevel;
  /** Plain-language statements of each rule that fired — shown to the user. */
  criteriaMet: string[];
  /** Why the incident is not higher, or not flagged — kept for the audit log. */
  notes: string[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Turns the verified reports for one incident into a level.
 *
 * CRITICAL — any one of:
 *   C1. a critical-tier indicator in a report coded with medium or high
 *       confidence, or in two or more independent sources;
 *   C2. MASS_CASUALTY_THRESHOLD or more deaths reported for a single event,
 *       in a report coded with medium or high confidence or with two or more
 *       independent sources on the incident (one low-confidence source —
 *       typically a headline not yet read in full — makes it Elevated);
 *   C3. MULTI_DOMAIN_POSTURE_COUNT or more distinct military-posture
 *       indicators, reported by two or more independent sources.
 *
 * ELEVATED — any one of:
 *   E1. a military-posture indicator in a report coded with medium or high
 *       confidence, or in two or more independent sources;
 *   E2. a contextual indicator AND at least one of: two or more independent
 *       sources; NOTABLE_FATALITY_THRESHOLD or more deaths; the article
 *       itself describes the event as an escalation. (Several contextual
 *       indicators from ONE report do not qualify on their own — a single
 *       roadside bomb that hits a patrol is both a bombing and an attack on
 *       security forces, and is still one routine event.)
 *   E3. a military-posture or critical-tier indicator that does not count on
 *       its own (one low-confidence source — typically a headline not yet
 *       read in full) AND at least one of: NOTABLE_FATALITY_THRESHOLD or
 *       more deaths; a second independent source reporting an armed event at
 *       the same place. A lone low-confidence report of a strike with no
 *       stated deaths still flags nothing.
 *
 * WATCH — a real, coded event that meets none of the above (kept in the
 * audit log, not shown as an alert).
 *
 * A report the article itself frames as de-escalation (withdrawal, truce
 * taking hold) contributes nothing.
 */
export function decideLevel(reports: ScoringReport[]): LevelDecision {
  const criteriaMet: string[] = [];
  const notes: string[] = [];
  const live = reports.filter((r) => r.trajectory !== "de-escalation" && r.indicators.length > 0);
  if (live.length === 0) return { level: "none", criteriaMet, notes: ["No report with a verified indicator in the active window."] };

  const sources = new Set(live.map((r) => r.sourceKey));
  const sourcesFor = (id: IndicatorId) => new Set(live.filter((r) => r.indicators.includes(id)).map((r) => r.sourceKey));
  const confidentFor = (id: IndicatorId) => live.some((r) => r.indicators.includes(id) && r.confidence !== "low");
  const present = (tier: IndicatorTier) => INDICATORS.filter((d) => d.tier === tier && live.some((r) => r.indicators.includes(d.id)));
  const qualifies = (id: IndicatorId) => confidentFor(id) || sourcesFor(id).size >= 2;

  let level: EscalationLevel = "watch";

  // C1
  for (const d of present("critical")) {
    if (qualifies(d.id)) {
      level = "critical";
      criteriaMet.push(`${d.label} reported (${plural(sourcesFor(d.id).size, "source")}) — a critical-tier indicator.`);
    } else {
      notes.push(`${d.label} reported by a single low-confidence source — not counted until corroborated.`);
    }
  }

  // C2
  const maxFatalities = Math.max(0, ...live.map((r) => r.fatalities ?? 0));
  if (maxFatalities >= MASS_CASUALTY_THRESHOLD) {
    // A toll this high makes an incident Critical once it rests on more than
    // one unread headline: a report coded with medium or high confidence, or
    // two independent sources. Until then it is Elevated.
    if (sources.size >= 2 || live.some((r) => (r.fatalities ?? 0) >= MASS_CASUALTY_THRESHOLD && r.confidence !== "low")) {
      level = "critical";
      criteriaMet.push(`${maxFatalities} deaths reported in a single event (threshold for Critical: ${MASS_CASUALTY_THRESHOLD}).`);
    } else {
      if (level !== "critical") level = "elevated";
      criteriaMet.push(`${maxFatalities} deaths reported by one source at low confidence — Elevated until a second source reports it or the article is read in full (threshold for Critical: ${MASS_CASUALTY_THRESHOLD}).`);
    }
  }

  // C3 / E1
  const posture = present("posture");
  const qualifyingPosture = posture.filter((d) => qualifies(d.id));
  if (qualifyingPosture.length >= MULTI_DOMAIN_POSTURE_COUNT && sources.size >= 2) {
    level = "critical";
    criteriaMet.push(
      `${qualifyingPosture.length} distinct military-posture indicators (${qualifyingPosture.map((d) => d.label.toLowerCase()).join(", ")}) across ${plural(sources.size, "independent source")}.`
    );
  }
  for (const d of posture) {
    if (qualifies(d.id)) {
      if (level !== "critical") level = "elevated";
      criteriaMet.push(`${d.label} reported (${plural(sourcesFor(d.id).size, "source")}).`);
    } else {
      notes.push(`${d.label} reported by a single low-confidence source — not counted until corroborated.`);
    }
  }

  // E2
  const contextual = present("contextual");
  if (contextual.length > 0) {
    const reasons: string[] = [];
    const contextualSources = new Set(live.filter((r) => r.indicators.some((id) => INDICATOR_BY_ID[id]?.tier === "contextual")).map((r) => r.sourceKey));
    if (contextualSources.size >= 2) reasons.push(`${contextualSources.size} independent sources`);
    if (maxFatalities >= NOTABLE_FATALITY_THRESHOLD) reasons.push(`${maxFatalities} deaths reported`);
    if (live.some((r) => r.trajectory === "escalation" && r.confidence !== "low")) reasons.push("described in the reporting as an escalation");
    const labels = contextual.map((d) => d.label.toLowerCase()).join(", ");
    if (reasons.length > 0) {
      if (level === "watch") level = "elevated";
      criteriaMet.push(`${labels.charAt(0).toUpperCase()}${labels.slice(1)} reported, with ${reasons.join("; ")}.`);
    } else {
      notes.push(`${labels.charAt(0).toUpperCase()}${labels.slice(1)} reported by one source with fewer than ${NOTABLE_FATALITY_THRESHOLD} deaths and no escalation framing — below the Elevated threshold.`);
    }
  }

  // E3
  const uncorroborated = [...present("critical"), ...posture].filter((d) => !qualifies(d.id));
  if (level === "watch" && uncorroborated.length > 0) {
    const reps = live.filter((r) => r.indicators.some((id) => uncorroborated.some((d) => d.id === id)));
    const deaths = Math.max(0, ...reps.map((r) => r.fatalities ?? 0));
    const reasons: string[] = [];
    if (sources.size >= 2) reasons.push(`${sources.size} independent sources reporting armed events here`);
    if (deaths >= NOTABLE_FATALITY_THRESHOLD) reasons.push(`${deaths} deaths reported`);
    if (reasons.length > 0) {
      level = "elevated";
      const labels = uncorroborated.map((d) => d.label.toLowerCase()).join(", ");
      criteriaMet.push(`${labels.charAt(0).toUpperCase()}${labels.slice(1)} reported by one source not yet corroborated, with ${reasons.join("; ")}.`);
    }
  }

  if (level === "watch") notes.push("Coded as a real event but below every Elevated criterion.");
  return { level, criteriaMet, notes };
}

/** The criteria as text, for the coding prompt and for the UI's "how is
 *  this decided" panel. */
export function codebookText(): string {
  const tierTitle: Record<IndicatorTier, string> = {
    critical: "CRITICAL-TIER INDICATORS",
    posture: "MILITARY-POSTURE INDICATORS",
    contextual: "CONTEXTUAL INDICATORS",
  };
  const parts: string[] = [];
  for (const tier of ["critical", "posture", "contextual"] as IndicatorTier[]) {
    parts.push(`${tierTitle[tier]}\n${INDICATORS.filter((i) => i.tier === tier).map((i) => `- ${i.id}: ${i.definition}`).join("\n")}`);
  }
  parts.push(`NOT AN ESCALATION REPORT (reject with the matching reason)\n${EXCLUSIONS.map((e) => `- ${e.id}: ${e.description}`).join("\n")}`);
  return parts.join("\n\n");
}
