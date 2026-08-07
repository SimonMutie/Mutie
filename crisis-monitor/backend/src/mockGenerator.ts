/**
 * Simulated ingestion connector.
 *
 * This stands in for the real integrations (social platform APIs, news wire
 * APIs like GDELT/NewsAPI, RSS, and a licensed dark-web threat-intel feed such
 * as Flashpoint/Recorded Future/DarkOwl — dark web content should never be
 * scraped directly with a DIY Tor crawler; use a vetted commercial feed).
 *
 * To wire in a real source: implement a function with the same shape as
 * `emitEvent` below that pushes into `onEvent`, and set MOCK_MODE=false.
 */
import type { SourceType } from "./types";

interface City {
  label: string;
  lat: number;
  lng: number;
}

const CITIES: City[] = [
  { label: "Nairobi, Kenya", lat: -1.286389, lng: 36.817223 },
  { label: "Lagos, Nigeria", lat: 6.5244, lng: 3.3792 },
  { label: "Manila, Philippines", lat: 14.5995, lng: 120.9842 },
  { label: "Jakarta, Indonesia", lat: -6.2088, lng: 106.8456 },
  { label: "Dhaka, Bangladesh", lat: 23.8103, lng: 90.4125 },
  { label: "Port-au-Prince, Haiti", lat: 18.5944, lng: -72.3074 },
  { label: "Kyiv, Ukraine", lat: 50.4501, lng: 30.5234 },
  { label: "Beirut, Lebanon", lat: 33.8938, lng: 35.5018 },
  { label: "Karachi, Pakistan", lat: 24.8607, lng: 67.0011 },
  { label: "Mexico City, Mexico", lat: 19.4326, lng: -99.1332 },
  { label: "Johannesburg, South Africa", lat: -26.2041, lng: 28.0473 },
  { label: "Sao Paulo, Brazil", lat: -23.5505, lng: -46.6333 },
  { label: "New Delhi, India", lat: 28.6139, lng: 77.209 },
  { label: "Cairo, Egypt", lat: 30.0444, lng: 31.2357 },
  { label: "Bangkok, Thailand", lat: 13.7563, lng: 100.5018 },
];

const CATEGORY_TEMPLATES: Record<string, { phrases: string[]; sentiment: [number, number] }> = {
  public_health: {
    phrases: [
      "Local hospital reports rising cases of {disease}, officials weighing quarantine measures in {city}",
      "Health ministry confirms {disease} outbreak cluster near {city}, cases climbing",
      "Rumors circulating about {disease} spreading through {city} district, clinics overwhelmed",
      "WHO team dispatched to {city} to assess {disease} outbreak",
      "Residents in {city} report shortage of medical supplies amid {disease} cases",
    ],
    sentiment: [-0.8, -0.2],
  },
  civil_unrest: {
    phrases: [
      "Large crowds gathering in central {city}, police deploy amid growing unrest",
      "Protest in {city} turns tense as curfew announced for tonight",
      "Reports of clashes between demonstrators and security forces in {city}",
      "Social media video shows tear gas used on protesters in {city}",
      "Labor strike escalates into street protest across {city}",
    ],
    sentiment: [-0.9, -0.3],
  },
  infrastructure: {
    phrases: [
      "Power grid failure reported across parts of {city}, cause under investigation",
      "Water utility in {city} confirms suspicious network activity, sabotage not ruled out",
      "Pipeline operator near {city} reports breach attempt on control systems",
      "Telecom outage hits {city} following reported cyber intrusion",
      "Officials in {city} investigating attack on substation feeding the metro grid",
    ],
    sentiment: [-0.7, -0.1],
  },
  natural_disaster: {
    phrases: [
      "Magnitude tremor felt across {city}, evacuation orders issued for coastal areas",
      "Flooding worsens in {city} as rivers overflow, rescue teams deployed",
      "Wildfire approaches outskirts of {city}, residents told to evacuate",
      "Cyclone warning issued for {city}, ports closed as storm intensifies",
      "Building collapse reported in {city} after heavy rainfall, casualties feared",
    ],
    sentiment: [-0.9, -0.4],
  },
  noise: {
    phrases: [
      "Great weather in {city} today, perfect for a walk downtown",
      "New coffee shop opened in {city}, already a local favorite",
      "{city} traffic update: minor delays on the ring road this morning",
      "Local team wins match in {city}, fans celebrate downtown",
      "Tech conference wraps up in {city} with record attendance",
    ],
    sentiment: [0.1, 0.7],
  },
};

const DISEASES = ["cholera", "measles", "dengue", "hemorrhagic fever", "avian influenza"];

const SOURCE_TYPES: SourceType[] = ["social", "news", "darkweb", "forum"];

const HANDLE_PREFIXES = ["field_watch", "citizen_report", "newsdesk", "anon_intel", "local_voice", "wire_service"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randRange([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

function jitter(value: number, amount: number): number {
  return value + (Math.random() - 0.5) * amount;
}

function buildContent(category: string, city: City): string {
  const template = CATEGORY_TEMPLATES[category];
  const phrase = pick(template.phrases);
  const disease = pick(DISEASES);
  return phrase.replace("{city}", city.label.split(",")[0]).replace("{disease}", disease);
}

export interface GeneratedEvent {
  source_type: SourceType;
  author: string;
  content: string;
  url: string;
  lang: string;
  sentiment: number;
  geo_lat: number;
  geo_lng: number;
  geo_label: string;
  published_at: Date;
}

let clusterState: { category: string; city: City; ticksLeft: number } | null = null;

/**
 * Generates one synthetic event. Most of the time it's background "noise" or a
 * mild category signal; periodically it enters a "cluster" mode that emits a
 * burst of correlated, escalating events around one city/category so the
 * dashboard has real escalation behavior to detect and visualize.
 */
export function generateEvent(): GeneratedEvent {
  // 6% chance per tick to start a new escalation cluster if none active
  if (!clusterState && Math.random() < 0.06) {
    const categories = Object.keys(CATEGORY_TEMPLATES).filter((c) => c !== "noise");
    clusterState = {
      category: pick(categories),
      city: pick(CITIES),
      ticksLeft: 8 + Math.floor(Math.random() * 10),
    };
  }

  let category: string;
  let city: City;

  if (clusterState && Math.random() < 0.75) {
    category = clusterState.category;
    city = clusterState.city;
    clusterState.ticksLeft--;
    if (clusterState.ticksLeft <= 0) clusterState = null;
  } else {
    const roll = Math.random();
    if (roll < 0.4) {
      category = "noise";
    } else {
      const categories = Object.keys(CATEGORY_TEMPLATES).filter((c) => c !== "noise");
      category = pick(categories);
    }
    city = pick(CITIES);
  }

  const template = CATEGORY_TEMPLATES[category];
  const sourceType = pick(SOURCE_TYPES);
  const content = buildContent(category, city);
  const sentiment = randRange(template.sentiment);

  return {
    source_type: sourceType,
    author: `${pick(HANDLE_PREFIXES)}_${Math.floor(Math.random() * 9999)}`,
    content,
    url: `https://example-feed.local/${sourceType}/${Math.random().toString(36).slice(2, 10)}`,
    lang: "en",
    sentiment: Number(sentiment.toFixed(2)),
    geo_lat: jitter(city.lat, 0.3),
    geo_lng: jitter(city.lng, 0.3),
    geo_label: city.label,
    published_at: new Date(),
  };
}
