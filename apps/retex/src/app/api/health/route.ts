import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    assertAppDatabaseReady();
    const { ensureNoteImageStorageRecovered } = await import("@/lib/storage");
    await ensureNoteImageStorageRecovered();
    return Response.json({ status: "ok", app: "ReTex" });
  } catch (error) {
    console.error("ReTex health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "ReTex storage is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
