import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@babel-apps/markdown/reference.css";
import "@babel-apps/platform/pages.css";
import "@babel-apps/platform/search.css";
import "@babel-apps/platform/shortcuts.css";
import "./globals.css";

import { PageSessionProvider, PageTabs } from "@babel-apps/platform/pages/react";
import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: {
    default: "Herodotus",
    template: "%s · Herodotus",
  },
  description: "A quiet, local notebook for reading and recording history and literature.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-US">
      <body>
        <ShortcutProvider>
          <PageSessionProvider storageKey="babel:herodotus:pages">
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <AppHeader />
            <PageTabs />
            <main id="main-content">{children}</main>
          </PageSessionProvider>
        </ShortcutProvider>
      </body>
    </html>
  );
}
