import { HtmlReader } from "@babel-apps/html/react";

export const dynamic = "force-dynamic";
export default async function HtmlReaderPage({ searchParams }: { searchParams: Promise<{ id?: string; owner?: string; anchor?: string }> }) {
  const params = await searchParams;
  return <HtmlReader key={typeof params.id === "string" ? params.id : ""} appId="neum" appName="Neum" documentId={typeof params.id === "string" ? params.id : ""} ownerId={typeof params.owner === "string" ? params.owner : ""} anchor={typeof params.anchor === "string" ? params.anchor : ""} />;
}
