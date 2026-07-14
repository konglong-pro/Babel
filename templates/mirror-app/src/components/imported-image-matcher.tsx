"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";

import {
  imageFileError, stageImageFile, type StagedImage,
} from "@/components/markdown-editor";
import {
  matchImportedImagesByBasename,
  type ImportedImageReference,
} from "@/lib/markdown-import";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

interface ImportedImageMatcherProps {
  references: readonly ImportedImageReference[];
  stagedImages: readonly StagedImage[];
  disabled?: boolean;
  onResolve: (images: readonly StagedImage[]) => void;
  onError: (message: string) => void;
}

export function ImportedImageMatcher({
  references,
  stagedImages,
  disabled = false,
  onResolve,
  onError,
}: ImportedImageMatcherProps) {
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const manualTokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState("");
  const stagedByToken = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image])),
    [stagedImages],
  );
  const unresolved = references.filter((reference) => !stagedByToken.has(reference.token));

  function chooseBulkImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (disabled) return;
    if (files.length === 0) return;

    const matched = matchImportedImagesByBasename(unresolved, files);
    const resolved: StagedImage[] = [];
    const validationErrors: string[] = [];
    for (const { reference, file } of matched.matches) {
      const validationError = imageFileError(file);
      if (validationError !== null) {
        validationErrors.push(validationError);
        continue;
      }
      resolved.push(stageImageFile(file, reference.token));
    }

    if (resolved.length > 0) onResolve(resolved);
    if (validationErrors.length > 0) onError(validationErrors[0]);
    else onError("");

    const ignored = files.length - resolved.length;
    setStatus([
      resolved.length === 1
        ? "Matched 1 image by filename."
        : `Matched ${resolved.length} images by filename.`,
      ignored > 0
        ? `${ignored} unmatched or ambiguous ${ignored === 1 ? "file was" : "files were"} ignored.`
        : "",
    ].filter(Boolean).join(" "));
  }

  function chooseManualImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const token = manualTokenRef.current;
    event.target.value = "";
    manualTokenRef.current = null;
    if (disabled) return;
    if (!file || !token) return;

    const validationError = imageFileError(file);
    if (validationError !== null) {
      onError(validationError);
      return;
    }

    onError("");
    onResolve([stageImageFile(file, token)]);
    setStatus(`Assigned ${file.name}.`);
  }

  function openManualPicker(token: string) {
    if (disabled) return;
    manualTokenRef.current = token;
    manualInputRef.current?.click();
  }

  if (references.length === 0) return null;

  return (
    <section className="import-image-matcher" aria-labelledby="import-images-heading">
      <div className="import-image-heading">
        <div>
          <span className="eyebrow">Imported images</span>
          <h2 id="import-images-heading">Match local image files</h2>
          <p>
            __APP_NAME__ found {references.length} local {references.length === 1 ? "image" : "images"}.
            Select the referenced files; extra selections are ignored.
          </p>
        </div>
        <input
          ref={bulkInputRef}
          className="sr-only"
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          disabled={disabled}
          tabIndex={-1}
          onChange={chooseBulkImages}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => bulkInputRef.current?.click()}
        >
          Select images
        </button>
      </div>

      <input
        ref={manualInputRef}
        className="sr-only"
        type="file"
        accept={IMAGE_ACCEPT}
        disabled={disabled}
        tabIndex={-1}
        onChange={chooseManualImage}
      />
      <ul className="import-image-list">
        {references.map((reference) => {
          const staged = stagedByToken.get(reference.token);
          return (
            <li key={reference.token}>
              <div>
                <strong>{reference.path}</strong>
                <span>{staged ? `Matched to ${staged.file.name}` : "Needs a file"}</span>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => openManualPicker(reference.token)}
              >
                {staged ? "Replace" : "Choose file"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className={unresolved.length > 0 ? "import-image-warning" : "import-image-ready"}>
        {unresolved.length > 0
          ? `${unresolved.length} ${unresolved.length === 1 ? "image is" : "images are"} unresolved. Save remains disabled.`
          : "All imported image references are ready."}
      </p>
      {status ? <p className="panel-status" role="status">{status}</p> : null}
    </section>
  );
}
