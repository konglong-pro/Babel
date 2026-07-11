import { NextResponse } from "next/server";

import {
  deleteKnowledge,
  getKnowledge,
  updateKnowledge,
  type UpdateKnowledgeInput,
} from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertPatchHasFields,
  optionalIdArray,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const note = getKnowledge(await routeId(context));
    if (note === null) {
      throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
    }

    return NextResponse.json(note);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const body = await readJsonObject(request);
    const patch: UpdateKnowledgeInput = {};
    const folderId = optionalPositiveInteger(body, "folderId");
    const title = optionalString(body, "title");
    const contentMd = optionalString(body, "contentMd", { allowEmpty: true, trim: false });
    const tags = optionalStringArray(body, "tags");
    const exerciseIds = optionalIdArray(body, "exerciseIds", "relatedExerciseIds");
    if (folderId !== undefined) patch.folderId = folderId;
    if (title !== undefined) patch.title = title;
    if (contentMd !== undefined) patch.contentMd = contentMd;
    if (tags !== undefined) patch.tags = tags;
    if (exerciseIds !== undefined) patch.exerciseIds = exerciseIds;
    assertPatchHasFields({ ...patch, exerciseIds });

    const id = await routeId(context);
    return NextResponse.json(updateKnowledge(id, patch));
  });
}

export function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    if (!deleteKnowledge(await routeId(context))) {
      throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
    }

    return new Response(null, { status: 204 });
  });
}
