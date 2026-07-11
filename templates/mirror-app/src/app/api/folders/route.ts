import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalNullablePositiveInteger,
  readJsonObject,
  requiredString,
} from "@/lib/http/request";
import { createFolder, listFolders } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handleApi(() => NextResponse.json(listFolders()));
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["name", "parentId"]);
    const folder = createFolder({
      name: requiredString(body, "name"),
      parentId: optionalNullablePositiveInteger(body, "parentId"),
    });
    return NextResponse.json(folder, { status: 201 });
  });
}
