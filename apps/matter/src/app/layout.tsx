import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@babel-apps/markdown/reference.css";
import "@babel-apps/platform/canvas.css";
import "@babel-apps/platform/pages.css";
import "@babel-apps/platform/search.css";
import "@babel-apps/platform/shortcuts.css";
import "@babel-apps/platform/imports.css";
import "./globals.css";

import { PageSessionProvider } from "@babel-apps/platform/pages/react";
import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";
import { GlobalQuickOpenSource } from "@/components/global-quick-open-source";
import {
  MatterPageTabs,
  MatterWorkspaceProcessHost,
} from "@/components/workspace-process-host";

export const metadata: Metadata = {
  title: "Matter · Physics Notebook",
  description:
    "A local notebook for physical concepts, selected exercises, and worked solutions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ShortcutProvider>
          <PageSessionProvider storageKey="babel:matter:pages">
            <a className="skip-link" href="#main-content">
              Skip to main content
            </a>
            <AppHeader />
            <MatterPageTabs />
            <GlobalQuickOpenSource />
            <main id="main-content">
              <MatterWorkspaceProcessHost>{children}</MatterWorkspaceProcessHost>
            </main>
          </PageSessionProvider>
        </ShortcutProvider>
      </body>
    </html>
  );
}
