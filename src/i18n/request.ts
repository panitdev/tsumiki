// next-intl request configuration. Runs on every request (server-side) and
// supplies the active locale plus its messages to getTranslations() and
// NextIntlClientProvider.
//
// Resolution order:
//   1. TSUMIKI_LOCALE cookie (explicit choice from the language switcher)
//   2. Accept-Language header (best supported match)
//   3. defaultLocale
//
// No URL prefix is used, so every route keeps its current path.

import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { isLocale, localeCookieName, negotiateLocale } from "./config";
import type { Locale } from "./config";
import type { Messages } from "./dictionaries/en";

const dictionaries: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => import("./dictionaries/en"),
  ko: () => import("./dictionaries/ko"),
};

export default getRequestConfig(async () => {
  const preferred = (await cookies()).get(localeCookieName)?.value;
  const locale = preferred !== undefined && isLocale(preferred)
    ? preferred
    : negotiateLocale((await headers()).get("accept-language"));

  return { locale, messages: (await dictionaries[locale]()).default };
});
