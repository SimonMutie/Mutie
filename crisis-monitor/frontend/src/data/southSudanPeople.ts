/**
 * The people in the South Sudan record. Portraits come from each person's
 * Wikipedia article (see components/Portrait.tsx); where a name has no article
 * we are confident of, the card shows initials. The role lines follow the
 * sources in southSudanElection.ts and the Reshuffle Ledger, dated where it
 * matters.
 */

export interface Person {
  name: string;
  /** Wikipedia article title. Omit to show initials. */
  wiki?: string;
  /** A word the article title must contain, so a different person is never shown. */
  guard?: string;
  role: string;
}

export const PEOPLE: Person[] = [
  { name: "Salva Kiir Mayardit", wiki: "Salva Kiir Mayardit", guard: "Kiir", role: "President since 2011. Declared a candidate for December 2026 (Jul 2026)." },
  { name: "Riek Machar", wiki: "Riek Machar", guard: "Machar", role: "SPLM-IO leader and First Vice-President under the agreement. Detained since March 2025 and on trial." },
  { name: "Benjamin Bol Mel", wiki: "Benjamin Bol Mel", guard: "Mel", role: "Vice-President (economic cluster), Feb to Nov 2025. Dismissed, seen as Kiir’s likely successor." },
  { name: "James Wani Igga", wiki: "James Wani Igga", guard: "Igga", role: "Vice-President. Out in Feb 2025, returned Nov 2025. SPLM First Deputy Chairman." },
  { name: "Hussein Abdelbagi", wiki: "Hussein Abdelbagi", guard: "Abdelbagi", role: "Vice-President, dismissed Feb 2025 and made Minister of Agriculture." },
  { name: "Josephine Lagu", wiki: "Josephine Lagu", guard: "Lagu", role: "Appointed Vice-President in Feb 2025, replacing Abdelbagi." },
  { name: "Michael Makuei Lueth", wiki: "Michael Makuei Lueth", guard: "Makuei", role: "Information minister, moved in the Nov 2025 reshuffle." },
  { name: "Ateny Wek Ateny", wiki: "Ateny Wek Ateny", guard: "Ateny", role: "Appointed Information minister, Nov 2025." },
  { name: "Mabior Garang de Mabior", wiki: "Mabior Garang de Mabior", guard: "Mabior", role: "Appointed Environment and Forestry minister, Nov 2025." },
  { name: "Gen. Akec Tong Aleu", wiki: "Akec Tong Aleu", guard: "Aleu", role: "Head of the NSS Internal Security Bureau. Dismissed Feb 2025 after a few months." },
  { name: "Gen. Abraham Manyuat Peter", wiki: "Abraham Manyuat", guard: "Manyuat", role: "Inspector-General of Police, dismissed Nov 2025." },
  { name: "Stephen Par Kuol", wiki: "Stephen Par Kuol", guard: "Kuol", role: "SPLM-IO (Par Kuol faction). Named Peacebuilding minister in the 22 Sep 2026 caretaker cabinet (Reshuffle Ledger)." },
  { name: "Taban Deng Gai", wiki: "Taban Deng Gai", guard: "Gai", role: "Vice-President until the 22 Sep 2026 order (Reshuffle Ledger)." },
  { name: "Rebecca Nyandeng de Mabior", wiki: "Rebecca Nyandeng de Mabior", guard: "Nyandeng", role: "Vice-President until the 22 Sep 2026 order (Reshuffle Ledger)." },
  { name: "Angelina Teny", wiki: "Angelina Teny", guard: "Teny", role: "Defence minister. Her post was taken by the SPLM in March 2023 (Reshuffle Ledger)." },
  { name: "Santino Deng Wol", wiki: "Santino Deng Wol", guard: "Wol", role: "Chief of Defence Forces. Appointed Dec 2024 and again May 2026 (Reshuffle Ledger)." },
];

/** Key a holder or candidate name to its person record, ignoring rank prefixes. */
export const personFor = (name: string) => PEOPLE.find((p) => p.name.replace(/^(Gen|Dr)\.\s+/, "") === name.replace(/^(Gen|Dr)\.\s+/, ""));
