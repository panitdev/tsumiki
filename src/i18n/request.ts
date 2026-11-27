// next-intl request configuration. Runs on every request (server-side) and
// supplies the active locale plus its messages to getTranslations() and
// NextIntlClientProvider.
//
// English is the only locale for now. When per-locale routing is added later,
// resolve the locale from the request (params, cookie, or URL prefix) here.

import { getRequestConfig } from "next-intl/server";

import { defaultLocale } from "./config";

export default getRequestConfig(async () => ({
  locale: defaultLocale,
  messages: (await import("./dictionaries/en")).default,
}));
