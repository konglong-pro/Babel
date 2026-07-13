import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export function GET(): Response {
  try {
    assertAppDatabaseReady();
    return Response.json({ status: "ok", app: "ReTex" });
  } catch (error) {
    console.error("ReTex health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "ReTex database is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
