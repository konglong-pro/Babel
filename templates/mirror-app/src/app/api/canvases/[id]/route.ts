import {
  createCanvasItemHandlers,
  type CanvasRouteContext,
} from "@babel-apps/platform/canvas/server";

import { handleApi } from "@/lib/http/errors";
import { canvasRepository } from "@/lib/repositories";

export const runtime = "nodejs";

const handlers = createCanvasItemHandlers(canvasRepository, handleApi);

export function GET(request: Request, context: CanvasRouteContext): Promise<Response> {
  return handlers.GET(request, context);
}

export function PATCH(request: Request, context: CanvasRouteContext): Promise<Response> {
  return handlers.PATCH(request, context);
}

export function DELETE(request: Request, context: CanvasRouteContext): Promise<Response> {
  return handlers.DELETE(request, context);
}

