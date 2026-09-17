import {
  elementBounds,
  type CanvasArrowBinding,
  type CanvasBounds,
  type CanvasElement,
  type CanvasPoint,
} from "./core";

const EPSILON = 1e-8;
type BoxElement = Extract<CanvasElement, { type: "shape" | "text" | "image" }>;

export function boundsForElements(elements: readonly CanvasElement[]): CanvasBounds | null {
  if (elements.length === 0) return null;
  const boxes = elements.map(elementBounds);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

export function intersectsBounds(element: CanvasElement, bounds: CanvasBounds): boolean {
  const box = elementBounds(element);
  return box.x <= bounds.x + bounds.width && box.x + box.width >= bounds.x &&
    box.y <= bounds.y + bounds.height && box.y + box.height >= bounds.y;
}

export function translateElements(
  elements: readonly CanvasElement[],
  selectedIds: ReadonlySet<string>,
  dx: number,
  dy: number,
): CanvasElement[] {
  if (dx === 0 && dy === 0) return [...elements];
  return transformElements(elements, selectedIds, (point) => ({ x: point.x + dx, y: point.y + dy }));
}

export function resizeElements(
  elements: readonly CanvasElement[],
  selectedIds: ReadonlySet<string>,
  fromBounds: CanvasBounds,
  toBounds: CanvasBounds,
): CanvasElement[] {
  if (fromBounds.x === toBounds.x && fromBounds.y === toBounds.y &&
    fromBounds.width === toBounds.width && fromBounds.height === toBounds.height) return [...elements];
  const scaleX = fromBounds.width > EPSILON ? toBounds.width / fromBounds.width : 1;
  const scaleY = fromBounds.height > EPSILON ? toBounds.height / fromBounds.height : 1;
  return transformElements(elements, selectedIds, (point) => ({
    x: toBounds.x + (point.x - fromBounds.x) * scaleX,
    y: toBounds.y + (point.y - fromBounds.y) * scaleY,
  }), scaleX, scaleY);
}

function transformElements(
  elements: readonly CanvasElement[],
  selectedIds: ReadonlySet<string>,
  transform: (point: CanvasPoint) => CanvasPoint,
  scaleX = 1,
  scaleY = 1,
): CanvasElement[] {
  const transformed = elements.map((element): CanvasElement => {
    if (!selectedIds.has(element.id)) return element;
    if (element.type === "path") return { ...element, points: element.points.map(transform) };
    if (element.type === "arrow") {
      const moved = { ...element, start: transform(element.start), end: transform(element.end) };
      if (moved.startBinding && !selectedIds.has(moved.startBinding.elementId)) delete moved.startBinding;
      if (moved.endBinding && !selectedIds.has(moved.endBinding.elementId)) delete moved.endBinding;
      return moved;
    }
    return {
      ...element,
      ...transform(element),
      width: Math.max(1, element.width * scaleX),
      height: Math.max(1, element.height * scaleY),
    };
  });
  return resolveArrowBindings(transformed);
}

export function resolveArrowBindings(elements: readonly CanvasElement[]): CanvasElement[] {
  const targets = new Map(elements.filter(isBoxElement).map((element) => [element.id, element]));
  return elements.map((element) => {
    if (element.type !== "arrow") return element;
    const arrow = { ...element };
    for (const end of ["start", "end"] as const) {
      const key = end === "start" ? "startBinding" : "endBinding";
      const binding = arrow[key];
      if (!binding) continue;
      const target = targets.get(binding.elementId);
      if (!target) {
        delete arrow[key];
      } else {
        arrow[end] = {
          x: target.x + target.width * binding.anchor.x,
          y: target.y + target.height * binding.anchor.y,
        };
      }
    }
    return arrow;
  });
}

export function deleteElements(
  elements: readonly CanvasElement[],
  ids: ReadonlySet<string>,
): CanvasElement[] {
  return resolveArrowBindings(elements.filter((element) => !ids.has(element.id)));
}

export function findArrowBinding(
  elements: readonly CanvasElement[],
  point: CanvasPoint,
  threshold: number,
): { binding: CanvasArrowBinding; point: CanvasPoint } | null {
  let nearest: { binding: CanvasArrowBinding; point: CanvasPoint } | null = null;
  let distance = Math.max(0, threshold) ** 2;
  // Reverse order gives the topmost object priority when borders coincide.
  for (const element of [...elements].reverse()) {
    if (!isBoxElement(element)) continue;
    if (point.x < element.x - threshold || point.x > element.x + element.width + threshold ||
      point.y < element.y - threshold || point.y > element.y + element.height + threshold) continue;
    const candidate = element.type === "shape" && element.shape === "ellipse"
      ? nearestEllipsePoint(element, (edge) => distanceSquared(edge, point))
      : nearestRectanglePoint(element, point);
    const candidateDistance = distanceSquared(candidate, point);
    if (candidateDistance > distance || (nearest && candidateDistance === distance)) continue;
    distance = candidateDistance;
    nearest = {
      point: candidate,
      binding: {
        elementId: element.id,
        anchor: {
          x: clamp((candidate.x - element.x) / element.width, 0, 1),
          y: clamp((candidate.y - element.y) / element.height, 0, 1),
        },
      },
    };
  }
  return nearest;
}

export function eraseElements(
  elements: readonly CanvasElement[],
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
  makeId: () => string,
): CanvasElement[] {
  const result: CanvasElement[] = [];
  for (const element of elements) {
    const reach = Math.max(0, radius) + (element.strokeWidth ?? 2) / 2;
    if (!intersectsBounds(element, {
      x: Math.min(from.x, to.x) - reach,
      y: Math.min(from.y, to.y) - reach,
      width: Math.abs(to.x - from.x) + reach * 2,
      height: Math.abs(to.y - from.y) + reach * 2,
    })) {
      result.push(element);
      continue;
    }
    if (element.type === "path") {
      const fragments = erasePath(element.points, from, to, reach);
      if (fragments === null) {
        result.push(element);
      } else {
        fragments.forEach((points, index) => result.push({
          ...element,
          id: index === 0 ? element.id : makeId(),
          points,
        }));
      }
    } else if (element.type === "arrow") {
      if (segmentDistanceSquared(from, to, element.start, element.end) > reach ** 2) result.push(element);
    } else if (!boxTouchesCapsule(element, from, to, reach)) {
      result.push(element);
    }
  }
  return resolveArrowBindings(result);
}

function erasePath(
  points: readonly CanvasPoint[],
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
): CanvasPoint[][] | null {
  let changed = false;
  const fragments: CanvasPoint[][] = [];
  let current: CanvasPoint[] = [];
  const append = (point: CanvasPoint) => {
    if (current.length === 0 || distanceSquared(current[current.length - 1], point) > EPSILON ** 2) {
      current.push(point);
    }
  };
  const flush = () => {
    if (current.length >= 2) fragments.push(current);
    current = [];
  };
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const interval = capsuleInterval(a, b, from, to, radius);
    if (!interval) {
      append(a);
      append(b);
      continue;
    }
    changed = true;
    if (interval[0] > EPSILON) {
      append(a);
      append(interpolate(a, b, interval[0]));
    }
    flush();
    if (interval[1] < 1 - EPSILON) {
      append(interpolate(a, b, interval[1]));
      append(b);
    }
  }
  flush();
  return changed ? fragments : null;
}

// The swept eraser is the union of two circles and their connecting strip.
// Clip whole stroke segments so a fast pointer cannot jump over a thin stroke.
function capsuleInterval(
  a: CanvasPoint,
  b: CanvasPoint,
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
): [number, number] | null {
  const intervals: [number, number][] = [];
  for (const center of [from, to]) {
    const interval = circleInterval(a, b, center, radius);
    if (interval) intervals.push(interval);
  }
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length > EPSILON) {
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    const project = (point: CanvasPoint): CanvasPoint => ({
      x: (point.x - from.x) * ux + (point.y - from.y) * uy,
      y: -(point.x - from.x) * uy + (point.y - from.y) * ux,
    });
    const interval = rectangleInterval(project(a), project(b), {
      x: 0, y: -radius, width: length, height: radius * 2,
    });
    if (interval) intervals.push(interval);
  }
  if (intervals.length === 0) return null;
  const low = Math.min(...intervals.map((interval) => interval[0]));
  const high = Math.max(...intervals.map((interval) => interval[1]));
  return high - low > EPSILON ? [low, high] : null;
}

function circleInterval(
  a: CanvasPoint,
  b: CanvasPoint,
  center: CanvasPoint,
  radius: number,
): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const px = a.x - center.x;
  const py = a.y - center.y;
  const quadratic = dx * dx + dy * dy;
  if (quadratic < EPSILON ** 2) return distanceSquared(a, center) <= radius ** 2 ? [0, 1] : null;
  const linear = 2 * (px * dx + py * dy);
  const constant = px * px + py * py - radius * radius;
  const discriminant = linear * linear - 4 * quadratic * constant;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const low = Math.max(0, (-linear - root) / (2 * quadratic));
  const high = Math.min(1, (-linear + root) / (2 * quadratic));
  return low <= high ? [low, high] : null;
}

function rectangleInterval(a: CanvasPoint, b: CanvasPoint, box: CanvasBounds): [number, number] | null {
  let low = 0;
  let high = 1;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? box.width : box.height;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPSILON) {
      if (a[axis] < box[axis] || a[axis] > box[axis] + size) return null;
      continue;
    }
    const one = (box[axis] - a[axis]) / delta;
    const two = (box[axis] + size - a[axis]) / delta;
    low = Math.max(low, Math.min(one, two));
    high = Math.min(high, Math.max(one, two));
    if (low > high) return null;
  }
  return [low, high];
}

function boxTouchesCapsule(element: BoxElement, from: CanvasPoint, to: CanvasPoint, radius: number): boolean {
  if (element.type === "shape" && element.shape === "ellipse") {
    const normalized = (point: CanvasPoint) => ({
      x: (point.x - element.x - element.width / 2) / (element.width / 2),
      y: (point.y - element.y - element.height / 2) / (element.height / 2),
    });
    if (circleInterval(normalized(from), normalized(to), { x: 0, y: 0 }, 1)) return true;
    const nearest = nearestEllipsePoint(element, (point) => pointSegmentDistanceSquared(point, from, to));
    return pointSegmentDistanceSquared(nearest, from, to) <= radius ** 2;
  }
  if (rectangleInterval(from, to, element)) return true;
  const corners = [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ];
  return corners.some((point, index) =>
    segmentDistanceSquared(from, to, point, corners[(index + 1) % 4]) <= radius ** 2);
}

function nearestRectanglePoint(box: CanvasBounds, point: CanvasPoint): CanvasPoint {
  const x = clamp(point.x, box.x, box.x + box.width);
  const y = clamp(point.y, box.y, box.y + box.height);
  const candidates = [
    { x: box.x, y }, { x: box.x + box.width, y },
    { x, y: box.y }, { x, y: box.y + box.height },
  ];
  return candidates.reduce((nearest, candidate) =>
    distanceSquared(candidate, point) < distanceSquared(nearest, point) ? candidate : nearest);
}

function nearestEllipsePoint(box: CanvasBounds, distance: (point: CanvasPoint) => number): CanvasPoint {
  const at = (angle: number): CanvasPoint => ({
    x: box.x + box.width / 2 + Math.cos(angle) * box.width / 2,
    y: box.y + box.height / 2 + Math.sin(angle) * box.height / 2,
  });
  const step = Math.PI * 2 / 64;
  let bestAngle = 0;
  let bestDistance = distance(at(0));
  for (let index = 1; index < 64; index += 1) {
    const angle = index * step;
    const candidateDistance = distance(at(angle));
    if (candidateDistance < bestDistance) {
      bestAngle = angle;
      bestDistance = candidateDistance;
    }
  }
  let low = bestAngle - step;
  let high = bestAngle + step;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    if (distance(at(left)) <= distance(at(right))) high = right;
    else low = left;
  }
  return at((low + high) / 2);
}

function segmentDistanceSquared(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): number {
  const cross = (one: CanvasPoint, two: CanvasPoint, three: CanvasPoint) =>
    (two.x - one.x) * (three.y - one.y) - (two.y - one.y) * (three.x - one.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0;
  return Math.min(
    pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b),
  );
}

function pointSegmentDistanceSquared(point: CanvasPoint, a: CanvasPoint, b: CanvasPoint): number {
  const lengthSquared = distanceSquared(a, b);
  const ratio = lengthSquared < EPSILON ** 2 ? 0 : clamp(
    ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared, 0, 1,
  );
  return distanceSquared(point, interpolate(a, b, ratio));
}

function distanceSquared(a: CanvasPoint, b: CanvasPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function interpolate(a: CanvasPoint, b: CanvasPoint, amount: number): CanvasPoint {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isBoxElement(element: CanvasElement): element is BoxElement {
  return element.type === "shape" || element.type === "text" || element.type === "image";
}
