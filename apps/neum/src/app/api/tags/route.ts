import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { listTags } from "@/lib/repositories/tags";

export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handleApi(() => NextResponse.json(listTags()));
}
