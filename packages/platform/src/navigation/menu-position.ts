interface MenuAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Keep list action menus inside the viewport, including short list panes. */
export function listMenuPosition(
  anchor: MenuAnchor,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const edge = 8;
  const gap = 4;
  const below = Math.max(0, viewport.height - anchor.bottom - gap - edge);
  const above = Math.max(0, anchor.top - gap - edge);
  const flip = menu.height > below && above > below;
  const maxHeight = flip ? above : below;
  const height = Math.min(menu.height, maxHeight);
  return {
    left: Math.max(edge, Math.min(anchor.right - menu.width, viewport.width - menu.width - edge)),
    top: Math.max(edge, Math.min(flip ? anchor.top - gap - height : anchor.bottom + gap,
      viewport.height - height - edge)),
    maxHeight,
  };
}
