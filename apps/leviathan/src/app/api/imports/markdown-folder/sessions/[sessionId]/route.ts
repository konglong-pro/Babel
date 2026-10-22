import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/request";
import {
  asFolderImportFile,
  cancelMarkdownFolderSession,
  commitMarkdownFolderSession,
  uploadMarkdownFolderSessionFile,
} from "@/lib/markdown-folder-import.server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sessionId: string }> };

async function routeSessionId(context: RouteContext): Promise<string> {
  return (await context.params).sessionId;
}

export function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 12 * 1024 * 1024) {
      throw new ApiError(413, "REQUEST_TOO_LARGE", "A staged file request must not exceed 12 MiB.");
    }
    const formData = await request.formData();
    const paths = formData.getAll("path");
    const kinds = formData.getAll("kind");
    const files = formData.getAll("file");
    if (
      paths.length !== 1 || typeof paths[0] !== "string" ||
      kinds.length !== 1 || (kinds[0] !== "markdown" && kinds[0] !== "image") ||
      files.length !== 1 || formData.keys().some((key) => !["path", "kind", "file"].includes(key))
    ) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid staged file request.");
    }
    const result = await uploadMarkdownFolderSessionFile(
      await routeSessionId(context),
      paths[0],
      kinds[0],
      asFolderImportFile(files[0]),
    );
    return NextResponse.json(result, { status: 201 });
  });
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const result = await commitMarkdownFolderSession(
      await routeSessionId(context),
      await request.json().catch(() => {
        throw new ApiError(400, "INVALID_JSON", "The import manifest must be valid JSON.");
      }),
    );
    return NextResponse.json(result, { status: 201 });
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await cancelMarkdownFolderSession(await routeSessionId(context));
    return new Response(null, { status: 204 });
  });
}
