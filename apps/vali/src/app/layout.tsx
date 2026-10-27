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
import "@babel-apps/html/html.css";
import { HtmlRouteBoundary } from "@babel-apps/html/react";
import { PdfRouteBoundary } from "@babel-apps/pdf/react";

import { PageSessionProvider } from "@babel-apps/platform/pages/react";
import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";
import { GlobalQuickOpenSource } from "@/components/global-quick-open-source";
import {
  ValiPageTabs,
  ValiWorkspaceProcessHost,
} from "@/components/workspace-process-host";

export const metadata: Metadata = {
  title: {
    default: "Vali",
    template: "%s | Vali",
  },
  description: "A local Markdown notebook for notes and daily reflection.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-US">
      <body>
        <HtmlRouteBoundary reader={children}>
        <PdfRouteBoundary reader={children}>
          <ShortcutProvider>
            <PageSessionProvider storageKey="babel:vali:pages">
              <a className="skip-link" href="#main-content">Skip to main content</a>
              <AppHeader />
              <ValiPageTabs />
              <GlobalQuickOpenSource />
              <main id="main-content">
                <ValiWorkspaceProcessHost>{children}</ValiWorkspaceProcessHost>
              </main>
            </PageSessionProvider>
          </ShortcutProvider>
        </PdfRouteBoundary>
        </HtmlRouteBoundary>
      </body>
    </html>
  );
}
