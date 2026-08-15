import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/request";
import { createMarkdownFolderSession } from "@/lib/markdown-folder-import.server";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    return NextResponse.json(await createMarkdownFolderSession(), { status: 201 });
  });
}
