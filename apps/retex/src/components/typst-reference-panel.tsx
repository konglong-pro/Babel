"use client";

import {
  TYPST_LANGUAGE_VERSION,
  TYPST_REFERENCE_VERSION,
  type TypstMathReferenceGroup,
  type TypstMathReferenceRow,
  typstMathReferenceGroups,
} from "@babel-apps/typst/reference";
import { TypstFormula } from "@babel-apps/typst/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

interface TypstReferencePanelProps {
  onClose: () => void;
}

export function TypstReferencePanel({ onClose }: TypstReferencePanelProps) {
  const headingId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("all");
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return typstMathReferenceGroups
      .filter((group) => groupId === "all" || group.id === groupId)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (!normalizedQuery) return true;
          return [
            group.title,
            group.description,
            row.category,
            row.syntax,
            row.description,
            row.example,
            row.notes ?? "",
          ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
        }),
      }))
      .filter((group) => group.rows.length > 0);
  }, [groupId, query]);
  const resultCount = filteredGroups.reduce((count, group) => count + group.rows.length, 0);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <aside
      id="retex-typst-reference-panel"
      className="typst-reference-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
    >
      <header className="typst-reference-header">
        <div>
          <span className="eyebrow">Native Typst Math · Typst {TYPST_LANGUAGE_VERSION}</span>
          <h2 id={headingId}>Typst 公式表</h2>
          <p>
            规则表 {TYPST_REFERENCE_VERSION}。ReTex 仅使用 Typst 数学语法；独立公式需要在
            定界符内侧留空格。
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭 Typst 公式表" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="typst-reference-filters">
        <label>
          <span>搜索</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="搜索语法、用途或符号…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>分类</span>
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="all">全部分类</option>
            {typstMathReferenceGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.title}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="typst-reference-count" aria-live="polite">
        {resultCount} 条规则
      </p>

      <div className="typst-reference-table-wrap">
        <table className="typst-reference-table">
          <thead>
            <tr>
              <th scope="col">分类</th>
              <th scope="col">语法</th>
              <th scope="col">用途</th>
              <th scope="col">示例源码</th>
              <th scope="col">预览</th>
              <th scope="col">注意事项</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.map((group) => (
              <TypstReferenceRows key={group.id} group={group} />
            ))}
          </tbody>
        </table>
        {resultCount === 0 ? (
          <p className="typst-reference-empty">没有匹配的 Typst 公式规则。</p>
        ) : null}
      </div>
    </aside>
  );
}

function TypstReferenceRows({ group }: { group: TypstMathReferenceGroup }) {
  return (
    <>
      <tr className="typst-reference-group-row">
        <th scope="rowgroup" colSpan={6}>
          <strong>{group.title}</strong>
          <span>{group.description}</span>
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td><span className="typst-reference-category">{row.category}</span></td>
          <td><code>{row.syntax}</code></td>
          <td>{row.description}</td>
          <td><code>{row.example}</code></td>
          <td><LazyTypstPreview source={row.example} display={row.display ?? "inline"} /></td>
          <td>{row.notes || "—"}</td>
        </tr>
      ))}
    </>
  );
}

function LazyTypstPreview({
  source,
  display,
}: {
  source: string;
  display: NonNullable<TypstMathReferenceRow["display"]>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={containerRef} className="typst-reference-preview">
      {visible ? <TypstFormula source={source} display={display} /> : <span aria-hidden="true">…</span>}
    </div>
  );
}
