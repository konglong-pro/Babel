import { NextResponse } from "next/server";

import { createFolder, listFolders } from "@/lib/repositories";
import { handleApi } from "@/lib/http/errors";
import {
  assertSameOrigin,
  optionalNullablePositiveInteger,
  queryFolderType,
  readJsonObject,
  requiredFolderType,
  requiredString,
} from "@/lib/http/request";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const typeValue = new URL(request.url).searchParams.get("type");
    const folders = listFolders(typeValue === null ? undefined : queryFolderType(typeValue));
    return NextResponse.json(folders);
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const folder = createFolder({
      type: requiredFolderType(body),
      name: requiredString(body, "name"),
      parentId: optionalNullablePositiveInteger(body, "parentId"),
    });

    return NextResponse.json(folder, { status: 201 });
  });
}
