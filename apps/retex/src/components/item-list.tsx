"use client";

import type { ExerciseSummaryDto, FolderType, KnowledgeSummaryDto } from "@/lib/types";
import { formatDate, Tags } from "@/components/shared";

type ArchiveSummary = KnowledgeSummaryDto | ExerciseSummaryDto;

interface ItemListProps {
  type: FolderType;
  items: ArchiveSummary[];
  selectedId: number | null;
  selectedFolderId: number | null;
  loading?: boolean;
  onSelect: (id: number) => void;
  onCreate: () => void;
}

export function ItemList({
  type,
  items,
  selectedId,
  selectedFolderId,
  loading,
  onSelect,
  onCreate,
}: ItemListProps) {
  const itemName = type === "knowledge" ? "Knowledge Notes" : "Exercises";

  return (
    <aside className="archive-panel item-panel" aria-label={`${itemName} list`}>
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">Content</span>
          <h2>{selectedFolderId === null ? `All ${itemName}` : itemName}</h2>
        </div>
        <button
          type="button"
          className="primary-button small"
          disabled={selectedFolderId === null}
          title={selectedFolderId === null ? "Select a folder first" : undefined}
          onClick={onCreate}
        >
          New
        </button>
      </div>

      {selectedFolderId === null ? (
        <p className="panel-hint">The root shows everything. Select a folder before creating content.</p>
      ) : null}
      {loading ? <p className="panel-status">Loading content…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">∅</span>
          <p>No {itemName.toLocaleLowerCase()} here yet.</p>
        </div>
      ) : null}
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={selectedId === item.id ? "item-card selected" : "item-card"}
              aria-current={selectedId === item.id ? "true" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <strong>{item.title}</strong>
              <Tags tags={item.tags} />
              <time dateTime={item.updatedAt}>Updated {formatDate(item.updatedAt)}</time>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
