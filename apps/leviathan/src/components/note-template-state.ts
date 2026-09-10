export interface TemplateReplacementState {
  currentContent: string;
  nextContent: string;
  stagedImageCount: number;
}

export function shouldConfirmTemplateReplacement({
  currentContent,
  nextContent,
  stagedImageCount,
}: TemplateReplacementState): boolean {
  return (
    nextContent !== currentContent &&
    (currentContent.length > 0 || stagedImageCount > 0)
  );
}
