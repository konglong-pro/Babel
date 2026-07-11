import { NextResponse } from "next/server";

import { createKnowledge, listKnowledge } from "@/lib/repositories";
import { handleApi } from "@/lib/http/errors";
import {
  optionalIdArray,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readJsonObject,
  requiredPositiveInteger,
  requiredString,
} from "@/lib/http/request";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const folderIdValue = new URL(request.url).searchParams.get("folderId");
    const folderId =
      folderIdValue === null ? undefined : parsePositiveInteger(folderIdValue, "folderId");
    return NextResponse.json(listKnowledge(folderId));
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    const body = await readJsonObject(request);
    const exerciseIds =
      optionalIdArray(body, "exerciseIds", "relatedExerciseIds") ?? [];

    const note = createKnowledge({
      folderId: requiredPositiveInteger(body, "folderId"),
      title: requiredString(body, "title"),
      contentMd: optionalString(body, "contentMd", { allowEmpty: true, trim: false }) ?? "",
      tags: optionalStringArray(body, "tags") ?? [],
      exerciseIds,
    });

    return NextResponse.json(note, { status: 201 });
  });
}
