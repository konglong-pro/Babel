"use client";

import { useRouter } from "next/navigation";

import { PageTabs, type PageTabsProps } from "./react";

export type NextPageTabsProps = Omit<PageTabsProps, "onNavigate">;

export function NextPageTabs(props: NextPageTabsProps) {
  const router = useRouter();
  return <PageTabs {...props} onNavigate={(href) => router.push(href)} />;
}
