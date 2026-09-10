import {
  createCanvasRepository,
  type CanvasRepository,
  type UpdateCanvasInput,
} from "@babel-apps/platform/canvas/server";

import { getNeumDatabase } from "@/lib/db/client";

export type { UpdateCanvasInput };

let resolvedCanvasRepository: CanvasRepository | undefined;

function getCanvasRepository(): CanvasRepository {
  resolvedCanvasRepository ??= createCanvasRepository(getNeumDatabase().sqlite);
  return resolvedCanvasRepository;
}

export const canvasRepository: CanvasRepository = {
  list: () => getCanvasRepository().list(),
  get: (id) => getCanvasRepository().get(id),
  create: (title) => getCanvasRepository().create(title),
  update: (id, input) => getCanvasRepository().update(id, input),
  delete: (id) => getCanvasRepository().delete(id),
};
export const listCanvases = canvasRepository.list;
export const getCanvas = canvasRepository.get;
export const createCanvas = canvasRepository.create;
export const updateCanvas = canvasRepository.update;
export const deleteCanvas = canvasRepository.delete;
