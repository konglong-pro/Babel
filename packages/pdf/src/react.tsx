"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export { PdfLibraryButton } from "./library";
export { PdfReader } from "./reader";

/** A reader window has its own controls and never restores notebook editor tabs. */
export function PdfRouteBoundary({ reader, children }: { reader: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  return pathname === "/pdf-reader" ? reader : children;
}
