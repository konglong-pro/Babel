import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";

import {
  assertAppDatabaseReady,
  assertCurrentNeumSchema,
} from "@/lib/db/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    assertAppDatabaseReady();
    const [{ getNeumDatabase }, storage] = await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/storage"),
    ]);
    const { sqlite } = getNeumDatabase();
    assertCurrentNeumSchema(sqlite);
    await storage.ensureEntryImageStorageRecovered();
    const uploadDirectory = storage.entryUploadDirectory();
    const uploadStats = await lstat(uploadDirectory);
    if (!uploadStats.isDirectory() || uploadStats.isSymbolicLink()) {
      throw new Error("Neum upload path is not a real directory.");
    }
    await access(uploadDirectory, constants.R_OK | constants.W_OK);
    return Response.json({ status: "ok", app: "Neum" });
  } catch (error) {
    console.error("Neum health check failed", error);
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Neum storage is unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
