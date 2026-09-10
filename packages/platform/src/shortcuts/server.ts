import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  getDefaultShortcutSettings,
  parseShortcutSettings,
  type ShortcutSettings,
} from "./core";

export interface ShortcutSettingsLoaderOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly path?: string;
}

export function resolveShortcutSettingsPath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = environment.BABEL_SHORTCUTS_PATH?.trim();
  if (override) return override;

  const localAppData = environment.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
  return join(localAppData, "Babel", "shortcuts.json");
}

export function loadShortcutSettings(
  options: ShortcutSettingsLoaderOptions = {},
): ShortcutSettings {
  const settingsPath = options.path ?? resolveShortcutSettingsPath(options.environment);
  try {
    const document: unknown = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ settingsPath, "utf8"),
    );
    return parseShortcutSettings(document);
  } catch {
    return getDefaultShortcutSettings();
  }
}

export function shortcutSettingsResponse(
  settings: ShortcutSettings = loadShortcutSettings(),
): Response {
  return Response.json(settings, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
