import { NextResponse } from "next/server";

import { parseTrashQuery } from "@/lib/http/entry-query";
import { handleApi } from "@/lib/http/errors";
import { listTrashEntries } from "@/lib/repositories/trash";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() =>
    NextResponse.json(listTrashEntries(parseTrashQuery(request))),
  );
}
