export function archiveModeAfterSave(itemId: number | null): "edit" | "view" {
  return itemId === null ? "view" : "edit";
}
