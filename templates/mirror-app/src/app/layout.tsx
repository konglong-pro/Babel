import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@babel-apps/markdown/reference.css";
import "@babel-apps/platform/pages.css";
import "@babel-apps/platform/search.css";
import "@babel-apps/platform/shortcuts.css";
import "./globals.css";

import { PageSessionProvider } from "@babel-apps/platform/pages/react";
import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";
import { GlobalQuickOpenSource } from "@/components/global-quick-open-source";
import {
  AppPageTabs,
  AppWorkspaceProcessHost,
} from "@/components/workspace-process-host";

export const metadata: Metadata = {
  title: {
    default: "__APP_NAME__",
    template: "%s · __APP_NAME__",
  },
  description: "A quiet, local notebook for vocabulary, grammar, and expressions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-US">
      <body>
        <ShortcutProvider>
          <PageSessionProvider storageKey="babel:__APP_ID__:pages">
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <AppHeader />
            <AppPageTabs />
            <GlobalQuickOpenSource />
            <main id="main-content">
              <AppWorkspaceProcessHost>{children}</AppWorkspaceProcessHost>
            </main>
          </PageSessionProvider>
        </ShortcutProvider>
      </body>
    </html>
  );
}
