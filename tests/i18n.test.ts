import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "use-intl/core";

import { locales, defaultLocale, isLocale } from "../src/i18n/config";
import en from "../src/i18n/dictionaries/en";

test("en is the only locale for now", () => {
  assert.deepEqual([...locales], ["en"]);
  assert.equal(defaultLocale, "en");
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("fr"), false);
});

test("messages cover the expected structure", () => {
  assert.equal(en.app.name, "Tsumiki");
  assert.equal(en.home.title, "Structures");
  assert.equal(en.auth.error.retry, "Retry sign-in");
  assert.equal(en.header.signOut, "Sign out");
});

test("next-intl translation and interpolation", () => {
  const t = createTranslator({ locale: "en", messages: en });
  assert.equal(t("home.title"), "Structures");
  assert.equal(t("app.description"), "A live viewer for Minecraft structures.");
});

test("unknown keys fall back to the key path", () => {
  const t = createTranslator({ locale: "en", messages: en });
  assert.equal(t("nonexistent.key" as never), "nonexistent.key");
});
