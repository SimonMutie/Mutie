/**
 * A curated, hand-verified list of specific sub-national places — cities,
 * towns and named regions — that actually appear in current African conflict
 * reporting, each pinned to its real coordinates and its OWN country.
 *
 * Why this exists: Simon's direct report — "Ethiopia forces near Mekelle
 * should not be popping up in Djibouti" — is a GDELT geocoding artifact of
 * exactly the kind this app has fixed before (Yemen's Taiz battle geocoded
 * onto Sudan's coast; a Ghana story geocoded onto South Africa), but this
 * specific case slips past both of those earlier fixes: Ethiopia and
 * Djibouti are frequently named TOGETHER in completely legitimate context
 * (Djibouti is Ethiopia's main port and trade corridor, so a story about
 * ENDF/TDF fighting near Mekelle very plausibly also mentions Djibouti —
 * logistics, the Red Sea corridor, refugee routes), so
 * isLikelyWrongCountryUrl's old logic ("the slug names the target country
 * at all -> trust it") would see "Djibouti" named in the slug and stop
 * looking, never noticing "Mekelle" sitting right next to it. A bare
 * country-name check can't tell "this article is ABOUT Djibouti" apart from
 * "this article is about Ethiopia and merely MENTIONS Djibouti" — a named,
 * specific place can: "Mekelle" is unambiguously Ethiopian soil, full stop,
 * however many other countries get mentioned alongside it in the same
 * sentence.
 *
 * This is deliberately a hand-picked list of currently-relevant conflict
 * hotspots (the same standard applied to NON_STATE_ARMED_GROUPS in
 * escalationKeywords.ts — real actors/places that actually appear in
 * current reporting, not an exhaustive gazetteer of every town in Africa)
 * rather than a geocoding API call: this data has no network access for
 * arbitrary lookups at ingestion/scoring time, and a wrong or over-broad
 * entry here is worse than a missing one (a common word mistaken for a
 * place name would reintroduce exactly the kind of false positive this
 * whole file exists to prevent). Add to it, the same way NON_STATE_ARMED_
 * GROUPS gets added to, whenever a real, currently-reported conflict
 * location is confirmed missing.
 */

export interface GazetteerPlace {
  /** Display name as it should appear in a summary ("near Mekelle"). */
  name: string;
  /** ISO-3166-1 alpha-2 code, matching AFRICA_COUNTRIES/AFRICA_CENTROIDS. */
  country: string;
  lat: number;
  lon: number;
}

export const CONFLICT_GAZETTEER: GazetteerPlace[] = [
  // Ethiopia — Tigray war, Amhara/Fano conflict, Oromia/OLA insurgency,
  // Benishangul-Gumuz/Metekel violence
  { name: "Mekelle", country: "ET", lat: 13.4967, lon: 39.4753 },
  { name: "Adigrat", country: "ET", lat: 14.2781, lon: 39.4621 },
  { name: "Shire", country: "ET", lat: 14.1061, lon: 38.285 },
  { name: "Axum", country: "ET", lat: 14.1211, lon: 38.7268 },
  { name: "Humera", country: "ET", lat: 14.299, lon: 36.6136 },
  { name: "Alamata", country: "ET", lat: 12.4186, lon: 39.5544 },
  { name: "Dessie", country: "ET", lat: 11.1333, lon: 39.6333 },
  { name: "Kombolcha", country: "ET", lat: 11.0833, lon: 39.7333 },
  { name: "Woldiya", country: "ET", lat: 11.8333, lon: 39.6 },
  { name: "Bahir Dar", country: "ET", lat: 11.5936, lon: 37.3908 },
  { name: "Gondar", country: "ET", lat: 12.609, lon: 37.4656 },
  { name: "Debre Tabor", country: "ET", lat: 11.85, lon: 38.0167 },
  { name: "Metekel", country: "ET", lat: 10.8, lon: 36.3 },
  { name: "Benishangul-Gumuz", country: "ET", lat: 10.77, lon: 35.56 },
  { name: "Afar Region", country: "ET", lat: 11.75, lon: 41.05 },
  { name: "Tigray Region", country: "ET", lat: 13.9, lon: 39.6 },
  { name: "Amhara Region", country: "ET", lat: 11.6, lon: 38.0 },
  { name: "Oromia Region", country: "ET", lat: 8.0, lon: 39.5 },
  { name: "Gambela", country: "ET", lat: 8.25, lon: 34.5833 },
  // Sudan — RSF/SAF civil war, Darfur
  { name: "El Fasher", country: "SD", lat: 13.6281, lon: 25.3491 },
  { name: "Nyala", country: "SD", lat: 12.05, lon: 24.8833 },
  { name: "El Geneina", country: "SD", lat: 13.4524, lon: 22.4474 },
  { name: "Zalingei", country: "SD", lat: 12.9104, lon: 23.4714 },
  { name: "Darfur", country: "SD", lat: 13.0, lon: 24.0 },
  { name: "North Darfur", country: "SD", lat: 15.5, lon: 25.5 },
  { name: "South Kordofan", country: "SD", lat: 11.0, lon: 29.75 },
  { name: "Kordofan", country: "SD", lat: 13.0, lon: 29.5 },
  { name: "Khartoum", country: "SD", lat: 15.5007, lon: 32.5599 },
  { name: "Omdurman", country: "SD", lat: 15.6445, lon: 32.4777 },
  { name: "Port Sudan", country: "SD", lat: 19.6158, lon: 37.2164 },
  { name: "Wad Madani", country: "SD", lat: 14.4012, lon: 33.5199 },
  // South Sudan
  { name: "Juba", country: "SS", lat: 4.8517, lon: 31.5825 },
  { name: "Bentiu", country: "SS", lat: 9.2333, lon: 29.8333 },
  { name: "Malakal", country: "SS", lat: 9.5334, lon: 31.6605 },
  { name: "Upper Nile", country: "SS", lat: 9.5, lon: 32.5 },
  { name: "Unity State", country: "SS", lat: 8.9, lon: 29.7 },
  { name: "Pibor", country: "SS", lat: 6.8, lon: 33.1333 },
  // DRC — M23/Great Lakes conflict
  { name: "Goma", country: "CD", lat: -1.6792, lon: 29.2228 },
  { name: "Bukavu", country: "CD", lat: -2.5083, lon: 28.8608 },
  { name: "Beni", country: "CD", lat: 0.4919, lon: 29.4728 },
  { name: "Butembo", country: "CD", lat: 0.1167, lon: 29.2833 },
  { name: "Ituri", country: "CD", lat: 1.5, lon: 29.5 },
  { name: "North Kivu", country: "CD", lat: -0.5, lon: 29.2 },
  { name: "South Kivu", country: "CD", lat: -3.0, lon: 28.5 },
  { name: "Rutshuru", country: "CD", lat: -1.1833, lon: 29.45 },
  // Somalia — al-Shabaab insurgency
  { name: "Mogadishu", country: "SO", lat: 2.0469, lon: 45.3182 },
  { name: "Kismayo", country: "SO", lat: -0.3582, lon: 42.5454 },
  { name: "Baidoa", country: "SO", lat: 3.1167, lon: 43.65 },
  { name: "Beledweyne", country: "SO", lat: 4.7358, lon: 45.2034 },
  { name: "Galkayo", country: "SO", lat: 6.7697, lon: 47.4308 },
  { name: "Jubaland", country: "SO", lat: 0.5, lon: 42.5 },
  // Mali — JNIM/ISGS insurgency
  { name: "Gao", country: "ML", lat: 16.2719, lon: -0.0437 },
  { name: "Timbuktu", country: "ML", lat: 16.7666, lon: -3.0026 },
  { name: "Kidal", country: "ML", lat: 18.4411, lon: 1.4078 },
  { name: "Mopti", country: "ML", lat: 14.4843, lon: -4.1951 },
  { name: "Menaka", country: "ML", lat: 15.9183, lon: 2.4017 },
  // Burkina Faso
  { name: "Djibo", country: "BF", lat: 14.1022, lon: -1.6256 },
  { name: "Ouahigouya", country: "BF", lat: 13.5828, lon: -2.4217 },
  // Niger
  { name: "Diffa", country: "NE", lat: 13.3154, lon: 12.6113 },
  { name: "Tillaberi", country: "NE", lat: 14.2097, lon: 1.4528 },
  // Nigeria — Boko Haram/ISWAP, Lake Chad basin
  { name: "Maiduguri", country: "NG", lat: 11.8333, lon: 13.15 },
  { name: "Borno State", country: "NG", lat: 11.5, lon: 13.0 },
  { name: "Chibok", country: "NG", lat: 10.8667, lon: 12.85 },
  // Cameroon — Ambazonia/Anglophone crisis, Lake Chad basin
  { name: "Bamenda", country: "CM", lat: 5.9631, lon: 10.1591 },
  { name: "Buea", country: "CM", lat: 4.1527, lon: 9.241 },
  // Mozambique — Cabo Delgado insurgency
  { name: "Cabo Delgado", country: "MZ", lat: -12.3, lon: 39.3 },
  { name: "Palma", country: "MZ", lat: -10.7536, lon: 40.4713 },
  { name: "Mocimboa da Praia", country: "MZ", lat: -11.3433, lon: 40.3511 },
  // Central African Republic
  { name: "Bangui", country: "CF", lat: 4.3947, lon: 18.5582 },
  // Libya
  { name: "Tripoli", country: "LY", lat: 32.8872, lon: 13.1913 },
  { name: "Benghazi", country: "LY", lat: 32.1167, lon: 20.0667 },
  { name: "Sirte", country: "LY", lat: 31.2089, lon: 16.5887 },
  // Egypt — Sinai insurgency
  { name: "Sinai", country: "EG", lat: 29.5, lon: 34.0 },
  { name: "El Arish", country: "EG", lat: 31.1313, lon: 33.7985 },
];

/** Escapes regex metacharacters and builds a case-insensitive, word-
 *  boundary-safe matcher for one gazetteer place name. Deliberately a small
 *  standalone copy of escalationKeywords.ts's termToRegex rather than an
 *  import from it — that file imports THIS one (for the wrong-country
 *  check), so importing back would be circular. */
function placeToRegex(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/ /g, "\\s+").replace(/-/g, "[\\s-]?");
  return new RegExp(`\\b${pattern}\\b`, "i");
}

const GAZETTEER_PATTERNS: { place: GazetteerPlace; rx: RegExp }[] = CONFLICT_GAZETTEER.map((place) => ({
  place,
  rx: placeToRegex(place.name),
}));

/** Every gazetteer place whose name appears in `text` (word-boundary-safe,
 *  case-insensitive). Used both to catch a wrong-country GDELT bucketing
 *  (escalationKeywords.ts's isLikelyWrongCountryUrl) and to re-geolocate a
 *  confirmed event to the real place its own article text names
 *  (countryEscalation.ts's getCountryEscalationEvidence), instead of
 *  trusting GDELT's own place_name/lat/lon fields, which is what actually
 *  produced the Ethiopia-forces-near-Mekelle-showing-in-Djibouti report. */
export function findGazetteerMatches(text: string): GazetteerPlace[] {
  if (!text) return [];
  const found: GazetteerPlace[] = [];
  for (const { place, rx } of GAZETTEER_PATTERNS) {
    if (rx.test(text)) found.push(place);
  }
  return found;
}
