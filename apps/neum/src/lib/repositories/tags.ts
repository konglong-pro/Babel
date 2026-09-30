import { asc, count, eq } from "drizzle-orm";

import { getNeumDatabase } from "@/lib/db/client";
import { entryTags, tags } from "@/lib/db/schema";
import type { TagSummaryDto } from "@/lib/types";

export function listTags(): TagSummaryDto[] {
  const { db } = getNeumDatabase();
  return db
    .select({ id: tags.id, name: tags.name, entryCount: count(entryTags.entryId) })
    .from(tags)
    .innerJoin(entryTags, eq(entryTags.tagId, tags.id))
    .groupBy(tags.id, tags.name)
    .orderBy(asc(tags.name), asc(tags.id))
    .all()
    .map((row) => ({ ...row, entryCount: Number(row.entryCount) }));
}
