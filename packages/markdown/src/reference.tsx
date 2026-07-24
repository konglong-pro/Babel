"use client";

import {
  KATEX_REFERENCE_VERSION,
  KATEX_VERSION,
  katexMathReferenceGroups,
} from "@babel-apps/katex/reference";
import { KatexFormula } from "@babel-apps/katex/react";
import {
  TYPST_LANGUAGE_VERSION,
  TYPST_REFERENCE_VERSION,
  typstMathReferenceGroups,
} from "@babel-apps/typst/reference";
import { TypstFormula } from "@babel-apps/typst/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  type MarkdownWritingGuideGroup,
  markdownWritingGuideGroups,
} from "./reference-data";

export {
  type MarkdownWritingGuideGroup,
  type MarkdownWritingGuideRow,
  markdownWritingGuideGroups,
  markdownWritingGuideRows,
} from "./reference-data";

export const DEFAULT_MARKDOWN_REFERENCE_PANEL_ID = "babel-markdown-writing-guide";
export const DEFAULT_TYPST_REFERENCE_PANEL_ID = "babel-typst-formula-reference";

export type ReferencePanelKind = "markdown" | "typst";

export interface ReferencePanelProps {
  onClose: () => void;
  id?: string;
  className?: string;
}

export type FormulaReferenceEngine = "typst" | "latex";

export interface FormulaReferencePanelProps extends ReferencePanelProps {
  initialEngine?: FormulaReferenceEngine;
}

export interface ReferencePanelTriggersProps {
  activePanel: ReferencePanelKind | null;
  onOpenMarkdown: () => void;
  onOpenTypst: () => void;
  markdownPanelId?: string;
  typstPanelId?: string;
  className?: string;
}

export function ReferencePanelTriggers({
  activePanel,
  onOpenMarkdown,
  onOpenTypst,
  markdownPanelId = DEFAULT_MARKDOWN_REFERENCE_PANEL_ID,
  typstPanelId = DEFAULT_TYPST_REFERENCE_PANEL_ID,
  className,
}: ReferencePanelTriggersProps) {
  return (
    <div
      className={classNames("reference-panel-triggers", className)}
      role="group"
      aria-label="Writing references"
    >
      <button
        type="button"
        className={classNames(
          "reference-panel-trigger",
          "reference-panel-trigger--markdown",
          activePanel === "markdown" ? "is-active" : undefined,
        )}
        aria-controls={markdownPanelId}
        aria-expanded={activePanel === "markdown"}
        onClick={onOpenMarkdown}
      >
        Markdown Guide
      </button>
      <button
        type="button"
        className={classNames(
          "reference-panel-trigger",
          "reference-panel-trigger--typst",
          activePanel === "typst" ? "is-active" : undefined,
        )}
        aria-controls={typstPanelId}
        aria-expanded={activePanel === "typst"}
        onClick={onOpenTypst}
      >
        Formula Reference
      </button>
    </div>
  );
}

export function MarkdownWritingGuidePanel({
  onClose,
  id = DEFAULT_MARKDOWN_REFERENCE_PANEL_ID,
  className,
}: ReferencePanelProps) {
  const headingId = useId();
  const descriptionId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("all");
  const filteredGroups = useMemo(() => {
    const normalizedQuery = normalizeQuery(query);
    return markdownWritingGuideGroups
      .filter((group) => groupId === "all" || group.id === groupId)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          return matchesQuery(
            [group.title, row.category, row.syntax, row.usage],
            normalizedQuery,
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);
  }, [groupId, query]);
  const resultCount = countRows(filteredGroups);

  useReferencePanelBehavior(searchRef, onClose);

  return (
    <aside
      id={id}
      className={classNames(
        "reference-board",
        "reference-board--markdown",
        className,
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <ReferencePanelHeader
        eyebrow="Babel Markdown"
        title="Markdown Writing Guide"
        description="Supported Markdown, wikilinks, managed images, code blocks, and Typst or LaTeX math."
        headingId={headingId}
        descriptionId={descriptionId}
        closeLabel="Close Markdown Writing Guide"
        onClose={onClose}
      />

      <ReferenceFilters
        query={query}
        groupId={groupId}
        groups={markdownWritingGuideGroups}
        searchRef={searchRef}
        searchPlaceholder="Search syntax or usage"
        onQueryChange={setQuery}
        onGroupChange={setGroupId}
      />

      <ReferenceCount count={resultCount} />

      <div
        className="reference-board__table-wrap"
        role="region"
        aria-label="Markdown guide table"
        tabIndex={0}
      >
        <table className="reference-board__table reference-board__table--markdown">
          <caption className="reference-board__visually-hidden">
            Markdown syntax and usage
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Syntax</th>
              <th scope="col">Usage</th>
            </tr>
          </thead>
          {filteredGroups.map((group) => (
            <tbody key={group.id}>
              <MarkdownReferenceRows group={group} />
            </tbody>
          ))}
        </table>
        {resultCount === 0 ? (
          <p className="reference-board__empty">
            No matching Markdown rules.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export function TypstReferencePanel({
  onClose,
  id = DEFAULT_TYPST_REFERENCE_PANEL_ID,
  className,
  initialEngine = "typst",
}: FormulaReferencePanelProps) {
  const headingId = useId();
  const descriptionId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<FormulaReferenceEngine>(initialEngine);
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("all");
  const referenceGroups: readonly FormulaReferenceGroup[] = engine === "typst"
    ? typstMathReferenceGroups
    : katexMathReferenceGroups;
  const filteredGroups = useMemo(() => {
    const normalizedQuery = normalizeQuery(query);
    return referenceGroups
      .filter((group) => groupId === "all" || group.id === groupId)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          return matchesQuery(
            [
              group.title,
              group.description,
              row.category,
              row.syntax,
              row.description,
              row.example,
              row.notes ?? "",
            ],
            normalizedQuery,
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);
  }, [groupId, query, referenceGroups]);
  const resultCount = countRows(filteredGroups);
  const isTypst = engine === "typst";

  useReferencePanelBehavior(searchRef, onClose);

  return (
    <aside
      id={id}
      className={classNames(
        "reference-board",
        "reference-board--typst",
        "reference-board--formula",
        className,
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <ReferencePanelHeader
        eyebrow={isTypst
          ? `Native Typst Math · Typst ${TYPST_LANGUAGE_VERSION}`
          : `LaTeX Math · KaTeX ${KATEX_VERSION}`}
        title="Formula Reference"
        description={isTypst
          ? `Reference ${TYPST_REFERENCE_VERSION}. Single-dollar formulas default to native Typst; recognizable LaTeX commands, braced scripts, and implicit products such as 4ac use KaTeX for compatibility. Spaces just inside a standalone pair select block layout.`
          : `Reference ${KATEX_REFERENCE_VERSION}. Traditional single-dollar LaTeX commands are supported for compatibility; use \\(...\\) inline or \\[...\\] and $$...$$ for unambiguous new content. KaTeX supports a practical subset of LaTeX math.`}
        headingId={headingId}
        descriptionId={descriptionId}
        closeLabel="Close Formula Reference"
        onClose={onClose}
      />

      <div className="reference-board__formula-controls">
        <div className="reference-board__engine-tabs" role="tablist" aria-label="Formula engine">
          <button
            type="button"
            role="tab"
            aria-selected={isTypst}
            className={isTypst ? "is-active" : undefined}
            onClick={() => {
              setEngine("typst");
              setGroupId("all");
            }}
          >
            Typst
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isTypst}
            className={!isTypst ? "is-active" : undefined}
            onClick={() => {
              setEngine("latex");
              setGroupId("all");
            }}
          >
            LaTeX / KaTeX
          </button>
        </div>

        <ReferenceFilters
          query={query}
          groupId={groupId}
          groups={referenceGroups}
          searchRef={searchRef}
          searchPlaceholder="Search syntax, usage, or symbols"
          onQueryChange={setQuery}
          onGroupChange={setGroupId}
        />
      </div>

      <ReferenceCount count={resultCount} />

      <div
        className="reference-board__table-wrap"
        role="region"
        aria-label={`${isTypst ? "Typst" : "LaTeX"} formula reference table`}
        tabIndex={0}
      >
        <table className="reference-board__table reference-board__table--typst">
          <caption className="reference-board__visually-hidden">
            {isTypst ? "Typst" : "LaTeX"} formula syntax, examples, previews, and notes
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Syntax</th>
              <th scope="col">Usage</th>
              <th scope="col">Example source</th>
              <th scope="col">Preview</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          {filteredGroups.map((group) => (
            <tbody key={group.id}>
              <FormulaReferenceRows group={group} engine={engine} />
            </tbody>
          ))}
        </table>
        {resultCount === 0 ? (
          <p className="reference-board__empty">
            No matching {isTypst ? "Typst" : "LaTeX"} formula rules.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

/** Preferred name; the legacy export remains for application compatibility. */
export const FormulaReferencePanel = TypstReferencePanel;

interface ReferencePanelHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  headingId: string;
  descriptionId: string;
  closeLabel: string;
  onClose: () => void;
}

function ReferencePanelHeader({
  eyebrow,
  title,
  description,
  headingId,
  descriptionId,
  closeLabel,
  onClose,
}: ReferencePanelHeaderProps) {
  return (
    <header className="reference-board__header">
      <div>
        <span className="reference-board__eyebrow">{eyebrow}</span>
        <h2 id={headingId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </div>
      <button
        type="button"
        className="reference-board__close"
        aria-label={closeLabel}
        onClick={onClose}
      >
        ×
      </button>
    </header>
  );
}

interface ReferenceFilterGroup {
  id: string;
  title: string;
}

interface ReferenceFiltersProps {
  query: string;
  groupId: string;
  groups: readonly ReferenceFilterGroup[];
  searchRef: RefObject<HTMLInputElement | null>;
  searchPlaceholder: string;
  onQueryChange: (query: string) => void;
  onGroupChange: (groupId: string) => void;
}

function ReferenceFilters({
  query,
  groupId,
  groups,
  searchRef,
  searchPlaceholder,
  onQueryChange,
  onGroupChange,
}: ReferenceFiltersProps) {
  return (
    <div className="reference-board__filters">
      <label className="reference-board__field">
        <span>Search</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <label className="reference-board__field">
        <span>Category</span>
        <select
          value={groupId}
          onChange={(event) => onGroupChange(event.target.value)}
        >
          <option value="all">All categories</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ReferenceCount({ count }: { count: number }) {
  return (
    <p className="reference-board__count" aria-live="polite">
      {count} {count === 1 ? "rule" : "rules"}
    </p>
  );
}

function MarkdownReferenceRows({
  group,
}: {
  group: MarkdownWritingGuideGroup;
}) {
  return (
    <>
      <tr className="reference-board__group-row">
        <th scope="rowgroup" colSpan={3}>
          {group.title}
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td>
            <span className="reference-board__category">{row.category}</span>
          </td>
          <td><code>{row.syntax}</code></td>
          <td>{row.usage}</td>
        </tr>
      ))}
    </>
  );
}

interface FormulaReferenceRow {
  id: string;
  category: string;
  syntax: string;
  description: string;
  example: string;
  display?: "inline" | "block";
  notes?: string;
}

interface FormulaReferenceGroup {
  id: string;
  title: string;
  description: string;
  rows: readonly FormulaReferenceRow[];
}

function FormulaReferenceRows({
  group,
  engine,
}: {
  group: FormulaReferenceGroup;
  engine: FormulaReferenceEngine;
}) {
  return (
    <>
      <tr className="reference-board__group-row">
        <th scope="rowgroup" colSpan={6}>
          <strong>{group.title}</strong>
          <span>{group.description}</span>
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td>
            <span className="reference-board__category">{row.category}</span>
          </td>
          <td><code>{row.syntax}</code></td>
          <td>{row.description}</td>
          <td><code>{row.example}</code></td>
          <td>
            <LazyFormulaPreview
              source={row.example}
              display={row.display ?? "inline"}
              engine={engine}
            />
          </td>
          <td>{row.notes || "—"}</td>
        </tr>
      ))}
    </>
  );
}

function LazyFormulaPreview({
  source,
  display,
  engine,
}: {
  source: string;
  display: NonNullable<FormulaReferenceRow["display"]>;
  engine: FormulaReferenceEngine;
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
    <div ref={containerRef} className="reference-board__preview">
      {visible ? (
        engine === "typst" ? (
          <TypstFormula
            source={source}
            display={display}
            ariaLabel={`Typst preview: ${source}`}
          />
        ) : (
          <KatexFormula
            source={source}
            display={display}
            ariaLabel={`LaTeX preview: ${source}`}
          />
        )
      ) : (
        <span aria-hidden="true">…</span>
      )}
    </div>
  );
}

function useReferencePanelBehavior(
  searchRef: RefObject<HTMLInputElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
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
  }, [onClose, searchRef]);
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function matchesQuery(values: readonly string[], normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return values.some((value) => {
    return value.toLocaleLowerCase().includes(normalizedQuery);
  });
}

function countRows(groups: readonly { rows: readonly unknown[] }[]): number {
  return groups.reduce((count, group) => count + group.rows.length, 0);
}

function classNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
