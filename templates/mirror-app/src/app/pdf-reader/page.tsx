import { PdfReader } from "@babel-apps/pdf/react";

export const dynamic = "force-dynamic";
export default async function PdfReaderPage({ searchParams }: { searchParams: Promise<{ id?: string; owner?: string }> }) {
  const params = await searchParams;
  return <PdfReader appId="__APP_ID__" appName="__APP_NAME__" documentId={typeof params.id === "string" ? params.id : ""} ownerId={typeof params.owner === "string" ? params.owner : ""} />;
}
