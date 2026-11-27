import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "use-intl/core";

import {
  defaultLocale,
  isLocale,
  locales,
  matchLocale,
  negotiateLocale,
} from "../src/i18n/config";
import en from "../src/i18n/dictionaries/en";
import ko from "../src/i18n/dictionaries/ko";

type Structure = string | { [key: string]: Structure } | readonly Structure[];

function structureOf(value: unknown): Structure {
  if (Array.isArray(value)) return value.map(structureOf);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, structureOf(child)]),
    );
  }
  return typeof value;
}

test("English and Korean are supported", () => {
  assert.deepEqual([...locales], ["en", "ko"]);
  assert.equal(defaultLocale, "en");
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("ko"), true);
  assert.equal(isLocale("fr"), false);
});

test("English and Korean dictionaries share a structure", () => {
  assert.deepEqual(structureOf(ko), structureOf(en));
});

test("messages cover the expected structure", () => {
  assert.equal(en.app.name, "Tsumiki");
  assert.equal(en.home.title, "Structures");
  assert.equal(en.auth.error.retry, "Retry sign-in");
  assert.equal(en.header.signOut, "Sign out");
  assert.equal(ko.home.title, "구조물");
  assert.equal(ko.header.signOut, "로그아웃");
});

test("next-intl translation and interpolation", () => {
  const t = createTranslator({ locale: "en", messages: en });
  assert.equal(t("home.title"), "Structures");
  assert.equal(t("app.description"), "A live viewer for Minecraft structures.");
});

test("Korean translates messages, not just keys", () => {
  const t = createTranslator({ locale: "ko", messages: ko });
  assert.equal(t("home.title"), "구조물");
  assert.notEqual(t("app.description"), en.app.description);
});

test("unknown keys fall back to the key path", () => {
  const t = createTranslator({ locale: "en", messages: en });
  assert.equal(t("nonexistent.key" as never), "nonexistent.key");
});

test("locale matching handles region subtags", () => {
  assert.equal(matchLocale("ko"), "ko");
  assert.equal(matchLocale("ko-KR"), "ko");
  assert.equal(matchLocale("EN-us"), "en");
  assert.equal(matchLocale("fr"), undefined);
});

test("Accept-Language negotiation prefers supported languages", () => {
  assert.equal(negotiateLocale("ko-KR,ko;q=0.9,en;q=0.8"), "ko");
  assert.equal(negotiateLocale("fr-FR,fr;q=0.9"), "en");
  assert.equal(negotiateLocale("fr;q=1.0,ko;q=0.7,en;q=0.5"), "ko");
  assert.equal(negotiateLocale("en;q=0.2,ko;q=0.4"), "ko");
  assert.equal(negotiateLocale("ko;q=0"), "en");
  assert.equal(negotiateLocale(""), "en");
  assert.equal(negotiateLocale(null), "en");
});
