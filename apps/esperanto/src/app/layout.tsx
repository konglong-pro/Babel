import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

import { AppHeader } from "@/components/app-header";

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
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <AppHeader />
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}
