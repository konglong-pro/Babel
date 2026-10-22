import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";
import {
  deleteNoteTemplate,
  getNoteTemplate,
  updateNoteTemplate,
  type UpdateNoteTemplateInput,
} from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const template = getNoteTemplate(await routeId(context));
    if (!template) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");
    return NextResponse.json(template);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["name", "contentMd"]);
    const patch: UpdateNoteTemplateInput = {};
    const name = optionalString(body, "name");
    const contentMd = optionalString(body, "contentMd", {
      allowEmpty: true,
      trim: false,
    });
    if (name !== undefined) patch.name = name;
    if (contentMd !== undefined) patch.contentMd = contentMd;
    assertPatchHasFields({ ...patch });
    const id = await routeId(context);
    if (!getNoteTemplate(id)) {
      throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");
    }
    return NextResponse.json(updateNoteTemplate(id, patch));
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    if (!deleteNoteTemplate(await routeId(context))) {
      throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");
    }
    return new Response(null, { status: 204 });
  });
}
