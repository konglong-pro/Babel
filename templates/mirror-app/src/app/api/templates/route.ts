import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/http/request";
import {
  createNoteTemplate,
  listNoteTemplates,
} from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handleApi(() => NextResponse.json(listNoteTemplates()));
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["name", "contentMd"]);
    const template = createNoteTemplate({
      name: requiredString(body, "name"),
      contentMd:
        optionalString(body, "contentMd", { allowEmpty: true, trim: false }) ??
        "",
    });
    return NextResponse.json(template, { status: 201 });
  });
}
