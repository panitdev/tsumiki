// English dictionary. The canonical set of keys: every other locale must
// mirror this exact structure (compare with `structureOf` in tests/i18n.test.ts).
//
// Messages are nested; use next-intl syntax for rich messages:
//   {name}        simple interpolation
//   {count, plural, one {...} other {...}}   ICU plurals
//
// Usage:
//   server components: await getTranslations() → t("home.title")
//   client components: useTranslations() from "next-intl/react"

export const en = {
  app: {
    name: "Tsumiki",
    description: "A live viewer for Minecraft structures.",
  },
  home: {
    title: "Structures",
  },
  auth: {
    signedOut: {
      title: "Signed out of Tsumiki",
      signIn: "Sign in",
    },
    error: {
      retry: "Retry sign-in",
      restart: "Start sign-in again",
    },
  },
  header: {
    signOut: "Sign out",
  },
} as const;

export type Messages = typeof en;

export default en;
