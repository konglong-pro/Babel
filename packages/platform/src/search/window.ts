const DEFAULT_SEARCH_WINDOW_FEATURES = [
  "popup=yes",
  "width=1240",
  "height=900",
  "resizable=yes",
  "scrollbars=yes",
].join(",");

export interface OpenSearchWindowOptions {
  sessionStorageKeys?: readonly string[];
  features?: string;
}

export function openSearchWindow(
  sourceWindow: Pick<Window, "open">,
  destination: string,
  windowName: string,
  options: OpenSearchWindowOptions = {},
): boolean {
  let popup: Window | null;
  try {
    popup = sourceWindow.open(
      destination,
      windowName,
      options.features ?? DEFAULT_SEARCH_WINDOW_FEATURES,
    );
  } catch {
    return false;
  }
  if (popup === null) return false;

  try {
    for (const key of options.sessionStorageKeys ?? []) {
      popup.sessionStorage.removeItem(key);
    }
  } catch {
    // Session isolation is best effort when a named window was navigated cross-origin.
  }
  try {
    popup.opener = null;
  } catch {
    // A cross-origin named window may reject opener changes after navigation.
  }
  try {
    popup.focus();
  } catch {
    // Search still opened even when the browser refuses programmatic focus.
  }
  return true;
}
