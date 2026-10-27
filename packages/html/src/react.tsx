"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export { HtmlLibraryButton } from "./library";
export { HtmlReader } from "./reader";

/** Keep detached reading windows separate from notebook page sessions. */
export function HtmlRouteBoundary({ reader, children }: { reader: ReactNode; children: ReactNode }) {
  return usePathname() === "/html-reader" ? reader : children;
}
