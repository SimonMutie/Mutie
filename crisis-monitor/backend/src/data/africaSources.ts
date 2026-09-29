/**
 * Country-by-country (plus pan-African and institutional) source list for
 * the "Africa Wire" crawl — see durableObjects/africaWireActor.ts.
 *
 * This is Simon's own list, supplied verbatim (2026-09-29) as the set of
 * outlets he wants pulled from, one entry per line, grouped by country in
 * the order he sent it. Nothing here is guessed or invented: these are the
 * homepages he provided, tagged with the ISO-3166 country code his own
 * AFRICA_CENTROIDS table (countryEscalation.ts) already uses, so a crawled
 * item can be pinned to that country's centroid.
 *
 * None of these homepages is assumed to expose a working RSS feed — that's
 * what feedDiscovery.ts checks live, per source, before anything is ever
 * shown. A source that turns out to have no discoverable feed is recorded
 * as such (status "no_feed") and simply contributes nothing, rather than
 * being silently dropped from this list or having a feed URL fabricated
 * for it.
 *
 * A handful of exact duplicates from Simon's original list are collapsed
 * to one entry. Sources already wired up directly as hand-verified
 * WIRE_FEEDS in lib/osintFeed.ts (AllAfrica, Radio Dabanga, Sudan Tribune,
 * Africanews, DW, Al Jazeera, BBC) are left out here so they aren't
 * crawled twice.
 */

export interface AfricaSource {
  url: string;
  /** ISO-3166-1 alpha-2 country code matching AFRICA_CENTROIDS, or a
   *  category tag for sources that aren't country-specific. */
  country: string;
}

/** Non-country tags used above the ISO2 codes. */
export const PAN_AFRICAN = "PAN";
export const GLOBAL_AFRICA_DESK = "GLOBAL";
export const INSTITUTION = "INST";

export const AFRICA_SOURCES: AfricaSource[] = [
  // ── Algeria ──
  { url: "https://www.aps.dz/", country: "DZ" },
  { url: "https://www.elwatan.com/", country: "DZ" },
  { url: "https://www.elmoudjahid.dz/", country: "DZ" },
  { url: "https://www.lesoirdalgerie.dz/", country: "DZ" },
  { url: "https://www.tsa-algerie.com/", country: "DZ" },
  { url: "https://www.algerie360.com/", country: "DZ" },
  { url: "https://www.lexpression.dz/", country: "DZ" },
  { url: "https://www.algerie1.com/", country: "DZ" },
  // ── Angola ──
  { url: "https://www.angop.ao/", country: "AO" },
  { url: "https://www.jornaldeangola.ao/", country: "AO" },
  { url: "https://novojornal.co.ao/", country: "AO" },
  { url: "https://expansao.co.ao/", country: "AO" },
  { url: "https://www.verangola.net/", country: "AO" },
  { url: "https://makaangola.org/", country: "AO" },
  { url: "https://www.opais.ao/", country: "AO" },
  // ── Benin ──
  { url: "https://lanation.bj/", country: "BJ" },
  { url: "https://lanouvelletribune.info/", country: "BJ" },
  { url: "https://24haubenin.info/", country: "BJ" },
  { url: "https://matinlibre.com/", country: "BJ" },
  { url: "https://banouto.bj/", country: "BJ" },
  { url: "https://beninwebtv.com/", country: "BJ" },
  { url: "https://leconomistebenin.com/", country: "BJ" },
  // ── Botswana ──
  { url: "https://www.mmegi.bw/", country: "BW" },
  { url: "https://www.sundaystandard.info/", country: "BW" },
  { url: "https://www.thegazette.news/", country: "BW" },
  { url: "https://www.botswanaguardian.co.bw/", country: "BW" },
  { url: "https://www.dailynews.gov.bw/", country: "BW" },
  // ── South Africa ──
  { url: "https://www.sowetanlive.co.za/", country: "ZA" },
  { url: "https://www.sabcnews.com/", country: "ZA" },
  { url: "https://www.enca.com/", country: "ZA" },
  { url: "https://www.news24.com/", country: "ZA" },
  { url: "https://mg.co.za/", country: "ZA" },
  { url: "https://www.dailymaverick.co.za/", country: "ZA" },
  { url: "https://www.businesslive.co.za/", country: "ZA" },
  { url: "https://www.businessday.co.za/", country: "ZA" },
  { url: "https://www.timeslive.co.za/", country: "ZA" },
  { url: "https://www.moneyweb.co.za/", country: "ZA" },
  { url: "https://amabhungane.org/", country: "ZA" },
  { url: "https://groundup.org.za/", country: "ZA" },
  { url: "https://www.iol.co.za/", country: "ZA" },
  { url: "https://www.ewn.co.za/", country: "ZA" },
  // ── Zimbabwe ──
  { url: "https://www.newsday.co.zw/", country: "ZW" },
  { url: "https://www.herald.co.zw/", country: "ZW" },
  { url: "https://www.chronicle.co.zw/", country: "ZW" },
  { url: "https://www.newzimbabwe.com/", country: "ZW" },
  { url: "https://www.theindependent.co.zw/", country: "ZW" },
  // ── Zambia ──
  { url: "https://www.znbc.co.zm/", country: "ZM" },
  { url: "https://www.daily-mail.co.zm/", country: "ZM" },
  { url: "https://www.lusakatimes.com/", country: "ZM" },
  { url: "https://diggers.news/", country: "ZM" },
  { url: "https://www.zambianobserver.com/", country: "ZM" },
  // ── Malawi ──
  { url: "https://www.mwnation.com/", country: "MW" },
  { url: "https://www.nyasatimes.com/", country: "MW" },
  { url: "https://www.zodiakmalawi.com/", country: "MW" },
  { url: "https://www.maravipost.com/", country: "MW" },
  { url: "https://www.publiceyenews.com/", country: "MW" },
  // ── Lesotho ──
  { url: "https://lestimes.com/", country: "LS" },
  { url: "https://www.lesothotimes.com/", country: "LS" },
  // ── Eswatini ──
  { url: "https://www.times.co.sz/", country: "SZ" },
  { url: "https://www.observer.org.sz/", country: "SZ" },
  // ── Namibia ──
  { url: "https://www.namibian.com.na/", country: "NA" },
  { url: "https://neweralive.na/", country: "NA" },
  { url: "https://www.nbc.na/", country: "NA" },
  { url: "https://www.namibiansun.com/", country: "NA" },
  { url: "https://economist.com.na/", country: "NA" },
  { url: "https://www.confidente.com.na/", country: "NA" },
  // ── Mozambique ──
  { url: "https://clubofmozambique.com/", country: "MZ" },
  { url: "https://www.jornalnoticias.co.mz/", country: "MZ" },
  { url: "https://opais.co.mz/", country: "MZ" },
  { url: "https://cartamz.com/", country: "MZ" },
  { url: "https://verdade.co.mz/", country: "MZ" },
  { url: "https://www.moz24h.co.mz/", country: "MZ" },
  // ── Tanzania ──
  { url: "https://www.ippmedia.com/", country: "TZ" },
  { url: "https://www.thecitizen.co.tz/", country: "TZ" },
  { url: "https://dailynews.co.tz/", country: "TZ" },
  { url: "https://www.mwananchi.co.tz/", country: "TZ" },
  { url: "https://www.thechanzo.com/", country: "TZ" },
  { url: "https://www.tbc.go.tz/", country: "TZ" },
  // ── Kenya ──
  { url: "https://www.theeastafrican.co.ke/", country: "KE" },
  { url: "https://nation.africa/", country: "KE" },
  { url: "https://www.standardmedia.co.ke/", country: "KE" },
  { url: "https://www.businessdailyafrica.com/", country: "KE" },
  { url: "https://www.the-star.co.ke/", country: "KE" },
  { url: "https://www.citizen.digital/", country: "KE" },
  { url: "https://www.kbc.co.ke/", country: "KE" },
  { url: "https://www.kenyans.co.ke/", country: "KE" },
  { url: "https://peopledaily.digital/", country: "KE" },
  // ── Uganda ──
  { url: "https://www.monitor.co.ug/", country: "UG" },
  { url: "https://www.newvision.co.ug/", country: "UG" },
  { url: "https://www.independent.co.ug/", country: "UG" },
  { url: "https://nilepost.co.ug/", country: "UG" },
  { url: "https://chimpreports.com/", country: "UG" },
  { url: "https://www.ugandaradionetwork.net/", country: "UG" },
  // ── Rwanda ──
  { url: "https://www.newtimes.co.rw/", country: "RW" },
  { url: "https://www.ktpress.rw/", country: "RW" },
  { url: "https://www.rba.co.rw/", country: "RW" },
  { url: "https://www.kigalitoday.com/", country: "RW" },
  // ── Burundi ──
  { url: "https://www.iwacu-burundi.org/", country: "BI" },
  { url: "https://www.rtnb.bi/", country: "BI" },
  { url: "https://www.sosmediasburundi.org/", country: "BI" },
  // ── Sudan / South Sudan (Sudan Tribune + Radio Dabanga already wired directly) ──
  { url: "https://www.sudanspost.com/", country: "SS" },
  { url: "https://www.radiotamazuj.org/", country: "SS" },
  { url: "https://www.suna-sd.net/", country: "SD" },
  { url: "https://www.alrakoba.net/", country: "SD" },
  { url: "https://darfur24.com/en/", country: "SD" },
  // ── Somalia ──
  { url: "https://www.hiiraan.com/", country: "SO" },
  { url: "https://www.garoweonline.com/", country: "SO" },
  { url: "https://www.horndiplomat.com/", country: "SO" },
  { url: "https://www.goobjoog.com/", country: "SO" },
  { url: "https://www.radiodalsan.com/", country: "SO" },
  { url: "https://www.somaliguardian.com/", country: "SO" },
  // ── Ethiopia ──
  { url: "https://ethiopia-insight.com/", country: "ET" },
  { url: "https://addisstandard.com/", country: "ET" },
  { url: "https://www.thereporterethiopia.com/", country: "ET" },
  { url: "https://www.fanabc.com/", country: "ET" },
  { url: "https://www.ena.et/", country: "ET" },
  { url: "https://www.capitalethiopia.com/", country: "ET" },
  { url: "https://www.borkena.com/", country: "ET" },
  // ── Djibouti ──
  { url: "https://www.djiboutipost.com/", country: "DJ" },
  { url: "https://www.lanation.dj/", country: "DJ" },
  { url: "https://www.adi.dj/", country: "DJ" },
  { url: "https://www.rtd.dj/", country: "DJ" },
  // ── Seychelles ──
  { url: "https://www.seychellesnewsagency.com/", country: "SC" },
  { url: "https://www.nation.sc/", country: "SC" },
  { url: "https://www.sbc.sc/", country: "SC" },
  // ── Mauritius ──
  { url: "https://www.lemauricien.com/", country: "MU" },
  { url: "https://www.lexpress.mu/", country: "MU" },
  { url: "https://defimedia.info/", country: "MU" },
  { url: "https://www.mbcradio.tv/", country: "MU" },
  // ── Madagascar ──
  { url: "https://www.madagascar-tribune.com/", country: "MG" },
  { url: "https://2424.mg/", country: "MG" },
  { url: "https://www.midi-madagasikara.mg/", country: "MG" },
  { url: "https://www.newsmada.com/", country: "MG" },
  // ── Liberia ──
  { url: "https://www.liberianobserver.com/", country: "LR" },
  { url: "https://frontpageafricaonline.com/", country: "LR" },
  { url: "https://www.liberianinquirer.com/", country: "LR" },
  { url: "https://newrepublicliberia.com/", country: "LR" },
  // ── Sierra Leone ──
  { url: "https://sierraloaded.sl/", country: "SL" },
  { url: "https://awokonewspaper.sl/", country: "SL" },
  { url: "https://sierraleonetimes.com/", country: "SL" },
  { url: "https://www.thesierraleonetelegraph.com/", country: "SL" },
  // ── Gambia ──
  { url: "https://www.thepoint.gm/", country: "GM" },
  { url: "https://standard.gm/", country: "GM" },
  { url: "https://foroyaa.net/", country: "GM" },
  { url: "https://fatunetwork.net/", country: "GM" },
  { url: "https://kerrfatou.com/", country: "GM" },
  // ── Ghana ──
  { url: "https://www.graphic.com.gh/", country: "GH" },
  { url: "https://www.myjoyonline.com/", country: "GH" },
  { url: "https://www.3news.com/", country: "GH" },
  { url: "https://www.citinewsroom.com/", country: "GH" },
  { url: "https://www.ghanaweb.com/", country: "GH" },
  { url: "https://www.pulse.com.gh/", country: "GH" },
  { url: "https://www.ghanabusinessnews.com/", country: "GH" },
  { url: "https://www.thefourthestategh.com/", country: "GH" },
  { url: "https://www.ghanaiantimes.com.gh/", country: "GH" },
  // ── Nigeria ──
  { url: "https://www.premiumtimesng.com/", country: "NG" },
  { url: "https://punchng.com/", country: "NG" },
  { url: "https://guardian.ng/", country: "NG" },
  { url: "https://www.thisdaylive.com/", country: "NG" },
  { url: "https://www.vanguardngr.com/", country: "NG" },
  { url: "https://www.channelstv.com/", country: "NG" },
  { url: "https://www.arise.tv/", country: "NG" },
  { url: "https://www.thecable.ng/", country: "NG" },
  { url: "https://www.dailytrust.com/", country: "NG" },
  { url: "https://tribuneonlineng.com/", country: "NG" },
  { url: "https://businessday.ng/", country: "NG" },
  { url: "https://nairametrics.com/", country: "NG" },
  { url: "https://www.icirnigeria.org/", country: "NG" },
  { url: "https://humanglemedia.com/", country: "NG" },
  { url: "https://www.dataphyte.com/", country: "NG" },
  { url: "https://www.ripplesnigeria.com/", country: "NG" },
  // ── Senegal ──
  { url: "https://www.seneweb.com/", country: "SN" },
  { url: "https://www.lequotidien.sn/", country: "SN" },
  { url: "https://www.sudonline.sn/", country: "SN" },
  { url: "https://www.enqueteplus.com/", country: "SN" },
  { url: "https://www.dakaractu.com/", country: "SN" },
  { url: "https://www.pressafrik.com/", country: "SN" },
  { url: "https://www.seneplus.com/", country: "SN" },
  { url: "https://www.igfm.sn/", country: "SN" },
  { url: "https://www.rts.sn/", country: "SN" },
  { url: "https://www.aps.sn/", country: "SN" },
  // ── Mali ──
  { url: "https://www.maliweb.net/", country: "ML" },
  { url: "https://malijet.com/", country: "ML" },
  { url: "https://www.studiotamani.org/", country: "ML" },
  { url: "https://www.journaldumali.com/", country: "ML" },
  { url: "https://www.bamada.net/", country: "ML" },
  { url: "https://www.lessor.ml/", country: "ML" },
  // ── Burkina Faso ──
  { url: "https://lefaso.net/", country: "BF" },
  { url: "https://www.sidwaya.info/", country: "BF" },
  { url: "https://lepays.bf/", country: "BF" },
  { url: "https://burkina24.com/", country: "BF" },
  { url: "https://www.wakatsera.com/", country: "BF" },
  { url: "https://www.aib.media/", country: "BF" },
  { url: "https://leconomistedufaso.com/", country: "BF" },
  // ── Niger ──
  { url: "https://www.actuniger.com/", country: "NE" },
  { url: "https://www.lesahel.org/", country: "NE" },
  { url: "https://www.anp.ne/", country: "NE" },
  { url: "https://www.tamtaminfo.com/", country: "NE" },
  // ── Mauritania ──
  { url: "https://www.saharamedias.net/", country: "MR" },
  { url: "https://alakhbar.info/", country: "MR" },
  { url: "https://ami.mr/", country: "MR" },
  { url: "https://www.cridem.org/", country: "MR" },
  // ── Togo ──
  { url: "https://www.togoweb.net/", country: "TG" },
  { url: "https://togomatin.tg/", country: "TG" },
  { url: "https://www.republicoftogo.com/", country: "TG" },
  { url: "https://www.icilome.com/", country: "TG" },
  { url: "https://www.togobreakingnews.info/", country: "TG" },
  { url: "https://www.togotopnews.com/", country: "TG" },
  { url: "https://www.togofirst.com/", country: "TG" },
  // ── Guinea ──
  { url: "https://www.guineenews.org/", country: "GN" },
  { url: "https://guineematin.com/", country: "GN" },
  { url: "https://mediaguinee.org/", country: "GN" },
  { url: "https://www.africaguinee.com/", country: "GN" },
  { url: "https://ledjely.com/", country: "GN" },
  { url: "https://www.visionguinee.info/", country: "GN" },
  // ── Cameroon ──
  { url: "https://www.crtv.cm/", country: "CM" },
  { url: "https://www.cameroon-tribune.cm/", country: "CM" },
  { url: "https://www.journalducameroun.com/", country: "CM" },
  { url: "https://actucameroun.com/", country: "CM" },
  { url: "https://www.cameroonconcord.com/", country: "CM" },
  { url: "https://www.cameroonintelligencereport.com/", country: "CM" },
  { url: "https://www.businessincameroon.com/", country: "CM" },
  { url: "https://www.investiraucameroun.com/", country: "CM" },
  // ── Congo-Brazzaville ──
  { url: "https://www.adiac-congo.com/", country: "CG" },
  { url: "https://www.lesdepechesdebrazzaville.fr/", country: "CG" },
  { url: "https://www.congo-site.com/", country: "CG" },
  { url: "https://www.aci.cg/", country: "CG" },
  { url: "https://www.lesechos-congobrazza.com/", country: "CG" },
  // ── DR Congo ──
  { url: "https://actualite.cd/", country: "CD" },
  { url: "https://www.radiookapi.net/", country: "CD" },
  { url: "https://www.7sur7.cd/", country: "CD" },
  { url: "https://www.mediacongo.net/", country: "CD" },
  { url: "https://www.politico.cd/", country: "CD" },
  { url: "https://www.lepotentiel.cd/", country: "CD" },
  { url: "https://www.forumdesas.net/", country: "CD" },
  { url: "https://www.topcongo.fm/", country: "CD" },
  // ── Gabon ──
  { url: "https://www.gabonreview.com/", country: "GA" },
  { url: "https://www.gabonmediatime.com/", country: "GA" },
  { url: "https://www.gabonactu.com/", country: "GA" },
  { url: "https://www.lenouveaugabon.com/", country: "GA" },
  { url: "https://www.infosgabon.com/", country: "GA" },
  { url: "https://www.gabon24.com/", country: "GA" },
  // ── Equatorial Guinea ──
  { url: "https://www.guineaecuatorialpress.com/", country: "GQ" },
  { url: "https://www.radiomacuto.net/", country: "GQ" },
  { url: "https://www.ahoraeg.com/", country: "GQ" },
  // ── Egypt ──
  { url: "https://www.madamasr.com/", country: "EG" },
  { url: "https://english.ahram.org.eg/", country: "EG" },
  { url: "https://www.almasryalyoum.com/", country: "EG" },
  { url: "https://www.dailynewsegypt.com/", country: "EG" },
  { url: "https://enterprise.press/", country: "EG" },
  { url: "https://www.egypttoday.com/", country: "EG" },
  { url: "https://www.egypt-business.com/", country: "EG" },
  // ── Libya ──
  { url: "https://libyaobserver.ly/", country: "LY" },
  { url: "https://www.libyaherald.com/", country: "LY" },
  { url: "https://alwasat.ly/", country: "LY" },
  { url: "https://www.218tv.net/", country: "LY" },
  { url: "https://www.afrigatenews.net/", country: "LY" },
  // ── Morocco ──
  { url: "https://www.moroccoworldnews.com/", country: "MA" },
  { url: "https://en.hespress.com/", country: "MA" },
  { url: "https://telquel.ma/", country: "MA" },
  { url: "https://www.leconomiste.com/", country: "MA" },
  { url: "https://medias24.com/", country: "MA" },
  { url: "https://www.yabiladi.com/", country: "MA" },
  { url: "https://www.mapnews.ma/", country: "MA" },
  { url: "https://www.challenge.ma/", country: "MA" },
  { url: "https://www.leseco.ma/", country: "MA" },
  // ── Tunisia ──
  { url: "https://www.tap.info.tn/", country: "TN" },
  { url: "https://www.tunisienumerique.com/", country: "TN" },
  { url: "https://www.businessnews.com.tn/", country: "TN" },
  { url: "https://www.webdo.tn/", country: "TN" },
  { url: "https://www.leaders.com.tn/", country: "TN" },
  { url: "https://www.kapitalis.com/", country: "TN" },
  { url: "https://www.mosaiquefm.net/", country: "TN" },
  { url: "https://www.lapresse.tn/", country: "TN" },
  { url: "https://www.assabahnews.tn/", country: "TN" },
  // ── Sao Tome and Principe ──
  { url: "https://www.telanon.info/", country: "ST" },
  { url: "https://www.stp-press.st/", country: "ST" },

  // ── Pan-African / regional ──
  { url: "https://www.reuters.com/world/africa/", country: PAN_AFRICAN },
  { url: "https://www.bbc.com/news/world/africa", country: PAN_AFRICAN },
  { url: "https://apnews.com/hub/africa", country: PAN_AFRICAN },
  { url: "https://www.aljazeera.com/where/africa/", country: PAN_AFRICAN },
  { url: "https://www.france24.com/en/africa/", country: PAN_AFRICAN },
  { url: "https://www.rfi.fr/en/africa/", country: PAN_AFRICAN },
  { url: "https://www.voanews.com/africa", country: PAN_AFRICAN },
  { url: "https://www.jeuneafrique.com/", country: PAN_AFRICAN },
  { url: "https://www.theafricareport.com/", country: PAN_AFRICAN },
  { url: "https://africa-confidential.com/", country: PAN_AFRICAN },
  { url: "https://www.africanbusiness.com/", country: PAN_AFRICAN },
  { url: "https://www.thecontinent.org/", country: PAN_AFRICAN },
  { url: "https://www.africanarguments.org/", country: PAN_AFRICAN },
  { url: "https://www.africaintelligence.com/", country: PAN_AFRICAN },
  { url: "https://www.african-markets.com/", country: PAN_AFRICAN },
  { url: "https://www.africacheck.org/", country: PAN_AFRICAN },
  { url: "https://africanofilter.org/", country: PAN_AFRICAN },
  { url: "https://www.pambazuka.org/", country: PAN_AFRICAN },
  { url: "https://www.panapress.com/", country: PAN_AFRICAN },
  { url: "https://www.thenewhumanitarian.org/africa", country: PAN_AFRICAN },
  { url: "https://www.mongabay.com/africa/", country: PAN_AFRICAN },

  // ── Think tanks, research institutes, policy & multilateral bodies ──
  // Lower publishing frequency than newsrooms above, and several may
  // expose no RSS feed at all — the crawl records that per source rather
  // than guessing a feed URL for them.
  { url: "https://issafrica.org/", country: INSTITUTION },
  { url: "https://www.saiia.org.za/", country: INSTITUTION },
  { url: "https://www.acetforafrica.org/", country: INSTITUTION },
  { url: "https://mo.ibrahim.foundation/", country: INSTITUTION },
  { url: "https://www.afrobarometer.org/", country: INSTITUTION },
  { url: "https://www.accord.org.za/", country: INSTITUTION },
  { url: "https://www.africacenter.org/", country: INSTITUTION },
  { url: "https://www.ipss-addis.org/", country: INSTITUTION },
  { url: "https://www.africanpeacebuildingnetwork.org/", country: INSTITUTION },
  { url: "https://www.thebrenthurstfoundation.org/", country: INSTITUTION },
  { url: "https://www.africanleadershipcentre.org/", country: INSTITUTION },
  { url: "https://www.africaportal.org/", country: INSTITUTION },
  { url: "https://www.tralac.org/", country: INSTITUTION },
  { url: "https://www.odi.org/regions/africa", country: INSTITUTION },
  { url: "https://www.chathamhouse.org/regions/africa", country: INSTITUTION },
  { url: "https://www.crisisgroup.org/africa", country: INSTITUTION },
  { url: "https://carnegieendowment.org/regions/africa", country: INSTITUTION },
  { url: "https://www.brookings.edu/topic/africa/", country: INSTITUTION },
  { url: "https://www.csis.org/regions/africa", country: INSTITUTION },
  { url: "https://www.cfr.org/africa", country: INSTITUTION },
  { url: "https://www.rand.org/topics/africa.html", country: INSTITUTION },
  { url: "https://www.uneca.org/", country: INSTITUTION },
  { url: "https://www.afdb.org/", country: INSTITUTION },
  { url: "https://au.int/", country: INSTITUTION },
  { url: "https://africacdc.org/", country: INSTITUTION },
  { url: "https://www.worldbank.org/en/region/afr", country: INSTITUTION },
  { url: "https://www.undp.org/africa", country: INSTITUTION },
  { url: "https://www.un.org/africarenewal/", country: INSTITUTION },
  { url: "https://reliefweb.int/country/africa", country: INSTITUTION },
  { url: "https://www.hrw.org/africa", country: INSTITUTION },
  { url: "https://www.amnesty.org/en/location/africa/", country: INSTITUTION },
  { url: "https://rsf.org/en/region/africa", country: INSTITUTION },
  { url: "https://cpj.org/africa/", country: INSTITUTION },
  { url: "https://www.transparency.org/en/regions/africa", country: INSTITUTION },
  { url: "https://www.civicus.org/", country: INSTITUTION },
  { url: "https://www.codeforafrica.org/", country: INSTITUTION },
  { url: "https://civicsignal.africa/", country: INSTITUTION },
  { url: "https://www.ecowas.int/", country: INSTITUTION },
  { url: "https://www.eac.int/", country: INSTITUTION },
  { url: "https://www.comesa.int/", country: INSTITUTION },
  { url: "https://www.sadc.int/", country: INSTITUTION },
  { url: "https://igad.int/", country: INSTITUTION },
  { url: "https://www.nilebasin.org/", country: INSTITUTION },
];
