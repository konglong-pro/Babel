import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  parsePositiveInteger,
  readJsonObject,
  requiredPositiveInteger,
} from "@/lib/http/request";
import { createReaderUnderline, listReaderUnderlines } from "@/lib/repositories/reader-underlines";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const url = new URL(request.url);
    if (url.searchParams.get("sourceKind") !== "note") {
      throw new ApiError(400, "VALIDATION_ERROR", "sourceKind must be note.");
    }
    const sourceId = parsePositiveInteger(url.searchParams.get("sourceId") ?? "", "sourceId");
    return NextResponse.json(listReaderUnderlines(sourceId));
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["sourceKind", "sourceId", "fieldKey", "color", "anchor"]);
    if (body.sourceKind !== "note") {
      throw new ApiError(400, "VALIDATION_ERROR", "sourceKind must be note.");
    }
    const underline = createReaderUnderline({
      sourceNoteId: requiredPositiveInteger(body, "sourceId"),
      fieldKey: body.fieldKey,
      color: body.color,
      anchor: body.anchor,
    });
    return NextResponse.json(underline, { status: 201 });
  });
}
