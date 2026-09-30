export function entryModeAfterSave(entryId: number | null): "edit" | "view" {
  return entryId === null ? "view" : "edit";
}
