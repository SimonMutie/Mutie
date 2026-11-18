import type { Env } from "../bindings";
import { AFRICA_CENTROIDS, AFRICA_GEO_COUNTRIES, MIDDLE_EAST_CODES, normalizeName } from "./africaGeo";
import { discoverFeed } from "./feedDiscovery";

/**
 * Strategic analyses: what think tanks, research centres and specialist outlets publish on Africa, sorted into
 * domains (New Humanitarianism, Geopolitics, Elections, Economy, Trade, Cybersecurity, Conflict). Each domain has its
 * own keyword taxonomy and its own sources; many sources feed several domains, and one piece can sit in more than one.
 *
 * The collector reads a batch of the least recently checked sources every run (so every source is read about hourly
 * without one run making too many requests), keeps pieces that match a domain's taxonomy and are about Africa (or,
 * for New Humanitarianism, are system-level reflections that shape Africa), and stores them per domain with their
 * themes and the African countries they discuss. New pieces are sent to anyone subscribed to that domain's alerts
 * (alertDelivery.ts, scope "analyses", query_id = domain).
 */

/* ── Domains, sources and taxonomy ────────────────────────────────────── */

export type DomainId = "humanitarian" | "geopolitics" | "elections" | "economy" | "trade" | "cyber" | "conflict";

export interface Theme {
  id: string;
  label: string;
  /** Lower-case terms; a term ending in "*" matches any word that starts with it. */
  terms: string[];
  /** Shapes the whole system, so counts even when a piece names no African country. */
  systemic?: boolean;
}

export interface Domain {
  id: DomainId;
  label: string;
  blurb: string;
  /** A piece must be about the domain at all before its themes count. */
  signal: RegExp;
  themes: Theme[];
  /** Theme-term hits needed from a source that covers many domains (a specialist source needs one). */
  minHits: number;
}

export interface Source {
  name: string;
  /** The feed, or the site's homepage when its feed is found by discovery. */
  url: string;
  /** Africa-based or Africa-focused: everything it publishes counts as about Africa. */
  africa: boolean;
  domains: DomainId[];
}

const ALL: DomainId[] = ["humanitarian", "geopolitics", "elections", "economy", "trade", "cyber", "conflict"];

/**
 * Think tanks, research centres and specialist outlets, with the domains each writes on. Sites without a findable
 * feed are reported in the source status (Strategic Analyses → Sources & keywords), not dropped silently.
 */
export const SOURCES: Source[] = [
  // African think tanks and Africa-focused analysis (broad)
  { name: "Institute for Security Studies (ISS Africa)", url: "https://issafrica.org/", africa: true, domains: ALL },
  { name: "Africa Center for Strategic Studies", url: "https://africacenter.org/feed/", africa: true, domains: ["humanitarian", "geopolitics", "elections", "cyber", "conflict"] },
  { name: "South African Institute of International Affairs (SAIIA)", url: "https://saiia.org.za/feed/", africa: true, domains: ["humanitarian", "geopolitics", "elections", "economy", "trade", "cyber"] },
  { name: "The Conversation Africa", url: "https://theconversation.com/africa/articles.atom", africa: true, domains: ALL },
  { name: "Africa Portal", url: "https://www.africaportal.org/", africa: true, domains: ALL },
  { name: "African Arguments", url: "https://africanarguments.org/feed/", africa: true, domains: ["humanitarian", "geopolitics", "elections", "economy", "conflict"] },
  { name: "ACCORD", url: "https://www.accord.org.za/feed/", africa: true, domains: ["humanitarian", "geopolitics", "elections", "conflict"] },
  { name: "Amani Africa", url: "https://amaniafrica-et.org/feed/", africa: true, domains: ["humanitarian", "geopolitics", "elections", "conflict"] },
  { name: "ECDPM", url: "https://ecdpm.org/", africa: true, domains: ["humanitarian", "geopolitics", "economy", "trade"] },
  { name: "West Africa Network for Peacebuilding (WANEP)", url: "https://wanep.org/wanep/", africa: true, domains: ["humanitarian", "elections", "conflict"] },
  { name: "Institute for Peace and Security Studies (IPSS, Addis Ababa)", url: "https://ipss-addis.org/", africa: true, domains: ["geopolitics", "conflict", "elections"] },
  { name: "HORN International Institute for Strategic Studies", url: "https://horninstitute.org/feed/", africa: true, domains: ["geopolitics", "conflict", "cyber"] },
  { name: "Rift Valley Institute", url: "https://riftvalley.net/", africa: true, domains: ["humanitarian", "conflict", "elections", "economy"] },
  { name: "Policy Center for the New South", url: "https://www.policycenter.ma/", africa: true, domains: ["geopolitics", "economy", "trade", "conflict"] },
  { name: "Good Governance Africa", url: "https://gga.org/", africa: true, domains: ["elections", "economy", "geopolitics"] },
  { name: "Mo Ibrahim Foundation", url: "https://mo.ibrahim.foundation/", africa: true, domains: ["elections", "economy", "geopolitics"] },
  { name: "Kujenga Amani (SSRC)", url: "https://kujenga-amani.ssrc.org/feed/", africa: true, domains: ["conflict", "humanitarian"] },
  { name: "The Africa Report", url: "https://www.theafricareport.com/feed/", africa: true, domains: ["geopolitics", "elections", "economy", "trade"] },
  // International think tanks writing on Africa (broad)
  { name: "International Crisis Group", url: "https://www.crisisgroup.org/", africa: false, domains: ["humanitarian", "geopolitics", "elections", "conflict"] },
  { name: "Chatham House", url: "https://www.chathamhouse.org/", africa: false, domains: ALL },
  { name: "CSIS Africa Program", url: "https://www.csis.org/programs/africa-program", africa: true, domains: ["geopolitics", "economy", "trade", "conflict"] },
  { name: "Brookings Africa Growth Initiative", url: "https://www.brookings.edu/projects/africa-growth-initiative/", africa: true, domains: ["economy", "trade", "geopolitics"] },
  { name: "Carnegie Endowment for International Peace", url: "https://carnegieendowment.org/", africa: false, domains: ["geopolitics", "elections", "cyber", "conflict"] },
  { name: "Atlantic Council Africa Center", url: "https://www.atlanticcouncil.org/programs/africa-center/", africa: true, domains: ["geopolitics", "economy", "trade", "conflict"] },
  { name: "Wilson Center Africa Program", url: "https://www.wilsoncenter.org/program/africa-program", africa: true, domains: ["geopolitics", "elections", "economy", "conflict"] },
  { name: "European Council on Foreign Relations (ECFR)", url: "https://ecfr.eu/", africa: false, domains: ["geopolitics", "conflict", "trade"] },
  { name: "Royal United Services Institute (RUSI)", url: "https://www.rusi.org/", africa: false, domains: ["geopolitics", "conflict", "cyber"] },
  { name: "Clingendael Institute", url: "https://www.clingendael.org/", africa: false, domains: ["geopolitics", "conflict", "humanitarian"] },
  { name: "German Institute for International and Security Affairs (SWP)", url: "https://www.swp-berlin.org/en/", africa: false, domains: ["geopolitics", "conflict"] },
  { name: "IPI Global Observatory", url: "https://theglobalobservatory.org/feed/", africa: false, domains: ["humanitarian", "conflict", "geopolitics"] },
  { name: "Center for Global Development", url: "https://www.cgdev.org/", africa: false, domains: ["humanitarian", "economy", "trade"] },
  { name: "ODI Global", url: "https://odi.org/en/", africa: false, domains: ["humanitarian", "economy", "trade"] },
  { name: "War on the Rocks", url: "https://warontherocks.com/feed/", africa: false, domains: ["geopolitics", "conflict"] },
  // New Humanitarianism
  { name: "The New Humanitarian", url: "https://www.thenewhumanitarian.org/rss/all.xml", africa: false, domains: ["humanitarian"] },
  { name: "Humanitarian Practice Network", url: "https://odihpn.org/feed/", africa: false, domains: ["humanitarian"] },
  { name: "ALNAP", url: "https://www.alnap.org/", africa: false, domains: ["humanitarian"] },
  { name: "ICRC Humanitarian Law & Policy blog", url: "https://blogs.icrc.org/law-and-policy/feed/", africa: false, domains: ["humanitarian", "conflict"] },
  { name: "ICVA", url: "https://www.icvanetwork.org/", africa: false, domains: ["humanitarian"] },
  { name: "Humanitarian Outcomes", url: "https://humanitarianoutcomes.org/", africa: false, domains: ["humanitarian"] },
  { name: "Global Public Policy Institute (GPPi)", url: "https://gppi.net/", africa: false, domains: ["humanitarian", "geopolitics"] },
  { name: "CHS Alliance", url: "https://www.chsalliance.org/", africa: false, domains: ["humanitarian"] },
  { name: "MSF Centre for Applied Reflection on Humanitarian Practice (CRASH)", url: "https://msf-crash.org/en", africa: false, domains: ["humanitarian"] },
  { name: "Development Initiatives", url: "https://devinit.org/", africa: false, domains: ["humanitarian", "economy"] },
  { name: "Center on International Cooperation (NYU)", url: "https://cic.nyu.edu/", africa: false, domains: ["humanitarian", "geopolitics"] },
  { name: "Refugees International", url: "https://www.refugeesinternational.org/feed/", africa: false, domains: ["humanitarian"] },
  { name: "Norwegian Refugee Council", url: "https://www.nrc.no/", africa: false, domains: ["humanitarian"] },
  { name: "Devex", url: "https://www.devex.com/", africa: false, domains: ["humanitarian", "economy"] },
  { name: "Charter4Change", url: "https://charter4change.org/feed/", africa: false, domains: ["humanitarian"] },
  { name: "NEAR Network", url: "https://www.near.ngo/", africa: false, domains: ["humanitarian"] },
  { name: "Peace Direct", url: "https://www.peacedirect.org/feed/", africa: false, domains: ["humanitarian", "conflict"] },
  { name: "Adeso", url: "https://adesoafrica.org/", africa: true, domains: ["humanitarian"] },
  // Elections and democracy
  { name: "EISA (Electoral Institute for Sustainable Democracy in Africa)", url: "https://www.eisa.org/", africa: true, domains: ["elections"] },
  { name: "Afrobarometer", url: "https://www.afrobarometer.org/", africa: true, domains: ["elections"] },
  { name: "Democracy in Africa", url: "https://democracyinafrica.org/feed/", africa: true, domains: ["elections"] },
  { name: "CDD-Ghana", url: "https://cddgh.org/", africa: true, domains: ["elections"] },
  { name: "Centre for Democracy and Development (CDD West Africa)", url: "https://www.cddwestafrica.org/", africa: true, domains: ["elections", "conflict"] },
  { name: "Yiaga Africa", url: "https://yiaga.org/", africa: true, domains: ["elections"] },
  { name: "International IDEA", url: "https://www.idea.int/", africa: false, domains: ["elections"] },
  { name: "The Carter Center", url: "https://www.cartercenter.org/", africa: false, domains: ["elections", "conflict"] },
  { name: "IFES", url: "https://www.ifes.org/", africa: false, domains: ["elections"] },
  { name: "National Democratic Institute", url: "https://www.ndi.org/", africa: false, domains: ["elections"] },
  // Economy
  { name: "African Economic Research Consortium (AERC)", url: "https://aercafrica.org/", africa: true, domains: ["economy"] },
  { name: "Africa Policy Research Institute (APRI)", url: "https://afripoli.org/", africa: true, domains: ["economy", "geopolitics", "trade"] },
  { name: "African Center for Economic Transformation (ACET)", url: "https://acetforafrica.org/", africa: true, domains: ["economy", "trade"] },
  { name: "Development Reimagined", url: "https://developmentreimagined.com/", africa: true, domains: ["economy", "trade", "geopolitics"] },
  { name: "Boston University Global Development Policy Center", url: "https://www.bu.edu/gdp/", africa: false, domains: ["economy", "trade"] },
  // Trade
  { name: "tralac (Trade Law Centre)", url: "https://www.tralac.org/", africa: true, domains: ["trade"] },
  { name: "Hinrich Foundation", url: "https://www.hinrichfoundation.com/", africa: false, domains: ["trade"] },
  { name: "IISD", url: "https://www.iisd.org/", africa: false, domains: ["trade", "economy"] },
  { name: "The China Global South Project", url: "https://chinaglobalsouth.com/", africa: false, domains: ["trade", "geopolitics", "economy"] },
  // Cybersecurity and digital
  { name: "CIPESA", url: "https://cipesa.org/feed/", africa: true, domains: ["cyber"] },
  { name: "Paradigm Initiative", url: "https://paradigmhq.org/", africa: true, domains: ["cyber"] },
  { name: "Research ICT Africa", url: "https://researchictafrica.net/", africa: true, domains: ["cyber"] },
  { name: "Access Now", url: "https://www.accessnow.org/", africa: false, domains: ["cyber"] },
  { name: "DFRLab (Atlantic Council)", url: "https://dfrlab.org/", africa: false, domains: ["cyber"] },
  { name: "Global Partners Digital", url: "https://www.gp-digital.org/", africa: false, domains: ["cyber"] },
  { name: "Digital Watch Observatory", url: "https://dig.watch/", africa: false, domains: ["cyber"] },
  // Conflict and security
  { name: "ACLED", url: "https://acleddata.com/", africa: false, domains: ["conflict"] },
  { name: "Small Arms Survey", url: "https://www.smallarmssurvey.org/", africa: false, domains: ["conflict"] },
  { name: "Global Initiative Against Transnational Organized Crime", url: "https://globalinitiative.net/", africa: false, domains: ["conflict", "economy"] },
  { name: "Critical Threats", url: "https://www.criticalthreats.org/", africa: false, domains: ["conflict"] },
  { name: "Combating Terrorism Center at West Point", url: "https://ctc.westpoint.edu/", africa: false, domains: ["conflict"] },
];

const HUMANITARIAN_THEMES: Theme[] = [
  {
    id: "funding",
    label: "Funding cuts & aid financing",
    systemic: true,
    terms: ["funding cut*", "aid cut*", "budget cut*", "cuts to aid", "foreign aid", "official development assistance", "oda", "usaid", "dismantl*", "aid freeze", "funding freeze", "funding gap*", "underfund*", "humanitarian financing", "humanitarian funding", "pooled fund*", "cerf", "global humanitarian overview", "donor fatigue", "donor government*", "shrinking aid", "aid budget*", "aid architecture", "financing gap", "hyper-prioriti*", "prioritisation", "prioritization"],
  },
  {
    id: "reset",
    label: "Humanitarian reset & system reform",
    systemic: true,
    terms: ["humanitarian reset", "the reset", "un80", "un reform", "system reform", "grand bargain", "iasc", "inter-agency standing committee", "flagship initiative", "humanitarian architecture", "humanitarian system", "transformation agenda", "agency merger*", "merging agencies", "emergency relief coordinator"],
  },
  {
    id: "localisation",
    label: "Localisation & shifting power",
    systemic: true,
    terms: ["localisation", "localization", "localis*", "localiz*", "locally led", "locally-led", "local actors", "local and national actors", "national ngos", "local ngos", "community-led", "shift the power", "shifting power", "power shift", "decoloni*", "charter for change", "intermediar*", "direct funding", "women-led organi*", "women's rights organi*", "proximate", "local leadership", "equitable partnership*"],
  },
  {
    id: "global-south",
    label: "Global South & non-traditional actors",
    systemic: true,
    terms: ["global south", "non-traditional donor*", "emerging donor*", "new donors", "gulf donor*", "gulf humanitarian*", "saudi aid", "ksrelief", "emirati aid", "uae aid", "qatari aid", "qatar fund for development", "kuwaiti aid", "turkish aid", "türkiye's aid", "chinese aid", "china's aid", "south-south", "brics", "india's aid", "african humanitarian agency", "african union", "au humanitarian", "solidarity-based", "middle powers", "islamic humanitarian*", "zakat", "diaspora"],
  },
  {
    id: "access",
    label: "Access & the operating environment",
    terms: ["humanitarian access", "access constraint*", "access impediment*", "bureaucratic impediment*", "humanitarian negotiation*", "negotiat* access", "armed group* engagement", "engagement with armed groups", "non-state armed group*", "deconflict*", "besieg*", "siege", "aid diversion", "obstruction of aid", "obstructing aid", "aid obstruction", "starvation as a weapon", "humanitarian corridor*", "cross-border aid", "cross-line", "denial of access", "humanitarian space", "operating environment"],
  },
  {
    id: "principles",
    label: "Principles, politicisation & sanctions",
    terms: ["humanitarian principles", "neutrality", "impartiality", "principled humanitarian*", "politicis*", "politiciz*", "instrumentalis*", "instrumentaliz*", "counter-terror*", "counterterror*", "sanctions regime*", "sanctions exemption*", "humanitarian carve-out*", "humanitarian exemption*", "militaris*", "securitis*", "international humanitarian law", "ihl"],
  },
  {
    id: "security",
    label: "Aid worker safety & risk",
    terms: ["aid worker*", "humanitarian worker*", "attacks on aid", "attacks on humanitarian*", "staff killed", "duty of care", "risk transfer", "risk sharing", "security risk management", "kidnapping of aid"],
  },
  {
    id: "nexus",
    label: "Nexus, climate & anticipatory action",
    terms: ["nexus", "humanitarian-development-peace", "triple nexus", "hdp", "anticipatory action", "early action", "early warning", "climate finance", "climate crisis", "loss and damage", "resilience", "protracted crisis", "protracted crises", "durable solutions"],
  },
  {
    id: "accountability",
    label: "Accountability & participation",
    terms: ["accountability to affected people", "accountability to affected populations", "aap", "participation revolution", "affected people", "feedback mechanism*", "community engagement", "psea", "sexual exploitation and abuse", "safeguarding"],
  },
  {
    id: "cash-digital",
    label: "Cash, data & technology",
    terms: ["cash assistance", "cash transfer*", "cash and voucher*", "digital humanitarian*", "artificial intelligence", "data protection", "biometric*", "digital identity", "humanitarian data"],
  },
  {
    id: "future",
    label: "The future of humanitarianism",
    systemic: true,
    terms: ["future of humanitarian*", "new humanitarianism", "humanitarian landscape", "humanitarian sector", "aid sector", "aid industry", "post-aid", "beyond aid", "aid dependency", "multilateralism", "multilateral system", "humanitarian model", "humanitarian action", "what next for aid", "end of aid", "rethinking aid", "rethink* humanitarian*"],
  },
];


const GEOPOLITICS_THEMES: Theme[] = [
  { id: "major-powers", label: "Major powers in Africa", terms: ["great power*", "great-power", "china", "chinese", "beijing", "russia*", "kremlin", "moscow", "united states", "washington", "us policy", "us-africa", "trump administration", "european union", "eu-africa", "brussels", "france", "french", "paris", "united kingdom", "britain", "british"] },
  { id: "middle-powers", label: "Gulf, Türkiye & middle powers", terms: ["middle power*", "gulf state*", "gulf countries", "uae", "emirati*", "abu dhabi", "saudi*", "riyadh", "qatar*", "doha", "turkey", "türkiye", "turkish", "ankara", "iran*", "tehran", "israel*", "india*", "new delhi", "japan*", "brazil*", "south korea*"] },
  { id: "multilateral", label: "AU, regional blocs & multilateralism", terms: ["african union", "au commission", "peace and security council", "ecowas", "sadc", "eac", "east african community", "igad", "eccas", "alliance of sahel states", "aes", "un security council", "unsc", "brics", "g20", "multilateral*", "regional bloc*", "regional organi*", "permanent seat"] },
  { id: "security-partnerships", label: "Security partnerships & foreign military presence", terms: ["military base*", "naval base*", "security cooperation", "security partner*", "defence pact*", "defense pact*", "defence agreement*", "defense agreement*", "arms deal*", "arms sale*", "foreign troops", "troop withdrawal", "military presence", "wagner", "africa corps", "private military", "mercenar*", "drone sale*", "military training"] },
  { id: "resources-corridors", label: "Resources, corridors & strategic geography", terms: ["critical mineral*", "rare earth*", "cobalt", "lithium", "uranium", "red sea", "bab el-mandeb", "gulf of aden", "horn of africa", "strategic port*", "port deal*", "sea access", "access to the sea", "lobito corridor", "belt and road", "infrastructure diplomacy", "mineral diplomacy"] },
  { id: "diplomacy", label: "Diplomacy, alignment & sovereignty", terms: ["foreign policy", "diplomac*", "diplomat*", "summit*", "non-align*", "alignment", "strategic autonomy", "sovereignty", "neocolonial*", "anti-french", "anti-western", "recognition of somaliland", "somaliland", "sanction*", "envoy*", "bilateral relations", "rapprochement", "rift with"] },
  { id: "influence", label: "Influence & information competition", terms: ["soft power", "influence operation*", "information war*", "disinformation", "propaganda", "media influence", "scholarships", "cultural diplomacy", "narrative*"] },
];

const ELECTION_THEMES: Theme[] = [
  { id: "contests", label: "Elections, campaigns & candidates", terms: ["presidential election*", "general election*", "legislative election*", "parliamentary election*", "local election*", "municipal election*", "by-election*", "run-off", "runoff", "second round", "primaries", "party primar*", "campaign*", "candidate*", "nomination*", "manifesto*", "electoral calendar", "polling day", "turnout", "election results", "landslide", "incumbent*", "opposition"] },
  { id: "integrity", label: "Electoral integrity & administration", terms: ["electoral commission", "election commission", "election management bod*", "iebc", "inec", "voter registration", "voter roll*", "voters roll", "voter register", "biometric voter", "results transmission", "rigging", "rigged", "electoral fraud", "vote fraud", "irregularit*", "tallying", "observer*", "observation mission*", "credibility", "election petition*", "electoral court*", "disputed result*", "recount", "boycott*"] },
  { id: "violence", label: "Electoral violence & unrest", terms: ["electoral violence", "election violence", "election-related violence", "post-election", "pre-election", "protest*", "crackdown", "internet shutdown*", "arrest of opposition", "opposition leader* arrested", "intimidation", "vote buying", "vote-buying", "abduction*", "state of emergency"] },
  { id: "backsliding", label: "Term limits, coups & democratic backsliding", terms: ["term limit*", "third term", "fourth term", "constitutional amendment*", "constitutional change*", "constitutional referendum", "referendum", "coup*", "junta*", "military rule", "transition*", "transitional", "democratic backslid*", "backsliding", "authoritarian*", "democratic decline", "democratic recession", "postpone* election*", "delayed election*", "succession"] },
  { id: "opinion", label: "Public opinion & participation", terms: ["afrobarometer", "opinion poll*", "survey*", "public trust", "trust in", "youth vote", "young voters", "gen z", "women's participation", "women in politics", "voter apathy", "civic space", "civil society"] },
  { id: "information", label: "Election information integrity", terms: ["disinformation", "misinformation", "fake news", "information manipulation", "deepfake*", "social media", "influence operation*", "hate speech", "media freedom"] },
];

const ECONOMY_THEMES: Theme[] = [
  { id: "debt-fiscal", label: "Debt, fiscal stress & IMF programmes", terms: ["sovereign debt", "public debt", "debt distress", "debt crisis", "debt restructur*", "common framework", "eurobond*", "default*", "debt service", "debt servicing", "fiscal deficit", "fiscal consolidation", "austerity", "budget deficit", "imf programme", "imf program", "imf deal", "extended credit facility", "bailout", "credit rating*", "downgrade*", "upgrade*", "domestic revenue", "tax reform*", "tax*"] },
  { id: "macro", label: "Inflation, currencies & monetary policy", terms: ["inflation", "interest rate*", "central bank*", "monetary policy", "currency", "exchange rate*", "devaluat*", "depreciat*", "naira", "cedi", "kenyan shilling", "rand", "birr", "kwacha", "egyptian pound", "cfa franc", "eco currency", "forex", "foreign exchange", "fx reserves", "foreign reserves", "dollar shortage*"] },
  { id: "growth", label: "Growth, outlook & structural change", terms: ["gdp", "economic growth", "growth outlook", "growth forecast*", "recession", "slowdown", "economic outlook", "economic recovery", "productivity", "structural transformation", "industrialis*", "industrializ*", "manufacturing", "economic diversification", "diversification"] },
  { id: "investment", label: "Investment, finance & capital markets", terms: ["foreign direct investment", "fdi", "investor*", "private capital", "private sector", "development finance", "climate finance", "green bond*", "blended finance", "financial inclusion", "fintech", "mobile money", "banking sector", "banks", "stock exchange", "capital market*", "remittance*", "sovereign wealth fund*", "pension fund*"] },
  { id: "resources-energy", label: "Mining, energy & commodities", terms: ["mining", "mining code", "critical mineral*", "oil", "crude", "natural gas", "lng", "refiner*", "energy transition", "electricity", "power sector", "power cuts", "load shedding", "load-shedding", "commodity price*", "commodities", "cocoa", "coffee", "gold price", "copper"] },
  { id: "livelihoods", label: "Jobs, prices & livelihoods", terms: ["unemployment", "youth unemployment", "jobs", "employment", "informal sector", "informal economy", "cost of living", "cost-of-living", "food prices", "fuel prices", "poverty", "inequality", "wages", "minimum wage", "living standards"] },
  { id: "reform", label: "Reform, subsidies & governance of the economy", terms: ["subsidy removal", "fuel subsidy", "subsidies", "privatis*", "privatiz*", "state-owned enterprise*", "parastatal*", "corruption", "illicit financial flows", "economic reform*", "structural reform*", "finance bill", "budget"] },
];

const TRADE_THEMES: Theme[] = [
  { id: "afcfta", label: "AfCFTA & regional integration", terms: ["afcfta", "african continental free trade", "continental free trade", "intra-african trade", "intra-regional trade", "regional integration", "regional economic communit*", "customs union", "rules of origin", "ecowas", "eac", "sadc", "comesa", "single market", "free movement", "papss", "guided trade initiative"] },
  { id: "partners", label: "US, EU, China & Gulf trade relations", terms: ["agoa", "african growth and opportunity act", "tariff*", "reciprocal tariff*", "trade war", "eu-africa", "economic partnership agreement*", "cbam", "carbon border", "deforestation regulation", "eudr", "china-africa", "focac", "zero-tariff", "zero tariff", "duty-free", "gulf investment", "trade deficit", "trade surplus", "bilateral trade"] },
  { id: "supply-chains", label: "Supply chains & critical minerals", terms: ["supply chain*", "value chain*", "critical mineral*", "beneficiation", "local processing", "value addition", "value-addition", "export ban*", "raw material*", "battery", "batteries", "cobalt", "lithium", "manganese", "graphite", "copper", "nearshoring", "friendshoring", "minerals security partnership"] },
  { id: "logistics", label: "Ports, shipping & trade corridors", terms: ["port*", "shipping", "red sea", "suez", "freight", "logistics", "corridor*", "lobito", "railway*", "standard gauge", "trade facilitation", "border post*", "one-stop border", "transit", "container*"] },
  { id: "agri-commodities", label: "Agricultural & commodity trade", terms: ["agricultural trade", "agricultural export*", "food trade", "food import*", "grain", "wheat", "fertili*", "cocoa", "coffee", "tea export*", "cashew", "horticulture", "export*", "import*", "commodity price*", "commodity export*"] },
  { id: "policy", label: "Trade policy, WTO & digital trade", terms: ["wto", "world trade organization", "trade policy", "trade negotiation*", "market access", "non-tariff barrier*", "protectionis*", "trade agreement*", "trade deal*", "free trade agreement*", "digital trade", "e-commerce", "services trade", "trade in services", "special economic zone*", "export processing zone*"] },
];

const CYBER_THEMES: Theme[] = [
  { id: "threats", label: "Cyber threats & incidents", terms: ["cyberattack*", "cyber attack*", "cyber-attack*", "ransomware", "malware", "data breach*", "breach*", "hack*", "ddos", "phishing", "cybercrime", "cyber crime", "cybercriminal*", "online fraud", "scam*", "sim swap*", "hacktivis*", "state-sponsored", "threat actor*", "vulnerabilit*"] },
  { id: "infrastructure", label: "Critical infrastructure & resilience", terms: ["critical infrastructure", "critical information infrastructure", "banking system*", "financial sector", "telecom*", "undersea cable*", "submarine cable*", "cable cut*", "power grid", "government systems", "e-government", "payment system*", "mobile money", "outage*", "cyber resilience"] },
  { id: "policy", label: "Cyber policy, law & capacity", terms: ["cybersecurity strategy", "cyber strategy", "national cert", "cert", "csirt", "cybersecurity law", "cybersecurity act", "cybercrime law", "cybercrimes act", "computer misuse", "malabo convention", "data protection", "privacy law", "data protection law", "data protection act", "cyber capacity", "capacity building", "cyber diplomacy", "cyber norms", "cybercrime convention", "cybersecurity"] },
  { id: "rights", label: "Surveillance, shutdowns & digital rights", terms: ["surveillance", "spyware", "pegasus", "predator", "facial recognition", "digital rights", "internet shutdown*", "network disruption*", "internet freedom", "censorship", "social media ban*", "online freedom", "digital authoritarian*", "data localis*", "data localiz*", "lawful interception"] },
  { id: "information", label: "Information operations & disinformation", terms: ["disinformation", "misinformation", "influence operation*", "information warfare", "information operation*", "propaganda", "troll*", "bot network*", "bots", "coordinated inauthentic", "deepfake*", "foreign information manipulation", "fimi", "fake account*"] },
  { id: "emerging", label: "AI, digital ID & emerging tech", terms: ["artificial intelligence", "ai governance", "ai policy", "generative ai", "digital public infrastructure", "digital id*", "digital identity", "biometric*", "cloud", "data centre*", "data center*", "starlink", "satellite internet", "5g"] },
];

const CONFLICT_THEMES: Theme[] = [
  { id: "dynamics", label: "Armed conflict dynamics", terms: ["war", "civil war", "fighting", "offensive", "counteroffensive", "clashes", "frontline*", "front line*", "siege", "battle*", "escalat*", "airstrike*", "air strike*", "drone strike*", "drone attack*", "shelling", "rapid support forces", "rsf", "m23", "fano", "tigray"] },
  { id: "extremism", label: "Jihadism & violent extremism", terms: ["jihad*", "al-shabaab", "al shabaab", "islamic state", "isis", "iswap", "is sahel", "jnim", "boko haram", "al-qaeda", "al qaeda", "aqim", "adf", "allied democratic forces", "violent extremis*", "counterterror*", "counter-terror*", "radicalis*", "radicaliz*", "insurgen*", "terror*"] },
  { id: "coups", label: "Coups & military rule", terms: ["coup*", "junta*", "military government", "military rule", "putsch", "mutin*", "return to civilian rule", "alliance of sahel states", "aes"] },
  { id: "peace", label: "Peace processes & mediation", terms: ["ceasefire*", "cease-fire*", "peace talks", "peace process*", "peace agreement*", "peace deal*", "mediation", "mediator*", "negotiation*", "national dialogue", "truce", "jeddah", "disarmament", "ddr", "demobilis*", "demobiliz*", "reconciliation"] },
  { id: "operations", label: "Peace operations & security partnerships", terms: ["peacekeep*", "peace operation*", "peace support operation*", "au mission", "aussom", "atmis", "monusco", "unmiss", "minusma", "sadc mission", "samidrc", "wagner", "africa corps", "private military", "mercenar*", "security force assistance", "foreign troops", "multinational force"] },
  { id: "communal", label: "Communal, local & resource conflict", terms: ["intercommunal", "inter-communal", "communal violence", "farmer-herder", "herder*", "pastoralist*", "land dispute*", "cattle raid*", "ethnic violence", "ethnic tension*", "militia*", "self-defence group*", "self-defense group*", "vigilante*", "banditry", "bandit*"] },
  { id: "illicit", label: "Illicit economies & organised crime", terms: ["organised crime", "organized crime", "trafficking", "smuggling", "illicit gold", "illegal mining", "artisanal mining", "galamsey", "arms flows", "arms trafficking", "small arms", "kidnap*", "piracy", "illicit economy", "illicit economies", "war economy"] },
  { id: "civilians", label: "Civilians, atrocities & accountability", terms: ["civilian casualt*", "civilians killed", "massacre*", "atrocit*", "genocide", "ethnic cleansing", "war crime*", "crimes against humanity", "sexual violence", "conflict-related sexual violence", "protection of civilians", "mass grave*", "icc", "accountability"] },
];

export const DOMAINS: Domain[] = [
  {
    id: "humanitarian",
    label: "New Humanitarianism",
    blurb: "How humanitarianism is changing: funding cuts, the reset, localisation, Global South actors, access and the future of aid.",
    signal: /\b(humanitarian\w*|aid|relief|ngos?|donors?|refugees?|displace\w*|idps?|famine|food insecurity|emergency response|development assistance|civil society)\b/i,
    themes: HUMANITARIAN_THEMES,
    minHits: 1,
  },
  {
    id: "geopolitics",
    label: "Geopolitics",
    blurb: "Africa in the world: major and middle powers, the AU and regional blocs, security partnerships, strategic geography and alignment.",
    signal: /\b(geopolitic\w*|foreign polic\w*|diplomac\w*|diplomat\w*|great.power|influence|competition|rivalr\w*|allian\w*|partnership|summit|bloc|sanction\w*|china|chinese|russia\w*|united states|washington|european union|france|french|gulf|emirati|uae|saudi|qatar\w*|turkey|türkiye|turkish|african union|ecowas|brics|military base|security cooperation|strategic)\b/i,
    themes: GEOPOLITICS_THEMES,
    minHits: 2,
  },
  {
    id: "elections",
    label: "Elections",
    blurb: "Elections and democratic politics in Africa: contests, integrity, violence, term limits and coups, opinion and information.",
    signal: /\b(election\w*|electoral|vot(e|es|ers?|ing)|ballot\w*|polls?|polling|referendum\w*|candidate\w*|campaign\w*|incumbent\w*|opposition|parliament\w*|presidential|term limits?|democra\w*|coup\w*)\b/i,
    themes: ELECTION_THEMES,
    minHits: 2,
  },
  {
    id: "economy",
    label: "Economy",
    blurb: "African economies: debt and IMF programmes, inflation and currencies, growth, investment, resources, livelihoods and reform.",
    signal: /\b(econom\w*|gdp|growth|inflation|debt\w*|fiscal|budget\w*|currenc\w*|monetary|central bank|imf|investment\w*|investors?|financ\w*|bonds?|tax\w*|revenue\w*|recession|poverty|jobs|employment|prices)\b/i,
    themes: ECONOMY_THEMES,
    minHits: 2,
  },
  {
    id: "trade",
    label: "Trade",
    blurb: "Africa's trade: the AfCFTA and regional integration, relations with the US, EU, China and the Gulf, supply chains, corridors and policy.",
    signal: /\b(trade|trading|tariffs?|exports?|imports?|afcfta|agoa|customs|supply chains?|value chains?|commodit\w*|market access|wto|ports?|logistics|corridors?|shipping)\b/i,
    themes: TRADE_THEMES,
    minHits: 2,
  },
  {
    id: "cyber",
    label: "Cybersecurity",
    blurb: "Cyber threats, critical infrastructure, policy and law, surveillance and shutdowns, information operations and emerging tech in Africa.",
    signal: /\b(cyber\w*|hack\w*|ransomware|malware|breach\w*|data protection|digital|internet|online|surveillance|spyware|disinformation|encryption|phishing|artificial intelligence|telecom\w*)\b/i,
    themes: CYBER_THEMES,
    minHits: 2,
  },
  {
    id: "conflict",
    label: "Conflict",
    blurb: "Armed conflict in Africa: dynamics, jihadism, coups, peace processes, peace operations, communal and illicit violence, and civilians.",
    signal: /\b(conflict\w*|wars?|fighting|armed|insurg\w*|militants?|jihad\w*|terror\w*|rebels?|militias?|violence|attacks?|ceasefire|peace|security|military|coups?|clashes|offensive|junta)\b/i,
    themes: CONFLICT_THEMES,
    minHits: 2,
  },
];

export const domainOf = (id: string): Domain | undefined => DOMAINS.find((d) => d.id === id);
export const themeLabel = (domain: string, id: string) => domainOf(domain)?.themes.find((t) => t.id === id)?.label ?? id;

function termRegex(term: string): RegExp {
  const t = term.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ch : `\\${ch}`));
  const body = t.endsWith("*") ? `${t.slice(0, -1)}[\\w-]*` : t;
  return new RegExp(`(?:^|[^\\w])${body}(?=$|[^\\w])`, "i");
}
const THEME_RX = new Map(DOMAINS.map((d) => [d.id, d.themes.map((th) => ({ id: th.id, systemic: !!th.systemic, rx: th.terms.map(termRegex) }))]));

/** The themes of a domain a text touches, most-matched first, with how many terms matched. */
export function themesOf(domain: DomainId, text: string): { id: string; hits: number }[] {
  return (THEME_RX.get(domain) ?? [])
    .map((th) => ({ id: th.id, hits: th.rx.filter((r) => r.test(text)).length }))
    .filter((t) => t.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}

/* ── Africa ───────────────────────────────────────────────────────────── */

const AFRICA_NAMES: { code: string; rx: RegExp }[] = Object.entries(AFRICA_GEO_COUNTRIES)
  .filter(([code]) => !MIDDLE_EAST_CODES.has(code))
  .flatMap(([code, info]) => [info.name, ...info.aliases].filter((n) => n.length >= 4).map((n) => ({ code, rx: new RegExp(`\\b${normalizeName(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) })));
const AFRICA_DEMONYMS: [RegExp, string][] = [
  [/\bsudanese\b/, "SD"], [/\bsouth sudanese\b/, "SS"], [/\bethiopians?\b/, "ET"], [/\beritreans?\b/, "ER"], [/\bsomalis?\b/, "SO"], [/\bkenyans?\b/, "KE"],
  [/\bugandans?\b/, "UG"], [/\bcongolese\b/, "CD"], [/\bmalians?\b/, "ML"], [/\bnigeriens?\b/, "NE"], [/\bnigerians?\b/, "NG"], [/\bburkinabe\b/, "BF"],
  [/\bchadians?\b/, "TD"], [/\bcameroonians?\b/, "CM"], [/\blibyans?\b/, "LY"], [/\bmozambicans?\b/, "MZ"], [/\bzimbabweans?\b/, "ZW"], [/\bdarfuri\b/, "SD"], [/\btigrayans?\b/, "ET"],
];
const AFRICA_REGION = /\b(africa|african|sahel|sahelian|horn of africa|lake chad|great lakes|east africa|west africa|central africa|southern africa|north africa|sub-saharan|maghreb)\b/;

/** The African countries a text discusses, most-mentioned first, and whether it is about Africa at all. */
export function africaOf(text: string): { africa: boolean; countries: string[] } {
  // "Ethiopia's" reads as "Ethiopia".
  const t = normalizeName(text.replace(/['’‘ʼ]s\b/g, ""));
  const counts = new Map<string, number>();
  for (const { code, rx } of AFRICA_NAMES) {
    const n = (t.match(new RegExp(rx.source, "g")) ?? []).length;
    if (n) counts.set(code, (counts.get(code) ?? 0) + n);
  }
  for (const [rx, code] of AFRICA_DEMONYMS) if (rx.test(t)) counts.set(code, (counts.get(code) ?? 0) + 1);
  // "South Sudan" also matches "Sudan": drop the Sudan count it caused.
  if (counts.has("SS") && counts.has("SD")) {
    const ss = (t.match(/\bsouth sudan/g) ?? []).length;
    const sd = (counts.get("SD") ?? 0) - ss;
    if (sd > 0) counts.set("SD", sd);
    else counts.delete("SD");
  }
  const countries = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { africa: countries.length > 0 || AFRICA_REGION.test(t), countries };
}

/* ── Classifying a piece ──────────────────────────────────────────────── */

export interface AnalysisItem {
  id: string;
  domain: DomainId;
  url: string;
  title: string;
  summary: string;
  source: string;
  published: string;
  themes: string[];
  countries: string[];
  africa: boolean;
  /** About Africa, or (New Humanitarianism) a system-level reflection that shapes Africa: shown and alerted on. */
  inScope: boolean;
  score: number;
}

/** The domains a piece belongs to, among those its source writes on. */
export function classify(raw: { url: string; title: string; summary: string; source: Source; published: string }): AnalysisItem[] {
  const text = `${raw.title}. ${raw.summary}`;
  const { africa: mentionsAfrica, countries } = africaOf(text);
  const africa = mentionsAfrica || raw.source.africa;
  const specialist = raw.source.domains.length <= 2;
  const out: AnalysisItem[] = [];
  for (const id of raw.source.domains) {
    const d = domainOf(id)!;
    if (!d.signal.test(text)) continue;
    const themes = themesOf(id, text);
    const hits = themes.reduce((n, t) => n + t.hits, 0);
    if (hits === 0 || hits < (specialist ? 1 : d.minHits)) continue;
    const systemic = themes.some((t) => d.themes.find((x) => x.id === t.id)?.systemic);
    // Outside Africa, only the system-level themes count.
    if (!africa && !systemic) continue;
    out.push({
      id: hashId(raw.url || raw.title),
      domain: id,
      url: raw.url,
      title: raw.title,
      summary: raw.summary.slice(0, 700),
      source: raw.source.name,
      published: raw.published,
      themes: themes.map((t) => t.id),
      countries,
      africa,
      inScope: africa || systemic,
      score: hits + (africa ? 2 : 0) + (systemic ? 1 : 0),
    });
  }
  return out;
}

/* ── Feeds ────────────────────────────────────────────────────────────── */

// Escaped markup (&lt;p&gt;) is unescaped before tags are stripped, so it does not survive as text.
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Items from an RSS or Atom feed: title, link, date and summary. */
export function parseFeed(xml: string): { title: string; url: string; published: string; summary: string }[] {
  const out: { title: string; url: string; published: string; summary: string }[] = [];
  const tag = (block: string, names: string[]) => {
    for (const n of names) {
      const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
      if (m) return m[1];
    }
    return "";
  };
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = decode(tag(b, ["title"]));
    let url = decode(tag(b, ["link"]));
    if (!url) url = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? "";
    const dateRaw = decode(tag(b, ["pubDate", "published", "updated", "dc:date"]));
    const date = Date.parse(dateRaw);
    const summary = decode(tag(b, ["description", "summary", "content:encoded", "content"]));
    if (!title || !url || !Number.isFinite(date)) continue;
    out.push({ title, url: url.trim(), published: new Date(date).toISOString(), summary });
  }
  return out;
}

function hashId(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `sa_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/* ── Storage and collection ───────────────────────────────────────────── */

let ready = false;
export async function ensureAnalysisTables(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS strategic_analyses (domain TEXT NOT NULL, id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, source TEXT NOT NULL, published TEXT NOT NULL, themes TEXT NOT NULL, countries TEXT NOT NULL, africa INTEGER NOT NULL, in_scope INTEGER NOT NULL, score INTEGER NOT NULL, first_seen TEXT NOT NULL, PRIMARY KEY (domain, id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_strategic_analyses_published ON strategic_analyses(domain, published)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_strategic_analyses_first_seen ON strategic_analyses(first_seen)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS strategic_sources (url TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT, checked_at TEXT, status TEXT, error TEXT, items INTEGER NOT NULL DEFAULT 0, kept INTEGER NOT NULL DEFAULT 0, last_ok TEXT)`),
  ]);
  // One-time move of the first version's humanitarian tables.
  const old = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hum_analyses', 'hum_sources')`).all<{ name: string }>();
  const names = new Set((old.results ?? []).map((r) => r.name));
  if (names.has("hum_analyses")) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO strategic_analyses (domain, id, url, title, summary, source, published, themes, countries, africa, in_scope, score, first_seen) SELECT 'humanitarian', id, url, title, summary, source, published, themes, countries, africa, in_scope, score, first_seen FROM hum_analyses`),
      db.prepare(`DROP TABLE hum_analyses`),
    ]);
  }
  if (names.has("hum_sources")) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO strategic_sources (url, name, feed_url, checked_at, status, error, items, kept, last_ok) SELECT url, name, feed_url, checked_at, status, error, items, kept, last_ok FROM hum_sources`),
      db.prepare(`DROP TABLE hum_sources`),
    ]);
  }
  ready = true;
}

/** Test hook. */
export function resetAnalysisTables(): void {
  ready = false;
}

const CHECK_EVERY_MS = 60 * 60_000;
const REDISCOVER_MS = 7 * 24 * 3600_000;
/** Sources read per run: the cron runs every few minutes, so every source is still read about hourly. */
const BATCH = 14;
/** Pieces older than this when first seen are not stored: the panel is about what is new. */
const MAX_AGE_DAYS = 120;

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLens/1.0; +https://afrilensconsulting.com)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(20000) });

/**
 * Reads the sources due a check (not read in the last hour, least recently read first, at most `limit`), stores new
 * pieces per domain, and returns how many were new.
 */
export async function collectStrategicAnalyses(
  env: Env,
  opts: { force?: boolean; now?: Date; fetcher?: Fetcher; discover?: typeof discoverFeed; limit?: number } = {}
): Promise<{ ran: boolean; added: number; sources: number }> {
  const db = env.DB;
  const now = opts.now ?? new Date();
  const fetcher = opts.fetcher ?? defaultFetch;
  const discover = opts.discover ?? discoverFeed;
  await ensureAnalysisTables(db);

  const states = new Map((await db.prepare(`SELECT url, feed_url, checked_at, status FROM strategic_sources`).all<{ url: string; feed_url: string | null; checked_at: string | null; status: string | null }>()).results?.map((r) => [r.url, r]) ?? []);
  const age = (s: Source) => {
    const t = states.get(s.url)?.checked_at;
    return t ? now.getTime() - Date.parse(t) : Infinity;
  };
  const due = SOURCES.filter((s) => opts.force || age(s) >= CHECK_EVERY_MS)
    .sort((a, b) => age(b) - age(a))
    .slice(0, opts.limit ?? BATCH);
  if (due.length === 0) return { ran: false, added: 0, sources: 0 };

  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString();
  let added = 0;

  const one = async (src: Source) => {
    const state = states.get(src.url);
    let feedUrl = state?.feed_url ?? null;
    try {
      if (!feedUrl || (state?.checked_at && now.getTime() - Date.parse(state.checked_at) > REDISCOVER_MS && state.status !== "ok")) {
        const found = await discover(src.url);
        if (found.status !== "ok") throw new Error(found.status === "no_feed" ? "No feed found on this site" : found.message);
        feedUrl = found.feedUrl;
      }
      const res = await fetcher(feedUrl);
      if (!res.ok) throw new Error(`Feed returned ${res.status}`);
      const entries = parseFeed(await res.text());
      const fresh = entries.filter((e) => e.published >= cutoff);
      const kept = fresh.flatMap((e) => classify({ ...e, source: src }));
      if (kept.length) {
        const results = await db.batch(
          kept.map((it) =>
            db
              .prepare(`INSERT OR IGNORE INTO strategic_analyses (domain, id, url, title, summary, source, published, themes, countries, africa, in_scope, score, first_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .bind(it.domain, it.id, it.url, it.title, it.summary, it.source, it.published, JSON.stringify(it.themes), JSON.stringify(it.countries), it.africa ? 1 : 0, it.inScope ? 1 : 0, it.score, now.toISOString())
          )
        );
        added += results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
      }
      const keptPieces = new Set(kept.map((k) => k.id)).size;
      await db
        .prepare(`INSERT INTO strategic_sources (url, name, feed_url, checked_at, status, error, items, kept, last_ok) VALUES (?,?,?,?,'ok',NULL,?,?,?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, feed_url = excluded.feed_url, checked_at = excluded.checked_at, status = 'ok', error = NULL, items = excluded.items, kept = excluded.kept, last_ok = excluded.last_ok`)
        .bind(src.url, src.name, feedUrl, now.toISOString(), entries.length, keptPieces, now.toISOString())
        .run();
    } catch (err) {
      await db
        .prepare(`INSERT INTO strategic_sources (url, name, feed_url, checked_at, status, error) VALUES (?,?,?,?,'error',?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, feed_url = COALESCE(excluded.feed_url, strategic_sources.feed_url), checked_at = excluded.checked_at, status = 'error', error = excluded.error`)
        .bind(src.url, src.name, feedUrl, now.toISOString(), err instanceof Error ? err.message.slice(0, 300) : String(err))
        .run();
    }
  };

  // A few at a time, so one slow site does not hold the rest.
  const queue = [...due];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) await one(s);
    })
  );
  await db.prepare(`DELETE FROM strategic_analyses WHERE first_seen < ?`).bind(new Date(now.getTime() - 365 * 86_400_000).toISOString()).run();
  return { ran: true, added, sources: due.length };
}

/* ── Reading ──────────────────────────────────────────────────────────── */

export interface AnalysisView extends AnalysisItem {
  firstSeen: string;
  /** The African country it discusses most, if any. */
  lat: number | null;
  lng: number | null;
}

function rowToView(r: Record<string, unknown>): AnalysisView {
  const countries = JSON.parse(String(r.countries ?? "[]")) as string[];
  const pin = countries.map((c) => AFRICA_CENTROIDS[c]).find(Boolean) ?? null;
  return {
    id: String(r.id),
    domain: String(r.domain) as DomainId,
    url: String(r.url),
    title: String(r.title),
    summary: String(r.summary ?? ""),
    source: String(r.source),
    published: String(r.published),
    themes: JSON.parse(String(r.themes ?? "[]")),
    countries,
    africa: !!r.africa,
    inScope: !!r.in_scope,
    score: Number(r.score),
    firstSeen: String(r.first_seen),
    lat: pin ? pin[0] : null,
    lng: pin ? pin[1] : null,
  };
}

export async function listAnalyses(db: D1Database, domain: DomainId, opts: { days?: number; all?: boolean; limit?: number } = {}): Promise<AnalysisView[]> {
  await ensureAnalysisTables(db);
  const since = new Date(Date.now() - (opts.days ?? 60) * 86_400_000).toISOString();
  const rows = await db
    .prepare(`SELECT * FROM strategic_analyses WHERE domain = ? AND published >= ? ${opts.all ? "" : "AND in_scope = 1"} ORDER BY published DESC LIMIT ?`)
    .bind(domain, since, Math.min(opts.limit ?? 300, 1000))
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToView);
}

/** Per domain: pieces in scope in the last 30 days and when the newest was first seen (for the tabs' NEW marks). */
export async function domainSummary(db: D1Database): Promise<Record<string, { recent: number; latest: string | null }>> {
  await ensureAnalysisTables(db);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = await db
    .prepare(`SELECT domain, SUM(CASE WHEN published >= ? THEN 1 ELSE 0 END) AS recent, MAX(first_seen) AS latest FROM strategic_analyses WHERE in_scope = 1 GROUP BY domain`)
    .bind(since)
    .all<{ domain: string; recent: number; latest: string | null }>();
  return Object.fromEntries((rows.results ?? []).map((r) => [r.domain, { recent: Number(r.recent ?? 0), latest: r.latest }]));
}

/** Pieces of a domain in scope first seen after `since`, best first, for alerts. */
export async function newAnalysesSince(db: D1Database, domain: DomainId, since: string, limit = 10): Promise<AnalysisView[]> {
  await ensureAnalysisTables(db);
  const rows = await db
    .prepare(`SELECT * FROM strategic_analyses WHERE domain = ? AND in_scope = 1 AND first_seen > ? ORDER BY score DESC, published DESC LIMIT ?`)
    .bind(domain, since, limit)
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToView);
}

export async function sourceStatus(db: D1Database, domain: DomainId): Promise<{ name: string; url: string; status: string; error: string | null; items: number; kept: number; lastOk: string | null }[]> {
  await ensureAnalysisTables(db);
  const rows = (await db.prepare(`SELECT * FROM strategic_sources`).all<Record<string, unknown>>()).results ?? [];
  const byUrl = new Map(rows.map((r) => [String(r.url), r]));
  return SOURCES.filter((s) => s.domains.includes(domain)).map((s) => {
    const r = byUrl.get(s.url);
    return { name: s.name, url: s.url, status: r ? String(r.status) : "not yet checked", error: r?.error != null ? String(r.error) : null, items: Number(r?.items ?? 0), kept: Number(r?.kept ?? 0), lastOk: r?.last_ok != null ? String(r.last_ok) : null };
  });
}
