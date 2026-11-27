import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { AmbientBackground } from "@charlotte-ui/labs/ambient-background";
import { MockGate } from "../src/mocks/boot";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: { default: "Tsumiki", template: "%s · Tsumiki" },
    icons: {
      icon: [
        { url: "/tsumiki-logo.svg", type: "image/svg+xml", sizes: "any", media: "(prefers-color-scheme: light)" },
        { url: "/tsumiki-logo-dark.svg", type: "image/svg+xml", sizes: "any", media: "(prefers-color-scheme: dark)" },
      ],
    },
    description: t("app.description"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <html lang="en">
      <body>
        <NextIntlClientProvider messages={messages}>
          <AmbientBackground className="site-background" />
          <MockGate>
            {children}
          </MockGate>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
