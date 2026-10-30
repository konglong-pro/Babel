import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { listReflections } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handleApi(() => NextResponse.json(listReflections()));
}
