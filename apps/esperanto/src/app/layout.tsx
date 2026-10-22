import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@babel-apps/markdown/reference.css";
import "@babel-apps/platform/canvas.css";
import "@babel-apps/platform/pages.css";
import "@babel-apps/platform/search.css";
import "@babel-apps/platform/shortcuts.css";
import "@babel-apps/platform/imports.css";
import "./globals.css";
import "@babel-apps/pdf/pdf.css";
import { PdfRouteBoundary } from "@babel-apps/pdf/react";

import {
  PageSessionProvider,
  PageTabs,
} from "@babel-apps/platform/pages/react";
import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";
import { GlobalQuickOpenSource } from "@/components/global-quick-open-source";

export const metadata: Metadata = {
  title: {
    default: "Esperanto",
    template: "%s · Esperanto",
  },
  description: "A quiet, local notebook for English vocabulary, grammar, and expressions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-US">
      <body>
        <PdfRouteBoundary reader={children}>
          <ShortcutProvider>
            <PageSessionProvider storageKey="babel:esperanto:pages">
              <a className="skip-link" href="#main-content">Skip to main content</a>
              <AppHeader />
              <PageTabs />
              <GlobalQuickOpenSource />
              <main id="main-content">{children}</main>
            </PageSessionProvider>
          </ShortcutProvider>
        </PdfRouteBoundary>
      </body>
    </html>
  );
}
