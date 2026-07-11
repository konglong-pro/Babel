import {
  assertDatabaseConnectionReady,
  assertDatabaseFileReady,
} from "@/lib/db/client";
import { valiDatabasePath } from "@/lib/db/paths";
import { getInitializedValiDatabase } from "@/lib/vali/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  try {
    const initializedDatabase = getInitializedValiDatabase();
    if (initializedDatabase) {
      assertDatabaseConnectionReady(initializedDatabase);
    } else {
      assertDatabaseFileReady(valiDatabasePath());
    }
    return Response.json({ id: "vali", status: "ok", schemaVersion: 1 });
  } catch {
    return Response.json(
      { id: "vali", status: "error", schemaVersion: 1 },
      { status: 503 },
    );
  }
}
