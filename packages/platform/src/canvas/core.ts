export const CANVAS_SCENE_MAX_BYTES = 5 * 1024 * 1024;
export const CANVAS_ELEMENT_MAX_COUNT = 2_000;

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

interface CanvasElementBase {
  id: string;
}

export interface CanvasCardElement extends CanvasElementBase {
  type: "card";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface CanvasPathElement extends CanvasElementBase {
  type: "path";
  points: CanvasPoint[];
}

export interface CanvasShapeElement extends CanvasElementBase {
  type: "shape";
  shape: "rectangle" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasArrowElement extends CanvasElementBase {
  type: "arrow";
  start: CanvasPoint;
  end: CanvasPoint;
}

export type CanvasElement =
  | CanvasCardElement
  | CanvasPathElement
  | CanvasShapeElement
  | CanvasArrowElement;

export interface CanvasScene {
  version: 1;
  elements: CanvasElement[];
  viewport: CanvasViewport;
}

export interface CanvasSummary {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasDetail extends CanvasSummary {
  scene: CanvasScene;
}

export interface CanvasApiClient {
  list(signal?: AbortSignal): Promise<CanvasSummary[]>;
  get(id: number, signal?: AbortSignal): Promise<CanvasDetail>;
  create(title: string): Promise<CanvasDetail>;
  update(id: number, input: { title?: string; scene?: CanvasScene }): Promise<CanvasDetail>;
  delete(id: number): Promise<void>;
  errorMessage(error: unknown): string;
}

export function createEmptyCanvasScene(): CanvasScene {
  return {
    version: 1,
    elements: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function decodeCanvasScene(value: string): CanvasScene {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Canvas scene must be valid JSON.");
  }
  return parseCanvasScene(parsed);
}

export function encodeCanvasScene(value: unknown): string {
  const scene = parseCanvasScene(value);
  const encoded = JSON.stringify(scene);
  if (new TextEncoder().encode(encoded).byteLength > CANVAS_SCENE_MAX_BYTES) {
    throw new Error("Canvas scene must not exceed 5 MiB.");
  }
  return encoded;
}

export function parseCanvasScene(value: unknown): CanvasScene {
  if (!isObject(value) || value.version !== 1) {
    throw new Error("Canvas scene version is invalid.");
  }
  if (!Array.isArray(value.elements) || value.elements.length > CANVAS_ELEMENT_MAX_COUNT) {
    throw new Error(`Canvas scene may contain at most ${CANVAS_ELEMENT_MAX_COUNT} elements.`);
  }
  if (!isViewport(value.viewport)) {
    throw new Error("Canvas viewport is invalid.");
  }

  const ids = new Set<string>();
  for (const element of value.elements) {
    if (!isCanvasElement(element)) throw new Error("Canvas scene contains an invalid element.");
    if (ids.has(element.id)) throw new Error("Canvas element ids must be unique.");
    ids.add(element.id);
  }
  return value as unknown as CanvasScene;
}

export function fitCanvasViewport(
  elements: readonly CanvasElement[],
  width: number,
  height: number,
  padding = 28,
): CanvasViewport {
  const bounds = canvasElementBounds(elements);
  if (bounds === null || width <= 0 || height <= 0) {
    return { x: width / 2, y: height / 2, zoom: 1 };
  }
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const zoom = clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight), 0.1, 4);
  return {
    x: (width - contentWidth * zoom) / 2 - bounds.minX * zoom,
    y: (height - contentHeight * zoom) / 2 - bounds.minY * zoom,
    zoom,
  };
}

function canvasElementBounds(elements: readonly CanvasElement[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (elements.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (point: CanvasPoint) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const element of elements) {
    if (element.type === "path") {
      element.points.forEach(include);
    } else if (element.type === "arrow") {
      include(element.start);
      include(element.end);
    } else {
      include({ x: element.x, y: element.y });
      include({ x: element.x + element.width, y: element.y + element.height });
    }
  }
  return { minX, minY, maxX, maxY };
}

function isCanvasElement(value: unknown): value is CanvasElement {
  if (!isObject(value) || !isId(value.id) || typeof value.type !== "string") return false;
  if (value.type === "card") {
    return isCoordinate(value.x) && isCoordinate(value.y) && isSize(value.width) &&
      isSize(value.height) && typeof value.text === "string" && value.text.length <= 20_000;
  }
  if (value.type === "path") {
    return Array.isArray(value.points) && value.points.length >= 2 &&
      value.points.length <= 20_000 && value.points.every(isPoint);
  }
  if (value.type === "shape") {
    return (value.shape === "rectangle" || value.shape === "ellipse") &&
      isCoordinate(value.x) && isCoordinate(value.y) && isSize(value.width) && isSize(value.height);
  }
  if (value.type === "arrow") return isPoint(value.start) && isPoint(value.end);
  return false;
}

function isViewport(value: unknown): value is CanvasViewport {
  return isObject(value) && isCoordinate(value.x) && isCoordinate(value.y) &&
    typeof value.zoom === "number" && Number.isFinite(value.zoom) &&
    value.zoom >= 0.1 && value.zoom <= 4;
}

function isPoint(value: unknown): value is CanvasPoint {
  return isObject(value) && isCoordinate(value.x) && isCoordinate(value.y);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 100_000;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
