import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export function GET(): Response {
  try {
    assertAppDatabaseReady();
    return Response.json({ status: "ok", app: "__APP_NAME__" });
  } catch (error) {
    console.error("__APP_NAME__ health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "__APP_NAME__ database is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
