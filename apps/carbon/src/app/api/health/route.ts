import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    assertAppDatabaseReady();
    const { ensureNoteImageStorageRecovered } = await import("@/lib/storage");
    await ensureNoteImageStorageRecovered();
    return Response.json({ status: "ok", app: "Carbon" });
  } catch (error) {
    console.error("Carbon health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Carbon storage is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
