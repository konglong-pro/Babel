import { shortcutSettingsResponse } from "@babel-apps/platform/shortcuts/server";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return shortcutSettingsResponse();
}
