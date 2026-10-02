import type { Env } from "../bindings";

/**
 * Best-effort translation of African local-language press into English,
 * via Workers AI's `@cf/meta/m2m100-1.2b` — chosen specifically because it
 * runs inside Simon's existing Cloudflare billing with no new vendor
 * relationship or API key, unlike DeepL/Google/Azure (see the OSINT
 * collection-scaling research report).
 *
 * Why this matters beyond "more languages covered": lib/osintFeed.ts's
 * scoreRisk() matches a fixed list of English keywords
 * (attack/killed/clashes/displaced/etc.) against raw article text. A French,
 * Portuguese or Arabic-language report — and a real share of
 * data/africaSources.ts's ~260 outlets publish in one of those — currently
 * scores at or near zero regardless of how severe the actual story is,
 * because none of those keywords can ever match non-English text. This
 * isn't a volume problem, it's a silent blind spot in what's already being
 * crawled.
 *
 * Detection is a plain script/diacritic heuristic, not a language-ID model
 * call (keeping this to one Workers AI call per item, not two) — good
 * enough to decide "this is probably not English" without needing to be
 * exactly right about which Latin-script language it is, since m2m100 is
 * told a specific source_lang per branch below rather than asked to guess.
 * A branch that can't tell French from Portuguese by diacritics alone
 * (both share é/ê/ç-style accents) tries French first, since it's the more
 * common press language across the source list — an imperfect guess the
 * same way the old pin-by-country-centroid fallback elsewhere in this app
 * is an imperfect guess, not a claim of certainty.
 *
 * Fails soft, same as fetchArticleText in connectors/gdelt.ts: any model
 * error, timeout, or unexpected response just returns the original text
 * untranslated rather than throwing — translation is an enrichment, never
 * something ingestion depends on to keep working.
 */

const MODEL = "@cf/meta/m2m100-1.2b" as const;
const TRANSLATE_TIMEOUT_MS = 6000;

const ARABIC_RX = /[؀-ۿ]/;
// Diacritics common in French/Portuguese press text. Deliberately broad
// (not trying to separately fingerprint French vs. Portuguese) — see doc
// comment above for why that's an acceptable simplification here.
const LATIN_ACCENT_RX = /[àâçéèêëîïôùûüÿñãõáíóúâêô]/i;

export type DetectedSourceLang = "ar" | "fr" | null;

/** Cheap pre-check so callers can skip the Workers AI call entirely for
 *  the (likely majority) of items that are already in English — exported
 *  separately from translateText so a caller can batch-decide without
 *  paying for a call per item. */
export function detectNonEnglish(text: string): DetectedSourceLang {
  if (ARABIC_RX.test(text)) return "ar";
  if (LATIN_ACCENT_RX.test(text)) return "fr";
  return null;
}

export interface TranslationResult {
  text: string;
  translated: boolean;
  sourceLang: DetectedSourceLang;
}

/** Translates `text` to English if (and only if) detectNonEnglish flags it
 *  as likely non-English. Returns the original text untouched, with
 *  `translated: false`, on anything from "already English" to "the model
 *  call failed" — callers don't need their own try/catch around this. */
export async function translateToEnglish(env: Env, text: string): Promise<TranslationResult> {
  const trimmed = text.trim();
  if (!trimmed) return { text, translated: false, sourceLang: null };

  const sourceLang = detectNonEnglish(trimmed);
  if (!sourceLang) return { text, translated: false, sourceLang: null };

  try {
    // env.AI.run() takes no AbortSignal/timeout option of its own, so the
    // timeout is enforced from this side with a race — a model call that's
    // genuinely hung shouldn't be able to stall the whole ingestion batch
    // it was called from.
    const result = await Promise.race([
      env.AI.run(MODEL, { text: trimmed, source_lang: sourceLang, target_lang: "en" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("translate timeout")), TRANSLATE_TIMEOUT_MS)),
    ]);
    const translated = (result as { translated_text?: string })?.translated_text;
    if (translated && translated.trim()) {
      return { text: translated, translated: true, sourceLang };
    }
    return { text, translated: false, sourceLang };
  } catch (err) {
    console.error(`[translate] m2m100 call failed (sourceLang=${sourceLang}):`, err);
    return { text, translated: false, sourceLang };
  }
}
