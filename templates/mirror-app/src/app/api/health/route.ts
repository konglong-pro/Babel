import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    assertAppDatabaseReady();
    const { ensureNoteImageStorageRecovered } = await import("@/lib/storage");
    await ensureNoteImageStorageRecovered();
    return Response.json({ status: "ok", app: "__APP_NAME__" });
  } catch (error) {
    console.error("__APP_NAME__ health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "__APP_NAME__ storage is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
