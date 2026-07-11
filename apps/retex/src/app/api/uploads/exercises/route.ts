import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { saveExerciseImage } from "@/lib/storage";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError(
        400,
        "INVALID_FORM_DATA",
        "The request must use multipart/form-data to upload an image.",
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "FILE_REQUIRED", 'A file field named "file" is required.');
    }

    const imagePath = await saveExerciseImage(file);
    const filename = imagePath.split("/").at(-1);
    if (!filename) {
      throw new Error("Image storage returned an invalid path.");
    }

    return NextResponse.json(
      {
        imagePath,
        url: `/api/uploads/exercises/${encodeURIComponent(filename)}`,
      },
      { status: 201 },
    );
  });
}
