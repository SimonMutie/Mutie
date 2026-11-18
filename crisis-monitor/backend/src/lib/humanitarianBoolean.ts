/**
 * Boolean rules for New Humanitarianism (Strategic Analyses). A rule is a list of term groups combined with AND; the
 * terms within a group are combined with OR. A term ending in "*" matches any word starting with it; matching ignores
 * case, accents, apostrophes and hyphens (strategicAnalysis.ts, fold). Each theme matches when ANY of its plain terms
 * matches OR ANY of its rules is satisfied.
 *
 * Written in English, French, Portuguese and Spanish, since much of the writing on humanitarianism in Africa is not
 * in English.
 */

/* ── Shared groups ────────────────────────────────────────────────────── */

/** Aid, money and the actors who give or move it. */
export const AID = [
  "aid", "aids", "aide", "aides", "ajuda", "ayuda", "assistance", "assistencia", "asistencia", "humanitar*", "relief", "secours",
  "donor*", "bailleur*", "doador*", "donante*", "funding", "funder*", "financement*", "financiamento*", "financiacion", "financing", "finance",
  "oda", "apd", "official development assistance", "development assistance", "development aid", "development cooperation", "cooperation au developpement",
  "aide publique au developpement", "foreign aid", "overseas aid", "international aid", "aid budget*", "aid spending", "aid money", "grant*",
  "appeal*", "response plan*", "hrp*", "pooled fund*", "cbpf*", "cerf", "usaid", "fcdo", "dfid", "dg echo", "norad", "danida", "giz", "afd",
  "jica", "koica", "dfat", "bha", "prm", "ocha", "unhcr", "wfp", "unicef", "iom", "oim", "unfpa", "oms", "icrc", "cicr", "ifrc",
  "msf", "ngo*", "ong*", "ingo*", "nngo*", "lngo*", "un agenc*", "agences onusiennes", "agencies", "agency", "philanthrop*", "foundation*",
];

/** Things being cut, frozen, shrinking or rationed. */
export const CUTS = [
  "cut", "cuts", "cutting", "coupe*", "coupure*", "corte", "cortes", "recorte*", "slash*", "freeze*", "frozen", "gele*", "suspen*", "halt*",
  "pause*", "paused", "terminat*", "cancel*", "dismantl*", "demantel*", "clos*", "shut*", "wind down", "winding down", "shortfall*", "gap", "gaps",
  "deficit*", "declin*", "reduc*", "redui*", "reduit*", "reduz*", "baisse*", "baiss*", "diminu*", "amput*", "rabot*", "sabr*", "tarit*", "taris*", "shrink*", "contract*", "retrench*", "withdraw*", "retrait*", "retreat*", "pull out",
  "pullout", "drop*", "fall", "falls", "falling", "fell", "plummet*", "collaps*", "crunch", "squeeze*", "austerit*", "triage", "prioriti*",
  "hyper prioriti*", "ration*", "pipeline break*", "layoff*", "lay off*", "job cuts", "job losses", "redundanc*", "licenciement*", "underfund*",
  "sous financ*", "subfinanc*", "unfunded", "end of", "fin de", "loss of", "lost", "stop work", "stop-work", "drying up", "dried up", "evaporat*",
  "budget pressure*", "budget crisis", "liquidity", "insolven*", "bankrupt*",
];

/** The system: its institutions, mechanisms and architecture. */
export const SYSTEM = [
  "humanitarian system", "systeme humanitaire", "sistema humanitario", "aid system", "humanitarian sector", "secteur humanitaire", "aid sector",
  "aid architecture", "humanitarian architecture", "architecture humanitaire", "international aid", "aid industry", "humanitarian industry",
  "multilateral*", "united nations", "nations unies", "un system", "systeme onusien", "un agenc*", "agencies", "iasc", "ocha", "coordination",
  "cluster*", "grand bargain", "humanitarian leadership", "humanitarian coordinator*", "resident coordinator*", "country team*", "hct*",
  "pooled fund*", "cerf", "appeal system", "global humanitarian overview", "gho", "humanitarian response plan*", "humanitarian programme cycle",
  "mandate*", "humanitarian reset", "reset", "un80", "humanitarian compact", "flagship initiative",
];

/** Reform, rethinking and transformation. */
export const REFORM = [
  "reset", "reform*", "reforme*", "reforma*", "overhaul*", "restructur*", "restructura*", "reestructura*", "transform*", "merg*", "fusion*",
  "consolidat*", "rethink*", "repens*", "repensar", "reimagin*", "reinvent*", "redesign*", "re design*", "streamlin*", "efficien*", "refonte",
  "shake up", "shake-up", "new deal", "compact", "bargain", "renewal", "rebuild*", "revamp*", "change*", "shift*", "future", "avenir", "futuro",
  "next", "what now", "what next", "lessons", "lecons", "turning point", "crossroads", "inflection", "rupture", "paradigm*",
];

/** Local and national actors, and the people affected. */
export const LOCAL_ACTORS = [
  "local*", "national actor*", "national ngo*", "national organi*", "acteurs locaux", "acteurs nationaux", "atores locais", "actores locales",
  "community", "communities", "communaut*", "comunidad*", "comunidade*", "grassroots", "frontline", "front line", "first responder*",
  "civil society", "societe civile", "sociedade civil", "sociedad civil", "women led", "women s rights organi*", "women s organi*", "feminist",
  "youth led", "refugee led", "survivor led", "people led", "faith based", "faith actors", "religious actors", "diaspora", "mutual aid",
  "emergency response room*", "err", "errs", "local ngo*", "lngo*", "nngo*", "cbo*", "community based organi*", "indigenous", "proximate",
  "southern ngo*", "southern partner*", "african ngo*", "african civil society", "african organi*", "local partner*", "partenaires locaux",
  "national staff", "local staff", "local responders", "local humanitarian*", "national humanitarian*",
];

/** What localisation is about: money, power, leadership and partnership. */
export const LOCAL_ISSUES = [
  "direct funding", "funding", "financement*", "money", "resources", "leadership", "lead", "leading", "led", "power", "pouvoir", "poder",
  "partnership*", "partenariat*", "parceria*", "alianza*", "capacity", "capacite*", "capacidade*", "decision making", "decision*", "overhead*",
  "indirect cost*", "frais de structure", "share", "sharing", "shift*", "transfer*", "equit*", "agency", "voice", "ownership", "decoloni*",
  "localis*", "localiz*", "locally led", "locally-led", "intermediar*", "pass through", "pass-through", "sub grant*", "subgrant*", "sub contract*",
  "subcontract*", "trust", "risk sharing", "risk transfer", "complementarity", "complementarite", "coordination", "representation", "seat at the table",
  "accountability", "solidarity", "solidarite", "self reliance", "autonom*", "sovereign*", "souverain*",
];

/** Non-traditional and Global South actors. */
export const NEW_ACTORS = [
  "gulf", "golfe", "saudi*", "arabie saoudite", "ksrelief", "emirat*", "uae", "qatar*", "kuwait*", "koweit", "turk*", "turquie", "turkiye", "tika",
  "afad", "china", "chinese", "chine", "chinois", "india*", "inde", "brazil*", "bresil", "indonesia*", "malaysia*", "south africa*",
  "afrique du sud", "nigeria*", "kenya*", "egypt*", "egypte", "morocc*", "maroc", "ethiopia*", "rwanda*", "african union", "union africaine",
  "igad", "ecowas", "cedeao", "sadc", "eac", "brics", "global south", "sud global", "sul global", "sur global", "south south", "sud sud",
  "non traditional", "non western", "emerging donor*", "new donor*", "nouveaux bailleurs", "middle power*", "islamic", "islamique", "zakat",
  "waqf", "sadaqa*", "diaspora*", "philanthrop*", "private sector", "secteur prive", "business*", "corporat*", "remittance*", "transferts de fonds",
  "africa cdc", "afreximbank", "regional organi*", "regional bod*", "african led", "african solutions", "pan african*", "panafrica*",
];

/** Getting aid through: access and its obstacles. */
export const ACCESS_SUBJECT = [
  "access", "acces", "acesso", "acceso", "aid", "aide", "convoy*", "delivery", "deliveries", "livraison*", "assistance", "humanitar*", "supplies",
  "food", "relief", "agencies", "aid workers", "ngo*", "ong*", "operations", "response", "reponse", "corridor*", "crossing*", "border*",
];
export const ACCESS_OBSTACLES = [
  "block*", "bloqu*", "blockade*", "blocus", "obstruct*", "imped*", "entrav*", "restrict*", "deni*", "refus*", "barrier*", "constraint*",
  "contrainte*", "bureaucra*", "permit*", "visa*", "checkpoint*", "siege", "besieg*", "assieg*", "loot*", "pillage*", "divert*", "diversion",
  "detourn*", "interfer*", "negotiat*", "negoci*", "corridor*", "cross border", "transfrontalier*", "cross line", "crossline", "expel*", "expuls*",
  "suspend*", "ban", "bans", "banned", "interdi*", "weaponi*", "instrumentali*", "starv*", "affam*", "attack*", "attaque*", "insecur*",
  "impossible", "cut off", "cut-off", "closure*", "fermeture*", "shrinking space", "humanitarian space", "operating environment", "remote management",
];

/** Aid workers and the threats to them. */
export const WORKERS = [
  "aid worker*", "humanitarian worker*", "humanitarians", "humanitarian staff", "relief worker*", "travailleur* humanitaire*", "humanitaires",
  "trabalhador* humanitario*", "staff", "personnel", "volunteer*", "benevole*", "voluntario*", "ngo worker*", "national staff", "local staff",
  "health worker*", "medics", "medical staff", "red cross", "red crescent", "croix rouge", "croissant rouge",
];
export const HARM = [
  "kill*", "tue*", "tues", "mort*", "murder*", "assassin*", "attack*", "attaque*", "abduct*", "enlev*", "kidnap*", "detain*", "detention",
  "arrest*", "arret*", "threat*", "menace*", "violence*", "safety", "securite", "security", "risk*", "risque*", "death*", "died", "deadliest",
  "injur*", "bless*", "loot*", "harass*", "intimidat*", "duty of care",
];

/** Climate, development, peace and anticipation. */
export const NEXUS_SUBJECT = [
  "climate", "climat*", "clima", "drought*", "secheresse*", "seca*", "flood*", "inondation*", "cheia*", "inundac*", "el nino", "la nina",
  "disaster*", "catastroph*", "desastre*", "resilien*", "development", "developpement", "desenvolvimento", "desarrollo", "peace*", "paix",
  "peacebuilding", "consolidation de la paix", "social protection", "protection sociale", "safety net*", "filet* sociaux", "anticipat*",
  "early warning", "alerte precoce", "early action", "action precoce", "forecast*", "prevision*", "insurance", "assurance*", "risk financ*",
  "adaptation", "loss and damage", "pertes et dommages", "protracted", "prolonge*", "durable solution*", "solutions durables", "exit strateg*",
  "transition*", "nexus", "triple nexus", "hdp", "hdpn",
];
export const RESPONSE = [
  "humanitar*", "aid", "aide", "response", "reponse", "resposta", "respuesta", "finance", "financ*", "funding", "action", "system",
  "systeme", "programm*", "intervention*", "assistance", "relief", "agencies", "ngo*", "ong*", "donor*", "bailleur*", "policy", "politique*",
];

/** Accountability, participation and the people affected. */
export const ACCOUNTABILITY = [
  "accountab*", "redevabilit*", "responsabiliza*", "rendicion de cuentas", "participat*", "feedback", "retour d information", "voice*",
  "dignity", "dignite", "dignidade", "dignidad", "perception*", "community engagement", "engagement communautaire", "psea", "pseah",
  "safeguarding", "sexual exploitation", "exploitation sexuelle", "abuse", "complaint*", "plainte*", "trust", "confiance", "legitima*",
  "consultation*", "listen*", "inclusion", "inclusive", "disabilit*", "handicap*", "gender", "genre", "age and gender", "do no harm",
  "core humanitarian standard", "chs", "sphere",
];
export const AFFECTED = [
  "affected", "affectees", "afetad*", "afectad*", "communit*", "communaut*", "people", "populations", "population", "recipient*",
  "beneficiar*", "beneficiaire*", "crisis affected", "crisis-affected", "displaced", "deplace*", "refugee*", "refugie*", "humanitar*", "survivors",
];

/** Money and technology in delivery. */
export const DELIVERY_TECH = [
  "cash", "especes", "dinheiro", "efectivo", "voucher*", "coupon*", "transfer*", "transferts monetaires", "digital", "numerique", "digitais",
  "data", "donnees", "dados", "datos", "technolog*", "ai", "artificial intelligence", "intelligence artificielle", "inteligencia artificial",
  "biometric*", "biometri*", "innovation*", "mobile money", "m pesa", "blockchain", "satellite*", "drone*", "starlink", "algorithm*",
  "automation", "chatbot*", "large language model*", "llm*", "digital identity", "identite numerique", "registration", "enregistrement",
];

/** The future and the identity of humanitarianism. */
export const FUTURE = [
  "future", "avenir", "futuro", "rethink*", "repens*", "reimagin*", "end of",
  "fin de", "fim de", "crisis of", "crise de", "decline of", "declin", "legitima*", "relevance", "pertinence", "purpose", "identity",
  "identite", "model*", "modele*", "paradigm*", "new era", "landscape", "paysage", "trend*", "tendance*", "outlook",
  "transformation", "reckoning", "existential", "post aid", "beyond aid", "after aid", "apres l aide", "decoloni*", "power shift*",
  "politics of", "geopolitic*", "geopolitique*", "multilateralism", "multilateralisme", "world order", "ordre mondial", "solidarity",
  "solidarite", "principles", "principes", "ethic*",
];
export const HUMANITARIANISM = [
  "humanitarian*", "humanitarianism", "humanitarisme", "humanitarismo", "humanitaire*", "humanitario*", "aid", "aide", "ajuda", "aid sector",
  "aid system", "aid industry", "development cooperation", "international cooperation", "cooperation internationale", "multilateralism",
  "relief", "ngo*", "ong*", "civil society", "societe civile",
];

/** People on the move. */
export const DISPLACED = [
  "refugee*", "refugie*", "refugiad*", "displace*", "deplace*", "desplazad*", "deslocad*", "idp", "idps", "pdi", "internally displaced",
  "migrant*", "migration*", "asylum", "asile", "asilo", "returnee*", "retourne*", "stateless*", "apatrid*", "host communit*",
  "communautes d accueil", "camp", "camps", "settlement*", "exile*", "exil*", "forced migration", "mixed migration", "mixed movements",
];
export const DISPLACEMENT_POLICY = [
  "policy", "politique*", "protection", "solution*", "camp*", "settlement*", "inclusion", "integration", "integrat*", "return*", "retour*",
  "resettlement", "reinstallation", "relocat*", "funding", "financement*", "response", "reponse", "crisis", "crise", "compact", "durable",
  "self reliance", "autonomie", "livelihood*", "moyens de subsistance", "work permit*", "right to work", "encampment", "repatriat*",
  "rapatri*", "kampala convention", "convention de kampala", "global compact on refugees", "pacte mondial", "grf", "global refugee forum",
  "burden sharing", "responsibility sharing", "partage des responsabilites", "externali*", "deterrence", "deportation*", "pushback*",
];

/** Hunger and health emergencies. */
export const HUNGER_HEALTH = [
  "famine", "hunger", "faim", "fome", "hambre", "food insecurity", "insecurite alimentaire", "inseguranca alimentar", "inseguridad alimentaria",
  "malnutrition", "desnutri*", "ipc", "cadre harmonise", "starvation", "famine early warning", "fews net", "food crisis", "crise alimentaire",
  "cholera", "cholera", "mpox", "ebola", "measles", "rougeole", "malaria", "paludisme", "outbreak*", "epidemi*", "epidemic*", "pandemic*",
  "health system*", "systeme* de sante", "health emergenc*", "urgence* sanitaire*",
];
export const HUNGER_HEALTH_RESPONSE = [
  "response", "reponse", "aid", "aide", "funding", "financement*", "policy", "politique*", "crisis", "crise", "warning", "alerte", "declar*",
  "humanitar*", "cuts", "coupe*", "access", "acces", "prevention", "preparedness", "preparation",
];

/** Protection, gender and inclusion. */
export const PROTECTION = [
  "protection", "gbv", "gender based violence", "violence basee sur le genre", "vbg", "sexual violence", "violences sexuelles",
  "child protection", "protection de l enfance", "women and girls", "femmes et filles", "disabilit*", "handicap*", "older people",
  "personnes agees", "minorit*", "marginali*", "inclusion", "exclusion", "trafficking", "traite", "child marriage", "mariage d enfants",
  "unaccompanied", "non accompagne*", "mental health", "sante mentale", "psychosocial", "mhpss",
];
export const PROTECTION_CONTEXT = [
  "humanitar*", "response", "reponse", "crisis", "crise", "displaced", "deplace*", "refugee*", "refugie*", "conflict*", "conflit*",
  "emergenc*", "urgence*", "camp*", "aid", "aide", "funding", "financement*", "cuts", "coupe*",
];

/** Rules per theme (each rule: groups ANDed, terms ORed). */
export const HUMANITARIAN_RULES: Record<string, string[][][]> = {
  funding: [[AID, CUTS]],
  reset: [[SYSTEM, REFORM]],
  localisation: [[LOCAL_ACTORS, LOCAL_ISSUES]],
  "global-south": [[NEW_ACTORS, AID]],
  access: [[ACCESS_SUBJECT, ACCESS_OBSTACLES]],
  security: [[WORKERS, HARM]],
  nexus: [[NEXUS_SUBJECT, RESPONSE]],
  accountability: [[ACCOUNTABILITY, AFFECTED]],
  "cash-digital": [[DELIVERY_TECH, ["humanitar*", "aid", "aide", "assistance", "relief", "response", "reponse", "refugee*", "refugie*", "displaced", "deplace*", "ngo*", "ong*"]]],
  displacement: [[DISPLACED, DISPLACEMENT_POLICY]],
  "hunger-health": [[HUNGER_HEALTH, HUNGER_HEALTH_RESPONSE]],
  protection: [[PROTECTION, PROTECTION_CONTEXT]],
  future: [[FUTURE, HUMANITARIANISM]],
};

/** How many two-term combinations a rule stands for (the size of the Boolean query it replaces). */
export const ruleCombinations = (rule: string[][]) => rule.reduce((n, g) => n * g.length, 1);
