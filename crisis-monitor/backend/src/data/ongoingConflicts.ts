/**
 * Provinces where armed conflict has been going on for a long time. They are shaded as "ongoing" even on a day
 * with no fresh reports, so a quiet news day does not make a war look over. Provinces with fresh fighting in the
 * last 48 hours are shaded more strongly on top of this (see lib/conflictZones.ts).
 *
 * This list is kept by hand, from the platform's analysts. It was last reviewed on the date below; edit it when
 * the situation changes. Names must match data/provinces.json exactly.
 */
export const ONGOING_REVIEWED = "2026-10-09";

/** [country code, province name, what the conflict is] */
export const ONGOING_CONFLICT_PROVINCES: [string, string, string][] = [
  // Nigeria
  ["NG", "Borno", "Boko Haram / ISWAP insurgency"],
  ["NG", "Yobe", "Boko Haram / ISWAP insurgency"],
  ["NG", "Adamawa", "Boko Haram / ISWAP insurgency"],
  ["NG", "Zamfara", "Banditry and mass kidnapping"],
  ["NG", "Katsina", "Banditry and mass kidnapping"],
  ["NG", "Sokoto", "Banditry, Lakurawa and other armed groups"],
  ["NG", "Kebbi", "Banditry, Lakurawa and other armed groups"],
  ["NG", "Niger", "Banditry and jihadist activity"],
  ["NG", "Kaduna", "Banditry and communal attacks"],
  ["NG", "Plateau", "Farmer-herder and communal violence"],
  ["NG", "Benue", "Farmer-herder and communal violence"],
  // DR Congo
  ["CD", "North Kivu", "M23 and other armed groups against the army"],
  ["CD", "South Kivu", "M23 and other armed groups against the army"],
  ["CD", "Ituri", "ADF and CODECO attacks on civilians"],
  // Sudan
  ["SD", "North Darfur", "Army versus the Rapid Support Forces"],
  ["SD", "Southern Darfur", "Army versus the Rapid Support Forces"],
  ["SD", "Western Darfur", "Army versus the Rapid Support Forces"],
  ["SD", "Central Darfur", "Army versus the Rapid Support Forces"],
  ["SD", "Eastern Darfur", "Army versus the Rapid Support Forces"],
  ["SD", "North Kordufan", "Army versus the Rapid Support Forces"],
  ["SD", "South Kordufan", "Army, RSF and SPLM-N fighting"],
  ["SD", "Blue Nile", "Army, RSF and SPLM-N fighting"],
  ["SD", "Khartoum", "Aftermath and fighting around the capital"],
  // South Sudan
  ["SS", "Upper Nile", "Government forces versus opposition and White Army"],
  ["SS", "Jonglei", "Government forces versus opposition and communal violence"],
  ["SS", "Unity", "Government forces versus opposition"],
  // Ethiopia
  ["ET", "Amhara", "Fano insurgency and federal operations"],
  ["ET", "Tigray", "Fragile post-war settlement and armed tension"],
  ["ET", "Oromiya", "Oromo Liberation Army insurgency"],
  // Somalia
  ["SO", "Gedo", "Al-Shabaab insurgency"],
  ["SO", "Jubbada Hoose", "Al-Shabaab insurgency"],
  ["SO", "Jubbada Dhexe", "Al-Shabaab insurgency"],
  ["SO", "Shabeellaha Hoose", "Al-Shabaab insurgency"],
  ["SO", "Shabeellaha Dhexe", "Al-Shabaab insurgency"],
  ["SO", "Hiiraan", "Al-Shabaab insurgency"],
  ["SO", "Galguduud", "Al-Shabaab insurgency"],
  ["SO", "Mudug", "Al-Shabaab insurgency"],
  ["SO", "Bakool", "Al-Shabaab insurgency"],
  ["SO", "Bay", "Al-Shabaab insurgency"],
  // Sahel and Lake Chad
  ["ML", "Gao", "JNIM and Islamic State Sahel against the army"],
  ["ML", "Timbuktu", "JNIM and Islamic State Sahel against the army"],
  ["ML", "Kidal", "Armed groups and army"],
  ["ML", "Mopti", "JNIM and Islamic State Sahel against the army"],
  ["ML", "Ségou", "JNIM against the army"],
  ["ML", "Kayes", "JNIM attacks in the west"],
  ["BF", "Soum", "Jihadist insurgency"],
  ["BF", "Oudalan", "Jihadist insurgency"],
  ["BF", "Séno", "Jihadist insurgency"],
  ["BF", "Yagha", "Jihadist insurgency"],
  ["BF", "Loroum", "Jihadist insurgency"],
  ["BF", "Yatenga", "Jihadist insurgency"],
  ["BF", "Sourou", "Jihadist insurgency"],
  ["BF", "Kossi", "Jihadist insurgency"],
  ["BF", "Tapoa", "Jihadist insurgency"],
  ["BF", "Gourma", "Jihadist insurgency"],
  ["NE", "Tillabéri", "Islamic State Sahel and JNIM attacks"],
  ["NE", "Diffa", "Boko Haram / ISWAP"],
  ["NE", "Tahoua", "Armed group attacks"],
  ["TD", "Lac", "Boko Haram / ISWAP"],
  ["CM", "Extrême-Nord", "Boko Haram / ISWAP"],
  ["CM", "Nord-Ouest", "Separatist conflict"],
  ["CM", "Sud-Ouest", "Separatist conflict"],
  // Other
  ["MZ", "Cabo Delgado", "Insurgency (IS-Mozambique)"],
  ["CF", "Haut-Mbomou", "Armed groups"],
  ["CF", "Haute-Kotto", "Armed groups"],
  ["CF", "Vakaga", "Armed groups"],
  ["LY", "Az Zawiyah", "Militia clashes around Tripoli"],
  ["LY", "Al Jifarah", "Militia clashes around Tripoli"],
  // Middle East
  ["YE", "Sa`dah", "Houthi-controlled north against the government and Saudi-led forces"],
  ["YE", "Al Hudaydah", "Red Sea coast, Houthi-controlled; strikes and shipping attacks"],
  ["YE", "Hajjah", "Frontline"],
  ["YE", "Al Jawf", "Frontline"],
  ["YE", "Ma'rib", "Frontline"],
  ["YE", "Ta`izz", "Frontline"],
  ["YE", "Al Bayda'", "Frontline"],
  ["YE", "Al Dali'", "Frontline"],
  ["YE", "Sana'a", "Houthi-held capital region; airstrikes"],
  ["YE", "Amanat Al Asimah", "Houthi-held capital; airstrikes"],
  ["YE", "Shabwah", "Armed groups"],
  ["YE", "Abyan", "Armed groups"],
  ["SY", "Idlib", "Armed factions"],
  ["SY", "Aleppo", "Armed factions and foreign forces"],
  ["SY", "Ar Raqqah", "Armed factions and foreign forces"],
  ["SY", "Dayr Az Zawr", "Armed factions and foreign forces"],
  ["SY", "Hasaka (Al Haksa)", "Armed factions and foreign forces"],
  ["SY", "Lattakia", "Sectarian violence"],
  ["SY", "Tartus", "Sectarian violence"],
  ["SY", "Homs (Hims)", "Sectarian violence"],
  ["SY", "Hamah", "Sectarian violence"],
  ["SY", "As Suwayda'", "Druze militias and government forces"],
  ["SY", "Dar`a", "Armed groups and Israeli strikes"],
  ["SY", "Quneitra", "Israeli operations"],
  ["PS", "Gaza Strip", "Israeli military operations"],
  ["PS", "West Bank", "Raids, settler violence and armed clashes"],
  ["LB", "South Lebanon", "Israel–Hezbollah border front"],
  ["LB", "An Nabatiyah", "Israel–Hezbollah border front"],
  ["LB", "Beqaa", "Israeli strikes"],
  ["IL", "HaZafon", "Northern border with Lebanon"],
];

/** Sea areas drawn as approximate shipping-attack zones, [lat, lon] corners. Not a boundary of anything. */
export const MARITIME_THREAT_ZONES: { id: string; name: string; note: string; ring: [number, number][] }[] = [
  {
    id: "red-sea-south",
    name: "Southern Red Sea & Bab al-Mandab",
    note: "Attacks on shipping linked to the Yemen conflict (approximate area)",
    ring: [[12.0, 42.6], [13.5, 43.5], [15.6, 42.3], [17.8, 40.6], [17.8, 39.4], [14.5, 40.4], [12.0, 41.2]],
  },
];
