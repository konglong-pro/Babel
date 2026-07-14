import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { assertSameOrigin, parsePositiveInteger } from "@/lib/http/request";
import { withEntryMutationLock } from "@/lib/mutation-lock";
import { restoreTrashEntry } from "@/lib/repositories/trash";
import { ensureEntryImageStorageRecovered } from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureEntryImageStorageRecovered();
    return withEntryMutationLock(async () => {
      const { id } = await context.params;
      return NextResponse.json(restoreTrashEntry(parsePositiveInteger(id, "id")));
    });
  });
}
