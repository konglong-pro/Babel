import { createCanvasCollectionHandlers } from "@babel-apps/platform/canvas/server";

import { handleApi } from "@/lib/http/errors";
import { canvasRepository } from "@/lib/repositories";

export const runtime = "nodejs";

const handlers = createCanvasCollectionHandlers(canvasRepository, handleApi);

export function GET(): Promise<Response> {
  return handlers.GET();
}

export function POST(request: Request): Promise<Response> {
  return handlers.POST(request);
}

