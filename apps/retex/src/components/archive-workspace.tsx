"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ExerciseDetail } from "@/components/exercise-detail";
import { FolderPanel } from "@/components/folder-panel";
import { ItemList } from "@/components/item-list";
import { KnowledgeDetail } from "@/components/knowledge-detail";
import { useDirtyNavigationGuard } from "@/components/use-dirty-navigation-guard";
import {
  createFolder,
  createKnowledge,
  deleteFolder,
  getErrorMessage,
  getExercise,
  getExerciseBacklinks,
  getKnowledge,
  getKnowledgeBacklinks,
  listExercises,
  listFolders,
  listKnowledge,
  updateFolder,
} from "@/lib/api-client";
import type {
  BacklinksDto,
  ExerciseDetailDto,
  ExerciseSummaryDto,
  FolderDto,
  FolderType,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
  LinkEntityKind,
} from "@/lib/types";

type ArchiveSummary = KnowledgeSummaryDto | ExerciseSummaryDto;
type ArchiveDetail = KnowledgeDetailDto | ExerciseDetailDto;
type ViewMode = "view" | "edit" | "create";

interface ArchiveWorkspaceProps {
  type: FolderType;
  initialFolderId?: number | null;
  initialItemId?: number | null;
}

interface WikilinkCreationRequest {
  title: string;
}

function emptyBacklinks(): BacklinksDto {
  return { knowledge: [], exercises: [] };
}

export function ArchiveWorkspace({
  type,
  initialFolderId = null,
  initialItemId = null,
}: ArchiveWorkspaceProps) {
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [items, setItems] = useState<ArchiveSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(initialItemId);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinksDto>(emptyBacklinks);
  const [mode, setMode] = useState<ViewMode>("view");
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [detailRequestVersion, setDetailRequestVersion] = useState(0);
  const [error, setError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [wikilinkCreation, setWikilinkCreation] = useState<WikilinkCreationRequest | null>(null);
  const [knowledgeFolders, setKnowledgeFolders] = useState<FolderDto[]>([]);
  const [knowledgeFoldersLoading, setKnowledgeFoldersLoading] = useState(false);
  const [knowledgeFoldersError, setKnowledgeFoldersError] = useState("");
  const selectionGenerationRef = useRef(0);
  const navigationGenerationRef = useRef(0);
  const folderRequestGenerationRef = useRef(0);
  const wikilinkCreateGenerationRef = useRef(0);
  const wikilinkCreatePendingRef = useRef(false);
  const {
    dirty,
    setDirty,
    registerSave,
    confirmDiscard,
    discardAndRun,
    replaceLocation: replaceGuardedLocation,
  } = useDirtyNavigationGuard();

  const basePath = type === "knowledge" ? "/knowledge" : "/exercise";
  const beginNavigation = useCallback(() => {
    setNavigationError("");
    navigationGenerationRef.current += 1;
    wikilinkCreateGenerationRef.current += 1;
    return navigationGenerationRef.current;
  }, []);

  useEffect(() => {
    return () => {
      navigationGenerationRef.current += 1;
      selectionGenerationRef.current += 1;
      folderRequestGenerationRef.current += 1;
      wikilinkCreateGenerationRef.current += 1;
    };
  }, []);

  const loadIndex = useCallback(async () => {
    const [nextFolders, nextItems] = await Promise.all([
      listFolders(type),
      type === "knowledge" ? listKnowledge() : listExercises(),
    ]);
    setFolders(nextFolders);
    setItems(nextItems);
  }, [type]);

  useEffect(() => {
    let active = true;
    Promise.all([
      listFolders(type),
      type === "knowledge" ? listKnowledge() : listExercises(),
    ])
      .then(([nextFolders, nextItems]) => {
        if (!active) return;
        setFolders(nextFolders);
        setItems(nextItems);
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [type]);

  useEffect(() => {
    if (selectedItemId === null) return;

    let active = true;
    const selectionGeneration = selectionGenerationRef.current;
    const detailRequest = type === "knowledge"
      ? getKnowledge(selectedItemId)
      : getExercise(selectedItemId);
    const backlinksRequest = type === "knowledge"
      ? getKnowledgeBacklinks(selectedItemId)
      : getExerciseBacklinks(selectedItemId);

    Promise.all([detailRequest, backlinksRequest])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active || selectionGeneration !== selectionGenerationRef.current) return;
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
      })
      .catch((caught) => {
        if (!active || selectionGeneration !== selectionGenerationRef.current) return;
        setDetail(null);
        setBacklinks(emptyBacklinks());
        setError(getErrorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [detailRequestVersion, selectedItemId, type]);

  const visibleItems = useMemo(() => {
    const filtered =
      selectedFolderId === null
        ? items
        : items.filter((item) => item.folderId === selectedFolderId);
    return [...filtered].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [items, selectedFolderId]);

  const replaceLocation = useCallback((folderId: number | null, itemId: number | null) => {
    const params = new URLSearchParams();
    if (folderId !== null) params.set("folder", String(folderId));
    if (itemId !== null) params.set("item", String(itemId));
    const query = params.toString();
    replaceGuardedLocation(query ? `${basePath}?${query}` : basePath);
  }, [basePath, replaceGuardedLocation]);

  const selectFolder = useCallback((id: number | null) => {
    if (!confirmDiscard()) return;
    setDirty(false);
    beginNavigation();
    selectionGenerationRef.current += 1;
    setSelectedFolderId(id);
    setSelectedItemId(null);
    setDetail(null);
    setBacklinks(emptyBacklinks());
    setMode("view");
    setCreateParentId(null);
    setError("");
    replaceLocation(id, null);
  }, [beginNavigation, confirmDiscard, replaceLocation, setDirty]);

  const selectItem = useCallback((
    id: number,
    exactFolderId?: number,
    discardConfirmed = false,
  ) => {
    if (!discardConfirmed && !confirmDiscard()) return;
    setDirty(false);
    beginNavigation();
    selectionGenerationRef.current += 1;
    const targetFolderId = exactFolderId
      ?? items.find((item) => item.id === id)?.folderId
      ?? selectedFolderId;
    setSelectedFolderId(targetFolderId);
    setSelectedItemId(id);
    setDetail(null);
    setBacklinks(emptyBacklinks());
    setError("");
    setMode("view");
    setCreateParentId(null);
    setDetailRequestVersion((version) => version + 1);
    replaceLocation(targetFolderId, id);
  }, [beginNavigation, confirmDiscard, items, replaceLocation, selectedFolderId, setDirty]);

  const navigateEntity = useCallback((
    kind: LinkEntityKind,
    id: number,
    exactFolderId?: number,
  ) => {
    if (!confirmDiscard()) return;

    const indexedFolderId = kind === type
      ? items.find((item) => item.id === id)?.folderId
      : undefined;
    const knownFolderId = exactFolderId ?? indexedFolderId;

    if (kind === type && knownFolderId !== undefined) {
      selectItem(id, knownFolderId, true);
      return;
    }

    if (kind !== type && knownFolderId !== undefined) {
      beginNavigation();
      discardAndRun(() => {
        window.location.assign(entityLocation(kind, id, knownFolderId));
      });
      return;
    }

    const generation = beginNavigation();
    const targetRequest = kind === "knowledge" ? getKnowledge(id) : getExercise(id);
    void targetRequest.then(
      (target) => {
        if (generation !== navigationGenerationRef.current) return;
        if (kind === type) {
          selectItem(id, target.folderId, true);
        } else {
          beginNavigation();
          discardAndRun(() => {
            window.location.assign(entityLocation(kind, id, target.folderId));
          });
        }
      },
      (caught) => {
        if (generation === navigationGenerationRef.current) {
          setNavigationError(getErrorMessage(caught));
        }
      },
    );
  }, [beginNavigation, confirmDiscard, discardAndRun, items, selectItem, type]);

  async function handleCreateFolder(name: string, parentId: number | null) {
    if (!confirmDiscard()) return;
    beginNavigation();
    const created = await createFolder({ type, parentId, name });
    setDirty(false);
    await loadIndex();
    selectionGenerationRef.current += 1;
    setSelectedFolderId(created.id);
    setSelectedItemId(null);
    setDetail(null);
    setBacklinks(emptyBacklinks());
    replaceLocation(created.id, null);
  }

  async function handleRenameFolder(id: number, name: string) {
    await updateFolder(id, { name });
    await loadIndex();
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    await updateFolder(id, { parentId });
    await loadIndex();
  }

  async function handleDeleteFolder(id: number) {
    if (!confirmDiscard()) return;
    beginNavigation();
    await deleteFolder(id);
    setDirty(false);
    selectionGenerationRef.current += 1;
    setSelectedFolderId(null);
    setSelectedItemId(null);
    setDetail(null);
    setBacklinks(emptyBacklinks());
    await loadIndex();
    replaceLocation(null, null);
  }

  async function handleSaved(saved: ArchiveDetail) {
    setDirty(false);
    beginNavigation();
    selectionGenerationRef.current += 1;
    setDetail(saved);
    setBacklinks(emptyBacklinks());
    setSelectedItemId(saved.id);
    setSelectedFolderId(saved.folderId);
    setMode("view");
    setCreateParentId(null);
    setDetailRequestVersion((version) => version + 1);
    replaceLocation(saved.folderId, saved.id);
    try {
      await loadIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleDeleted() {
    setDirty(false);
    beginNavigation();
    selectionGenerationRef.current += 1;
    setSelectedItemId(null);
    setDetail(null);
    setBacklinks(emptyBacklinks());
    setMode("view");
    setCreateParentId(null);
    await loadIndex();
    replaceLocation(selectedFolderId, null);
  }

  async function createKnowledgeNote(title: string, folderId: number) {
    if (wikilinkCreatePendingRef.current) return;
    const requestGeneration = wikilinkCreateGenerationRef.current + 1;
    wikilinkCreateGenerationRef.current = requestGeneration;
    const startingNavigationGeneration = navigationGenerationRef.current;
    wikilinkCreatePendingRef.current = true;
    try {
      const saved = await createKnowledge({
        folderId,
        parentId: null,
        title,
        contentMd: "",
        tags: [],
        exerciseIds: [],
      });
      if (
        requestGeneration !== wikilinkCreateGenerationRef.current ||
        startingNavigationGeneration !== navigationGenerationRef.current
      ) {
        return;
      }
      if (type === "knowledge") {
        await handleSaved(saved);
      } else {
        beginNavigation();
        discardAndRun(() => {
          window.location.assign(entityLocation("knowledge", saved.id, saved.folderId));
        });
      }
    } catch (caught) {
      if (
        requestGeneration !== wikilinkCreateGenerationRef.current ||
        startingNavigationGeneration !== navigationGenerationRef.current
      ) {
        return;
      }
      throw caught;
    } finally {
      wikilinkCreatePendingRef.current = false;
    }
  }

  async function createKnowledgeFromKnowledgeWikilink(title: string, folderId: number) {
    setError("");
    try {
      await createKnowledgeNote(title, folderId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function requestKnowledgeCreation(title: string) {
    if (wikilinkCreatePendingRef.current) return;
    const requestGeneration = folderRequestGenerationRef.current + 1;
    folderRequestGenerationRef.current = requestGeneration;
    setWikilinkCreation({ title });
    setKnowledgeFolders([]);
    setKnowledgeFoldersError("");
    setKnowledgeFoldersLoading(true);
    void listFolders("knowledge").then(
      (nextFolders) => {
        if (requestGeneration !== folderRequestGenerationRef.current) return;
        setKnowledgeFolders(nextFolders);
        setKnowledgeFoldersLoading(false);
      },
      (caught) => {
        if (requestGeneration !== folderRequestGenerationRef.current) return;
        setKnowledgeFoldersError(getErrorMessage(caught));
        setKnowledgeFoldersLoading(false);
      },
    );
  }

  function cancelKnowledgeCreation() {
    beginNavigation();
    folderRequestGenerationRef.current += 1;
    setWikilinkCreation(null);
    setKnowledgeFolders([]);
    setKnowledgeFoldersError("");
    setKnowledgeFoldersLoading(false);
  }

  const effectiveFolderId = detail?.folderId ?? selectedFolderId;
  const detailLoading = selectedItemId !== null && detail?.id !== selectedItemId && !error;

  function beginCreate(parentId: number | null) {
    if (!confirmDiscard()) return;
    setDirty(false);
    beginNavigation();
    selectionGenerationRef.current += 1;
    if (type === "knowledge" && parentId !== null) {
      const parent = (items as KnowledgeSummaryDto[]).find((item) => item.id === parentId);
      if (parent) {
        setSelectedFolderId(parent.folderId);
        replaceLocation(parent.folderId, null);
      }
    }
    setCreateParentId(type === "knowledge" ? parentId : null);
    setSelectedItemId(null);
    setDetail(null);
    setBacklinks(emptyBacklinks());
    setMode("create");
  }

  function beginEdit() {
    beginNavigation();
    setMode("edit");
  }

  function cancelEditing() {
    if (!confirmDiscard()) return;
    setDirty(false);
    beginNavigation();
    setMode("view");
  }

  return (
    <>
      {navigationError ? (
        <p className="form-error" role="alert">{navigationError}</p>
      ) : null}
      <div className={`archive-workspace${dirty ? " has-unsaved" : ""}`}>
        <FolderPanel
          type={type}
          folders={folders}
          selectedId={selectedFolderId}
          busy={indexLoading}
          onSelect={selectFolder}
          onCreate={handleCreateFolder}
          onRename={handleRenameFolder}
          onMove={handleMoveFolder}
          onDelete={handleDeleteFolder}
        />
        <ItemList
          type={type}
          items={visibleItems}
          selectedId={selectedItemId}
          selectedFolderId={selectedFolderId}
          loading={indexLoading}
          onSelect={selectItem}
          onCreate={beginCreate}
        />

        {error ? (
          <section className="detail-panel error-state" role="alert">
            <span aria-hidden="true">!</span>
            <h2>Couldn’t Load the Archive</h2>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setIndexLoading(true);
                loadIndex()
                  .catch((caught) => setError(getErrorMessage(caught)))
                  .finally(() => setIndexLoading(false));
              }}
            >
              Retry
            </button>
          </section>
        ) : type === "knowledge" ? (
          <KnowledgeDetail
            detail={detail as KnowledgeDetailDto | null}
            mode={mode}
            folderId={effectiveFolderId}
            pages={items as KnowledgeSummaryDto[]}
            createParentId={createParentId}
            backlinks={backlinks}
            loading={detailLoading}
            onEdit={beginEdit}
            onCreateChild={() => beginCreate(detail?.id ?? null)}
            onCancel={cancelEditing}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onNavigateEntity={navigateEntity}
            onCreateWikilink={createKnowledgeFromKnowledgeWikilink}
            onDirtyChange={setDirty}
            onRegisterSave={registerSave}
          />
        ) : (
          <ExerciseDetail
            detail={detail as ExerciseDetailDto | null}
            mode={mode}
            folderId={effectiveFolderId}
            backlinks={backlinks}
            loading={detailLoading}
            onEdit={beginEdit}
            onCancel={cancelEditing}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onNavigateEntity={navigateEntity}
            onCreateKnowledgeWikilink={requestKnowledgeCreation}
            onDirtyChange={setDirty}
            onRegisterSave={registerSave}
          />
        )}
      </div>

      {wikilinkCreation === null ? null : (
        <KnowledgeFolderDialog
          request={wikilinkCreation}
          folders={knowledgeFolders}
          loading={knowledgeFoldersLoading}
          loadError={knowledgeFoldersError}
          onCancel={cancelKnowledgeCreation}
          onCreate={createKnowledgeNote}
        />
      )}
    </>
  );
}

interface KnowledgeFolderDialogProps {
  request: WikilinkCreationRequest;
  folders: FolderDto[];
  loading: boolean;
  loadError: string;
  onCancel: () => void;
  onCreate: (title: string, folderId: number) => Promise<void>;
}

function KnowledgeFolderDialog({
  request,
  folders,
  loading,
  loadError,
  onCancel,
  onCreate,
}: KnowledgeFolderDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const folderOptions = useMemo(() => {
    const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .map((folder) => ({ id: folder.id, label: folderPath(folder, folderMap) }))
      .sort((a, b) => a.label.localeCompare(b.label, "en-US"));
  }, [folders]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (folderId === null) {
      setError("Choose a Knowledge folder before creating the note.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await onCreate(request.title, folderId);
      dialogRef.current?.close();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      onClose={onCancel}
    >
      <form className="dialog-body" onSubmit={submit}>
        <h2>Create Knowledge Note</h2>
        <p>
          Choose where to create “{request.title}”. The new note will open after creation.
        </p>
        {loading ? <p className="muted">Loading Knowledge folders…</p> : null}
        {!loading && !loadError && folderOptions.length === 0 ? (
          <p className="form-error" role="alert">
            No Knowledge folder exists. Cancel and create a Knowledge folder first.
          </p>
        ) : null}
        {loadError ? (
          <p className="form-error" role="alert">{loadError}</p>
        ) : null}
        {folderOptions.length > 0 ? (
          <label className="field">
            <span>Knowledge folder</span>
            <select
              name="knowledgeFolderId"
              required
              value={folderId ?? ""}
              onChange={(event) => setFolderId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="" disabled>Choose a folder</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" disabled={pending} onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={pending || loading || Boolean(loadError) || folderOptions.length === 0}
          >
            {pending ? "Creating…" : "Create and Open"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function entityLocation(kind: LinkEntityKind, id: number, folderId: number): string {
  const path = kind === "knowledge" ? "/knowledge" : "/exercise";
  return `${path}?folder=${folderId}&item=${id}`;
}

function folderPath(folder: FolderDto, folders: ReadonlyMap<number, FolderDto>): string {
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = folders.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}
