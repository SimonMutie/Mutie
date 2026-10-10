import { COUNTIES } from "./kenyaElection";
import { PLACES, STATES } from "./southSudanElection";
import type { WatchKey } from "../api";

/**
 * What differs between the two election watches: the categories and how
 * they are named and coloured, the places and the map. The dashboard and the
 * editor read this, so one set of components serves both countries.
 */
export interface WatchConfig {
  key: WatchKey;
  categories: string[];
  labels: Record<string, string>;
  help: Record<string, string>;
  colors: Record<string, string>;
  /** Every place a report can be filed under (the filter and form lists). */
  places: { code: string; name: string }[];
  /** The units drawn on the map. */
  mapUnits: { code: string; name: string }[];
  geoUrl: string;
  labelCodes: string[];
  noun: string;
  nouns: string;
  csvName: string;
  /** Plural of the category list's place word, used in copy. */
  placeWord: string;
  method: string;
  intro: string;
  heading: string;
  kicker: string;
}

export const KE_WATCH_CONFIG: WatchConfig = {
  key: "ke",
  categories: ["political_violence", "protest_policing", "abduction", "election_admin", "intimidation", "hate_speech", "disinformation", "coverage"],
  labels: {
    political_violence: "Political violence",
    protest_policing: "Protest violence and policing",
    abduction: "Abductions and disappearances",
    election_admin: "Attacks on election administration",
    intimidation: "Threats and intimidation",
    hate_speech: "Hate speech and incitement",
    disinformation: "Election disinformation",
    coverage: "Election coverage",
  },
  help: {
    political_violence: "Attacks, clashes, killings and arson linked to politicians, rallies or supporters.",
    protest_policing: "Deaths, injuries and force at protests and demonstrations.",
    abduction: "Abductions, kidnappings and disappearances of political actors, activists and critics.",
    election_admin: "Attacks on IEBC offices, registration centres and staff.",
    intimidation: "Reported threats, harassment and intimidation of candidates, voters and journalists.",
    hate_speech: "Reports of hate speech, ethnic incitement and NCIC action.",
    disinformation: "Reported fake or manipulated content about politics and the vote.",
  },
  colors: {
    political_violence: "#d1352b",
    protest_policing: "#e07a1f",
    abduction: "#8a3ffc",
    election_admin: "#2f66f0",
    intimidation: "#b3690b",
    hate_speech: "#c2185b",
    disinformation: "#0d9488",
  },
  places: COUNTIES.map((c) => ({ code: c.code, name: c.name })),
  mapUnits: COUNTIES.map((c) => ({ code: c.code, name: c.name })),
  geoUrl: "/KEN-counties.json",
  labelCodes: ["047", "001", "022", "032", "037"],
  noun: "county",
  nouns: "counties",
  csvName: "kenya-election-watch",
  placeWord: "county",
  method: "headlines and feed summaries from Kenyan and regional outlets are coded by written rules (type, county, stated deaths).",
  intro: "Political violence, intimidation, hate speech, election disinformation and attacks on election administration, collected from the platform’s news feeds every 15 minutes and coded by type and county. Counts are of events, with duplicate reports grouped. They measure what is reported, so they undercount, and every item starts unverified until an analyst checks it.",
  heading: "Violence and hate speech",
  kicker: "Live monitoring",
};

export const SS_WATCH_CONFIG: WatchConfig = {
  key: "ss",
  categories: ["armed_clash", "civilian_harm", "sexual_violence", "abduction", "displacement", "ceasefire_violation", "agreement_breach", "political_detention", "coverage"],
  labels: {
    armed_clash: "Armed clashes",
    civilian_harm: "Attacks on civilians",
    sexual_violence: "Sexual violence",
    abduction: "Abductions",
    displacement: "Displacement",
    ceasefire_violation: "Ceasefire violations",
    agreement_breach: "Peace agreement breaches",
    political_detention: "Political detention",
    coverage: "Transition coverage",
  },
  help: {
    armed_clash: "Fighting between government forces, SPLA-IO, the White Army and other armed groups.",
    civilian_harm: "Killings, burning, looting and shelling of villages and civilians.",
    sexual_violence: "Reported rape and sexual violence, as stated in the report.",
    abduction: "Abductions and forced recruitment of civilians and political actors.",
    displacement: "Reports of people fleeing, with the number stated where the report gives one.",
    ceasefire_violation: "Reported breaches of the ceasefire or the cessation of hostilities.",
    agreement_breach: "Reported failures of the Revitalised Agreement: unified forces, transition, elections, power-sharing.",
    political_detention: "Arrests and detention of opposition figures, officials, journalists and activists.",
  },
  colors: {
    armed_clash: "#d1352b",
    civilian_harm: "#e07a1f",
    sexual_violence: "#8a3ffc",
    abduction: "#2f66f0",
    displacement: "#b3690b",
    ceasefire_violation: "#0d9488",
    agreement_breach: "#c2185b",
    political_detention: "#6b7280",
  },
  places: PLACES,
  mapUnits: STATES,
  geoUrl: "/SSD-states.geojson",
  labelCodes: STATES.map((s) => s.code),
  noun: "state",
  nouns: "states",
  csvName: "south-sudan-watch",
  placeWord: "state",
  method: "headlines and feed summaries from South Sudanese and regional outlets are coded by written rules (type, state, stated deaths and displacement).",
  intro: "Fighting, attacks on civilians, sexual violence, abductions, displacement, ceasefire violations and political detention, collected from the platform’s news feeds every 15 minutes and coded by type and state. Counts are of events, with duplicate reports grouped. They measure what is reported, so they undercount, and every item starts unverified until an analyst checks it.",
  heading: "Conflict dashboard",
  kicker: "Live monitoring",
};

export const WATCH_CONFIG: Record<WatchKey, WatchConfig> = { ke: KE_WATCH_CONFIG, ss: SS_WATCH_CONFIG };
