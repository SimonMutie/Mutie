/**
 * Terrorist attacks. An incident is flagged as one when a report codes a terrorist attack (major_terror_attack or
 * terrorist_attack), or when its perpetrators include a group on the UN Security Council's ISIL (Da'esh) and
 * Al-Qaida sanctions list or one of their recognised affiliates. The UN list is the yardstick because it is the one
 * shared internationally; groups designated only by some governments are not flagged by name.
 */

/** The groups, by the names reporting uses for them (English, French, Arabic transliterations). */
const GROUPS: { name: string; rx: RegExp }[] = [
  { name: "al-Shabaab", rx: /\b(?:al[\s-]?shabaab|al[\s-]?shabab|harakat al[\s-]?shabaab|shabaab)\b/i },
  { name: "Boko Haram (JAS)", rx: /\b(?:boko[\s-]?haram|jama'?atu ahlis[\s-]?sunna|jas)\b/i },
  { name: "ISWAP", rx: /\b(?:iswap|islamic state west africa|islamic state'?s? west africa|iswa)\b/i },
  { name: "Islamic State Sahel", rx: /\b(?:islamic state (?:in the )?(?:greater )?sahara|islamic state sahel|isgs|is[\s-]?sahel|issp|état islamique au grand sahara|eigs)\b/i },
  { name: "JNIM", rx: /\b(?:jnim|jama'?at nusrat al[\s-]?islam|gsim)\b/i },
  { name: "AQIM", rx: /\b(?:aqim|al[\s-]?qa'?e?ida in the islamic maghreb|aqmi)\b/i },
  { name: "al-Qaeda", rx: /\b(?:al[\s-]?qa'?e?ida|al[\s-]?qaida|aqap)\b/i },
  { name: "Islamic State (IS/ISIS)", rx: /\b(?:islamic state|isis|isil|daesh|da'?esh|état islamique)\b/i },
  { name: "ADF / IS Central Africa", rx: /\b(?:adf|allied democratic forces|iscap|islamic state central africa)\b/i },
  { name: "IS Mozambique (Ahlu Sunna wal Jama'a)", rx: /\b(?:ahlu[\s-]?sunna(?:h)? wa[\s-]?l?[\s-]?jama'?a|al[\s-]?sunnah wa jama'?ah|asw?j|is[\s-]?mozambique|islamic state mozambique|islamic state'?s? mozambique)\b/i },
  { name: "IS Somalia", rx: /\b(?:is[\s-]?somalia|islamic state somalia|islamic state'?s? somalia|isis[\s-]?somalia)\b/i },
  { name: "Ansaru", rx: /\bansaru\b/i },
  { name: "Ansar al-Islam", rx: /\bansar(?:ul)? al[\s-]?islam\b/i },
  { name: "Lakurawa", rx: /\blakurawa\b/i },
];

export const TERROR_INDICATORS = new Set(["major_terror_attack", "terrorist_attack"]);

/** The listed groups named among these actors (or in this text). */
export function terrorGroupsIn(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const g of GROUPS) if (g.rx.test(t)) found.add(g.name);
  // A specific affiliate makes the generic name redundant.
  if (found.size > 1) found.delete("Islamic State (IS/ISIS)");
  if ([...found].some((g) => g !== "al-Qaeda" && /JNIM|AQIM/.test(g))) found.delete("al-Qaeda");
  return [...found];
}

export function isTerrorism(indicatorIds: string[], actors: string[]): { terrorism: boolean; groups: string[] } {
  const groups = terrorGroupsIn(actors);
  return { terrorism: groups.length > 0 || indicatorIds.some((id) => TERROR_INDICATORS.has(id)), groups };
}
