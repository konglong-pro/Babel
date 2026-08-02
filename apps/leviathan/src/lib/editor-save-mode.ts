export function noteModeAfterSave(noteId: number | null): "edit" | "view" {
  return noteId === null ? "view" : "edit";
}
