import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalString,
  readJsonObject,
} from "@/lib/http/request";
import { createCanvas, listCanvases } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handleApi(() => NextResponse.json(listCanvases()));
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["title"]);
    const title = optionalString(body, "title") ?? "Untitled canvas";
    return NextResponse.json(createCanvas(title), { status: 201 });
  });
}
