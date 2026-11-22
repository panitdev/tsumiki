import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AmbientBackground } from "@charlotte-ui/labs/ambient-background";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tsumiki", template: "%s · Tsumiki" },
  icons: {
    icon: [
      { url: "/tsumiki-logo.svg", type: "image/svg+xml", sizes: "any", media: "(prefers-color-scheme: light)" },
      { url: "/tsumiki-logo-dark.svg", type: "image/svg+xml", sizes: "any", media: "(prefers-color-scheme: dark)" },
    ],
  },
  description: "A live viewer for Minecraft structures.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AmbientBackground className="site-background" />
        {children}
      </body>
    </html>
  );
}
