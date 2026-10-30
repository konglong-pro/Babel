import { handleApi } from "@/lib/http/errors";
import { assertSameOrigin, parsePositiveInteger } from "@/lib/http/request";
import { detachReaderUnderlineNote } from "@/lib/repositories/reader-underlines";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; noteId: string }> };

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const { id, noteId } = await context.params;
    detachReaderUnderlineNote(
      parsePositiveInteger(id, "id"),
      parsePositiveInteger(noteId, "noteId"),
    );
    return new Response(null, { status: 204 });
  });
}
