import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { assertSameOrigin, parsePositiveInteger } from "@/lib/http/request";
import { withEntryMutationLock } from "@/lib/mutation-lock";
import { restoreTrashEntry } from "@/lib/repositories/trash";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(() => withEntryMutationLock(async () => {
    assertSameOrigin(request);
    const { id } = await context.params;
    return NextResponse.json(restoreTrashEntry(parsePositiveInteger(id, "id")));
  }));
}
