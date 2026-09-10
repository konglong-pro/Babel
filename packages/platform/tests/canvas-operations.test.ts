import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasArrowElement, CanvasElement, CanvasPathElement, CanvasShapeElement } from "../src/canvas/core";
import {
  boundsForElements,
  deleteElements,
  eraseElements,
  findArrowBinding,
  intersectsBounds,
  resizeElements,
  resolveArrowBindings,
  translateElements,
} from "../src/canvas/operations";

const box: CanvasShapeElement = {
  id: "box", type: "shape", shape: "rectangle", x: 20, y: 30, width: 100, height: 80,
};
const arrow: CanvasArrowElement = {
  id: "arrow", type: "arrow", start: { x: 120, y: 70 }, end: { x: 200, y: 70 },
  startBinding: { elementId: "box", anchor: { x: 1, y: 0.5 } },
};

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} should be near ${expected}`);
}

test("selection bounds include boxes, strokes and arrow endpoints, and handle empty scenes", () => {
  assert.equal(boundsForElements([]), null);
  assert.deepEqual(boundsForElements([box, arrow, {
    id: "path", type: "path", points: [{ x: -20, y: -10 }, { x: 10, y: 160 }],
  }]), { x: -20, y: -10, width: 220, height: 170 });
  assert.equal(intersectsBounds(box, { x: 110, y: 100, width: 30, height: 30 }), true);
  assert.equal(intersectsBounds(box, { x: -10, y: -10, width: 10, height: 10 }), false);
});

test("moving a bound object follows its anchor without moving the free arrow end or mutating inputs", () => {
  const scene = [box, arrow];
  const before = structuredClone(scene);
  const moved = translateElements(scene, new Set([box.id]), 10, 15);
  assert.deepEqual(moved[0], { ...box, x: 30, y: 45 });
  assert.deepEqual(moved[1], { ...arrow, start: { x: 130, y: 85 } });
  assert.deepEqual(scene, before);
});

test("moving arrows alone detaches anchors while moving arrows and targets together retains anchors", () => {
  assert.deepEqual(translateElements([box, arrow], new Set([arrow.id]), 0, 0), [box, arrow]);
  const alone = translateElements([box, arrow], new Set([arrow.id]), 10, 15)[1] as CanvasArrowElement;
  assert.equal(alone.startBinding, undefined);
  assert.deepEqual(alone.start, { x: 130, y: 85 });
  const together = translateElements([box, arrow], new Set([box.id, arrow.id]), 10, 15)[1] as CanvasArrowElement;
  assert.deepEqual(together.startBinding, arrow.startBinding);
  assert.deepEqual(together.start, { x: 130, y: 85 });
  assert.deepEqual(together.end, { x: 210, y: 85 });
});

test("diagonal eraser sweeps clip against the rotated strip", () => {
  const path: CanvasPathElement = {
    id: "path", type: "path", strokeWidth: 2,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  };
  const erased = eraseElements([path], { x: 20, y: -20 }, { x: 80, y: 40 }, 2, () => "second") as CanvasPathElement[];
  assert.equal(erased.length, 2);
  near(erased[0].points[1].x, 40 - 3 * Math.sqrt(2));
  near(erased[1].points[0].x, 40 + 3 * Math.sqrt(2));
});

test("multi-object resizing scales positions and boxes, preserves text size, and updates attached arrows", () => {
  const text: CanvasElement = {
    id: "text", type: "text", x: 140, y: 30, width: 80, height: 80,
    text: "Readable", fontSize: 20, textAlign: "left",
  };
  const image: CanvasElement = {
    id: "image", type: "image", x: 20, y: 120, width: 100, height: 80,
    src: "data:image/png;base64,aGVsbG8=",
  };
  const elements = [box, text, image, arrow];
  const result = resizeElements(elements, new Set([box.id, text.id, image.id]),
    { x: 20, y: 30, width: 200, height: 170 },
    { x: 40, y: 60, width: 400, height: 340 });
  assert.deepEqual(result[0], { ...box, x: 40, y: 60, width: 200, height: 160 });
  assert.deepEqual(result[1], { ...text, x: 280, y: 60, width: 160, height: 160 });
  assert.deepEqual(result[2], { ...image, x: 40, y: 240, width: 200, height: 160 });
  assert.deepEqual((result[3] as CanvasArrowElement).start, { x: 240, y: 140 });
});

test("resizing a vertical stroke never divides by zero", () => {
  const path: CanvasPathElement = { id: "vertical", type: "path", points: [{ x: 0, y: 0 }, { x: 0, y: 100 }] };
  const resized = resizeElements([path], new Set([path.id]),
    { x: 0, y: 0, width: 0, height: 100 }, { x: 20, y: 30, width: 0, height: 200 });
  assert.deepEqual(resized, [{ ...path, points: [{ x: 20, y: 30 }, { x: 20, y: 230 }] }]);
});

test("removing bound targets keeps arrows in place and drops invalid bindings", () => {
  const result = deleteElements([box, arrow], new Set([box.id]));
  const expected = { ...arrow };
  delete expected.startBinding;
  assert.deepEqual(result, [expected]);
  assert.deepEqual(resolveArrowBindings([arrow]), [expected]);
  assert.ok(arrow.startBinding);
});

test("arrow snapping chooses the nearest perimeter and honors distance and z order", () => {
  assert.deepEqual(findArrowBinding([box], { x: 124, y: 70 }, 5), {
    binding: { elementId: box.id, anchor: { x: 1, y: 0.5 } }, point: { x: 120, y: 70 },
  });
  assert.equal(findArrowBinding([box], { x: 140, y: 70 }, 5), null);
  assert.equal(findArrowBinding([box, { ...box, id: "top" }], { x: 120, y: 70 }, 1)?.binding.elementId, "top");
  assert.equal(findArrowBinding([arrow], arrow.start, 20), null);
});

test("ellipse snapping returns a normalized perimeter anchor that remains attached after resize", () => {
  const ellipse: CanvasShapeElement = { ...box, shape: "ellipse", width: 120, height: 60 };
  const snap = findArrowBinding([ellipse], { x: 143, y: 60 }, 5);
  assert.ok(snap);
  near(snap.point.x, 140);
  near(snap.point.y, 60);
  near(snap.binding.anchor.x, 1);
  near(snap.binding.anchor.y, 0.5);
  const linked: CanvasArrowElement = { ...arrow, start: snap.point, startBinding: snap.binding };
  const resized = resolveArrowBindings([{ ...ellipse, width: 240 }, linked])[1] as CanvasArrowElement;
  near(resized.start.x, 260);
  near(resized.start.y, 60);
});

test("a swept eraser splits sparse stroke segments without missing the space between events", () => {
  const path: CanvasPathElement = {
    id: "path", type: "path", stroke: "#123456", strokeWidth: 2,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  };
  const before = structuredClone(path);
  const erased = eraseElements([path], { x: 50, y: -50 }, { x: 50, y: 50 }, 5, () => "fragment");
  assert.equal(erased.length, 2);
  assert.deepEqual(erased[0], { ...path, points: [{ x: 0, y: 0 }, { x: 44, y: 0 }] });
  const second = erased[1] as CanvasPathElement;
  assert.equal(second.id, "fragment");
  assert.equal(second.stroke, path.stroke);
  assert.equal(second.points.length, 2);
  near(second.points[0].x, 56);
  assert.equal(second.points[0].y, 0);
  assert.deepEqual(second.points[1], { x: 100, y: 0 });
  assert.deepEqual(path, before);
});

test("point erasing clips circles precisely and retains connected multi-segment fragments", () => {
  const path: CanvasPathElement = {
    id: "path", type: "path", strokeWidth: 2,
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 50, y: 0 }, { x: 80, y: 0 }, { x: 100, y: 0 }],
  };
  const erased = eraseElements([path], { x: 50, y: 0 }, { x: 50, y: 0 }, 9, () => "second") as CanvasPathElement[];
  assert.deepEqual(erased.map((element) => element.points), [
    [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }],
    [{ x: 60, y: 0 }, { x: 80, y: 0 }, { x: 100, y: 0 }],
  ]);
  assert.deepEqual(eraseElements([path], { x: 0, y: 0 }, { x: 100, y: 0 }, 1, () => "unused"), []);
  assert.equal(eraseElements([path], { x: 0, y: 20 }, { x: 100, y: 20 }, 1, () => "unused")[0], path);
});

test("an eraser removes touched objects, detaches arrows, and ignores empty ellipse corners", () => {
  const ellipse: CanvasShapeElement = { ...box, id: "ellipse", shape: "ellipse", x: 200, y: 200, width: 100, height: 100 };
  const text: CanvasElement = {
    id: "text", type: "text", x: 400, y: 200, width: 100, height: 40,
    text: "Text", fontSize: 20, textAlign: "left",
  };
  const image: CanvasElement = {
    id: "image", type: "image", x: 600, y: 200, width: 100, height: 40,
    src: "data:image/png;base64,aGVsbG8=",
  };
  const erased = eraseElements([box, arrow, ellipse, text, image], { x: 40, y: 40 }, { x: 50, y: 40 }, 3, () => "unused");
  assert.deepEqual(erased.map((element) => element.id), ["arrow", "ellipse", "text", "image"]);
  assert.equal((erased[0] as CanvasArrowElement).startBinding, undefined);
  assert.equal(eraseElements([ellipse], { x: 201, y: 201 }, { x: 203, y: 201 }, 1, () => "unused").length, 1);
  assert.equal(eraseElements([ellipse], { x: 250, y: 250 }, { x: 250, y: 250 }, 1, () => "unused").length, 0);
  assert.equal(eraseElements([text], { x: 450, y: 190 }, { x: 450, y: 260 }, 1, () => "unused").length, 0);
  assert.equal(eraseElements([image], { x: 650, y: 210 }, { x: 650, y: 210 }, 1, () => "unused").length, 0);
  assert.equal(eraseElements([arrow], { x: 150, y: 0 }, { x: 150, y: 100 }, 1, () => "unused").length, 0);
});
