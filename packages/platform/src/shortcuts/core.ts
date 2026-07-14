export const SHORTCUT_SCHEMA_VERSION = 1 as const;

export const SHORTCUT_COMMANDS = [
  "save",
  "new",
  "edit",
  "confirm",
  "cancel",
  "search",
  "delete",
  "commandPalette",
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
  | `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

export interface ShortcutDefinition {
  readonly command: ShortcutCommand;
  readonly label: string;
  readonly defaultBinding: string;
}

export type ShortcutBindings = Readonly<Record<ShortcutCommand, string>>;

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
  Object.freeze({ command: "confirm", label: "Confirm", defaultBinding: "Ctrl+Enter" }),
  Object.freeze({ command: "cancel", label: "Cancel", defaultBinding: "Escape" }),
  Object.freeze({ command: "search", label: "Search", defaultBinding: "Ctrl+F" }),
  Object.freeze({ command: "delete", label: "Delete", defaultBinding: "Ctrl+Delete" }),
  Object.freeze({
    command: "commandPalette",
    label: "Command Palette",
    defaultBinding: "Ctrl+K",
  }),
]);

const COMMAND_SET = new Set<string>(SHORTCUT_COMMANDS);
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
]);
const EXACT_DANGEROUS_BINDINGS = new Set([
  "Alt+F4",
  "Alt+Escape",
  "Alt+Space",
  "Ctrl+Escape",
  "Ctrl+Alt+Delete",
  "Ctrl+Shift+Escape",
  "Ctrl+W",
  "Ctrl+Shift+W",
  "Ctrl+T",
  "Ctrl+Shift+T",
  "Ctrl+L",
  "Ctrl+R",
  "F5",
  "Ctrl+F5",
  "F11",
  "F12",
]);

function makeDefaultBindings(): Record<ShortcutCommand, string> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map(({ command, defaultBinding }) => [command, defaultBinding]),
  ) as Record<ShortcutCommand, string>;
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

export function parseShortcutBinding(value: string): ParsedShortcutBinding {
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
  if (!isBareEscape && !modifierSet.has("Ctrl") && !modifierSet.has("Alt")) {
    throw new ShortcutValidationError(
      "Every shortcut except bare Escape must include Ctrl or Alt.",
    );
  }

  const binding = [
    ...MODIFIER_ORDER.filter((modifier) => modifierSet.has(modifier)),
    key,
  ].join("+");

  if (EXACT_DANGEROUS_BINDINGS.has(binding)) {
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

export function normalizeShortcutBinding(value: string): string {
  return parseShortcutBinding(value).binding;
}

export function parseShortcutSettings(value: unknown): ShortcutSettings {
  if (!isRecord(value)) {
    throw new ShortcutValidationError("Shortcut settings must be an object.");
  }
  assertExactKeys(value, ["schemaVersion", "bindings"], "Shortcut settings");

  if (value.schemaVersion !== SHORTCUT_SCHEMA_VERSION) {
    throw new ShortcutValidationError(
      `Unsupported shortcut settings schema version: ${String(value.schemaVersion)}.`,
    );
  }
  if (!isRecord(value.bindings)) {
    throw new ShortcutValidationError("Shortcut bindings must be an object.");
  }
  assertExactKeys(value.bindings, SHORTCUT_COMMANDS, "Shortcut bindings");

  const normalizedBindings = {} as Record<ShortcutCommand, string>;
  const assignedBindings = new Map<string, ShortcutCommand>();
  for (const command of SHORTCUT_COMMANDS) {
    const rawBinding = value.bindings[command];
    if (typeof rawBinding !== "string") {
      throw new ShortcutValidationError(`Shortcut binding for ${command} must be a string.`);
    }

    const binding = normalizeShortcutBinding(rawBinding);
    const previousCommand = assignedBindings.get(binding);
    if (previousCommand !== undefined) {
      throw new ShortcutValidationError(
        `Shortcut binding ${binding} is assigned to both ${previousCommand} and ${command}.`,
      );
    }
    assignedBindings.set(binding, command);
    normalizedBindings[command] = binding;
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
    event.metaKey === true
  );
}

export function matchesShortcutBinding(
  event: ShortcutKeyboardEventLike,
  binding: string | ParsedShortcutBinding,
): boolean {
  if (shouldIgnoreShortcutEvent(event)) return false;

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
