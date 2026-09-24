import { NextResponse } from "next/server";
import { assertOnlyFields, assertSameOrigin, readJsonObject } from "@babel-apps/platform/http/request";

import { ApiError, handleApi } from "@/lib/http/errors";
import { createReaderUnderline, listReaderUnderlines } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const params = new URL(request.url).searchParams;
    const kind = params.get("sourceKind");
    const id = params.get("sourceId");
    if (kind === null || id === null) throw new ApiError(400, "VALIDATION", "sourceKind and sourceId are required.");
    return NextResponse.json(listReaderUnderlines(kind, id));
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["sourceKind", "sourceId", "fieldKey", "color", "anchor"]);
    return NextResponse.json(createReaderUnderline(body), { status: 201 });
  });
}
