import {
  createCanvasRepository,
  type UpdateCanvasInput,
} from "@babel-apps/platform/canvas/server";

import { sqlite } from "@/lib/db/client";

export type { UpdateCanvasInput };

export const canvasRepository = createCanvasRepository(sqlite);
export const listCanvases = canvasRepository.list;
export const getCanvas = canvasRepository.get;
export const createCanvas = canvasRepository.create;
export const updateCanvas = canvasRepository.update;
export const deleteCanvas = canvasRepository.delete;

