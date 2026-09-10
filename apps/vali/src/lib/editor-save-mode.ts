export function persistedEditorModeAfterSave(
  persistedBeforeSave: boolean,
): "edit" | "view" {
  return persistedBeforeSave ? "edit" : "view";
}
