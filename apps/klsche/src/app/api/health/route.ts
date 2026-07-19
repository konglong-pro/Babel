import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    assertAppDatabaseReady();
    const { ensureNoteImageStorageRecovered } = await import("@/lib/storage");
    await ensureNoteImageStorageRecovered();
    return Response.json({ status: "ok", app: "KLsche" });
  } catch (error) {
    console.error("KLsche health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "KLsche storage is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
