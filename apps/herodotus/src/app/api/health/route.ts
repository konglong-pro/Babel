import { ensureNoteImageStorageRecovered } from "@/lib/storage";

export async function GET(): Promise<Response> {
  await ensureNoteImageStorageRecovered();
  return Response.json({ status: "ok", app: "Herodotus" });
}
