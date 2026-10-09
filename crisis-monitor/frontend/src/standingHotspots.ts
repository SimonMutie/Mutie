/**
 * Long-running flashpoints in Africa and the Middle East, drawn as a reference layer on Live Intel.
 *
 * These are NOT live alerts. They are a hand-kept list of places where conflict has been ongoing for a long time,
 * so the map shows where to look even on a quiet day. Live, verified escalations appear in the alert layers
 * and never come from this list. Review it from time to time; it only reflects what the platform's maintainers
 * last wrote down.
 */
export interface StandingHotspot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: "Africa" | "Middle East";
  note: string;
}

export const STANDING_HOTSPOTS: StandingHotspot[] = [
  { id: "sudan-darfur", name: "Sudan — Darfur & Kordofan", lat: 13.6, lon: 25.3, region: "Africa", note: "War between the Sudanese army and the Rapid Support Forces; mass displacement and famine conditions." },
  { id: "sudan-khartoum", name: "Sudan — Khartoum & Gezira", lat: 15.5, lon: 32.55, region: "Africa", note: "Front line of the army–RSF war." },
  { id: "south-sudan", name: "South Sudan — Upper Nile", lat: 9.9, lon: 32.7, region: "Africa", note: "Political crisis and armed clashes between government and opposition forces." },
  { id: "drc-east", name: "DR Congo — North & South Kivu", lat: -1.7, lon: 29.0, region: "Africa", note: "M23 and other armed groups against the army; large displacement." },
  { id: "drc-ituri", name: "DR Congo — Ituri", lat: 1.6, lon: 30.2, region: "Africa", note: "ADF and CODECO attacks on civilians." },
  { id: "somalia-south", name: "Somalia — southern & central", lat: 3.1, lon: 45.0, region: "Africa", note: "Al-Shabaab insurgency against the federal government and AU-backed forces." },
  { id: "ethiopia-amhara", name: "Ethiopia — Amhara", lat: 11.6, lon: 38.0, region: "Africa", note: "Fano insurgency and federal operations." },
  { id: "ethiopia-tigray", name: "Ethiopia — Tigray border", lat: 13.5, lon: 39.5, region: "Africa", note: "Fragile post-war settlement; tension with Eritrea." },
  { id: "sahel-mali", name: "Mali — north & centre", lat: 15.5, lon: -2.5, region: "Africa", note: "JNIM and Islamic State Sahel against the army and its Russian partners." },
  { id: "sahel-burkina", name: "Burkina Faso — north & east", lat: 13.2, lon: -0.5, region: "Africa", note: "Jihadist insurgency; much of the countryside contested." },
  { id: "sahel-niger", name: "Niger — Tillabéri", lat: 14.3, lon: 2.0, region: "Africa", note: "Attacks by Islamic State Sahel and JNIM." },
  { id: "nigeria-ne", name: "Nigeria — north-east", lat: 11.8, lon: 13.2, region: "Africa", note: "Boko Haram and ISWAP insurgency." },
  { id: "nigeria-nw", name: "Nigeria — north-west & middle belt", lat: 11.0, lon: 7.5, region: "Africa", note: "Banditry, kidnapping and farmer–herder violence." },
  { id: "lake-chad", name: "Lake Chad basin", lat: 13.0, lon: 14.0, region: "Africa", note: "Cross-border jihadist activity (Nigeria, Niger, Chad, Cameroon)." },
  { id: "mozambique-cabo", name: "Mozambique — Cabo Delgado", lat: -12.3, lon: 39.5, region: "Africa", note: "Insurgency by Ansar al-Sunna / IS-Mozambique." },
  { id: "cameroon-anglo", name: "Cameroon — Anglophone regions", lat: 5.9, lon: 9.9, region: "Africa", note: "Separatist conflict in the North-West and South-West." },
  { id: "car", name: "Central African Republic", lat: 6.6, lon: 20.9, region: "Africa", note: "Armed groups across much of the country." },
  { id: "libya", name: "Libya — Tripoli & the south", lat: 32.9, lon: 13.2, region: "Africa", note: "Rival governments and militias." },
  { id: "red-sea", name: "Red Sea & Bab al-Mandab", lat: 13.5, lon: 42.5, region: "Middle East", note: "Attacks on shipping and strikes linked to the Yemen conflict." },
  { id: "yemen", name: "Yemen", lat: 15.4, lon: 44.2, region: "Middle East", note: "Houthi-controlled north against the internationally recognised government." },
  { id: "gaza", name: "Gaza Strip", lat: 31.45, lon: 34.4, region: "Middle East", note: "Israeli military operations and humanitarian crisis." },
  { id: "west-bank", name: "West Bank", lat: 32.0, lon: 35.25, region: "Middle East", note: "Raids, settler violence and armed clashes." },
  { id: "lebanon-south", name: "Southern Lebanon", lat: 33.25, lon: 35.4, region: "Middle East", note: "Israel–Hezbollah border front." },
  { id: "syria-north", name: "Syria — north & north-east", lat: 36.2, lon: 38.5, region: "Middle East", note: "Competing armed factions and foreign forces." },
  { id: "syria-coast-south", name: "Syria — coast & south", lat: 33.3, lon: 36.6, region: "Middle East", note: "Sectarian violence and Israeli strikes." },
  { id: "iraq", name: "Iraq — Kurdistan & Anbar", lat: 35.0, lon: 43.5, region: "Middle East", note: "Militia activity and Islamic State remnants." },
  { id: "iran", name: "Iran", lat: 32.4, lon: 53.7, region: "Middle East", note: "Tension with Israel and the United States over nuclear sites and regional proxies." },
  { id: "hormuz", name: "Strait of Hormuz", lat: 26.6, lon: 56.3, region: "Middle East", note: "Key oil route; naval incidents." },
];
