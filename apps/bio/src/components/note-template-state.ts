export function shouldConfirmTemplateContentReplacement(
  currentContent: string,
  nextContent: string,
  hasStagedImages: boolean,
): boolean {
  return hasStagedImages || (currentContent.length > 0 && currentContent !== nextContent);
}
