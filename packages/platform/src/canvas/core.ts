export const CANVAS_SCENE_MAX_BYTES = 5 * 1024 * 1024;
export const CANVAS_ELEMENT_MAX_COUNT = 2_000;
export const CANVAS_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasElementBase {
  id: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface CanvasTextElement extends CanvasElementBase, CanvasBounds {
  type: "text";
  text: string;
  fontSize: number;
  textAlign: "left" | "center" | "right";
}

export interface CanvasImageElement extends CanvasElementBase, CanvasBounds {
  type: "image";
  src: string;
  alt?: string;
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
  startBinding?: CanvasArrowBinding;
  endBinding?: CanvasArrowBinding;
}

export interface CanvasArrowBinding {
  elementId: string;
  anchor: CanvasPoint;
}

export type CanvasElement =
  | CanvasTextElement
  | CanvasImageElement
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
  assertSceneSize(value);
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
  return JSON.stringify(scene);
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

  const elementsById = new Map<string, CanvasElement>();
  for (const element of value.elements) {
    if (!isCanvasElement(element)) throw new Error("Canvas scene contains an invalid element.");
    if (elementsById.has(element.id)) throw new Error("Canvas element ids must be unique.");
    elementsById.set(element.id, element);
  }
  for (const element of elementsById.values()) {
    if (element.type !== "arrow") continue;
    for (const binding of [element.startBinding, element.endBinding]) {
      if (!binding) continue;
      const target = elementsById.get(binding.elementId);
      if (!target || (target.type !== "shape" && target.type !== "text" && target.type !== "image")) {
        throw new Error("Canvas arrow binding must reference a shape, text, or image.");
      }
    }
  }
  assertSceneSize(JSON.stringify(value));
  return value as unknown as CanvasScene;
}

export function elementBounds(element: CanvasElement): CanvasBounds {
  if (element.type === "shape" || element.type === "text" || element.type === "image") {
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }
  const points = element.type === "arrow" ? [element.start, element.end] : element.points;
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
    const bounds = elementBounds(element);
    include(bounds);
    include({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
  }
  return { minX, minY, maxX, maxY };
}

function isCanvasElement(value: unknown): value is CanvasElement {
  if (!isObject(value) || !isId(value.id) || typeof value.type !== "string" || !hasValidStyle(value)) return false;
  if (value.type === "text") {
    return isBox(value) && typeof value.text === "string" && value.text.length <= 20_000 &&
      typeof value.fontSize === "number" && Number.isFinite(value.fontSize) &&
      value.fontSize >= 8 && value.fontSize <= 240 &&
      (value.textAlign === "left" || value.textAlign === "center" || value.textAlign === "right");
  }
  if (value.type === "image") {
    return isBox(value) && isCanvasImageSource(value.src) &&
      (value.alt === undefined || (typeof value.alt === "string" && value.alt.length <= 2_000));
  }
  if (value.type === "path") {
    return Array.isArray(value.points) && value.points.length >= 2 &&
      value.points.length <= 20_000 && value.points.every(isPoint);
  }
  if (value.type === "shape") {
    return (value.shape === "rectangle" || value.shape === "ellipse") &&
      isBox(value);
  }
  if (value.type === "arrow") {
    return isPoint(value.start) && isPoint(value.end) &&
      (value.startBinding === undefined || isArrowBinding(value.startBinding)) &&
      (value.endBinding === undefined || isArrowBinding(value.endBinding));
  }
  return false;
}

function hasValidStyle(value: Record<string, unknown>): boolean {
  return (value.stroke === undefined || isHexColor(value.stroke)) &&
    (value.fill === undefined || value.fill === "none" || isHexColor(value.fill)) &&
    (value.strokeWidth === undefined || (typeof value.strokeWidth === "number" &&
      Number.isFinite(value.strokeWidth) && value.strokeWidth >= 1 && value.strokeWidth <= 32));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value);
}

function isBox(value: Record<string, unknown>): boolean {
  return isCoordinate(value.x) && isCoordinate(value.y) && isSize(value.width) && isSize(value.height);
}

function isArrowBinding(value: unknown): value is CanvasArrowBinding {
  return isObject(value) && isId(value.elementId) && isPoint(value.anchor) &&
    value.anchor.x >= 0 && value.anchor.x <= 1 && value.anchor.y >= 0 && value.anchor.y <= 1;
}

export function isCanvasImageSource(value: unknown): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(CANVAS_IMAGE_MAX_BYTES / 3) * 4 + 32) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match) return false;
  const [, format, encoded] = match;
  if (!encoded || encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const byteLength = encoded.length / 4 * 3 - padding;
  if (byteLength > CANVAS_IMAGE_MAX_BYTES) return false;
  // Inspect only the fixed header: no external fetches or image decoder is needed to validate storage.
  const header = atob(encoded.slice(0, Math.min(16, encoded.length)));
  if (format === "png") return header.startsWith("\x89PNG\r\n\x1a\n");
  if (format === "jpeg") return header.startsWith("\xff\xd8\xff");
  return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
}

function assertSceneSize(encoded: string): void {
  if (new TextEncoder().encode(encoded).byteLength > CANVAS_SCENE_MAX_BYTES) {
    throw new Error("Canvas scene must not exceed 5 MiB.");
  }
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
