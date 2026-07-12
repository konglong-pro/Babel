import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: {
    default: "Neum",
    template: "%s · Neum",
  },
  description: "A local notebook for computer science knowledge and small code snippets.",
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
