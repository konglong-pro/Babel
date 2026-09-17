export const SHORTCUT_SCHEMA_VERSION = 3 as const;

export const SHORTCUT_COMMANDS = [
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

export interface ShortcutSettings {
  readonly schemaVersion: typeof SHORTCUT_SCHEMA_VERSION;
  readonly bindings: ShortcutBindings;
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
  "Ctrl+W",
  "Ctrl+Shift+W",
  "Ctrl+T",
  "Ctrl+Shift+T",
  "Ctrl+L",
  "F2",
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

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = Object.freeze({
  schemaVersion: SHORTCUT_SCHEMA_VERSION,
  bindings: Object.freeze(makeDefaultBindings()),
});

export function getDefaultShortcutSettings(): ShortcutSettings {
  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings },
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

export function parseShortcutBinding(value: string): ParsedShortcutBinding {
  return parseShortcutBindingInternal(value);
}

export function normalizeShortcutBinding(value: string): string {
  return parseShortcutBinding(value).binding;
}

function assertCommandBindingOwnership(command: ShortcutCommand, binding: string): void {
  if (binding === "Escape" && command !== "cancel") {
    throw new ShortcutValidationError(
      `Shortcut binding Escape is reserved for cancel and fixed navigation behavior, not ${command}.`,
    );
  }
}

export function parseShortcutSettings(value: unknown): ShortcutSettings {
  if (!isRecord(value)) {
    throw new ShortcutValidationError("Shortcut settings must be an object.");
  }
  assertExactKeys(value, ["schemaVersion", "bindings"], "Shortcut settings");

  if (
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== SHORTCUT_SCHEMA_VERSION
  ) {
    throw new ShortcutValidationError(
      `Unsupported shortcut settings schema version: ${String(value.schemaVersion)}.`,
    );
  }
  if (!isRecord(value.bindings)) {
    throw new ShortcutValidationError("Shortcut bindings must be an object.");
  }
  const sourceCommands =
    value.schemaVersion === 1
      ? VERSION_ONE_SHORTCUT_COMMANDS
      : value.schemaVersion === 2
        ? VERSION_TWO_SHORTCUT_COMMANDS
        : SHORTCUT_COMMANDS;
  assertExactKeys(value.bindings, sourceCommands, "Shortcut bindings");

  const sourceBindings = new Map<ShortcutCommand, ShortcutBinding>();
  const assignedBindings = new Map<string, ShortcutCommand>();
  for (const command of sourceCommands) {
    const rawBinding = value.bindings[command];
    if (rawBinding === null && value.schemaVersion === SHORTCUT_SCHEMA_VERSION) {
      sourceBindings.set(command, null);
      continue;
    }
    if (typeof rawBinding !== "string") {
      throw new ShortcutValidationError(
        `Shortcut binding for ${command} must be a string${
          value.schemaVersion === SHORTCUT_SCHEMA_VERSION ? " or null" : ""
        }.`,
      );
    }

    const binding = parseShortcutBindingInternal(
      rawBinding,
      value.schemaVersion !== SHORTCUT_SCHEMA_VERSION,
    ).binding;
    if (
      value.schemaVersion !== SHORTCUT_SCHEMA_VERSION &&
      LEGACY_FIXED_NAVIGATION_BINDINGS.has(binding)
    ) {
      sourceBindings.set(command, null);
      continue;
    }
    if (
      value.schemaVersion !== SHORTCUT_SCHEMA_VERSION &&
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

  const parsed = typeof binding === "string" ? parseShortcutBinding(binding) : binding;
  return (
    normalizeEventKey(event.key) === parsed.key &&
    (event.ctrlKey === true) === parsed.ctrlKey &&
    (event.altKey === true) === parsed.altKey &&
    (event.shiftKey === true) === parsed.shiftKey
  );
}

export function isShortcutCommand(value: string): value is ShortcutCommand {
  return COMMAND_SET.has(value);
}
