import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { assertSameOrigin, parsePositiveInteger } from "@/lib/http/request";
import { withEntryMutationLock } from "@/lib/mutation-lock";
import { getTrashEntry, purgeTrashEntry } from "@/lib/repositories/trash";
import {
  finalizeQuarantinedEntryImages,
  quarantineEntryImages,
  restoreQuarantinedEntryImages,
  type EntryImageQuarantine,
} from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const entry = getTrashEntry(await routeId(context));
    if (!entry) throw trashEntryNotFound();
    return NextResponse.json(entry);
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(() => withEntryMutationLock(async () => {
    assertSameOrigin(request);
    const id = await routeId(context);
    const entry = getTrashEntry(id);
    if (!entry) throw trashEntryNotFound();

    let quarantine: EntryImageQuarantine | undefined;
    try {
      quarantine = await quarantineEntryImages(entry.imagePaths);
      if (!purgeTrashEntry(id, entry.imagePaths)) throw trashEntryNotFound();
    } catch (error) {
      if (quarantine) {
        try {
          await restoreQuarantinedEntryImages(quarantine);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            "Trash purge failed and its images could not be restored.",
          );
        }
      }
      throw error;
    }
    await finalizeQuarantinedEntryImages(quarantine!);
    return new Response(null, { status: 204 });
  }));
}

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

function trashEntryNotFound(): ApiError {
  return new ApiError(404, "TRASH_ENTRY_NOT_FOUND", "Trash entry not found.");
}
