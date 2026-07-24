import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@babel-apps/markdown/reference.css";
import "@babel-apps/platform/pages.css";
import "@babel-apps/platform/shortcuts.css";
import "./globals.css";

import { PageSessionProvider, PageTabs } from "@babel-apps/platform/pages/react";
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
          <PageSessionProvider storageKey="babel:retex:pages">
            <a className="skip-link" href="#main-content">
              Skip to main content
            </a>
            <AppHeader />
            <PageTabs />
            <main id="main-content">{children}</main>
          </PageSessionProvider>
        </ShortcutProvider>
      </body>
    </html>
  );
}
