import type { Metadata } from "next";
import type { ReactNode } from "react";

import "katex/dist/katex.min.css";
import "@babel-apps/platform/shortcuts.css";
import "./globals.css";

import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "ReTex · Math Archive",
  description:
    "A lasting home for mathematical understanding, classic exercises, and your own solutions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ShortcutProvider>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          <AppHeader />
          <main id="main-content">{children}</main>
        </ShortcutProvider>
      </body>
    </html>
  );
}
