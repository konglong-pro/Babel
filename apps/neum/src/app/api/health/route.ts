import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";

import { getNeumDatabase } from "@/lib/db/client";
import { assertCurrentNeumSchema } from "@/lib/db/readiness";
import { entryUploadDirectory } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const { sqlite } = getNeumDatabase();
    assertCurrentNeumSchema(sqlite);
    const uploadDirectory = entryUploadDirectory();
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
