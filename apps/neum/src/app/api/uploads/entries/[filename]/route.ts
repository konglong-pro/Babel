import { handleApi } from "@/lib/http/errors";
import { readEntryImage } from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ filename: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const { filename } = await context.params;
    const image = await readEntryImage(filename);
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${image.fileName}"`,
        "Content-Length": String(image.size),
        "Content-Type": image.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
