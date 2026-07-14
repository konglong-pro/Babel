import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    assertAppDatabaseReady();
    const { ensureNoteImageStorageRecovered } = await import("@/lib/storage");
    await ensureNoteImageStorageRecovered();
    return Response.json({ status: "ok", app: "Vali" });
  } catch (error) {
    console.error("Vali health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Vali storage is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
