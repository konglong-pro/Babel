import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  parsePositiveInteger,
  readJsonObject,
  requiredPositiveInteger,
} from "@/lib/http/request";
import { attachReaderUnderlineNote } from "@/lib/repositories/reader-underlines";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["noteId"]);
    const id = parsePositiveInteger((await context.params).id, "id");
    return NextResponse.json(attachReaderUnderlineNote(id, requiredPositiveInteger(body, "noteId")));
  });
}
