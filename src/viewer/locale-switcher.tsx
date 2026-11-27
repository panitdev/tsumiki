"use client";

// Language picker. Persists the choice via POST /api/locale (which sets the
// TSUMIKI_LOCALE cookie) and re-renders the server tree in the new locale.

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@charlotte-ui/dropdown-menu";

import { defaultLocale, isLocale, locales } from "../i18n/config";
import type { Locale } from "../i18n/config";

const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};

export function LocaleSwitcher() {
  const activeLocale = useLocale();
  const active = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const t = useTranslations("header");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  async function change(next: Locale) {
    if (next === active) return;
    setSaving(true);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!response.ok) throw new Error("Locale update failed");
      startTransition(() => router.refresh());
    } catch {
      // Keep the previous language on failure rather than showing a stale choice.
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu expandTriggerToMenuWidth>
      <DropdownMenuTrigger
        size="sm"
        variant="outline"
        aria-label={t("language")}
        disabled={saving || pending}
      >
        {LANGUAGE_NAMES[active]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={active}
          onValueChange={(next) => {
            if (isLocale(next)) void change(next);
          }}
        >
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} lang={locale}>
              {LANGUAGE_NAMES[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
