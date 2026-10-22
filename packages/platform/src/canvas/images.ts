import { CANVAS_IMAGE_MAX_BYTES } from "./core";

/** Embed raster bytes with the scene, so save, undo and notebook backups share one lifetime. */
export async function readCanvasClipboardImage(file: File): Promise<{ src: string; width: number; height: number }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Paste a PNG, JPEG or WebP image.");
  }
  if (file.size > 20 * 1024 * 1024) throw new Error("This image is too large. Choose an image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const surface = document.createElement("canvas");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      surface.width = Math.max(1, Math.round(bitmap.width * scale));
      surface.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = surface.getContext("2d");
      if (!context) throw new Error("Image decoding is unavailable in this browser.");
      context.drawImage(bitmap, 0, 0, surface.width, surface.height);
      const src = surface.toDataURL("image/png");
      const bytes = Math.ceil((src.length - src.indexOf(",") - 1) * 3 / 4);
      if (bytes <= CANVAS_IMAGE_MAX_BYTES) return { src, width: surface.width, height: surface.height };
      scale *= 0.7;
    }
    throw new Error("This image is too large for the canvas. Paste a smaller image.");
  } finally {
    bitmap.close();
  }
}
