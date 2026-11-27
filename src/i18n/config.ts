// Locale registry. English is the only locale for now — when adding a
// language, list it here and add src/i18n/dictionaries/<code>.ts.

export const locales = ["en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
