import type { Env } from "../bindings";
import { AFRICA_CENTROIDS, MIDDLE_EAST_CODES, namedLocations } from "./africaGeo";
import { discoverFeed } from "./feedDiscovery";
import { SOURCE_KIND_LABEL, SOURCES, type DomainId, type Source, type SourceKind } from "./strategicSources";
import { HUMANITARIAN_RULES } from "./humanitarianBoolean";

export { SOURCES, type DomainId, type Source };

/**
 * Strategic analyses: what think tanks, research centres, analysts and specialist outlets publish on Africa, sorted
 * into domains (New Humanitarianism, Geopolitics, Elections, Economy, Trade, Cybersecurity, Conflict). Each domain has
 * its own keyword taxonomy (English, French and Portuguese, since much African analysis is not in English, plus a
 * theme for the places and bodies the domain turns on); the sources are in strategicSources.ts.
 *
 * The collector reads a batch of the least recently read sources every run (so every source is read about hourly
 * without one run making too many requests), keeps pieces that match a domain's taxonomy and are about Africa (or,
 * for New Humanitarianism, are system-level reflections that shape Africa), and stores them per domain with their
 * themes, the African countries, places, regions and regional blocs they discuss. New pieces are sent to anyone
 * subscribed to that domain's alerts (alertDelivery.ts, scope "analyses", query_id = domain).
 *
 * Matching ignores case, accents, apostrophes and hyphens on both sides ("élection" = "election", "Côte d'Ivoire" =
 * "cote d ivoire", "farmer-herder" = "farmer herder").
 */

/* ── Taxonomy ─────────────────────────────────────────────────────────── */

export interface Theme {
  id: string;
  label: string;
  /** A term ending in "*" matches any word that starts with it. */
  terms: string[];
  /** Shapes the whole system, so counts even when a piece names no African country. */
  systemic?: boolean;
  /** Tags a piece (where, which crisis) but never qualifies it on its own. */
  context?: boolean;
  /** Boolean rules: each rule is groups combined with AND, the terms in a group combined with OR. The theme matches
   *  when any plain term matches OR any rule is satisfied. */
  rules?: string[][][];
}

export interface Domain {
  id: DomainId;
  label: string;
  blurb: string;
  /** Run on the folded text: a piece must be about the domain at all before its themes count. */
  signal: RegExp;
  themes: Theme[];
  /** Theme-term hits needed from a source that covers many domains (a specialist source needs one). */
  minHits: number;
}

/** Lower case, no accents; apostrophes, hyphens and dashes as spaces ("L'Alliance" → "l alliance"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘ʼ`´]/g, " ")
    .replace(/[-‐‑–—_/]/g, " ")
    .replace(/\s+/g, " ");
}

const HUMANITARIAN_THEMES: Theme[] = [
  {
    id: "funding",
    label: "Funding cuts & aid financing",
    systemic: true,
    terms: ["funding cut*", "aid cut*", "budget cut*", "cuts to aid", "foreign aid", "official development assistance", "oda", "usaid", "dismantl*", "aid freeze", "funding freeze", "stop work order*", "funding gap*", "underfund*", "humanitarian financing", "humanitarian funding", "pooled fund*", "country based pooled fund*", "cerf", "global humanitarian overview", "humanitarian response plan*", "appeal* funded", "funding crunch", "funding crisis", "liquidity crisis", "un liquidity", "pepfar", "uk aid", "fcdo", "0 7 per cent", "0 3 per cent", "gni", "aid budget cut*", "development budget*", "rescission*", "doge", "trump cuts", "ration cut*", "pipeline break*", "staff cuts", "job cuts", "layoffs", "redundanc*", "ngo closures", "programme closures", "contraction", "retrenchment", "humanitarian needs overview", "donor fatigue", "donor government*", "shrinking aid", "aid budget*", "aid architecture", "financing gap", "hyper prioriti*", "prioritisation", "prioritization", "baisse de l aide", "coupes budgetaires", "financement humanitaire", "aide publique au developpement", "cortes na ajuda"],
  },
  {
    id: "reset",
    label: "Humanitarian reset & system reform",
    systemic: true,
    terms: ["humanitarian reset", "the reset", "reset humanitaire", "un80", "un reform", "system reform", "grand bargain", "iasc", "inter agency standing committee", "flagship initiative", "humanitarian architecture", "humanitarian system", "systeme humanitaire", "transformation agenda", "agency merger*", "merging agencies", "emergency relief coordinator", "cluster system", "cluster approach", "humanitarian coordination", "coordination humanitaire", "area based coordination", "people centred", "people centered", "needs based", "hyper prioritised", "hyper prioritized", "humanitarian compact", "new humanitarian architecture", "ocha", "humanitarian leadership", "humanitarian coordinator*", "humanitarian country team*", "agency mandates"],
  },
  {
    id: "localisation",
    label: "Localisation & shifting power",
    systemic: true,
    terms: ["localisation", "localization", "localis*", "localiz*", "locally led", "local actors", "local and national actors", "national ngos", "local ngos", "ong locales", "ong nationales", "acteurs locaux", "community led", "community based organi*", "mutual aid", "emergency response rooms", "err", "shift the power", "shifting power", "power shift", "decoloni*", "charter for change", "intermediar*", "direct funding", "overhead*", "indirect cost*", "women led organi*", "women s rights organi*", "proximate", "local leadership", "equitable partnership*", "leadership locale", "survivor led", "refugee led", "refugee led organi*", "youth led", "faith based", "faith actors", "grassroots", "community philanthropy", "african philanthropy", "pledge for change", "risk sharing", "partnership*", "capacity sharing", "power imbalance*", "ubuntu", "solidarity", "african led", "african solutions"],
  },
  {
    id: "global-south",
    label: "Global South & non-traditional actors",
    systemic: true,
    terms: ["global south", "sud global", "non traditional donor*", "emerging donor*", "new donors", "gulf donor*", "gulf humanitarian*", "saudi aid", "ksrelief", "emirati aid", "uae aid", "qatari aid", "qatar fund for development", "qatar charity", "kuwaiti aid", "turkish aid", "turkiye s aid", "tika", "afad", "chinese aid", "china s aid", "south south", "brics", "india s aid", "african humanitarian agency", "african union humanitarian", "au humanitarian", "afreximbank", "solidarity based", "middle powers", "islamic humanitarian*", "islamic relief", "zakat", "waqf", "diaspora", "remittance*", "africa cdc", "african development solutions", "south african aid", "nigeria s aid", "kenya s humanitarian", "egypt s aid", "regional humanitarian", "humanitarian diplomacy", "geopolitics of aid", "aid and geopolitics", "new donors"],
  },
  {
    id: "access",
    label: "Access & the operating environment",
    terms: ["humanitarian access", "acces humanitaire", "access constraint*", "access impediment*", "bureaucratic impediment*", "humanitarian negotiation*", "negotiat* access", "armed group* engagement", "engagement with armed groups", "non state armed group*", "deconflict*", "besieg*", "siege", "blockade", "aid diversion", "obstruction of aid", "obstructing aid", "aid obstruction", "starvation as a weapon", "starvation", "humanitarian corridor*", "cross border aid", "cross line", "adre crossing", "denial of access", "humanitarian space", "espace humanitaire", "operating environment", "visa restrictions", "travel permit*", "communications blackout", "access negotiation*", "frontline negotiation*", "remote management", "remote programming", "de facto authorities", "humanitarian corridor*", "crossline", "aid blockade", "weaponi* aid", "weaponi* food", "registration of ngos", "ngo law", "ngo regulation", "shrinking civic space", "expulsion of aid", "expelled ngo*"],
  },
  {
    id: "principles",
    label: "Principles, politicisation & sanctions",
    terms: ["humanitarian principles", "principes humanitaires", "neutrality", "neutralite", "impartiality", "impartialite", "independence of humanitarian", "principled humanitarian*", "politicis*", "politiciz*", "instrumentalis*", "instrumentaliz*", "counter terror*", "counterterror*", "sanctions regime*", "sanctions exemption*", "humanitarian carve out*", "humanitarian exemption*", "resolution 2664", "resolution 2417", "militaris*", "securitis*", "humanitarian ethics", "dunantist", "solidarity based humanitarian*", "politics of aid", "aid conditionality", "conditionality", "international humanitarian law", "droit international humanitaire", "ihl", "dih", "protection of civilians"],
  },
  {
    id: "security",
    label: "Aid worker safety & risk",
    terms: ["aid worker*", "humanitarian worker*", "travailleurs humanitaires", "attacks on aid", "attacks on humanitarian*", "staff killed", "humanitarian staff", "duty of care", "risk transfer", "risk sharing", "security risk management", "kidnapping of aid", "national staff", "local staff", "looting of aid", "warehouse* looted", "aid worker deaths", "deadliest year", "security incidents", "insecurity insight", "aid worker security"],
  },
  {
    id: "nexus",
    label: "Nexus, climate & anticipatory action",
    terms: ["nexus", "humanitarian development peace", "triple nexus", "hdp", "anticipatory action", "action anticipatoire", "early action", "early warning", "alerte precoce", "climate finance", "climate crisis", "climate shocks", "drought", "secheresse", "floods", "inondations", "el nino", "loss and damage", "resilience", "protracted crisis", "protracted crises", "protracted displacement", "durable solutions", "solutions durables", "social protection", "shock responsive", "disaster risk", "climate adaptation", "climate displacement", "development actors", "peacebuilding", "humanitarian development", "phase out", "exit strateg*"],
  },
  {
    id: "accountability",
    label: "Accountability & participation",
    terms: ["accountability to affected people", "accountability to affected populations", "aap", "participation revolution", "affected people", "affected communities", "feedback mechanism*", "community engagement", "psea", "sexual exploitation and abuse", "safeguarding", "redevabilite", "core humanitarian standard", "chs", "ground truth", "perception survey*", "community feedback", "dignity", "people affected by crisis", "affected populations", "voice of affected", "inclusion", "disability inclusion", "gender", "protection mainstreaming"],
  },
  {
    id: "cash-digital",
    label: "Cash, data & technology",
    terms: ["cash assistance", "cash transfer*", "cash and voucher*", "multipurpose cash", "transferts monetaires", "digital humanitarian*", "artificial intelligence", "data protection", "biometric*", "digital identity", "humanitarian data", "mobile money", "starlink", "ai in humanitarian*", "humanitarian innovation", "innovation", "data responsibility", "anticipatory finance", "forecast based financing", "insurance", "risk financing"],
  },
  {
    id: "displacement",
    label: "Displacement, refugees & migration policy",
    terms: ["refugee policy", "refugee response", "refugee protection", "durable solutions", "global compact on refugees", "global refugee forum", "kampala convention", "comprehensive refugee response framework", "crrf", "refugee self reliance", "refugee inclusion", "encampment policy", "mixed migration", "forced displacement", "internal displacement", "displacement crisis", "displacement crises", "politique d asile", "deplacement force"],
  },
  {
    id: "hunger-health",
    label: "Famine, hunger & health emergencies",
    terms: ["famine", "famine declared", "famine warning", "ipc phase 5", "ipc 5", "catastrophic hunger", "hunger crisis", "food crisis", "crise alimentaire", "cadre harmonise", "fews net", "acute malnutrition", "cholera outbreak", "mpox response", "health emergency"],
  },
  {
    id: "protection",
    label: "Protection, gender & inclusion",
    terms: ["protection crisis", "protection of civilians", "gender based violence", "gbv", "sexual violence in conflict", "child protection", "women and girls in crisis", "disability inclusion", "mhpss", "mental health and psychosocial", "violences basees sur le genre"],
  },
  {
    id: "crises",
    label: "Africa's major crises",
    context: true,
    terms: ["sudan", "darfur", "el fasher", "el fashir", "kordofan", "south sudan", "eastern drc", "north kivu", "south kivu", "ituri", "goma", "central sahel", "lake chad", "lac tchad", "tigray", "amhara", "somalia", "cabo delgado", "anglophone crisis", "central african republic", "famine", "ipc 5", "ipc phase 5", "cholera", "mpox", "refugee camp*", "camps de refugies", "chad refugee*", "displaced", "deplaces", "idps", "returnees"],
  },
  {
    id: "general",
    label: "Humanitarian policy & practice",
    terms: ["humanitarian*", "aid agenc*", "aid organi*", "relief", "ngo*", "international ngo*", "un agenc*", "donor*", "refugee*", "displacement", "famine", "food insecurity", "aide humanitaire", "ajuda humanitaria"],
  },
  {
    id: "future",
    label: "The future of humanitarianism",
    systemic: true,
    terms: ["future of humanitarian*", "avenir de l humanitaire", "new humanitarianism", "humanitarian landscape", "humanitarian sector", "secteur humanitaire", "aid sector", "aid industry", "post aid", "beyond aid", "aid dependency", "multilateralism", "multilateral system", "humanitarian model", "humanitarian action", "action humanitaire", "what next for aid", "end of aid", "rethinking aid", "rethink* humanitarian*", "decolonising aid", "decolonizing aid", "humanitarian imperative", "humanitarian identity", "humanitarian ecosystem", "humanitarian response", "international aid", "aid system", "development cooperation", "development aid", "aid effectiveness", "aid policy", "humanitarian policy", "politique humanitaire", "humanitarian crisis response", "state of the humanitarian system", "humanitarian trends", "global humanitarian assistance", "humanitarianism", "humanitarisme", "humanitaire"],
  },
];

const GEOPOLITICS_THEMES: Theme[] = [
  { id: "major-powers", label: "Major powers in Africa", terms: ["great power*", "grandes puissances", "china", "chinese", "chine", "chinois", "beijing", "pekin", "focac", "russia*", "russie", "russe*", "kremlin", "moscow", "moscou", "united states", "etats unis", "washington", "us africa", "trump administration", "africom", "european union", "union europeenne", "eu africa", "brussels", "france", "french", "francais", "francafrique", "paris", "united kingdom", "britain", "british", "royaume uni", "portugal", "germany", "italy", "mattei plan"] },
  { id: "middle-powers", label: "Gulf, Türkiye & middle powers", terms: ["middle power*", "puissances moyennes", "gulf state*", "gulf countries", "golfe", "uae", "emirati*", "emirats", "abu dhabi", "saudi*", "arabie saoudite", "riyadh", "qatar*", "doha", "turkey", "turkiye", "turquie", "turkish", "ankara", "iran*", "tehran", "israel*", "india*", "inde", "new delhi", "japan*", "ticad", "brazil*", "south korea*", "indonesia", "egypt*"] },
  { id: "multilateral", label: "AU, regional blocs & multilateralism", terms: ["african union", "union africaine", "au commission", "commission de l ua", "peace and security council", "conseil de paix et de securite", "ecowas", "cedeao", "sadc", "eac", "east african community", "igad", "eccas", "ceeac", "comesa", "arab maghreb union", "uma", "cen sad", "alliance of sahel states", "alliance des etats du sahel", "aes", "confederation of sahel states", "un security council", "conseil de securite", "unsc", "a3", "a3 plus", "brics", "g20", "multilateral*", "multilateralisme", "regional bloc*", "regional organi*", "permanent seat", "ezulwini consensus", "agenda 2063"] },
  { id: "security-partnerships", label: "Security partnerships & foreign military presence", terms: ["military base*", "base militaire", "naval base*", "base navale", "security cooperation", "cooperation securitaire", "security partner*", "defence pact*", "defense pact*", "defence agreement*", "defense agreement*", "accord de defense", "arms deal*", "arms sale*", "ventes d armes", "foreign troops", "troupes etrangeres", "troop withdrawal", "retrait des troupes", "military presence", "presence militaire", "wagner", "africa corps", "private military", "mercenar*", "drone sale*", "bayraktar", "military training", "military advisers", "barkhane"] },
  { id: "arenas", label: "Strategic arenas: Red Sea, Sahel, Great Lakes, Gulf of Guinea…", terms: ["red sea", "mer rouge", "bab el mandeb", "gulf of aden", "golfe d aden", "horn of africa", "corne de l afrique", "sahel", "gulf of guinea", "golfe de guinee", "great lakes", "grands lacs", "indian ocean", "ocean indien", "mozambique channel", "maghreb", "nile", "nil", "gerd", "grand ethiopian renaissance dam", "renaissance dam", "western sahara", "sahara occidental", "polisario", "somaliland", "berbera", "port sudan", "djibouti", "suez canal", "canal de suez", "sinai", "libya", "fezzan", "lake chad", "lac tchad", "cabo delgado", "sea access", "access to the sea", "acces a la mer"] },
  { id: "resources", label: "Resources, minerals & infrastructure diplomacy", terms: ["critical mineral*", "minerais critiques", "rare earth*", "terres rares", "cobalt", "lithium", "uranium", "coltan", "copper", "gold", "oil", "petrole", "gas", "gaz", "strategic port*", "port deal*", "dp world", "lobito corridor", "corridor de lobito", "belt and road", "global gateway", "pgii", "infrastructure diplomacy", "mineral diplomacy", "minerals for security", "resource nationalism", "nationalisme des ressources"] },
  { id: "diplomacy", label: "Diplomacy, alignment & sovereignty", terms: ["foreign policy", "politique etrangere", "diplomac*", "diplomati*", "diplomat*", "summit*", "sommet*", "non align*", "alignment", "strategic autonomy", "autonomie strategique", "sovereignty", "souverainete", "soberania", "neocolonial*", "anti french", "sentiment anti francais", "anti western", "pan african*", "panafrican*", "recognition", "reconnaissance", "sanction*", "envoy*", "envoye special", "bilateral relations", "rapprochement", "rupture", "expulsion of ambassador*", "rift with"] },
  { id: "influence", label: "Influence & information competition", terms: ["soft power", "influence operation*", "operations d influence", "information war*", "guerre informationnelle", "disinformation", "desinformation", "propaganda", "propagande", "media influence", "rt", "sputnik", "african initiative", "scholarships", "cultural diplomacy", "narrative*", "recit*"] },
  { id: "migration", label: "Migration, borders & mobility", terms: ["migration", "migrants", "migratoire", "border*", "frontiere*", "externalis*", "externaliz*", "migration deal*", "migration partnership*", "returns agreement*", "readmission", "free movement", "libre circulation", "mediterranean crossing*", "central mediterranean", "atlantic route", "canary islands", "smuggling network*"] },
];

const ELECTION_THEMES: Theme[] = [
  { id: "contests", label: "Elections, campaigns & candidates", terms: ["presidential election*", "election presidentielle", "presidentielle", "general election*", "elections generales", "legislative election*", "legislatives", "parliamentary election*", "local election*", "municipal election*", "municipales", "elections locales", "by election*", "run off", "runoff", "second round", "second tour", "premier tour", "primaries", "party primar*", "campaign*", "campagne electorale", "candidate*", "candidat*", "nomination*", "manifesto*", "electoral calendar", "calendrier electoral", "polling day", "turnout", "taux de participation", "election results", "resultats", "landslide", "incumbent*", "sortant", "opposition", "eleicoes", "eleicao", "candidato*", "electoral alliance*", "coalition*"] },
  { id: "integrity", label: "Electoral integrity & administration", terms: ["electoral commission", "election commission", "commission electorale", "election management bod*", "iebc", "inec", "ceni", "cena", "nec", "zec", "ecz", "cne", "ec ghana", "voter registration", "enrolement", "inscription sur les listes", "voter roll*", "voters roll", "voter register", "fichier electoral", "liste electorale", "biometric voter", "bvas", "irev", "results transmission", "transmission des resultats", "rigging", "rigged", "electoral fraud", "fraude electorale", "fraude", "vote fraud", "irregularit*", "tallying", "depouillement", "observer*", "observateur*", "observation mission*", "mission d observation", "credibility", "credibilite", "election petition*", "contentieux electoral", "electoral court*", "cour constitutionnelle", "constitutional court", "supreme court ruling", "disputed result*", "recount", "boycott*", "diaspora vote", "electoral code", "code electoral"] },
  { id: "violence", label: "Electoral violence & unrest", terms: ["electoral violence", "election violence", "violences electorales", "election related violence", "post election", "post electoral", "postelectoral*", "pre election", "pre electoral", "protest*", "manifestation*", "crackdown", "repression", "internet shutdown*", "coupure d internet", "arrest of opposition", "opposition leader* arrested", "arrestation d opposants", "intimidation", "vote buying", "achat de voix", "abduction*", "enlevement*", "state of emergency", "etat d urgence", "curfew", "couvre feu", "gen z protest*"] },
  { id: "backsliding", label: "Term limits, coups & democratic backsliding", terms: ["term limit*", "limitation des mandats", "third term", "troisieme mandat", "fourth term", "quatrieme mandat", "constitutional amendment*", "constitutional change*", "revision constitutionnelle", "nouvelle constitution", "new constitution", "constitutional referendum", "referendum", "coup*", "coup d etat", "putsch", "junta*", "junte*", "military rule", "transition*", "transitional", "charte de la transition", "democratic backslid*", "backsliding", "recul democratique", "authoritarian*", "autoritar*", "democratic decline", "democratic recession", "postpone* election*", "delayed election*", "report des elections", "succession", "dynast*", "life president*", "unconstitutional change* of government", "changement anticonstitutionnel"] },
  { id: "norms", label: "Regional norms & sanctions", terms: ["african charter on democracy", "acdeg", "ecowas protocol on democracy", "protocole de la cedeao", "sadc principles and guidelines", "au suspension", "suspended from the african union", "suspension de l ua", "ecowas sanctions", "sanctions de la cedeao", "election observation mission", "au election observation", "ecowas observer*", "sadc electoral observation", "peace and security council", "mediation*", "mediateur*"] },
  { id: "opinion", label: "Public opinion & participation", terms: ["afrobarometer", "afrobarometre", "opinion poll*", "sondage*", "survey*", "public trust", "trust in", "confiance", "youth vote", "young voters", "jeunes electeurs", "gen z", "women s participation", "women in politics", "participation des femmes", "voter apathy", "abstention", "civic space", "espace civique", "civil society", "societe civile", "political parties", "partis politiques"] },
  { id: "information", label: "Election information integrity", terms: ["disinformation", "desinformation", "misinformation", "fake news", "infox", "information manipulation", "deepfake*", "social media", "reseaux sociaux", "influence operation*", "hate speech", "discours de haine", "media freedom", "liberte de la presse", "fact check*"] },
];

const ECONOMY_THEMES: Theme[] = [
  { id: "debt-fiscal", label: "Debt, fiscal stress & IMF programmes", terms: ["debt", "dette", "sovereign debt", "dette souveraine", "public debt", "dette publique", "debt distress", "surendettement", "debt crisis", "crise de la dette", "debt restructur*", "restructuration de la dette", "common framework", "cadre commun", "paris club", "eurobond*", "panda bond*", "default*", "defaut de paiement", "debt service", "service de la dette", "debt servicing", "fiscal deficit", "deficit budgetaire", "fiscal consolidation", "austerity", "austerite", "budget deficit", "imf programme", "imf program", "imf deal", "programme du fmi", "fmi", "extended credit facility", "facilite elargie de credit", "bailout", "credit rating*", "notation", "downgrade*", "upgrade*", "domestic revenue", "tax reform*", "reforme fiscale", "tax*", "impot*", "divida"] },
  { id: "macro", label: "Inflation, currencies & monetary policy", terms: ["inflation", "interest rate*", "taux directeur", "taux d interet", "central bank*", "banque centrale", "bceao", "beac", "monetary policy", "politique monetaire", "currency", "monnaie", "exchange rate*", "taux de change", "devaluat*", "depreciat*", "naira", "cedi", "kenyan shilling", "ugandan shilling", "rand", "birr", "kwacha", "egyptian pound", "leone", "cfa franc", "franc cfa", "eco currency", "monnaie eco", "forex", "foreign exchange", "devises", "fx reserves", "foreign reserves", "reserves de change", "dollar shortage*", "penurie de dollars", "dollarisation", "dollarization"] },
  { id: "growth", label: "Growth, outlook & structural change", terms: ["gdp", "pib", "economic growth", "croissance economique", "croissance", "growth outlook", "growth forecast*", "perspectives economiques", "recession", "slowdown", "ralentissement", "economic outlook", "economic recovery", "reprise economique", "productivity", "productivite", "structural transformation", "transformation structurelle", "industrialis*", "industrializ*", "manufacturing", "economic diversification", "diversification", "special economic zone*", "crescimento"] },
  { id: "investment", label: "Investment, finance & capital markets", terms: ["foreign direct investment", "investissements directs etrangers", "fdi", "ide", "investor*", "investisseur*", "private capital", "private sector", "secteur prive", "development finance", "climate finance", "finance climatique", "green bond*", "blended finance", "financial inclusion", "inclusion financiere", "fintech", "mobile money", "m pesa", "banking sector", "banks", "banques", "stock exchange", "bourse", "brvm", "jse", "nse", "capital market*", "remittance*", "transferts de fonds", "sovereign wealth fund*", "pension fund*", "private equity", "venture capital", "startup funding"] },
  { id: "resources-energy", label: "Mining, energy & commodities", terms: ["mining", "secteur minier", "mining code", "code minier", "critical mineral*", "oil", "petrole", "crude", "natural gas", "gaz naturel", "lng", "refiner*", "raffinerie", "dangote refinery", "energy transition", "transition energetique", "electricity", "electricite", "power sector", "power cuts", "delestage*", "load shedding", "eskom", "mission 300", "commodity price*", "cours des matieres premieres", "commodities", "matieres premieres", "cocoa", "cacao", "coffee", "gold price", "copper", "green hydrogen"] },
  { id: "livelihoods", label: "Jobs, prices & livelihoods", terms: ["unemployment", "chomage", "youth unemployment", "chomage des jeunes", "jobs", "emploi*", "employment", "informal sector", "secteur informel", "informal economy", "cost of living", "cout de la vie", "vie chere", "food prices", "prix alimentaires", "fuel prices", "prix du carburant", "poverty", "pauvrete", "inequality", "inegalites", "wages", "salaires", "minimum wage", "salaire minimum", "living standards", "pouvoir d achat"] },
  { id: "reform", label: "Reform, subsidies & economic governance", terms: ["subsidy removal", "fuel subsidy", "subvention*", "subsidies", "privatis*", "privatiz*", "state owned enterprise*", "entreprises publiques", "parastatal*", "corruption", "illicit financial flows", "flux financiers illicites", "economic reform*", "reformes economiques", "structural reform*", "finance bill", "loi de finances", "budget", "public procurement", "marches publics", "audit*"] },
  { id: "zones", label: "Monetary zones & regional economies", terms: ["waemu", "uemoa", "cemac", "sacu", "common monetary area", "eac monetary union", "franc zone", "zone franc", "afreximbank", "african credit rating agency", "african financial institutions", "regional economic outlook", "economies africaines", "african economies", "frontier market*", "marches frontieres"] },
];

const TRADE_THEMES: Theme[] = [
  { id: "afcfta", label: "AfCFTA & regional integration", terms: ["afcfta", "zlecaf", "african continental free trade", "zone de libre echange continentale", "continental free trade", "intra african trade", "commerce intra africain", "intra regional trade", "regional integration", "integration regionale", "regional economic communit*", "communautes economiques regionales", "customs union", "union douaniere", "rules of origin", "regles d origine", "ecowas", "cedeao", "eac", "sadc", "comesa", "tripartite free trade", "single market", "marche commun", "free movement", "libre circulation", "papss", "guided trade initiative", "etls", "tarif exterieur commun", "common external tariff"] },
  { id: "partners", label: "US, EU, China & Gulf trade relations", terms: ["agoa", "african growth and opportunity act", "tariff*", "tarif*", "droits de douane", "reciprocal tariff*", "trade war", "guerre commerciale", "eu africa", "ue afrique", "economic partnership agreement*", "accord de partenariat economique", "ape", "epa", "cbam", "carbon border", "mecanisme d ajustement carbone", "deforestation regulation", "eudr", "china africa", "chine afrique", "focac", "zero tariff", "zero tariff treatment", "duty free", "gulf investment", "trade deficit", "deficit commercial", "trade surplus", "bilateral trade", "commerce bilateral", "gsp", "everything but arms"] },
  { id: "supply-chains", label: "Supply chains & critical minerals", terms: ["supply chain*", "chaines d approvisionnement", "value chain*", "chaines de valeur", "critical mineral*", "minerais critiques", "beneficiation", "local processing", "transformation locale", "value addition", "export ban*", "interdiction d exportation", "raw material*", "matieres premieres", "battery", "batteries", "cobalt", "lithium", "manganese", "graphite", "copper", "cuivre", "nearshoring", "friendshoring", "minerals security partnership", "mineral processing"] },
  { id: "logistics", label: "Ports, shipping & trade corridors", terms: ["port*", "shipping", "transport maritime", "red sea", "mer rouge", "suez", "freight", "fret", "logistics", "logistique", "corridor*", "lobito", "northern corridor", "central corridor", "lapsset", "abidjan lagos corridor", "dakar bamako", "djibouti", "mombasa", "dar es salaam", "tema", "lekki", "berbera", "port sudan", "durban", "tanger med", "railway*", "chemin de fer", "standard gauge", "trade facilitation", "facilitation des echanges", "border post*", "one stop border", "poste frontiere", "transit", "container*", "conteneurs"] },
  { id: "agri-commodities", label: "Agricultural & commodity trade", terms: ["agricultural trade", "commerce agricole", "agricultural export*", "food trade", "food import*", "importations alimentaires", "grain", "cereales", "wheat", "ble", "fertili*", "engrais", "cocoa", "cacao", "coffee", "cafe", "tea export*", "cashew", "cajou", "cotton", "coton", "horticulture", "export*", "exportation*", "import*", "importation*", "commodity price*", "commodity export*", "black sea grain"] },
  { id: "policy", label: "Trade policy, WTO & digital trade", terms: ["wto", "omc", "world trade organization", "organisation mondiale du commerce", "trade policy", "politique commerciale", "trade negotiation*", "negociations commerciales", "market access", "acces au marche", "non tariff barrier*", "barrieres non tarifaires", "protectionis*", "trade agreement*", "accord commercial", "trade deal*", "free trade agreement*", "accord de libre echange", "digital trade", "commerce numerique", "e commerce", "services trade", "trade in services", "special economic zone*", "zones economiques speciales", "export processing zone*", "industrial policy", "politique industrielle"] },
];

const CYBER_THEMES: Theme[] = [
  { id: "threats", label: "Cyber threats & incidents", terms: ["cyberattack*", "cyber attack*", "cyberattaque*", "ransomware", "rancongiciel*", "malware", "logiciel malveillant", "data breach*", "fuite de donnees", "breach*", "hack*", "piratage", "pirate*", "ddos", "phishing", "hameconnage", "cybercrime", "cyber crime", "cybercriminalite", "cybercriminal*", "online fraud", "fraude en ligne", "scam*", "arnaque*", "sim swap*", "hacktivis*", "state sponsored", "threat actor*", "vulnerabilit*", "zero day", "business email compromise", "crypto fraud", "pig butchering", "scam compound*"] },
  { id: "infrastructure", label: "Critical infrastructure & resilience", terms: ["critical infrastructure", "infrastructures critiques", "critical information infrastructure", "banking system*", "financial sector", "telecom*", "operateurs telecoms", "undersea cable*", "submarine cable*", "cables sous marins", "cable cut*", "power grid", "government systems", "e government", "administration en ligne", "payment system*", "mobile money", "outage*", "panne*", "cyber resilience", "data centre*", "data center*", "ixp", "internet exchange point"] },
  { id: "policy", label: "Cyber policy, law & capacity", terms: ["cybersecurity strategy", "strategie nationale de cybersecurite", "cyber strategy", "national cert", "cert", "csirt", "cirt", "cybersecurity law", "loi sur la cybersecurite", "cybersecurity act", "cybercrime law", "loi sur la cybercriminalite", "cybercrimes act", "computer misuse", "malabo convention", "convention de malabo", "au data policy framework", "data protection", "protection des donnees", "privacy law", "data protection law", "data protection act", "data protection authority", "odpc", "ndpc", "information regulator", "cyber capacity", "capacity building", "renforcement des capacites", "cyber diplomacy", "cyber norms", "cybercrime convention", "budapest convention", "cybersecurity", "cybersecurite", "smart africa", "afrinic"] },
  { id: "rights", label: "Surveillance, shutdowns & digital rights", terms: ["surveillance", "spyware", "logiciel espion", "pegasus", "predator", "facial recognition", "reconnaissance faciale", "safe city", "digital rights", "droits numeriques", "internet shutdown*", "coupure d internet", "coupures d internet", "network disruption*", "throttling", "internet freedom", "liberte sur internet", "censorship", "censure", "social media ban*", "blocage des reseaux sociaux", "online freedom", "digital authoritarian*", "data localis*", "data localiz*", "lawful interception", "sim registration", "false news offence*"] },
  { id: "information", label: "Information operations & disinformation", terms: ["disinformation", "desinformation", "misinformation", "infox", "influence operation*", "operations d influence", "information warfare", "guerre informationnelle", "information operation*", "propaganda", "propagande", "troll*", "bot network*", "bots", "coordinated inauthentic", "deepfake*", "hypertrucage", "foreign information manipulation", "fimi", "fake account*", "faux comptes"] },
  { id: "emerging", label: "AI, digital ID & emerging tech", terms: ["artificial intelligence", "intelligence artificielle", "ai governance", "ai policy", "generative ai", "au continental ai strategy", "digital public infrastructure", "infrastructure publique numerique", "digital id*", "digital identity", "identite numerique", "huduma namba", "maisha namba", "biometric*", "biometrie", "cloud", "starlink", "satellite internet", "5g", "huawei", "digital silk road"] },
];

const CONFLICT_THEMES: Theme[] = [
  { id: "dynamics", label: "Armed conflict dynamics", terms: ["war", "guerre", "civil war", "guerre civile", "fighting", "combats", "offensive", "counteroffensive", "contre offensive", "clashes", "affrontements", "frontline*", "front line*", "siege", "blocus", "battle*", "bataille", "escalat*", "escalade", "airstrike*", "air strike*", "frappes aeriennes", "drone strike*", "drone attack*", "frappes de drones", "shelling", "bombardement*", "rapid support forces", "forces de soutien rapide", "rsf", "saf", "sudanese armed forces", "m23", "afc", "fano", "tplf", "ola", "oromo liberation army", "guerra", "conflito"] },
  { id: "extremism", label: "Jihadism & violent extremism", terms: ["jihad*", "djihad*", "al shabaab", "shabaab", "islamic state", "etat islamique", "isis", "iswap", "is sahel", "eigs", "isgs", "jnim", "gsim", "boko haram", "jas", "lakurawa", "ansaru", "al qaeda", "al qaida", "aqim", "aqmi", "adf", "allied democratic forces", "iscap", "ahlu sunnah wal jamaah", "ansar al sunna", "violent extremis*", "extremisme violent", "counterterror*", "counter terror*", "contre terrorisme", "radicalis*", "radicaliz*", "insurgen*", "insurrection*", "terror*", "terroris*", "insurgencia"] },
  { id: "coups", label: "Coups & military rule", terms: ["coup*", "coup d etat", "putsch*", "junta*", "junte*", "military government", "gouvernement militaire", "military rule", "regime militaire", "mutin*", "return to civilian rule", "retour a l ordre constitutionnel", "alliance of sahel states", "alliance des etats du sahel", "aes", "conseil national pour la sauvegarde de la patrie", "cnsp", "transition militaire"] },
  { id: "peace", label: "Peace processes & mediation", terms: ["ceasefire*", "cease fire*", "cessez le feu", "peace talks", "pourparlers de paix", "peace process*", "processus de paix", "peace agreement*", "accord de paix", "peace deal*", "mediation", "mediator*", "mediateur*", "negotiation*", "negociation*", "national dialogue", "dialogue national", "dialogue inclusif", "truce", "treve", "jeddah", "doha process", "luanda process", "nairobi process", "washington accord*", "pretoria agreement", "disarmament", "desarmement", "ddr", "demobilis*", "demobiliz*", "reconciliation", "transitional justice", "justice transitionnelle"] },
  { id: "operations", label: "Peace operations & security partnerships", terms: ["peacekeep*", "maintien de la paix", "casques bleus", "peace operation*", "peace support operation*", "au mission", "mission de l ua", "aussom", "atmis", "amisom", "monusco", "unmiss", "minusca", "minusma", "unisfa", "sadc mission", "samidrc", "samim", "eacrf", "multinational joint task force", "mnjtf", "force conjointe", "g5 sahel", "accra initiative", "wagner", "africa corps", "private military", "mercenar*", "security force assistance", "foreign troops", "troupes etrangeres", "multinational force", "rwandan troops", "burundian troops"] },
  { id: "communal", label: "Communal, local & resource conflict", terms: ["intercommunal", "inter communal", "intercommunautaire*", "communal violence", "violences communautaires", "farmer herder", "agriculteurs eleveurs", "herder*", "eleveur*", "pastoralist*", "pasteurs", "transhumance", "land dispute*", "conflits fonciers", "cattle raid*", "vol de betail", "ethnic violence", "violences ethniques", "ethnic tension*", "militia*", "milice*", "self defence group*", "self defense group*", "groupes d autodefense", "vdp", "volontaires pour la defense de la patrie", "dozo", "koglweogo", "wazalendo", "codeco", "mai mai", "anti balaka", "vigilante*", "banditry", "banditisme", "bandit*", "ambazonia*", "separatist*", "separatiste*"] },
  { id: "illicit", label: "Illicit economies & organised crime", terms: ["organised crime", "organized crime", "crime organise", "trafficking", "trafic*", "smuggling", "contrebande", "illicit gold", "or illicite", "illegal mining", "orpaillage", "artisanal mining", "galamsey", "arms flows", "arms trafficking", "trafic d armes", "small arms", "armes legeres", "kidnap*", "enlevement*", "kidnapping for ransom", "piracy", "piraterie", "illicit economy", "illicit economies", "war economy", "economie de guerre", "drug trafficking", "trafic de drogue", "cocaine", "captagon", "fuel smuggling"] },
  { id: "civilians", label: "Civilians, atrocities & accountability", terms: ["civilian casualt*", "victimes civiles", "civilians killed", "civils tues", "massacre*", "tuerie*", "atrocit*", "genocide", "ethnic cleansing", "nettoyage ethnique", "war crime*", "crimes de guerre", "crimes against humanity", "crimes contre l humanite", "sexual violence", "violences sexuelles", "conflict related sexual violence", "protection of civilians", "protection des civils", "mass grave*", "charnier*", "icc", "cpi", "international criminal court", "cour penale internationale", "accountability", "extrajudicial", "executions sommaires", "child soldiers", "enfants soldats"] },
  { id: "theatres", label: "Conflict theatres", terms: ["darfur", "el fasher", "el fashir", "kordofan", "khartoum", "omdurman", "blue nile", "gezira", "eastern drc", "est de la rdc", "north kivu", "nord kivu", "south kivu", "sud kivu", "ituri", "goma", "bukavu", "central sahel", "sahel central", "liptako gourma", "menaka", "tillaberi", "djibo", "kidal", "lake chad", "lac tchad", "borno", "diffa", "far north", "extreme nord", "cabo delgado", "jubaland", "puntland", "lower shabelle", "middle shabelle", "galmudug", "tigray", "amhara", "oromia", "northwest region", "southwest region", "nord ouest", "sud ouest", "tripoli", "fezzan", "central african republic", "centrafrique", "zamfara", "katsina", "sokoto", "plateau state", "benue", "upper nile", "jonglei", "northern benin", "nord benin", "northern togo", "savanes", "coastal states", "pays cotiers"] },
];

for (const th of HUMANITARIAN_THEMES) if (HUMANITARIAN_RULES[th.id]) th.rules = HUMANITARIAN_RULES[th.id];

export const DOMAINS: Domain[] = [
  {
    id: "humanitarian",
    label: "New Humanitarianism",
    blurb: "How humanitarianism is changing: funding cuts, the reset, localisation, Global South actors, access, principles and the future of aid, with Africa's major crises.",
    signal: /\b(humanitar\w*|aids?|aide|ajuda|ayuda|relief|secours|assistance|ngos?|ongs?|ingos?|donors?|bailleurs?|doador\w*|refugee\w*|refugie\w*|refugiad\w*|displace\w*|deplace\w*|desplazad\w*|idps?|asylum|asile|famine|hunger|faim|fome|malnutrition|food insecurity|insecurite alimentaire|cholera|outbreak|emergency response|emergencies|development assistance|development cooperation|civil society|societe civile|ocha|unhcr|wfp|unicef|iom|icrc|cicr|msf|red cross|croix rouge|localis\w*|localiz\w*|grand bargain|philanthrop\w*|protection|gbv|resilience|anticipatory)\b/,
    themes: HUMANITARIAN_THEMES,
    minHits: 1,
  },
  {
    id: "geopolitics",
    label: "Geopolitics",
    blurb: "Africa in the world: major and middle powers, the AU and regional blocs, security partnerships, strategic arenas, resources, alignment, influence and migration.",
    signal: /\b(geopoliti\w*|foreign polic\w*|politique etrangere|diplomac\w*|diplomati\w*|great power|grandes puissances|influence|competition|rivalr\w*|allian\w*|partnership|partenariat|summit|sommet|bloc|sanction\w*|china|chine|chinese|russia\w*|russie|united states|etats unis|washington|european union|union europeenne|france|french|gulf|golfe|emirati|uae|saudi|qatar\w*|turkey|turkiye|turquie|african union|union africaine|ecowas|cedeao|brics|military base|security cooperation|strategic|strategique|sovereignty|souverainete)\b/,
    themes: GEOPOLITICS_THEMES,
    minHits: 2,
  },
  {
    id: "elections",
    label: "Elections",
    blurb: "Elections and democratic politics in Africa: contests, integrity, violence, term limits and coups, regional norms, opinion and information.",
    signal: /\b(election\w*|electora\w*|eleic\w*|vot(e|es|ers?|ing)|voto|ballot\w*|scrutin|polls?|polling|referendum\w*|candidat\w*|campaign\w*|campagne|incumbent\w*|opposition|parliament\w*|parlement\w*|presidential\w*|presidentielle|legislatives|term limits?|mandat|democra\w*|coup\w*|junte|junta)\b/,
    themes: ELECTION_THEMES,
    minHits: 2,
  },
  {
    id: "economy",
    label: "Economy",
    blurb: "African economies: debt and IMF programmes, inflation and currencies, growth, investment, resources and energy, livelihoods, reform and monetary zones.",
    signal: /\b(econom\w*|gdp|pib|growth|croissance|inflation|debt\w*|dette|divida|fiscal\w*|budget\w*|currenc\w*|monnaie|monetary|monetaire|central bank|banque centrale|imf|fmi|investment\w*|investissement\w*|investors?|financ\w*|bonds?|tax\w*|impot\w*|revenue\w*|recession|poverty|pauvrete|jobs|emploi|employment|prices|prix)\b/,
    themes: ECONOMY_THEMES,
    minHits: 2,
  },
  {
    id: "trade",
    label: "Trade",
    blurb: "Africa's trade: the AfCFTA and regional integration, relations with the US, EU, China and the Gulf, supply chains, ports and corridors, commodities and policy.",
    signal: /\b(trade|trading|commerce\w*|commercial\w*|tariffs?|tarif\w*|douane\w*|exports?|exportation\w*|imports?|importation\w*|afcfta|zlecaf|agoa|customs|supply chains?|value chains?|chaines? de valeur|commodit\w*|matieres premieres|market access|wto|omc|ports?|logisti\w*|corridors?|shipping)\b/,
    themes: TRADE_THEMES,
    minHits: 2,
  },
  {
    id: "cyber",
    label: "Cybersecurity",
    blurb: "Cyber threats, critical infrastructure, policy and law, surveillance and shutdowns, information operations, AI and digital ID in Africa.",
    signal: /\b(cyber\w*|hack\w*|piratage|ransomware|malware|breach\w*|data protection|protection des donnees|digital|numerique\w*|internet|online|en ligne|surveillance|spyware|disinformation|desinformation|encryption|phishing|artificial intelligence|intelligence artificielle|telecom\w*)\b/,
    themes: CYBER_THEMES,
    minHits: 2,
  },
  {
    id: "conflict",
    label: "Conflict",
    blurb: "Armed conflict in Africa: dynamics, jihadism, coups, peace processes, peace operations, communal and illicit violence, civilians and the main theatres.",
    signal: /\b(conflict\w*|conflit\w*|conflito\w*|wars?|guerre\w*|guerra|fighting|combats?|armed|arme\w*|insurg\w*|militants?|jihad\w*|djihad\w*|terror\w*|rebel\w*|rebelle\w*|militias?|milices?|violence\w*|attacks?|attaques?|ceasefire|cessez|peace|paix|security|securite|military|militaire\w*|coups?|clashes|affrontements|offensive|junta|junte)\b/,
    themes: CONFLICT_THEMES,
    minHits: 2,
  },
];

export const domainOf = (id: string): Domain | undefined => DOMAINS.find((d) => d.id === id);
export const themeLabel = (domain: string, id: string) => domainOf(domain)?.themes.find((t) => t.id === id)?.label ?? id;

function termRegex(term: string): RegExp {
  const t = fold(term)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ch : `\\${ch}`));
  const body = t.endsWith("*") ? `${t.slice(0, -1)}\\w*` : t;
  return new RegExp(`(?:^|[^\\w])${body}(?=$|[^\\w])`);
}
// Each theme has one combined pattern, tested first: most themes do not match most texts, so their terms are never
// tested one by one.
const THEME_RX = new Map(
  DOMAINS.map((d) => [
    d.id,
    d.themes.map((th) => {
      const rx = th.terms.map(termRegex);
      const group = (terms: string[]) => new RegExp(terms.map((t) => `(?:${termRegex(t).source})`).join("|"));
      return { id: th.id, systemic: !!th.systemic, any: new RegExp(rx.map((r) => `(?:${r.source})`).join("|")), rx, rules: (th.rules ?? []).map((rule) => rule.map(group)) };
    }),
  ])
);

/** The themes of a domain a text touches, most-matched first, with how many terms matched. */
export function themesOf(domain: DomainId, text: string): { id: string; hits: number }[] {
  const t = fold(text);
  return (THEME_RX.get(domain) ?? [])
    .map((th) => ({ id: th.id, hits: (th.any.test(t) ? th.rx.filter((r) => r.test(t)).length : 0) + th.rules.filter((rule) => rule.every((g) => g.test(t))).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}

/* ── Places, regions and blocs ────────────────────────────────────────── */

export const REGIONS = ["North Africa", "Sahel", "West Africa", "Horn of Africa", "East Africa", "Great Lakes", "Central Africa", "Southern Africa", "Indian Ocean"] as const;
export type Region = (typeof REGIONS)[number];

const COUNTRY_REGIONS: Record<string, Region[]> = {
  DZ: ["North Africa"], EG: ["North Africa"], LY: ["North Africa"], MA: ["North Africa"], TN: ["North Africa"], EH: ["North Africa"],
  MR: ["North Africa", "Sahel", "West Africa"], ML: ["Sahel", "West Africa"], BF: ["Sahel", "West Africa"], NE: ["Sahel", "West Africa"], TD: ["Sahel", "Central Africa"],
  BJ: ["West Africa"], CV: ["West Africa"], CI: ["West Africa"], GM: ["West Africa"], GH: ["West Africa"], GN: ["West Africa"], GW: ["West Africa"], LR: ["West Africa"], NG: ["West Africa"], SN: ["West Africa"], SL: ["West Africa"], TG: ["West Africa"],
  DJ: ["Horn of Africa"], ER: ["Horn of Africa"], ET: ["Horn of Africa", "East Africa"], SO: ["Horn of Africa", "East Africa"], SD: ["Horn of Africa"], SS: ["Horn of Africa", "East Africa"],
  KE: ["East Africa"], TZ: ["East Africa"], UG: ["East Africa", "Great Lakes"], RW: ["East Africa", "Great Lakes"], BI: ["East Africa", "Great Lakes"],
  CD: ["Central Africa", "Great Lakes"], CM: ["Central Africa"], CF: ["Central Africa"], CG: ["Central Africa"], GA: ["Central Africa"], GQ: ["Central Africa"], ST: ["Central Africa"],
  AO: ["Southern Africa"], BW: ["Southern Africa"], LS: ["Southern Africa"], MW: ["Southern Africa"], MZ: ["Southern Africa"], NA: ["Southern Africa"], ZA: ["Southern Africa"], SZ: ["Southern Africa"], ZM: ["Southern Africa"], ZW: ["Southern Africa"],
  MG: ["Indian Ocean", "Southern Africa"], MU: ["Indian Ocean"], SC: ["Indian Ocean"], KM: ["Indian Ocean"],
};

const REGION_TERMS: [Region, RegExp][] = [
  ["North Africa", /\b(north africa\w*|afrique du nord|maghreb\w*|mashreq|nord de l afrique)\b/],
  ["Sahel", /\b(sahel\w*|liptako|sahara sahel|sahelo saharienne?)\b/],
  ["West Africa", /\b(west africa\w*|afrique de l ouest|ouest africaine?|gulf of guinea|golfe de guinee|coastal states|pays cotiers)\b/],
  ["Horn of Africa", /\b(horn of africa|corne de l afrique|greater horn|red sea|mer rouge|bab el mandeb)\b/],
  ["East Africa", /\b(east africa\w*|afrique de l est|est africaine?)\b/],
  ["Great Lakes", /\b(great lakes|grands lacs|kivus?)\b/],
  ["Central Africa", /\b(central africa\w*|afrique centrale|lake chad basin|bassin du lac tchad)\b/],
  ["Southern Africa", /\b(southern africa\w*|afrique australe)\b/],
  ["Indian Ocean", /\b(indian ocean islands|ocean indien|mozambique channel|canal du mozambique)\b/],
];

/** Regional blocs and bodies, as they are shown. */
const BLOC_TERMS: [string, RegExp][] = [
  ["AU", /\b(african union|union africaine|au commission|commission de l ua|peace and security council|psc|conseil de paix et de securite|aussom|atmis|amisom)\b/],
  ["ECOWAS", /\b(ecowas|cedeao)\b/],
  ["SADC", /\b(sadc|samidrc|samim)\b/],
  ["EAC", /\b(eac|east african community|communaute d afrique de l est|eacrf)\b/],
  ["IGAD", /\bigad\b/],
  ["ECCAS", /\b(eccas|ceeac)\b/],
  ["COMESA", /\bcomesa\b/],
  ["AES", /\b(alliance of sahel states|alliance des etats du sahel|confederation of sahel states|confederation des etats du sahel|aes)\b/],
  ["AfCFTA", /\b(afcfta|zlecaf|continental free trade)\b/],
  ["UEMOA / WAEMU", /\b(uemoa|waemu|bceao)\b/],
  ["CEMAC", /\b(cemac|beac)\b/],
  ["AMU", /\b(arab maghreb union|union du maghreb arabe)\b/],
  ["CEN-SAD", /\bcen sad\b/],
  ["ICGLR", /\b(icglr|cirgl|international conference on the great lakes)\b/],
  ["Lake Chad Basin / MNJTF", /\b(lake chad basin commission|lcbc|mnjtf|multinational joint task force|force multinationale mixte)\b/],
  ["SACU", /\bsacu\b/],
];

const DEMONYMS: [RegExp, string][] = [
  [/\bsudanese\b|\bsoudanais/, "SD"], [/\bsouth sudanese\b|\bsud soudanais/, "SS"], [/\bethiopians?\b|\bethiopien/, "ET"], [/\beritreans?\b|\berythreen/, "ER"], [/\bsomalis?\b|\bsomaliens?\b/, "SO"], [/\bkenyans?\b|\bkenyan/, "KE"],
  [/\bugandans?\b|\bougandais/, "UG"], [/\bcongolese\b|\bcongolais/, "CD"], [/\bmalians?\b|\bmaliens?\b/, "ML"], [/\bnigeriens?\b/, "NE"], [/\bnigerians?\b|\bnigerian/, "NG"], [/\bburkinabe\b/, "BF"],
  [/\bchadians?\b|\btchadiens?\b/, "TD"], [/\bcameroonians?\b|\bcamerounais/, "CM"], [/\blibyans?\b|\blibyens?\b/, "LY"], [/\bmozambicans?\b|\bmocambicanos?\b/, "MZ"], [/\bzimbabweans?\b/, "ZW"], [/\bdarfuri\b/, "SD"], [/\btigrayans?\b/, "ET"],
  [/\bivorians?\b|\bivoiriens?\b/, "CI"], [/\bsenegalese\b|\bsenegalais/, "SN"], [/\bghanaians?\b/, "GH"], [/\bguineans?\b|\bguineens?\b/, "GN"], [/\brwandans?\b|\brwandais/, "RW"], [/\bburundians?\b|\bburundais/, "BI"],
  [/\btanzanians?\b/, "TZ"], [/\bzambians?\b/, "ZM"], [/\bangolans?\b|\bangolanos?\b/, "AO"], [/\bmalawians?\b/, "MW"], [/\bsouth africans?\b|\bsud africains?\b/, "ZA"], [/\begyptians?\b|\begyptiens?\b/, "EG"],
  [/\balgerians?\b|\balgeriens?\b/, "DZ"], [/\bmoroccans?\b|\bmarocains?\b/, "MA"], [/\btunisians?\b|\btunisiens?\b/, "TN"], [/\bmauritanians?\b|\bmauritaniens?\b/, "MR"], [/\btogolese\b|\btogolais/, "TG"], [/\bbeninese\b|\bbeninois/, "BJ"],
  [/\bcentral africans?\b|\bcentrafricains?\b/, "CF"], [/\bgabonese\b|\bgabonais/, "GA"], [/\bliberians?\b/, "LR"], [/\bsierra leoneans?\b/, "SL"], [/\bnamibians?\b/, "NA"], [/\bmalagasy\b|\bmalgaches?\b/, "MG"], [/\bsahrawis?\b/, "EH"],
];
/** Crises and regions outside Africa: a humanitarian piece about one of these, and nowhere in Africa, is kept but out of scope. */
const ELSEWHERE = /\b(gaza|palestin\w*|west bank|lebanon|liban|syria\w*|syrie|yemen\w*|iraq\w*|irak|afghan\w*|myanmar|burma|rohingya|bangladesh|cox s bazar|haiti\w*|venezuela\w*|colombia\w*|ukrain\w*|pakistan\w*|nepal|philippines|indonesia|latin america|amerique latine|central america|darien|asia pacific|pacific islands|turkiye earthquake|turkey earthquake|kashmir|sri lanka)\b/;
const AFRICA_WORDS = /\b(africa\w*|afrique|africain\w*|africano?s?|sub saharan|subsaharien\w*|pan african\w*|panafrican\w*)\b/;

export interface Where {
  africa: boolean;
  /** Names a place outside Africa (the Middle East, Ukraine, Myanmar…). */
  elsewhere: boolean;
  /** African countries, most-mentioned first. */
  countries: string[];
  /** Towns and regions named, most specific first, at most eight ("El Fasher", "North Kivu"). */
  places: string[];
  regions: Region[];
  blocs: string[];
}

/** Where in Africa a text is about: countries, the towns and regions it names, the wider regions and the blocs. */
export function africaOf(text: string): Where {
  const t = fold(text);
  const counts = new Map<string, number>();
  const places: string[] = [];
  let elsewhere = ELSEWHERE.test(t);
  for (const l of namedLocations(text)) {
    if (MIDDLE_EAST_CODES.has(l.countryCode)) {
      elsewhere = true;
      continue;
    }
    counts.set(l.countryCode, (counts.get(l.countryCode) ?? 0) + (l.precision === "country" ? 1 : 1.5));
    if (l.precision !== "country" && !places.includes(l.label)) places.push(l.label);
  }
  for (const [rx, code] of DEMONYMS) if (rx.test(t)) counts.set(code, (counts.get(code) ?? 0) + 1);
  const countries = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const regions = new Set<Region>();
  for (const c of countries) for (const r of COUNTRY_REGIONS[c] ?? []) regions.add(r);
  for (const [r, rx] of REGION_TERMS) if (rx.test(t)) regions.add(r);
  const blocs = BLOC_TERMS.filter(([, rx]) => rx.test(t)).map(([b]) => b);
  return {
    africa: countries.length > 0 || regions.size > 0 || blocs.length > 0 || AFRICA_WORDS.test(t),
    elsewhere,
    countries,
    places: places.slice(0, 8),
    regions: REGIONS.filter((r) => regions.has(r)),
    blocs,
  };
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
  places: string[];
  regions: Region[];
  blocs: string[];
  africa: boolean;
  /** About Africa, or (New Humanitarianism) a system-level reflection that shapes Africa: shown and alerted on. */
  inScope: boolean;
  score: number;
}

/* ── Analytical publications only ───────────────────────────────────────── */

/** Whole titles of site pages, not publications ("About", "Our team", "Publications"). */
const PAGE_TITLES = new RegExp(
  "^(" +
    [
      "home", "homepage", "accueil", "about", "about us", "a propos", "qui sommes nous", "who we are", "what we do", "our work", "our mission",
      "our story", "our history", "our team", "our people", "our staff", "our partners", "our donors", "our funders", "our board", "team", "staff",
      "people", "experts", "board", "governance", "partners", "donors", "funders", "contact", "contact us", "contactez nous", "privacy",
      "privacy policy", "terms", "terms of use", "terms and conditions", "cookies?", "cookie policy", "accessibility", "disclaimer", "legal",
      "copyright", "donate", "support us", "faire un don", "subscribe", "newsletter", "sign up", "login", "log in", "register", "search",
      "careers?", "jobs?", "vacanc(y|ies)", "work with us", "join us", "join our team", "events?", "upcoming events", "calendar", "faqs?",
      "frequently asked questions", "sitemap", "archives?", "publications", "resources", "library", "news", "latest news", "blog", "media",
      "press", "press releases?", "newsroom", "reports", "research", "data", "databases?", "tools?", "maps?", "dashboard", "projects?",
      "programmes?", "programs?", "countries", "regions", "topics", "themes", "issues", "annual reports?( \\d{4})?", "financial statements?",
      "page not found", "not found", "404", "access denied", "error", "untitled", "home page", "multimedia", "videos?", "podcasts?", "photos?",
      "gallery", "galerie", "nous contacter", "equipe", "partenaires", "actualites", "evenements", "emplois", "recrutement",
    ].join("|") +
    ")$"
);
/** Title openings of site pages, notices and calls rather than analysis. */
const PAGE_OPENINGS =
  /^(about( the| our| us)?\b|a propos\b|welcome to\b|bienvenue\b|join (us|our)\b|apply\b|call for (applications|proposals|papers|expressions|submissions|nominations)\b|appel (a|aux) (candidatures|propositions|manifestation)\b|vacancy\b|job( opening| offer)?\b|offre d emploi\b|internship\b|tender\b|appel d offres\b|request for (proposals|quotations|expressions)\b|rfp\b|rfq\b|consultan(cy|t) (opportunity|wanted|position)\b|terms of reference\b|tor\b|webinar\b|webinaire\b|event\b|register (now|here)\b|save the date\b|press release\b|communique de presse\b|media advisory\b|statement by the (board|director)\b|meet (the|our)\b|subscribe\b|donate\b|privacy\b|cookie\b|404\b|page not found\b|annual report\b|financial statement|audited accounts|board of (directors|trustees)\b|job description\b)/;
const PAGE_PATHS = /\/(about|about-us|a-propos|who-we-are|contact|contact-us|team|our-team|staff|people|experts?|board|partners|donors|funders|careers?|jobs?|vacanc\w*|recrutement|events?|evenements|donate|support-us|privacy|terms|cookies?|search|tag|tags|category|categories|author|authors|user|users|taxonomy|page\/\d+|newsletter|subscribe|login|register|faq)(\/|$)/i;

/**
 * NOT clause of every domain's query: a site page, notice, vacancy, event, call or press release, not an analytical
 * publication. Also drops comment pages ("Anonymous (not verified)") and titles too short to be a publication.
 */
export function isNotAnalysis(raw: { title: string; summary: string; url: string }): boolean {
  const t = fold(raw.title).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (PAGE_TITLES.test(t) || PAGE_OPENINGS.test(t)) return true;
  if (t.split(" ").length < 3) return true;
  if (/anonymous \(not verified\)|\(not verified\)/i.test(raw.summary) || /^submitted by /i.test(raw.summary.trim())) return true;
  try {
    if (PAGE_PATHS.test(new URL(raw.url).pathname)) return true;
  } catch {
    /* not a URL: judged by its title */
  }
  return false;
}

/**
 * A source whose work is mainly humanitarian (it writes on New Humanitarianism and at most one other domain, with
 * New Humanitarianism first): everything it publishes is humanitarian reflection, so its pieces need no keyword to
 * get in; the themes only tag them ("Humanitarian policy & practice" when nothing more specific matches).
 */
export const isHumanitarianSpecialist = (s: Source) => s.domains[0] === "humanitarian" && s.domains.length <= 2;

/** The domains a piece belongs to, among those its source writes on. */
export function classify(raw: { url: string; title: string; summary: string; source: Source; published: string }): AnalysisItem[] {
  if (isNotAnalysis(raw)) return [];
  const text = `${raw.title}. ${raw.summary}`;
  const folded = fold(text);
  const where = africaOf(text);
  const africa = where.africa || raw.source.africa;
  const specialist = raw.source.domains.length <= 2;
  const out: AnalysisItem[] = [];
  for (const id of raw.source.domains) {
    const d = domainOf(id)!;
    const takeAll = id === "humanitarian" && isHumanitarianSpecialist(raw.source);
    if (!takeAll && !d.signal.test(folded)) continue;
    let themes = themesOf(id, text);
    // "General" only tags a piece nothing more specific describes.
    if (themes.some((t) => t.id !== "general")) themes = themes.filter((t) => t.id !== "general");
    const counting = themes.filter((t) => t.id !== "general" || takeAll);
    const hits = counting.reduce((n, t) => n + t.hits, 0);
    const substantive = counting.filter((t) => !d.themes.find((x) => x.id === t.id)?.context).reduce((n, t) => n + t.hits, 0);
    if (!takeAll && (substantive === 0 || hits < (specialist ? 1 : d.minHits))) continue;
    if (takeAll && themes.length === 0) themes = [{ id: "general", hits: 0 }];
    const systemic = themes.some((t) => d.themes.find((x) => x.id === t.id)?.systemic);
    // New Humanitarianism keeps Africa, system-level reflections and general reflections tied to no place; a piece
    // about a crisis elsewhere (Gaza, Ukraine…) is kept out of scope, under "Everything". Other domains need Africa.
    const inScope = id === "humanitarian" ? africa || systemic || !where.elsewhere : africa;
    if (!inScope && id !== "humanitarian") continue;
    out.push({
      id: hashId(fold(raw.title).trim() || raw.url),
      domain: id,
      url: raw.url,
      title: raw.title,
      summary: raw.summary.slice(0, 700),
      source: raw.source.name,
      published: raw.published,
      themes: themes.map((t) => t.id),
      countries: where.countries,
      places: where.places,
      regions: where.regions,
      blocs: where.blocs,
      africa,
      inScope,
      score: hits + (africa ? 2 : 0) + (systemic ? 1 : 0) + (where.places.length ? 1 : 0),
    });
  }
  return out;
}

const SOURCE_BY_NAME = new Map(SOURCES.map((s) => [s.name, s]));
export const sourceKindOf = (name: string): SourceKind | null => SOURCE_BY_NAME.get(name)?.kind ?? null;
export { SOURCE_KIND_LABEL };

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
    db.prepare(`CREATE TABLE IF NOT EXISTS strategic_analyses (domain TEXT NOT NULL, id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, source TEXT NOT NULL, published TEXT NOT NULL, themes TEXT NOT NULL, countries TEXT NOT NULL, places TEXT, regions TEXT, blocs TEXT, africa INTEGER NOT NULL, in_scope INTEGER NOT NULL, score INTEGER NOT NULL, first_seen TEXT NOT NULL, PRIMARY KEY (domain, id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_strategic_analyses_published ON strategic_analyses(domain, published)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_strategic_analyses_first_seen ON strategic_analyses(first_seen)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS strategic_sources (url TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT, checked_at TEXT, status TEXT, error TEXT, items INTEGER NOT NULL DEFAULT 0, kept INTEGER NOT NULL DEFAULT 0, last_ok TEXT)`),
  ]);
  // Columns added after the first release.
  const cols = new Set(((await db.prepare(`PRAGMA table_info(strategic_analyses)`).all<{ name: string }>()).results ?? []).map((c) => c.name));
  for (const c of ["places", "regions", "blocs"]) if (!cols.has(c)) await db.prepare(`ALTER TABLE strategic_analyses ADD COLUMN ${c} TEXT`).run();
  const scols = new Set(((await db.prepare(`PRAGMA table_info(strategic_sources)`).all<{ name: string }>()).results ?? []).map((c) => c.name));
  for (const c of ["backfilled_at", "gnews_at", "backfill_note", "sitemap_at", "sitemap_note"]) if (!scols.has(c)) await db.prepare(`ALTER TABLE strategic_sources ADD COLUMN ${c} TEXT`).run();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS strategic_candidates (url TEXT PRIMARY KEY, source_url TEXT NOT NULL, lastmod TEXT, priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_strategic_candidates_pending ON strategic_candidates(status, priority, lastmod)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_strategic_analyses_url ON strategic_analyses(url)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS strategic_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
  ]);
  // Drop stored pieces that are not analytical publications ("About the GDHO"), whenever the filter changes.
  if (!(await db.prepare(`SELECT 1 FROM strategic_state WHERE key = 'not_analysis_v1'`).first())) {
    const rows = (await db.prepare(`SELECT domain, id, title, summary, url FROM strategic_analyses`).all<{ domain: string; id: string; title: string; summary: string | null; url: string }>()).results ?? [];
    const junk = rows.filter((r) => isNotAnalysis({ title: r.title, summary: r.summary ?? "", url: r.url }));
    for (let i = 0; i < junk.length; i += 50) await db.batch(junk.slice(i, i + 50).map((r) => db.prepare(`DELETE FROM strategic_analyses WHERE domain = ? AND id = ?`).bind(r.domain, r.id)));
    await db.prepare(`INSERT INTO strategic_state (key, value) VALUES ('not_analysis_v1', ?)`).bind(JSON.stringify({ at: new Date().toISOString(), removed: junk.length })).run();
  }
  // One-time: the first catch-ups shared the main schedule's request budget and many found nothing because their
  // requests were refused, so every source's past year is fetched again on Strategic Analyses' own schedule.
  if (!(await db.prepare(`SELECT 1 FROM strategic_state WHERE key = 'catchup_reset_v1'`).first())) {
    await db.batch([
      db.prepare(`UPDATE strategic_sources SET backfilled_at = NULL, backfill_note = NULL, sitemap_at = NULL, sitemap_note = NULL, gnews_at = NULL`),
      db.prepare(`UPDATE strategic_candidates SET status = 'pending' WHERE status = 'failed'`),
      db.prepare(`INSERT INTO strategic_state (key, value) VALUES ('catchup_reset_v1', ?)`).bind(JSON.stringify(new Date().toISOString())),
    ]);
  }
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
const BATCH = 22;
/** Sources whose past year is fetched per run (see backfill), New Humanitarianism's first. */
const BACKFILL_BATCH = 6;
/** Sources searched on Google News per run (daily per source), which also covers sites with no feed. */
const GNEWS_BATCH = 6;
const GNEWS_EVERY_MS = 24 * 3600_000;
/** A run starts no new job after this long, so it finishes well inside Cloudflare's limits. */
const RUN_BUDGET_MS = 60_000;
/** How far back pieces are kept: a year and a little. */
const MAX_AGE_DAYS = 400;
const WP_PAGES = 8;
/** Sources whose sitemap is read per run, and pages opened per run to read a sitemap find's title, summary and date. */
const SITEMAP_BATCH = 4;
const ENRICH_BATCH = 25;
const MAX_CHILD_SITEMAPS = 10;
const MAX_CANDIDATES_PER_SOURCE = 500;
const SUBSTACK_PAGES = 6;

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLens/1.0; +https://afrilensconsulting.com)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*" }, signal: AbortSignal.timeout(20000) });

type Entry = { title: string; url: string; published: string; summary: string };

/** Words for a Google News search of one source in one domain (a source covering one or two domains is searched whole). */
const GNEWS_WORDS: Record<DomainId, string> = {
  humanitarian: "(humanitarian OR aid OR refugees OR localisation OR localization OR displacement OR humanitaire)",
  geopolitics: '(geopolitics OR "foreign policy" OR China OR Russia OR Gulf OR "African Union" OR diplomacy)',
  elections: "(election OR elections OR vote OR coup OR democracy OR élection)",
  economy: "(economy OR debt OR inflation OR IMF OR investment OR growth)",
  trade: "(trade OR tariffs OR AfCFTA OR exports OR AGOA OR corridor)",
  cyber: "(cyber OR cybersecurity OR digital OR disinformation OR surveillance OR internet)",
  conflict: "(conflict OR war OR jihadist OR insurgency OR ceasefire OR militia OR conflit)",
};

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Google News RSS searches for a source: one per domain for broad sources, one for the whole site otherwise. */
export function gnewsQueries(src: Source, window: string): string[] {
  const host = hostOf(src.url);
  if (!host) return [];
  const africa = src.africa ? "" : " (Africa OR African OR Afrique)";
  const qs = src.domains.length <= 2 ? [`site:${host} when:${window}`] : src.domains.map((d) => `site:${host} ${GNEWS_WORDS[d]}${d === "humanitarian" ? "" : africa} when:${window}`);
  return qs.map((q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);
}

/** The Bing News RSS search equivalent to a Google News one (Bing has no "when:", so it is dropped). */
export function bingQuery(googleUrl: string): string {
  const q = (new URL(googleUrl).searchParams.get("q") ?? "").replace(/\s*when:\S+/g, "").trim();
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en`;
}
/** Bing links go through a redirect that carries the article's address in its "url" parameter. */
const cleanBing = (e: Entry): Entry => {
  try {
    const u = new URL(e.url);
    const real = u.hostname.endsWith("bing.com") ? u.searchParams.get("url") : null;
    return real ? { ...e, url: real } : e;
  } catch {
    return e;
  }
};

/** Google News titles end with " - Source"; drop it. */
const cleanGnews = (e: Entry): Entry => ({ ...e, title: e.title.replace(/\s+[-–—|]\s+[^-–—|]{2,80}$/, "").trim() });

/* ── Sitemaps ──────────────────────────────────────────────────────────── */

/** <loc> and <lastmod> of each <sitemap> or <url> entry. */
export function parseSitemap(xml: string): { index: boolean; entries: { loc: string; lastmod: string | null }[] } {
  const index = /<sitemapindex[\s>]/i.test(xml);
  const entries = [...xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/gi)].map((m) => {
    const loc = (m[1].match(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i)?.[1] ?? "").replace(/&amp;/g, "&").trim();
    const lm = m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1];
    const t = lm ? Date.parse(lm) : NaN;
    return { loc, lastmod: Number.isFinite(t) ? new Date(t).toISOString() : null };
  });
  return { index, entries: entries.filter((e) => e.loc) };
}

const NOT_CONTENT = /\/(tag|tags|category|categories|author|authors|page|events?|jobs?|careers?|vacanc\w*|about|about-us|contact|donate|people|staff|team|experts?|wp-content|feed|search|login|cart|shop|privacy|terms|cookies?)(\/|$)|\.(pdf|jpe?g|png|gif|docx?|xlsx?|zip|mp3|mp4)$/i;
const CHILD_SKIP = /(tag|category|author|attachment|product|event|job|career|people|staff|person|expert|taxonomy|image|video|media|page-sitemap|pages?\.xml)/i;

/** The last path segment as words: "/publications/the-humanitarian-reset-what-next" → "the humanitarian reset what next". */
export const slugWords = (u: string) => {
  try {
    const parts = new URL(u).pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? "").replace(/\.[a-z]{2,4}$/, "").replace(/[-_+]+/g, " ");
  } catch {
    return "";
  }
};

/**
 * Whether a sitemap address is worth opening for a source: a content page (not a tag, author, event or file), with a
 * real slug, under the source's own section when it is listed by one (csis.org/programs/africa-program), and — for a
 * broad international source — a slug that already looks like one of its domains (and, outside New Humanitarianism,
 * like Africa). Africa-focused sources and humanitarian specialists keep every content page.
 */
export function worthOpening(src: Source, loc: string): boolean {
  let u: URL;
  let base: URL;
  try {
    u = new URL(loc);
    base = new URL(src.url);
  } catch {
    return false;
  }
  if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return false;
  if (NOT_CONTENT.test(u.pathname) || u.search) return false;
  const words = slugWords(loc);
  if (words.replace(/\s/g, "").length < 12 || words.split(" ").length < 3) return false;
  if (src.africa || isHumanitarianSpecialist(src)) return true;
  const w = fold(words);
  const where = africaOf(words);
  return src.domains.some((d) => domainOf(d)!.signal.test(w) && (where.africa || (d === "humanitarian" && !where.elsewhere)));
}

/** Title, summary and publication date from a page's head. */
export function pageMeta(html: string): { title: string; summary: string; published: string | null } {
  const head = html.slice(0, 300_000);
  const meta = (names: string[]) => {
    for (const n of names) {
      const m =
        head.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i")) ??
        head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, "i"));
      if (m?.[1]) return m[1];
    }
    return "";
  };
  const unescape = (x: string) => x.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "’").replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  let title = unescape(meta(["og:title", "twitter:title"]) || head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  // "The reset, a year on | ODI" → "The reset, a year on"
  title = title.replace(/\s+[|–—]\s+[^|–—]{2,60}$/, "").trim();
  const summary = unescape(meta(["og:description", "description", "twitter:description"]));
  const dateRaw =
    meta(["article:published_time", "datePublished", "date", "dc.date", "DC.date.issued", "citation_publication_date", "pubdate"]) ||
    head.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ||
    head.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ||
    "";
  const t = Date.parse(dateRaw);
  return { title, summary, published: Number.isFinite(t) ? new Date(t).toISOString() : null };
}

/**
 * Reads the sources due a check (not read in the last hour, least recently read first, at most `limit`), fetches the
 * past year of a few sources not yet backfilled, searches Google News for a few sources due their daily search, and
 * stores new pieces per domain. Returns how many were new.
 *
 * Backfill, once per source: older pages of a WordPress feed (?paged=2…), the archive of a Substack, and a year of
 * Google News results for the site. Backfilled pieces are dated by when they were published, not when the Lens found
 * them, so they fill the reading list without counting as new or setting off alerts.
 */
export async function collectStrategicAnalyses(
  env: Env,
  opts: { force?: boolean; now?: Date; fetcher?: Fetcher; discover?: typeof discoverFeed; limit?: number; backfill?: number; gnews?: number; sitemaps?: number; enrich?: number } = {}
): Promise<{ ran: boolean; added: number; sources: number; backfilled: number }> {
  const db = env.DB;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const fetcher = opts.fetcher ?? defaultFetch;
  const discover = opts.discover ?? discoverFeed;
  await ensureAnalysisTables(db);

  type State = { url: string; feed_url: string | null; checked_at: string | null; status: string | null; backfilled_at: string | null; gnews_at: string | null };
  const states = new Map((await db.prepare(`SELECT url, feed_url, checked_at, status, backfilled_at, gnews_at FROM strategic_sources`).all<State>()).results?.map((r) => [r.url, r]) ?? []);
  const since = (t: string | null | undefined) => (t ? now.getTime() - Date.parse(t) : Infinity);
  const age = (s: Source) => since(states.get(s.url)?.checked_at);
  const due = SOURCES.filter((s) => opts.force || age(s) >= CHECK_EVERY_MS)
    .sort((a, b) => age(b) - age(a))
    .slice(0, opts.limit ?? BATCH);
  // Humanitarian specialists first (light, and the tab that needs it most), then other humanitarian sources, narrowest first.
  const rank = (s: Source) => (isHumanitarianSpecialist(s) ? 0 : s.domains.includes("humanitarian") ? 1 : 2) * 10 + s.domains.length;
  const backfillDue = SOURCES.filter((s) => !states.get(s.url)?.backfilled_at)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, opts.backfill ?? BACKFILL_BATCH);
  const backfillSet = new Set(backfillDue.map((s) => s.url));
  const gnewsDue = SOURCES.filter((s) => !backfillSet.has(s.url) && states.get(s.url)?.backfilled_at && since(states.get(s.url)?.gnews_at) >= GNEWS_EVERY_MS)
    .sort((a, b) => since(states.get(b.url)?.gnews_at) - since(states.get(a.url)?.gnews_at))
    .slice(0, opts.gnews ?? GNEWS_BATCH);
  type SitemapState = { url: string; sitemap_at: string | null };
  const sitemapDone = new Set(((await db.prepare(`SELECT url, sitemap_at FROM strategic_sources WHERE sitemap_at IS NOT NULL`).all<SitemapState>()).results ?? []).map((r) => r.url));
  const sitemapDue = SOURCES.filter((s) => !sitemapDone.has(s.url))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, opts.sitemaps ?? SITEMAP_BATCH);
  const pending = ((await db.prepare(`SELECT url, source_url, lastmod FROM strategic_candidates WHERE status = 'pending' ORDER BY priority DESC, lastmod DESC LIMIT ?`).bind(opts.enrich ?? ENRICH_BATCH).all<{ url: string; source_url: string; lastmod: string | null }>()).results ?? []);
  if (due.length === 0 && backfillDue.length === 0 && gnewsDue.length === 0 && sitemapDue.length === 0 && pending.length === 0) return { ran: false, added: 0, sources: 0, backfilled: 0 };

  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString();
  let added = 0;

  const startedAt = Date.now();
  const errors: string[] = [];
  const stored: Record<string, number> = {};
  const lanes = { read: 0, backfill: 0, gnews: 0, sitemaps: 0, pages: 0, skipped: 0 };
  await setState(db, "last_run", { startedAt: nowIso, finishedAt: null, planned: { read: due.length, backfill: backfillDue.map((s) => s.name), gnews: gnewsDue.length, sitemaps: sitemapDue.map((s) => s.name), pages: pending.length } });
  // Found while backfilling, a piece published in the last three days still counts as new (and can alert); older ones
  // are dated by publication.
  const recentIso = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  /** Classifies and stores entries; returns how many distinct pieces were kept. `old` dates older ones by publication. */
  const store = async (src: Source, entries: Entry[], old: boolean): Promise<number> => {
    const kept = entries.filter((e) => e.published >= cutoff && e.published <= new Date(now.getTime() + 86_400_000).toISOString()).flatMap((e) => classify({ ...e, source: src }));
    for (let i = 0; i < kept.length; i += 40) {
      const write = () => db.batch(
        kept.slice(i, i + 40).map((it) =>
          db
            .prepare(`INSERT OR IGNORE INTO strategic_analyses (domain, id, url, title, summary, source, published, themes, countries, places, regions, blocs, africa, in_scope, score, first_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(it.domain, it.id, it.url, it.title, it.summary, it.source, it.published, JSON.stringify(it.themes), JSON.stringify(it.countries), JSON.stringify(it.places), JSON.stringify(it.regions), JSON.stringify(it.blocs), it.africa ? 1 : 0, it.inScope ? 1 : 0, it.score, old && it.published < recentIso ? it.published : nowIso)
        )
      );
      let results: D1Result[] | null = null;
      try {
        results = await write();
      } catch {
        // The database is busy now and then: wait a moment and try once more.
        await new Promise((r) => setTimeout(r, 1500));
        try {
          results = await write();
        } catch (err) {
          errors.push(`${src.name}: could not save (${err instanceof Error ? err.message.slice(0, 100) : String(err)})`);
        }
      }
      added += (results ?? []).reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
      stored[src.name] = (stored[src.name] ?? 0) + (results ?? []).reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
    }
    return new Set(kept.map((k) => k.id)).size;
  };

  // Failed fetches are counted with a few reasons (blocked, timed out, request budget used up), never silently empty.
  const fetchFails: Record<string, number> = {};
  const failReason = (why: string) => (fetchFails[why] = (fetchFails[why] ?? 0) + 1);
  const getText = async (url: string): Promise<string | null> => {
    try {
      const r = await fetcher(url);
      if (r.ok) return await r.text();
      if (r.status !== 404) failReason(`HTTP ${r.status}${url.includes("news.google.com") ? " (Google News)" : ""}`);
      return null;
    } catch (err) {
      failReason(err instanceof Error ? err.message.slice(0, 80) : String(err));
      return null;
    }
  };

  const gnews = async (src: Source, window: string): Promise<Entry[]> => {
    const out: Entry[] = [];
    for (const q of gnewsQueries(src, window)) {
      const xml = await getText(q);
      const found = xml ? parseFeed(xml).map(cleanGnews) : [];
      if (found.length) {
        out.push(...found);
        continue;
      }
      // Google returned nothing (or refused): ask Bing News the same question.
      const bing = await getText(bingQuery(q));
      if (bing) out.push(...parseFeed(bing).map(cleanBing));
    }
    return out;
  };

  /** The past year of one source: older feed pages, a Substack archive, and Google News. */
  const backfill = async (src: Source, feedUrl: string | null, firstPage: string | null): Promise<string> => {
    const notes: string[] = [];
    let n = 0;
    if (feedUrl) {
      let prevFirst = firstPage ? parseFeed(firstPage)[0]?.url : undefined;
      let pages = 0;
      for (let p = 2; p <= WP_PAGES; p++) {
        const xml = await getText(`${feedUrl}${feedUrl.includes("?") ? "&" : "?"}paged=${p}`);
        const entries = xml ? parseFeed(xml) : [];
        if (entries.length === 0 || entries[0].url === prevFirst) break;
        prevFirst = entries[0].url;
        pages++;
        n += await store(src, entries, true);
        if (entries[entries.length - 1].published < cutoff) break;
      }
      if (pages) notes.push(`${pages} older feed pages`);
      const host = hostOf(feedUrl);
      if (host.endsWith("substack.com") || /substack/i.test(firstPage ?? "")) {
        const origin = new URL(feedUrl).origin;
        let got = 0;
        for (let p = 0; p < SUBSTACK_PAGES; p++) {
          const body = await getText(`${origin}/api/v1/archive?sort=new&offset=${p * 50}&limit=50`);
          let posts: { title?: string; canonical_url?: string; post_date?: string; subtitle?: string; description?: string }[] = [];
          try {
            posts = body ? JSON.parse(body) : [];
          } catch {
            posts = [];
          }
          if (!Array.isArray(posts) || posts.length === 0) break;
          const entries = posts
            .filter((x) => x.title && x.canonical_url && x.post_date)
            .map((x) => ({ title: x.title!, url: x.canonical_url!, published: new Date(x.post_date!).toISOString(), summary: x.subtitle || x.description || "" }));
          got += entries.length;
          n += await store(src, entries, true);
          if (entries.length && entries[entries.length - 1].published < cutoff) break;
        }
        if (got) notes.push(`${got} archive posts`);
      }
    }
    const g = await gnews(src, "1y");
    if (g.length) notes.push(`${g.length} Google News results`);
    n += await store(src, g, true);
    return `${n} pieces from the past year${notes.length ? ` (${notes.join(", ")})` : ""}`;
  };

  const one = async (src: Source) => {
    const state = states.get(src.url);
    let feedUrl = state?.feed_url ?? null;
    let firstPage: string | null = null;
    const doBackfill = backfillSet.has(src.url);
    try {
      try {
        if (!feedUrl || (state?.checked_at && since(state.checked_at) > REDISCOVER_MS && state.status !== "ok")) {
          const found = await discover(src.url);
          if (found.status !== "ok") throw new Error(found.status === "no_feed" ? "No feed found on this site" : found.message);
          feedUrl = found.feedUrl;
        }
        let res = await fetcher(feedUrl);
        // A feed that refuses (or moved): try the source's other known feed addresses before giving up.
        for (const alt of src.altFeeds ?? []) {
          if (res.ok) break;
          const r = await fetcher(alt).catch(() => null);
          if (r?.ok) {
            res = r;
            feedUrl = alt;
          }
        }
        if (!res.ok) throw new Error(`Feed returned ${res.status}`);
        firstPage = await res.text();
        const entries = parseFeed(firstPage);
        const kept = await store(src, entries, doBackfill);
        await db
          .prepare(`INSERT INTO strategic_sources (url, name, feed_url, checked_at, status, error, items, kept, last_ok) VALUES (?,?,?,?,'ok',NULL,?,?,?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, feed_url = excluded.feed_url, checked_at = excluded.checked_at, status = 'ok', error = NULL, items = excluded.items, kept = excluded.kept, last_ok = excluded.last_ok`)
          .bind(src.url, src.name, feedUrl, nowIso, entries.length, kept, nowIso)
          .run();
      } catch (err) {
        await db
          .prepare(`INSERT INTO strategic_sources (url, name, feed_url, checked_at, status, error) VALUES (?,?,?,?,'error',?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, feed_url = COALESCE(excluded.feed_url, strategic_sources.feed_url), checked_at = excluded.checked_at, status = 'error', error = excluded.error`)
          .bind(src.url, src.name, feedUrl, nowIso, err instanceof Error ? err.message.slice(0, 300) : String(err))
          .run();
        feedUrl = null;
      }
      if (doBackfill) {
        // Marked before the work, so a run cut short never retries the same source forever; the note says so.
        await db.prepare(`UPDATE strategic_sources SET backfilled_at = ?, backfill_note = ? WHERE url = ?`).bind(nowIso, "Past year: started, not finished", src.url).run();
        const note = await backfill(src, feedUrl, firstPage);
        await db.prepare(`UPDATE strategic_sources SET backfilled_at = ?, gnews_at = ?, backfill_note = ? WHERE url = ?`).bind(nowIso, nowIso, note, src.url).run();
      }
    } catch (err) {
      console.error(`[analyses] ${src.name} failed`, err);
      errors.push(`${src.name}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
  };

  const searchDaily = async (src: Source) => {
    try {
      await store(src, await gnews(src, "3d"), false);
    } finally {
      await db.prepare(`UPDATE strategic_sources SET gnews_at = ? WHERE url = ?`).bind(nowIso, src.url).run();
    }
  };

  /** Lists a source's content pages from the past year from its sitemap, to be opened a batch at a time. */
  const readSitemap = async (src: Source) => {
    let note = "No sitemap found";
    await db
      .prepare(`INSERT INTO strategic_sources (url, name, sitemap_at, sitemap_note) VALUES (?,?,?,?) ON CONFLICT(url) DO UPDATE SET sitemap_at = excluded.sitemap_at, sitemap_note = excluded.sitemap_note`)
      .bind(src.url, src.name, nowIso, "Sitemap: started, not finished")
      .run();
    try {
      const origin = new URL(src.url).origin;
      const robots = (await getText(`${origin}/robots.txt`)) ?? "";
      const roots = [...new Set([...[...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]), `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`])];
      const pages: { loc: string; lastmod: string | null }[] = [];
      for (const root of roots) {
        const xml = await getText(root);
        if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
        const top = parseSitemap(xml);
        if (top.index) {
          // Newest child sitemaps first; skip ones for tags, authors, events, media and static pages.
          const children = top.entries
            .filter((c) => !CHILD_SKIP.test(c.loc) && (!c.lastmod || c.lastmod >= cutoff))
            .sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""))
            .slice(0, MAX_CHILD_SITEMAPS);
          for (const c of children) {
            const cx = await getText(c.loc);
            if (cx) pages.push(...parseSitemap(cx).entries);
          }
        } else pages.push(...top.entries);
        if (pages.length) break;
      }
      const picked = pages
        .filter((p) => (!p.lastmod || p.lastmod >= cutoff) && worthOpening(src, p.loc))
        .sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""))
        .slice(0, MAX_CANDIDATES_PER_SOURCE);
      const priority = src.domains.includes("humanitarian") ? 1 : 0;
      for (let i = 0; i < picked.length; i += 50) {
        await db.batch(picked.slice(i, i + 50).map((p) => db.prepare(`INSERT OR IGNORE INTO strategic_candidates (url, source_url, lastmod, priority, status, created_at) VALUES (?,?,?,?,'pending',?)`).bind(p.loc, src.url, p.lastmod, priority, nowIso)));
      }
      if (pages.length) note = `${picked.length} publications from the past year listed in the sitemap (of ${pages.length} pages)`;
    } catch (err) {
      note = `Sitemap failed: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`;
    }
    await db
      .prepare(`INSERT INTO strategic_sources (url, name, sitemap_at, sitemap_note) VALUES (?,?,?,?) ON CONFLICT(url) DO UPDATE SET sitemap_at = excluded.sitemap_at, sitemap_note = excluded.sitemap_note`)
      .bind(src.url, src.name, nowIso, note)
      .run();
  };

  const sourceByUrl = new Map(SOURCES.map((s) => [s.url, s]));
  /** Opens a page a sitemap listed, reads its title, summary and date, and stores it like a feed item. */
  const openPage = async (c: { url: string; source_url: string; lastmod: string | null }) => {
    let status = "failed";
    try {
      const src = sourceByUrl.get(c.source_url);
      const known = await db.prepare(`SELECT 1 FROM strategic_analyses WHERE url = ? LIMIT 1`).bind(c.url).first();
      if (!src || known) status = "done";
      else {
        const html = await getText(c.url);
        if (html) {
          const m = pageMeta(html);
          const published = m.published ?? c.lastmod;
          if (m.title && published) {
            await store(src, [{ title: m.title, url: c.url, published, summary: m.summary }], true);
            status = "done";
          }
        }
      }
    } finally {
      await db.prepare(`UPDATE strategic_candidates SET status = ? WHERE url = ?`).bind(status, c.url).run();
    }
  };

  // Sources to read: the due ones, plus the ones being backfilled (which need their feed read first).
  const toRead = [...due, ...backfillDue.filter((s) => !due.some((d) => d.url === s.url))];
  const queue: (() => Promise<void>)[] = [
    ...toRead.map((s) => async () => (await one(s), void (backfillSet.has(s.url) ? lanes.backfill++ : lanes.read++))),
    ...sitemapDue.map((s) => async () => (await readSitemap(s), void lanes.sitemaps++)),
    ...pending.map((c) => async () => (await openPage(c), void lanes.pages++)),
    ...gnewsDue.map((s) => async () => (await searchDaily(s), void lanes.gnews++)),
  ];
  // A few at a time, so one slow site does not hold the rest; nothing new starts once the run's time is up.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          lanes.skipped++;
          continue;
        }
        try {
          await job();
        } catch (err) {
          errors.push(err instanceof Error ? err.message.slice(0, 120) : String(err));
        }
      }
    })
  );
  await db.prepare(`DELETE FROM strategic_analyses WHERE published < ?`).bind(cutoff).run();
  await db.prepare(`DELETE FROM strategic_candidates WHERE status != 'pending' AND created_at < ?`).bind(new Date(now.getTime() - 30 * 86_400_000).toISOString()).run();
  await setState(db, "last_run", { startedAt: nowIso, finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - startedAt) / 1000), added, lanes, stored, fetchFails, errors: errors.slice(0, 12) });
  return { ran: true, added, sources: toRead.length + gnewsDue.length + sitemapDue.length, backfilled: backfillDue.length };
}

/* ── Run record and diagnostics ─────────────────────────────────────────── */

async function setState(db: D1Database, key: string, value: unknown): Promise<void> {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS strategic_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
    await db.prepare(`INSERT INTO strategic_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, JSON.stringify(value)).run();
  } catch {
    /* diagnostics only */
  }
}

/** What the collector is doing: its last run, how far the year's catch-up has got, and what is stored per domain. */
export async function analysisDiagnostics(db: D1Database): Promise<Record<string, unknown>> {
  await ensureAnalysisTables(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS strategic_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
  const [run, src, cand, per] = await Promise.all([
    db.prepare(`SELECT value FROM strategic_state WHERE key = 'last_run'`).first<{ value: string }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(status = 'ok') AS ok, SUM(status = 'error') AS failing, SUM(backfilled_at IS NOT NULL) AS backfilled, SUM(backfill_note = 'Past year: started, not finished') AS backfill_cut, SUM(sitemap_at IS NOT NULL) AS sitemaps_read, SUM(sitemap_note LIKE '%publications%') AS sitemaps_found FROM strategic_sources`
      )
      .first<Record<string, number>>(),
    db.prepare(`SELECT status, COUNT(*) AS n FROM strategic_candidates GROUP BY status`).all<{ status: string; n: number }>(),
    db.prepare(`SELECT domain, COUNT(*) AS n, SUM(in_scope) AS in_scope FROM strategic_analyses GROUP BY domain`).all<{ domain: string; n: number; in_scope: number }>(),
  ]);
  return {
    lastRun: run ? JSON.parse(run.value) : null,
    sources: { listed: SOURCES.length, ...(src ?? {}) },
    pages: Object.fromEntries((cand.results ?? []).map((r) => [r.status, r.n])),
    stored: Object.fromEntries((per.results ?? []).map((r) => [r.domain, { all: r.n, inScope: r.in_scope }])),
  };
}

/* ── Reading ──────────────────────────────────────────────────────────── */

export interface AnalysisView extends AnalysisItem {
  firstSeen: string;
  /** African think tank, international think tank, analyst / newsletter or specialist outlet. */
  sourceKind: string | null;
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
    places: JSON.parse(String(r.places ?? "[]")),
    regions: JSON.parse(String(r.regions ?? "[]")),
    blocs: JSON.parse(String(r.blocs ?? "[]")),
    africa: !!r.africa,
    inScope: !!r.in_scope,
    score: Number(r.score),
    firstSeen: String(r.first_seen),
    sourceKind: (() => {
      const k = sourceKindOf(String(r.source));
      return k ? SOURCE_KIND_LABEL[k] : null;
    })(),
    lat: pin ? pin[0] : null,
    lng: pin ? pin[1] : null,
  };
}

export async function listAnalyses(db: D1Database, domain: DomainId, opts: { days?: number; all?: boolean; limit?: number } = {}): Promise<AnalysisView[]> {
  await ensureAnalysisTables(db);
  const since = new Date(Date.now() - (opts.days ?? 60) * 86_400_000).toISOString();
  const rows = await db
    .prepare(`SELECT * FROM strategic_analyses WHERE domain = ? AND published >= ? ${opts.all ? "" : "AND in_scope = 1"} ORDER BY published DESC LIMIT ?`)
    .bind(domain, since, Math.min(opts.limit ?? 1000, 1500))
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
    .prepare(`SELECT * FROM strategic_analyses WHERE domain = ? AND in_scope = 1 AND first_seen > ? AND published > ? ORDER BY score DESC, published DESC LIMIT ?`)
    .bind(domain, since, new Date(Date.parse(since) - 7 * 86_400_000).toISOString(), limit)
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToView);
}

export async function sourceStatus(db: D1Database, domain: DomainId): Promise<{ name: string; url: string; kind: string; backfill: string | null; status: string; error: string | null; items: number; kept: number; lastOk: string | null }[]> {
  await ensureAnalysisTables(db);
  const rows = (await db.prepare(`SELECT * FROM strategic_sources`).all<Record<string, unknown>>()).results ?? [];
  const byUrl = new Map(rows.map((r) => [String(r.url), r]));
  return SOURCES.filter((s) => s.domains.includes(domain)).map((s) => {
    const r = byUrl.get(s.url);
    return { name: s.name, url: s.url, kind: SOURCE_KIND_LABEL[s.kind], backfill: [r?.backfill_note, r?.sitemap_note].filter((x) => x != null).map(String).join(" · ") || null, status: r ? String(r.status) : "not yet checked", error: r?.error != null ? String(r.error) : null, items: Number(r?.items ?? 0), kept: Number(r?.kept ?? 0), lastOk: r?.last_ok != null ? String(r.last_ok) : null };
  });
}
