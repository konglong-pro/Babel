import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@babel-apps/markdown/reference.css";
import "@babel-apps/platform/shortcuts.css";
import "./globals.css";

import { ShortcutProvider } from "@babel-apps/platform/shortcuts/react";

import { AppHeader } from "@/components/app-header";

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
        <ShortcutProvider>
          <a className="skip-link" href="#main-content">Skip to main content</a>
          <AppHeader />
          <main id="main-content">{children}</main>
        </ShortcutProvider>
      </body>
    </html>
  );
}
