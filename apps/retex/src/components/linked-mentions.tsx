"use client";

import type {
  BacklinkDto,
  BacklinksDto,
  LinkEntityKind,
} from "@/lib/types";

interface LinkedMentionsProps {
  backlinks: BacklinksDto;
  onNavigate: (kind: LinkEntityKind, id: number, folderId: number) => void;
}

export function LinkedMentions({ backlinks, onNavigate }: LinkedMentionsProps) {
  const total = backlinks.knowledge.length + backlinks.exercises.length;

  return (
    <section className="linked-mentions" aria-labelledby="linked-mentions-heading">
      <h2 id="linked-mentions-heading">Linked mentions ({total})</h2>
      {total === 0 ? (
        <p className="empty-copy">No notes link here yet.</p>
      ) : (
        <div className="linked-mention-groups">
          <BacklinkGroup
            kind="knowledge"
            label="Knowledge"
            items={backlinks.knowledge}
            onNavigate={onNavigate}
          />
          <BacklinkGroup
            kind="exercise"
            label="Exercises"
            items={backlinks.exercises}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </section>
  );
}

interface BacklinkGroupProps {
  kind: LinkEntityKind;
  label: string;
  items: BacklinkDto[];
  onNavigate: (kind: LinkEntityKind, id: number, folderId: number) => void;
}

function BacklinkGroup({ kind, label, items, onNavigate }: BacklinkGroupProps) {
  if (items.length === 0) return null;

  return (
    <section aria-label={`${label} mentions`}>
      <h3>{label}</h3>
      <ul>
        {items.map((backlink) => (
          <li key={`${kind}:${backlink.id}`}>
            <button
              type="button"
              onClick={() => onNavigate(kind, backlink.id, backlink.folderId)}
            >
              {backlink.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
