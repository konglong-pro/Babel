export const SHORTCUT_SCHEMA_VERSION = 5 as const;

export const SHORTCUT_COMMANDS = [
  "save",
  "new",
  "edit",
  "read",
  "confirm",
  "cancel",
  "search",
  "delete",
  "underlineSelection",
  "removeUnderline",
  "commandPalette",
  "focusNextPane",
  "focusPreviousPane",
  "nextTab",
  "previousTab",
  "closeTab",
  "quickOpen",
  "help",
] as const;

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number];

export type ShortcutKey =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "Enter"
  | "Escape"
  | "Delete"
  | "Backspace"
  | "Space"
  | "Tab"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

export interface ShortcutDefinition {
  readonly command: ShortcutCommand;
  readonly label: string;
  readonly defaultBinding: string;
}

export type ShortcutBinding = string | null;

export type ShortcutBindings = Readonly<Record<ShortcutCommand, ShortcutBinding>>;

export type ShortcutMode = "app" | "edit" | "read";

export const LAUNCHER_SHORTCUT_COMMANDS = [
  "previousApp", "nextApp", "openApp", "stopApp", "hideLauncher",
  "focusNextPane", "focusPreviousPane",
] as const;

export type LauncherShortcutCommand = (typeof LAUNCHER_SHORTCUT_COMMANDS)[number];
export type LauncherBindings = Readonly<Record<LauncherShortcutCommand, ShortcutBinding>>;

export interface ShortcutLayers {
  readonly app: Partial<ShortcutBindings>;
  readonly edit: Partial<ShortcutBindings>;
  readonly read: Partial<ShortcutBindings>;
  readonly launcher: LauncherBindings;
}

export interface ShortcutSettings {
  readonly schemaVersion: typeof SHORTCUT_SCHEMA_VERSION;
  readonly bindings: ShortcutBindings;
  readonly layers: ShortcutLayers;
}

export interface ParsedShortcutBinding {
  readonly binding: string;
  readonly key: ShortcutKey;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface ShortcutKeyboardEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly repeat?: boolean;
  readonly defaultPrevented?: boolean;
  readonly getModifierState?: (keyArg: string) => boolean;
}

export class ShortcutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShortcutValidationError";
  }
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = Object.freeze([
  Object.freeze({ command: "save", label: "Save", defaultBinding: "Ctrl+S" }),
  Object.freeze({ command: "new", label: "New", defaultBinding: "Ctrl+Alt+N" }),
  Object.freeze({ command: "edit", label: "Edit", defaultBinding: "Ctrl+Alt+E" }),
  Object.freeze({ command: "read", label: "Read", defaultBinding: "Ctrl+R" }),
  Object.freeze({ command: "confirm", label: "Confirm", defaultBinding: "Ctrl+Enter" }),
  Object.freeze({ command: "cancel", label: "Cancel", defaultBinding: "Escape" }),
  Object.freeze({ command: "search", label: "Search", defaultBinding: "Ctrl+F" }),
  Object.freeze({ command: "delete", label: "Delete", defaultBinding: "Ctrl+Delete" }),
  Object.freeze({
    command: "underlineSelection",
    label: "Underline Selection",
    defaultBinding: "Ctrl+Shift+U",
  }),
  Object.freeze({
    command: "removeUnderline",
    label: "Remove Underline",
    defaultBinding: "Ctrl+Alt+U",
  }),
  Object.freeze({
    command: "commandPalette",
    label: "Command Palette",
    defaultBinding: "Ctrl+K",
  }),
  Object.freeze({
    command: "focusNextPane",
    label: "Focus Next Pane",
    defaultBinding: "Ctrl+F6",
  }),
  Object.freeze({
    command: "focusPreviousPane",
    label: "Focus Previous Pane",
    defaultBinding: "Ctrl+Shift+F6",
  }),
  Object.freeze({
    command: "nextTab",
    label: "Next Tab",
    defaultBinding: "Ctrl+Alt+ArrowRight",
  }),
  Object.freeze({
    command: "previousTab",
    label: "Previous Tab",
    defaultBinding: "Ctrl+Alt+ArrowLeft",
  }),
  Object.freeze({
    command: "closeTab",
    label: "Close Tab",
    defaultBinding: "Ctrl+Alt+W",
  }),
  Object.freeze({
    command: "quickOpen",
    label: "Quick Open",
    defaultBinding: "Ctrl+Alt+P",
  }),
  Object.freeze({
    command: "help",
    label: "Keyboard Help",
    defaultBinding: "Ctrl+Alt+H",
  }),
]);

export const LAUNCHER_SHORTCUT_DEFINITIONS: readonly {
  readonly command: LauncherShortcutCommand;
  readonly label: string;
  readonly defaultBinding: string;
}[] = Object.freeze([
  Object.freeze({ command: "previousApp", label: "Previous APP", defaultBinding: "ArrowUp" }),
  Object.freeze({ command: "nextApp", label: "Next APP", defaultBinding: "ArrowDown" }),
  Object.freeze({ command: "openApp", label: "Open APP", defaultBinding: "Enter" }),
  Object.freeze({ command: "stopApp", label: "Stop APP", defaultBinding: "Delete" }),
  Object.freeze({ command: "hideLauncher", label: "Hide Launcher", defaultBinding: "Escape" }),
  Object.freeze({ command: "focusNextPane", label: "Focus Next Pane", defaultBinding: "Tab" }),
  Object.freeze({ command: "focusPreviousPane", label: "Focus Previous Pane", defaultBinding: "Shift+Tab" }),
]);

const COMMAND_SET = new Set<string>(SHORTCUT_COMMANDS);
const VERSION_ONE_SHORTCUT_COMMANDS = [
  "save",
  "new",
  "edit",
  "confirm",
  "cancel",
  "search",
  "delete",
  "commandPalette",
] as const;
const VERSION_TWO_SHORTCUT_COMMANDS = [
  "save",
  "new",
  "edit",
  "read",
  "confirm",
  "cancel",
  "search",
  "delete",
  "commandPalette",
] as const;
const VERSION_THREE_SHORTCUT_COMMANDS = [
  "save",
  "new",
  "edit",
  "read",
  "confirm",
  "cancel",
  "search",
  "delete",
  "commandPalette",
  "focusNextPane",
  "focusPreviousPane",
  "nextTab",
  "previousTab",
  "closeTab",
  "quickOpen",
  "help",
] as const;
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift"] as const;
const NAMED_KEYS = new Map<string, ShortcutKey>([
  ["enter", "Enter"],
  ["return", "Enter"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["backspace", "Backspace"],
  ["back", "Backspace"],
  ["space", "Space"],
  ["tab", "Tab"],
  ["arrowup", "ArrowUp"],
  ["up", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["down", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["left", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["right", "ArrowRight"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
]);
const EXACT_DANGEROUS_BINDINGS = new Set([
  "Alt+F4",
  "Alt+Escape",
  "Alt+Space",
  "Ctrl+Escape",
  "Ctrl+Alt+Delete",
  "Ctrl+Alt+ArrowUp",
  "Ctrl+Alt+ArrowDown",
  "Ctrl+Shift+Escape",
  "Alt+Tab",
  "Alt+Shift+Tab",
  "Ctrl+Alt+Tab",
  "Ctrl+Alt+Shift+Tab",
  "F2",
]);
const DESKTOP_ONLY_BINDINGS = new Set([
  "Ctrl+W",
  "Ctrl+Shift+W",
  "Ctrl+T",
  "Ctrl+Shift+T",
  "Ctrl+L",
  "Ctrl+N",
  "Ctrl+Shift+N",
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
  "F5",
  "Ctrl+F5",
  "F6",
  "F11",
  "F12",
]);
const LEGACY_FIXED_NAVIGATION_BINDINGS = new Set([
  "Ctrl+Alt+ArrowUp",
  "Ctrl+Alt+ArrowDown",
]);

function makeDefaultBindings(): Record<ShortcutCommand, ShortcutBinding> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map(({ command, defaultBinding }) => [command, defaultBinding]),
  ) as Record<ShortcutCommand, ShortcutBinding>;
}

function makeDefaultLayers(): ShortcutLayers {
  return {
    app: {},
    edit: {},
    read: {},
    launcher: Object.fromEntries(
      LAUNCHER_SHORTCUT_DEFINITIONS.map(({ command, defaultBinding }) => [command, defaultBinding]),
    ) as Record<LauncherShortcutCommand, ShortcutBinding>,
  };
}

const defaultLayers = makeDefaultLayers();

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = Object.freeze({
  schemaVersion: SHORTCUT_SCHEMA_VERSION,
  bindings: Object.freeze(makeDefaultBindings()),
  layers: Object.freeze({
    app: Object.freeze(defaultLayers.app),
    edit: Object.freeze(defaultLayers.edit),
    read: Object.freeze(defaultLayers.read),
    launcher: Object.freeze(defaultLayers.launcher),
  }),
});

export function getDefaultShortcutSettings(): ShortcutSettings {
  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings },
    layers: makeDefaultLayers(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  name: string,
): void {
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new ShortcutValidationError(`${name} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
}

function normalizeKey(keyPart: string): ShortcutKey {
  if (/^[a-z]$/i.test(keyPart)) return keyPart.toUpperCase() as ShortcutKey;
  if (/^[0-9]$/.test(keyPart)) return keyPart as ShortcutKey;

  const namedKey = NAMED_KEYS.get(keyPart.toLowerCase());
  if (namedKey !== undefined) return namedKey;

  const functionKey = /^f([1-9]|1[0-2])$/i.exec(keyPart);
  if (functionKey !== null) return `F${functionKey[1]}` as ShortcutKey;

  throw new ShortcutValidationError(`Unsupported shortcut key: ${keyPart}.`);
}

function parseShortcutBindingInternal(
  value: string,
  allowLegacyFixedNavigationBindings = false,
  allowBare = false,
): ParsedShortcutBinding {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ShortcutValidationError("Shortcut binding must be a non-empty string.");
  }

  const parts = value.split("+").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    throw new ShortcutValidationError(`Invalid shortcut binding: ${value}.`);
  }

  const modifierSet = new Set<(typeof MODIFIER_ORDER)[number]>();
  let keyPart: string | undefined;

  for (const part of parts) {
    const normalizedPart = part.toLowerCase() === "control" ? "ctrl" : part.toLowerCase();
    const modifier = MODIFIER_ORDER.find(
      (candidate) => candidate.toLowerCase() === normalizedPart,
    );
    if (modifier !== undefined) {
      if (modifierSet.has(modifier)) {
        throw new ShortcutValidationError(`Duplicate shortcut modifier: ${modifier}.`);
      }
      modifierSet.add(modifier);
      continue;
    }

    if (keyPart !== undefined) {
      throw new ShortcutValidationError(`Shortcut binding must contain exactly one key: ${value}.`);
    }
    keyPart = part;
  }

  if (keyPart === undefined) {
    throw new ShortcutValidationError(`Shortcut binding is missing a key: ${value}.`);
  }

  const key = normalizeKey(keyPart);
  const isBareEscape = key === "Escape" && modifierSet.size === 0;
  const isBareFunctionKey = /^F([1-9]|1[0-2])$/.test(key) && modifierSet.size === 0;
  if (
    !allowBare &&
    !isBareEscape &&
    !isBareFunctionKey &&
    !modifierSet.has("Ctrl") &&
    !modifierSet.has("Alt")
  ) {
    throw new ShortcutValidationError(
      "Every shortcut except bare Escape or a safe bare function key must include Ctrl or Alt.",
    );
  }

  const binding = [
    ...MODIFIER_ORDER.filter((modifier) => modifierSet.has(modifier)),
    key,
  ].join("+");

  if (
    EXACT_DANGEROUS_BINDINGS.has(binding) &&
    !(
      allowLegacyFixedNavigationBindings &&
      LEGACY_FIXED_NAVIGATION_BINDINGS.has(binding)
    )
  ) {
    throw new ShortcutValidationError(`Shortcut binding is reserved or unsafe: ${binding}.`);
  }

  return {
    binding,
    key,
    ctrlKey: modifierSet.has("Ctrl"),
    altKey: modifierSet.has("Alt"),
    shiftKey: modifierSet.has("Shift"),
  };
}

export function parseShortcutBinding(value: string, allowBare = false): ParsedShortcutBinding {
  return parseShortcutBindingInternal(value, false, allowBare);
}

export function normalizeShortcutBinding(value: string, allowBare = false): string {
  return parseShortcutBinding(value, allowBare).binding;
}

export function isDesktopOnlyShortcutBinding(binding: string | null): boolean {
  return binding !== null && DESKTOP_ONLY_BINDINGS.has(normalizeShortcutBinding(binding, true));
}

export function isShortcutBindingAvailable(binding: string | null, desktop: boolean): boolean {
  return binding !== null && (desktop || !isDesktopOnlyShortcutBinding(binding));
}

function assertCommandBindingOwnership(command: ShortcutCommand, binding: string): void {
  if (binding === "Escape" && command !== "cancel") {
    throw new ShortcutValidationError(
      `Shortcut binding Escape is reserved for cancel and fixed navigation behavior, not ${command}.`,
    );
  }
}

function parseModeLayer(value: unknown, mode: ShortcutMode): Partial<ShortcutBindings> {
  if (!isRecord(value)) {
    throw new ShortcutValidationError(`Shortcut layer ${mode} must be an object.`);
  }
  const bindings: Partial<Record<ShortcutCommand, ShortcutBinding>> = {};
  const assigned = new Map<string, ShortcutCommand>();
  for (const [command, rawBinding] of Object.entries(value)) {
    if (!isShortcutCommand(command)) {
      throw new ShortcutValidationError(`Unknown command ${command} in shortcut layer ${mode}.`);
    }
    if (rawBinding === undefined) continue;
    if (rawBinding === null) {
      bindings[command] = null;
      continue;
    }
    if (typeof rawBinding !== "string") {
      throw new ShortcutValidationError(`Shortcut binding for ${mode}.${command} must be a string or null.`);
    }
    const parsed = parseShortcutBinding(rawBinding, true);
    if (!parsed.ctrlKey && !parsed.altKey && (parsed.key === "Tab" || parsed.key === "Enter")) {
      throw new ShortcutValidationError(`Shortcut binding ${parsed.binding} is reserved for focus and native controls.`);
    }
    assertCommandBindingOwnership(command, parsed.binding);
    const previous = assigned.get(parsed.binding);
    if (previous !== undefined) {
      throw new ShortcutValidationError(`Shortcut binding ${parsed.binding} is assigned to both ${previous} and ${command} in layer ${mode}.`);
    }
    assigned.set(parsed.binding, command);
    bindings[command] = parsed.binding;
  }
  return bindings;
}

function parseLauncherBindings(value: unknown): LauncherBindings {
  if (!isRecord(value)) {
    throw new ShortcutValidationError("Launcher shortcut bindings must be an object.");
  }
  assertExactKeys(value, LAUNCHER_SHORTCUT_COMMANDS, "Launcher shortcut bindings");
  const bindings = {} as Record<LauncherShortcutCommand, ShortcutBinding>;
  const assigned = new Map<string, LauncherShortcutCommand>();
  for (const command of LAUNCHER_SHORTCUT_COMMANDS) {
    const rawBinding = value[command];
    if (rawBinding === null) {
      bindings[command] = null;
      continue;
    }
    if (typeof rawBinding !== "string") {
      throw new ShortcutValidationError(`Launcher shortcut binding for ${command} must be a string or null.`);
    }
    const binding = normalizeShortcutBinding(rawBinding, true);
    if (binding === "Escape" && command !== "hideLauncher") {
      throw new ShortcutValidationError("Launcher shortcut binding Escape is reserved for hideLauncher.");
    }
    const previous = assigned.get(binding);
    if (previous !== undefined) {
      throw new ShortcutValidationError(`Launcher shortcut binding ${binding} is assigned to both ${previous} and ${command}.`);
    }
    assigned.set(binding, command);
    bindings[command] = binding;
  }
  return bindings;
}

function parseShortcutLayers(value: unknown): ShortcutLayers {
  if (!isRecord(value)) {
    throw new ShortcutValidationError("Shortcut layers must be an object.");
  }
  assertExactKeys(value, ["app", "edit", "read", "launcher"], "Shortcut layers");
  return {
    app: parseModeLayer(value.app, "app"),
    edit: parseModeLayer(value.edit, "edit"),
    read: parseModeLayer(value.read, "read"),
    launcher: parseLauncherBindings(value.launcher),
  };
}

function overlayBindings(base: ShortcutBindings, layer: Partial<ShortcutBindings>): ShortcutBindings {
  const overriddenBindings = new Set(Object.values(layer).filter((binding) => binding != null));
  return Object.fromEntries(SHORTCUT_COMMANDS.map((command) => {
    const override = layer[command];
    const inherited = base[command];
    return [command, override !== undefined
      ? override
      : inherited !== null && overriddenBindings.has(inherited) ? null : inherited];
  })) as Record<ShortcutCommand, ShortcutBinding>;
}

/** Resolve one mode, suppressing any lower command whose key was claimed by a higher layer. */
export function resolveShortcutBindings(settings: ShortcutSettings, mode: ShortcutMode): ShortcutBindings {
  const appBindings = overlayBindings(settings.bindings, settings.layers.app);
  return mode === "app" ? appBindings : overlayBindings(appBindings, settings.layers[mode]);
}

export function parseShortcutSettings(value: unknown): ShortcutSettings {
  if (!isRecord(value)) {
    throw new ShortcutValidationError("Shortcut settings must be an object.");
  }
  if (
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== 3 &&
    value.schemaVersion !== 4 &&
    value.schemaVersion !== SHORTCUT_SCHEMA_VERSION
  ) {
    throw new ShortcutValidationError(
      `Unsupported shortcut settings schema version: ${String(value.schemaVersion)}.`,
    );
  }
  assertExactKeys(
    value,
    value.schemaVersion === SHORTCUT_SCHEMA_VERSION
      ? ["schemaVersion", "bindings", "layers"]
      : ["schemaVersion", "bindings"],
    "Shortcut settings",
  );
  if (!isRecord(value.bindings)) {
    throw new ShortcutValidationError("Shortcut bindings must be an object.");
  }
  const sourceCommands =
    value.schemaVersion === 1
      ? VERSION_ONE_SHORTCUT_COMMANDS
      : value.schemaVersion === 2
        ? VERSION_TWO_SHORTCUT_COMMANDS
        : value.schemaVersion === 3
          ? VERSION_THREE_SHORTCUT_COMMANDS
          : SHORTCUT_COMMANDS;
  assertExactKeys(value.bindings, sourceCommands, "Shortcut bindings");

  const sourceBindings = new Map<ShortcutCommand, ShortcutBinding>();
  const assignedBindings = new Map<string, ShortcutCommand>();
  for (const command of sourceCommands) {
    const rawBinding = value.bindings[command];
    if (rawBinding === null && value.schemaVersion >= 3) {
      sourceBindings.set(command, null);
      continue;
    }
    if (typeof rawBinding !== "string") {
      throw new ShortcutValidationError(
        `Shortcut binding for ${command} must be a string${
          value.schemaVersion >= 3 ? " or null" : ""
        }.`,
      );
    }

    const binding = parseShortcutBindingInternal(
      rawBinding,
      value.schemaVersion < 3,
    ).binding;
    if (
      value.schemaVersion < 3 &&
      LEGACY_FIXED_NAVIGATION_BINDINGS.has(binding)
    ) {
      sourceBindings.set(command, null);
      continue;
    }
    if (
      value.schemaVersion < 3 &&
      binding === "Escape" &&
      command !== "cancel"
    ) {
      sourceBindings.set(command, null);
      continue;
    }
    assertCommandBindingOwnership(command, binding);
    const previousCommand = assignedBindings.get(binding);
    if (previousCommand !== undefined) {
      throw new ShortcutValidationError(
        `Shortcut binding ${binding} is assigned to both ${previousCommand} and ${command}.`,
      );
    }
    assignedBindings.set(binding, command);
    sourceBindings.set(command, binding);
  }

  const normalizedBindings = {} as Record<ShortcutCommand, ShortcutBinding>;
  for (const command of SHORTCUT_COMMANDS) {
    if (sourceBindings.has(command)) {
      normalizedBindings[command] = sourceBindings.get(command) ?? null;
      continue;
    }

    const defaultBinding = normalizeShortcutBinding(
      SHORTCUT_DEFINITIONS.find((definition) => definition.command === command)!.defaultBinding,
    );
    if (assignedBindings.has(defaultBinding)) {
      normalizedBindings[command] = null;
      continue;
    }
    assertCommandBindingOwnership(command, defaultBinding);
    assignedBindings.set(defaultBinding, command);
    normalizedBindings[command] = defaultBinding;
  }

  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    bindings: normalizedBindings,
    layers: value.schemaVersion === SHORTCUT_SCHEMA_VERSION
      ? parseShortcutLayers(value.layers)
      : makeDefaultLayers(),
  };
}

export const validateShortcutSettings = parseShortcutSettings;

function normalizeEventKey(value: string): ShortcutKey | undefined {
  if (value === " ") return "Space";
  try {
    return normalizeKey(value);
  } catch {
    return undefined;
  }
}

export function shouldIgnoreShortcutEvent(event: ShortcutKeyboardEventLike): boolean {
  return (
    event.defaultPrevented === true ||
    event.repeat === true ||
    event.isComposing === true ||
    event.keyCode === 229 ||
    event.getModifierState?.("AltGraph") === true ||
    event.metaKey === true
  );
}

export function matchesShortcutBinding(
  event: ShortcutKeyboardEventLike,
  binding: string | ParsedShortcutBinding | null,
): boolean {
  if (shouldIgnoreShortcutEvent(event)) return false;
  if (binding === null) return false;

  const parsed = typeof binding === "string" ? parseShortcutBinding(binding, true) : binding;
  const eventKey = normalizeEventKey(event.key) ?? (
    event.shiftKey === true && /^Digit[0-9]$/.test(event.code ?? "")
      ? event.code!.slice(-1) as ShortcutKey
      : undefined
  );
  return (
    eventKey === parsed.key &&
    (event.ctrlKey === true) === parsed.ctrlKey &&
    (event.altKey === true) === parsed.altKey &&
    (event.shiftKey === true) === parsed.shiftKey
  );
}

export function isShortcutCommand(value: string): value is ShortcutCommand {
  return COMMAND_SET.has(value);
}
