import { sqlite } from "../src/lib/db/client";
import { rebuildAllNoteLinks } from "../src/lib/repositories";

try {
  const result = rebuildAllNoteLinks();
  console.log(
    `Bio link index rebuilt: ${result.sources} sources, ${result.links} links, ` +
      `${result.unresolved.length} unresolved.`,
  );
  if (result.unresolved.length > 0) {
    console.log("Unresolved links:");
    for (const link of result.unresolved) {
      console.log(
        `- source ${link.sourceId} (${JSON.stringify(link.sourceTitle)}): ` +
          JSON.stringify(link.targetTitleKey),
      );
    }
  }
} finally {
  sqlite.close();
}
