/**
 * Baseline credibility assessments for the Sources Register.
 *
 * Reliability uses the NATO/Admiralty source scale (A–F). In open-source work
 * "A" is reserved for primary official publishers of data; the best news
 * organisations sit at "B". An outlet we cannot yet vouch for is "F" (cannot
 * be judged), never a guess.
 *
 * These are desk assessments of an outlet's track record, ownership and
 * editorial independence. They are a starting point for the analyst to review
 * (the register records who rated and when), not a verdict on any single story.
 */
export type Reliability = "A" | "B" | "C" | "D" | "E" | "F";

export type Ownership =
  | "independent" // privately or trust owned, editorially independent
  | "public" // public-service broadcaster with an editorial-independence framework
  | "state" // owned or controlled by the state or ruling party
  | "state_funded" // funded by a state but with editorial separation claimed
  | "diaspora" // exile or diaspora newsroom
  | "civil_society" // NGO, think tank, advocacy or fact-checking body
  | "academic" // university institute
  | "multilateral" // UN, AU, regional bloc, development bank
  | "data" // a data publisher or aggregator
  | "unassessed";

export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  independent: "Independent",
  public: "Public broadcaster",
  state: "State-owned / controlled",
  state_funded: "State-funded",
  diaspora: "Exile / diaspora",
  civil_society: "Civil society / think tank",
  academic: "Academic",
  multilateral: "Multilateral body",
  data: "Data publisher",
  unassessed: "Not yet assessed",
};

export const RELIABILITY_LABEL: Record<Reliability, string> = {
  A: "Completely reliable",
  B: "Usually reliable",
  C: "Fairly reliable",
  D: "Not usually reliable",
  E: "Unreliable",
  F: "Cannot be judged yet",
};

/** [reliability, ownership, orientation, note?] by hostname without "www." */
type Rating = [Reliability, Ownership, string, string?];

const IND = "Independent"; // orientation shorthand
const GOV = "Pro-government line on politics and security";
const OFFICIAL = "Official line; strong on routine events and statements";
const CONTROLLED = "State-controlled; the official line, not for contested facts";

export const RATINGS: Record<string, Rating> = {
  // ── Wires and international ──
  "reuters.com": ["B", "independent", IND + ", wire standards", "Global wire with a long record; corrections policy."],
  "apnews.com": ["B", "independent", IND + ", wire standards", "Non-profit cooperative wire; corrections policy."],
  "bbc.com": ["B", "public", "Public-service; editorial independence charter", "UK licence-fee funded."],
  "theguardian.com": ["B", "independent", "Centre-left editorial line", "Owned by a trust; opinion and news are separated."],
  "aljazeera.com": ["B", "state_funded", "Qatar-funded; editorial line differs on Gulf and Muslim Brotherhood politics", "Strong field reporting across Africa and the Middle East; weigh coverage touching Qatar's interests."],
  "dw.com": ["B", "public", "Public-service; editorial independence by law", "German federally funded."],
  "france24.com": ["B", "state_funded", "French public-service group; editorial independence by statute", "Treat framing of French policy in the Sahel with care."],
  "rfi.fr": ["B", "state_funded", "French public-service radio; editorial independence by statute", "Treat framing of French policy in the Sahel with care."],
  "voanews.com": ["C", "state_funded", "US government-funded; editorial firewall", "The status and output of US-funded broadcasting has been disrupted; check that coverage is current."],
  "aa.com.tr": ["C", "state", "Turkish state agency; follows Ankara's foreign-policy line", "Useful for Turkish positions and Middle East events; verify contested claims."],
  "tass.com": ["D", "state", "Russian state agency; the Kremlin's line", "Valued as an indicator of the Russian official position; not relied on for contested facts."],
  "timesofisrael.com": ["B", "independent", "Israeli perspective; liberal-centrist", "Independent newsroom; reflects Israeli sourcing."],
  "africanews.com": ["C", "independent", "Pan-African; Euronews-owned", "Broad but often thin and wire-derived."],
  "allafrica.com": ["C", "independent", "Aggregator of African newsrooms", "Reliability is that of the originating outlet; always check the byline source."],
  "jeuneafrique.com": ["C", "independent", "Pan-African francophone weekly", "Well sourced on politics and business; has faced questions over proximity to some governments."],
  "theafricareport.com": ["C", "independent", "Business and politics; Jeune Afrique group"],
  "africa-confidential.com": ["B", "independent", "Subscription political intelligence", "Long-established, well-placed sources."],
  "africaintelligence.com": ["B", "independent", "Subscription political and business intelligence", "Investigative, well-placed sources; Indigo Publications."],
  "africanbusiness.com": ["C", "independent", "Business magazine"],
  "thecontinent.org": ["B", "independent", "Pan-African weekly; journalist-run", "Uses a collaborative network of reporters."],
  "africanarguments.org": ["B", "civil_society", "Analysis and commentary", "Published by the Royal African Society; academic authors."],
  "african-markets.com": ["C", "independent", "Market data and news"],
  "africacheck.org": ["B", "civil_society", "Fact-checking; non-partisan", "Africa's first independent fact-checking organisation."],
  "africanofilter.org": ["C", "civil_society", "Media and open-data focus"],
  "pambazuka.org": ["C", "civil_society", "Pan-African social-justice commentary", "Advocacy orientation."],
  "panapress.com": ["C", "independent", "Pan-African news agency", "Coverage and funding have been uneven."],
  "thenewhumanitarian.org": ["B", "independent", "Humanitarian reporting", "Non-profit newsroom; strong field reporting."],
  "mongabay.com": ["B", "civil_society", "Environmental reporting; non-profit"],

  // ── South Africa ──
  "news24.com": ["B", "independent", IND], "dailymaverick.co.za": ["B", "independent", "Independent; investigative and opinion-forward"], "mg.co.za": ["B", "independent", IND + "; investigative record"],
  "amabhungane.org": ["B", "civil_society", "Non-profit investigative centre"], "groundup.org.za": ["B", "civil_society", "Non-profit news agency"],
  "businesslive.co.za": ["B", "independent", "Business daily"], "businessday.co.za": ["B", "independent", "Business daily"],
  "timeslive.co.za": ["C", "independent", IND], "sowetanlive.co.za": ["C", "independent", IND], "iol.co.za": ["C", "independent", IND], "ewn.co.za": ["C", "independent", IND + "; breaking-news focus"], "moneyweb.co.za": ["C", "independent", "Business and investment"],
  "enca.com": ["C", "independent", IND], "sabcnews.com": ["C", "public", "Public broadcaster; political-interference concerns have recurred"],
  // ── East Africa ──
  "nation.africa": ["B", "independent", IND + "; Nation Media Group"], "theeastafrican.co.ke": ["B", "independent", "Regional weekly; Nation Media Group"], "businessdailyafrica.com": ["B", "independent", "Business daily; Nation Media Group"],
  "standardmedia.co.ke": ["C", "independent", IND], "the-star.co.ke": ["C", "independent", "Independent; owner has political links"], "citizen.digital": ["C", "independent", IND], "kenyans.co.ke": ["C", "independent", "Digital, high-volume"], "peopledaily.digital": ["C", "independent", IND],
  "kbc.co.ke": ["C", "state", OFFICIAL],
  "monitor.co.ug": ["B", "independent", IND + "; Nation Media Group"], "newvision.co.ug": ["C", "state", "Majority state-owned; " + GOV.toLowerCase()], "independent.co.ug": ["C", "independent", IND], "nilepost.co.ug": ["C", "independent", IND], "chimpreports.com": ["C", "independent", "Security and politics; has close sourcing in the security services"], "ugandaradionetwork.net": ["C", "independent", "Local news agency"],
  "thecitizen.co.tz": ["B", "independent", IND + "; Nation Media Group"], "mwananchi.co.tz": ["C", "independent", IND], "ippmedia.com": ["C", "independent", IND], "thechanzo.com": ["C", "independent", "Digital, investigative-leaning"],
  "dailynews.co.tz": ["C", "state", OFFICIAL], "tbc.go.tz": ["C", "state", OFFICIAL],
  "newtimes.co.rw": ["C", "state", "Government-aligned; " + GOV.toLowerCase(), "Reliable on official positions and economy; limited critical coverage of security."], "ktpress.rw": ["C", "state", "Government-aligned"], "rba.co.rw": ["C", "state", OFFICIAL], "kigalitoday.com": ["C", "independent", "Local news"],
  "iwacu-burundi.org": ["B", "independent", "Independent under pressure", "Burundi's leading independent outlet; operates in a restricted environment."], "rtnb.bi": ["D", "state", CONTROLLED], "sosmediasburundi.org": ["C", "diaspora", "Citizen-journalist network; exile-linked"],
  "radiotamazuj.org": ["B", "diaspora", "Independent; Netherlands-based, South Sudan focus", "Strong on South Sudan; check single-source claims."], "sudanspost.com": ["C", "independent", "South Sudan news"],
  "suna-sd.net": ["C", "state", OFFICIAL, "Sudan's state agency; the authority in control of the capital shapes it."], "darfur24.com": ["C", "diaspora", "Darfur-focused; exile-linked"],
  "hiiraan.com": ["C", "diaspora", "Somali diaspora; commercial"], "garoweonline.com": ["C", "independent", "Puntland-based"], "horndiplomat.com": ["C", "independent", "Horn of Africa politics"], "goobjoog.com": ["C", "independent", "Mogadishu-based"], "radiodalsan.com": ["C", "independent", "Mogadishu-based"], "somaliguardian.com": ["C", "independent", "Somali news"],
  "addisstandard.com": ["B", "independent", "Independent; has faced government pressure"], "ethiopia-insight.com": ["B", "independent", "Analysis; academic and expert authors"], "thereporterethiopia.com": ["C", "independent", IND], "capitalethiopia.com": ["C", "independent", "Business"],
  "fanabc.com": ["C", "state", "Historically ruling-party affiliated; follows the government line"], "ena.et": ["C", "state", OFFICIAL], "borkena.com": ["C", "diaspora", "Diaspora; critical of the government"],
  "seychellesnewsagency.com": ["C", "state", "Government-run agency"], "nation.sc": ["C", "state", "Government-owned daily"], "sbc.sc": ["C", "state", OFFICIAL],
  "lemauricien.com": ["C", "independent", IND], "lexpress.mu": ["C", "independent", IND], "defimedia.info": ["C", "independent", IND], "mbcradio.tv": ["C", "state", OFFICIAL],
  "madagascar-tribune.com": ["C", "independent", IND], "midi-madagasikara.mg": ["C", "independent", IND],
  "djiboutipost.com": ["D", "independent", "Government-friendly environment"], "lanation.dj": ["D", "state", CONTROLLED], "adi.dj": ["D", "state", CONTROLLED], "rtd.dj": ["D", "state", CONTROLLED],
  "ahoraeg.com": ["F", "unassessed", "Not yet assessed"],
  // ── Southern Africa ──
  "newsday.co.zw": ["C", "independent", IND], "newzimbabwe.com": ["C", "independent", IND], "theindependent.co.zw": ["C", "independent", IND],
  "herald.co.zw": ["D", "state", "State-controlled; ruling-party aligned", "The official line; not for contested political or security facts."], "chronicle.co.zw": ["D", "state", "State-controlled; ruling-party aligned", "The official line; not for contested political or security facts."],
  "znbc.co.zm": ["C", "state", OFFICIAL], "daily-mail.co.zm": ["C", "state", OFFICIAL], "lusakatimes.com": ["C", "independent", IND], "diggers.news": ["C", "independent", "Independent; critical of governments"],
  "mwnation.com": ["C", "independent", IND], "nyasatimes.com": ["C", "independent", IND],
  "namibian.com.na": ["B", "independent", "Independent; Namibia's leading daily"], "neweralive.na": ["C", "state", "Government-owned daily"], "nbc.na": ["C", "state", OFFICIAL], "namibiansun.com": ["C", "independent", IND],
  "mmegi.bw": ["B", "independent", IND], "botswanaguardian.co.bw": ["C", "independent", IND], "dailynews.gov.bw": ["C", "state", OFFICIAL],
  "lesothotimes.com": ["C", "independent", IND], "lestimes.com": ["C", "independent", IND], "times.co.sz": ["C", "independent", IND, "Operates in a restricted press environment."], "observer.org.sz": ["C", "state", "Church-linked but government-influenced"],
  "clubofmozambique.com": ["C", "independent", "English summaries of Portuguese reporting", "Check the original outlet."], "cartamz.com": ["C", "independent", IND], "verdade.co.mz": ["C", "independent", IND], "jornalnoticias.co.mz": ["C", "state", "Government-aligned daily"],
  "angop.ao": ["C", "state", OFFICIAL], "jornaldeangola.ao": ["C", "state", OFFICIAL], "makaangola.org": ["B", "civil_society", "Anti-corruption investigative blog"], "novojornal.co.ao": ["C", "independent", IND], "expansao.co.ao": ["C", "independent", "Business weekly"],
  // ── West Africa ──
  "premiumtimesng.com": ["B", "independent", "Independent; investigative record"], "dailytrust.com": ["B", "independent", "Independent; strong northern Nigeria coverage"], "icirnigeria.org": ["B", "civil_society", "Non-profit investigative centre"], "humanglemedia.com": ["B", "civil_society", "Non-profit; conflict and Lake Chad reporting"], "thecable.ng": ["B", "independent", IND],
  "punchng.com": ["C", "independent", IND], "guardian.ng": ["C", "independent", IND], "thisdaylive.com": ["C", "independent", "Independent; owner has political ties"], "vanguardngr.com": ["C", "independent", IND], "channelstv.com": ["C", "independent", IND], "arise.tv": ["C", "independent", IND], "tribuneonlineng.com": ["C", "independent", IND], "businessday.ng": ["C", "independent", "Business daily"], "nairametrics.com": ["C", "independent", "Business and markets"], "dataphyte.com": ["C", "civil_society", "Data journalism"], "ripplesnigeria.com": ["C", "independent", IND],
  "graphic.com.gh": ["C", "state", "State-owned; generally balanced on routine news"], "ghanaiantimes.com.gh": ["C", "state", "State-owned daily"], "myjoyonline.com": ["B", "independent", "Multimedia group; leading Ghana newsroom"], "citinewsroom.com": ["C", "independent", IND], "3news.com": ["C", "independent", IND], "ghanaweb.com": ["C", "independent", "High-volume aggregator; verify claims"], "pulse.com.gh": ["C", "independent", "Lifestyle-leaning"], "ghanabusinessnews.com": ["C", "independent", "Business"], "thefourthestategh.com": ["C", "independent", "Investigative"],
  "seneweb.com": ["C", "independent", IND], "lequotidien.sn": ["C", "independent", IND], "sudonline.sn": ["C", "independent", IND], "dakaractu.com": ["C", "independent", IND], "pressafrik.com": ["C", "independent", IND], "rts.sn": ["C", "state", OFFICIAL], "aps.sn": ["C", "state", OFFICIAL],
  "maliweb.net": ["C", "independent", "Aggregator"], "malijet.com": ["C", "independent", "Aggregator"], "studiotamani.org": ["B", "independent", "Hirondelle Foundation-backed local radio news"], "journaldumali.com": ["C", "independent", IND], "lessor.ml": ["C", "state", OFFICIAL, "Mali is under military rule; domestic outlets operate under restrictions."],
  "lefaso.net": ["C", "independent", IND], "burkina24.com": ["C", "independent", IND], "sidwaya.info": ["C", "state", OFFICIAL, "Burkina Faso is under military rule; domestic outlets operate under restrictions."], "aib.media": ["C", "state", OFFICIAL],
  "lesahel.org": ["C", "state", OFFICIAL, "Niger is under military rule; domestic outlets operate under restrictions."], "anp.ne": ["C", "state", OFFICIAL],
  "ami.mr": ["C", "state", OFFICIAL], "alakhbar.info": ["C", "independent", IND], "cridem.org": ["C", "independent", "Aggregator"], "saharamedias.net": ["C", "independent", IND],
  "togomatin.tg": ["C", "state", OFFICIAL], "republicoftogo.com": ["C", "state", "Government-aligned"],
  "guineenews.org": ["C", "independent", IND], "guineematin.com": ["C", "independent", IND], "mediaguinee.org": ["C", "independent", IND], "africaguinee.com": ["C", "independent", IND],
  "thepoint.gm": ["C", "independent", IND], "standard.gm": ["C", "independent", IND], "foroyaa.net": ["C", "independent", "Aligned historically to the PDOIS party"],
  "liberianobserver.com": ["C", "independent", IND], "frontpageafricaonline.com": ["B", "independent", "Independent; investigative record"], "liberianinquirer.com": ["C", "independent", IND],
  "awokonewspaper.sl": ["C", "independent", IND], "thesierraleonetelegraph.com": ["C", "diaspora", "Diaspora-run; critical of government"],
  "lanation.bj": ["C", "state", "State-owned daily"], "banouto.bj": ["C", "independent", IND],
  // ── Central Africa ──
  "radiookapi.net": ["B", "multilateral", "UN-backed (MONUSCO) radio; Hirondelle Foundation-run", "Reliable on eastern DR Congo; UN mission context."], "actualite.cd": ["B", "independent", IND], "7sur7.cd": ["C", "independent", IND], "mediacongo.net": ["C", "independent", "Aggregator"], "politico.cd": ["C", "independent", IND], "lepotentiel.cd": ["C", "independent", IND], "forumdesas.net": ["C", "independent", IND],
  "crtv.cm": ["D", "state", CONTROLLED], "cameroon-tribune.cm": ["C", "state", OFFICIAL], "journalducameroun.com": ["C", "independent", IND], "actucameroun.com": ["C", "independent", IND], "businessincameroon.com": ["C", "independent", "Business"],
  "adiac-congo.com": ["C", "state", OFFICIAL], "lesdepechesdebrazzaville.fr": ["C", "state", OFFICIAL], "aci.cg": ["C", "state", OFFICIAL],
  "gabonreview.com": ["C", "independent", IND], "gabonmediatime.com": ["C", "independent", IND], "gabonactu.com": ["C", "independent", IND],
  "guineaecuatorialpress.com": ["D", "state", CONTROLLED], "radiomacuto.net": ["C", "diaspora", "Exile; critical of the government"],
  "stp-press.st": ["C", "state", OFFICIAL],
  // ── North Africa ──
  "madamasr.com": ["B", "independent", "Independent; investigative; operates under pressure"], "english.ahram.org.eg": ["C", "state", OFFICIAL], "almasryalyoum.com": ["C", "independent", "Independent daily; operates under restrictions"], "dailynewsegypt.com": ["C", "independent", IND], "enterprise.press": ["B", "independent", "Business and politics newsletter"], "egypttoday.com": ["C", "state", "Government-aligned"],
  "libyaobserver.ly": ["C", "independent", "Tripoli-based; check against eastern sources"], "libyaherald.com": ["C", "independent", "Libya-focused English daily"], "alwasat.ly": ["C", "independent", IND], "218tv.net": ["C", "independent", IND],
  "moroccoworldnews.com": ["C", "independent", "English-language; tends toward the official line on the Sahara issue"], "en.hespress.com": ["C", "independent", "Tends toward the official line on the Sahara issue"], "telquel.ma": ["B", "independent", IND], "leconomiste.com": ["C", "independent", "Business"], "medias24.com": ["C", "independent", IND], "yabiladi.com": ["C", "independent", IND], "mapnews.ma": ["C", "state", "State agency; the official line on the Sahara"],
  "tap.info.tn": ["C", "state", OFFICIAL], "businessnews.com.tn": ["C", "independent", IND], "webdo.tn": ["C", "independent", IND], "mosaiquefm.net": ["C", "independent", IND], "lapresse.tn": ["C", "state", OFFICIAL],
  "aps.dz": ["C", "state", OFFICIAL], "elmoudjahid.dz": ["C", "state", OFFICIAL], "elwatan.com": ["C", "independent", IND], "tsa-algerie.com": ["C", "independent", IND],

  // ── Research bodies, think tanks, NGOs ──
  "issafrica.org": ["B", "civil_society", "Research; African security"], "saiia.org.za": ["B", "civil_society", "Research; foreign policy"], "acetforafrica.org": ["B", "civil_society", "Economic research"], "mo.ibrahim.foundation": ["B", "civil_society", "Governance index"], "afrobarometer.org": ["B", "civil_society", "Public-opinion surveys"],
  "accord.org.za": ["B", "civil_society", "Conflict resolution research"], "africacenter.org": ["B", "state_funded", "US Department of Defense-funded academic centre", "Security research; US government-funded."], "ipss-addis.org": ["B", "academic", "University institute"],
  "africanpeacebuildingnetwork.org": ["B", "civil_society", "Research network"], "thebrenthurstfoundation.org": ["C", "civil_society", "Private foundation; policy advocacy"], "africanleadershipcentre.org": ["C", "civil_society", "Academic centre"], "africaportal.org": ["B", "civil_society", "Policy research aggregator"], "tralac.org": ["B", "civil_society", "Trade-law research"],
  "odi.org": ["B", "civil_society", "Development research"], "chathamhouse.org": ["B", "civil_society", "Foreign-policy research"], "crisisgroup.org": ["B", "civil_society", "Conflict analysis; field-based"], "carnegieendowment.org": ["B", "civil_society", "Foreign-policy research"], "brookings.edu": ["B", "civil_society", "Policy research"], "csis.org": ["B", "civil_society", "Security research"], "cfr.org": ["B", "civil_society", "Foreign-policy research"], "rand.org": ["B", "civil_society", "Defense and policy research"],
  "hrw.org": ["B", "civil_society", "Rights advocacy; documented methodology"], "amnesty.org": ["B", "civil_society", "Rights advocacy; documented methodology"], "rsf.org": ["B", "civil_society", "Press-freedom advocacy"], "cpj.org": ["B", "civil_society", "Press-freedom advocacy"], "transparency.org": ["B", "civil_society", "Corruption research"], "civicus.org": ["B", "civil_society", "Civic-space monitoring"], "codeforafrica.org": ["B", "civil_society", "Data journalism"], "civicsignal.africa": ["C", "civil_society", "Media-monitoring project"],
  // ── Multilaterals and official data ──
  "uneca.org": ["B", "multilateral", "UN regional commission"], "afdb.org": ["B", "multilateral", "Development bank"], "au.int": ["B", "multilateral", "Continental body; official positions"], "africacdc.org": ["B", "multilateral", "AU health agency"], "worldbank.org": ["B", "multilateral", "Development bank"], "undp.org": ["B", "multilateral", "UN agency"], "un.org": ["B", "multilateral", "UN"], "reliefweb.int": ["B", "multilateral", "UN OCHA service; aggregates humanitarian reports"],
  "ecowas.int": ["B", "multilateral", "Regional bloc; official positions"], "eac.int": ["B", "multilateral", "Regional bloc; official positions"], "comesa.int": ["B", "multilateral", "Regional bloc; official positions"], "sadc.int": ["B", "multilateral", "Regional bloc; official positions"], "igad.int": ["B", "multilateral", "Regional bloc; official positions"], "nilebasin.org": ["B", "multilateral", "Intergovernmental initiative"],

  // ── Data providers and references ──
  "gdeltproject.org": ["C", "data", "Machine-coded global events", "Broad but noisy; used to find candidates, never as proof on its own."],
  "data.worldbank.org": ["A", "data", "Official statistics publisher", "Primary publisher of World Development Indicators; figures lag and are revised."],
  "frankfurter.dev": ["A", "data", "ECB daily reference rates", "Primary European Central Bank reference rates."],
  "fred.stlouisfed.org": ["A", "data", "US Federal Reserve data", "Primary publisher for energy and rates series."],
  "coingecko.com": ["C", "data", "Market-data aggregator", "Crypto prices vary by venue."],
  "naturalearthdata.com": ["B", "data", "Public-domain boundaries", "Boundaries are cartographic, not legal."],
  "geoboundaries.org": ["B", "data", "Open boundary data (CC BY 4.0)", "Boundaries are cartographic, not legal."],
  "sanctionssearch.ofac.treas.gov": ["A", "data", "Primary sanctions list", "Official US Treasury list."],
  "main.un.org": ["A", "data", "Primary sanctions list", "Official UN Security Council list."],
  "sanctionsmap.eu": ["A", "data", "Primary sanctions list", "Official EU list."],
  "gov.uk": ["A", "data", "Primary sanctions list", "Official UK list."],
  "acleddata.com": ["B", "data", "Hand-coded conflict events; published methodology", "Cross-check for event counts and locations."],
  "ucdp.uu.se": ["B", "data", "Academic conflict data; published methodology", "Conservative fatality counts."],
  "unocha.org": ["B", "multilateral", "UN humanitarian coordination"], "ipcinfo.org": ["B", "multilateral", "Food-security classification partnership"], "data.unhcr.org": ["B", "multilateral", "UN refugee agency data"], "dtm.iom.int": ["B", "multilateral", "UN migration agency displacement data"], "papsrepository.africa-union.org": ["B", "multilateral", "AU Peace and Security Council record"],
};
