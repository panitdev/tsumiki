// Locale registry. When adding a language, list it here and add
// src/i18n/dictionaries/<code>.ts.

export const locales = ["en", "ko"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// Cookie that pins an explicit language choice so it survives requests and
// wins over the browser's Accept-Language header. Set by POST /api/locale.
export const localeCookieName = "TSUMIKI_LOCALE";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Matches a single BCP 47 tag ("ko", "ko-KR", "en-US") to a supported locale. */
export function matchLocale(tag: string): Locale | undefined {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return undefined;
  return locales.find((locale) => normalized === locale || normalized.startsWith(`${locale}-`));
}

/**
 * Picks a supported locale from an Accept-Language header, honouring q-values.
 * Returns the default locale when nothing matches.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const ranked = acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      const weight = quality === undefined ? 1 : Number(quality.slice(2));
      return { tag, weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.weight > 0)
    .sort((left, right) => right.weight - left.weight);

  for (const { tag } of ranked) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return defaultLocale;
}
