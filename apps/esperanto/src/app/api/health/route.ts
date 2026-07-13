import { assertAppDatabaseReady } from "@/lib/db/readiness";

export const runtime = "nodejs";

export function GET(): Response {
  try {
    assertAppDatabaseReady();
    return Response.json({ status: "ok", app: "Esperanto" });
  } catch (error) {
    console.error("Esperanto health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Esperanto database is unavailable or requires migration.",
        },
      },
      { status: 503 },
    );
  }
}
