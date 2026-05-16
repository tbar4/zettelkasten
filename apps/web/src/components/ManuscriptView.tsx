import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api } from "../lib/api-client";
import type { ManuscriptSection } from "../lib/api-client";

type ExportFormat = "md" | "latex" | "docx";

interface ManuscriptViewProps {
  manuscriptId: string;
}

export function ManuscriptView({ manuscriptId }: ManuscriptViewProps) {
  const qc = useQueryClient();

  const manuscriptQuery = useQuery({
    queryKey: ["manuscripts", manuscriptId],
    queryFn: () => api.getManuscript(manuscriptId)
  });

  const manuscript = manuscriptQuery.data;
  const anchorTopicIds = manuscript?.anchor_topic_ids ?? [];

  const anchorLinksQueries = useQuery({
    queryKey: ["manuscripts", manuscriptId, "anchor-links"],
    queryFn: async () => {
      if (anchorTopicIds.length === 0) return [];
      const results = await Promise.all(
        anchorTopicIds.map((id) => api.getNoteLinks(id))
      );
      const noteIds = new Set<string>();
      for (const { outgoing, incoming } of results) {
        for (const link of outgoing) noteIds.add(link.to_note_id);
        for (const link of incoming) noteIds.add(link.from_note_id);
      }
      if (noteIds.size === 0) return [];
      const { notes } = await api.listNoteSummariesByIds([...noteIds]);
      return notes.map((n) => ({ id: n.id, title: n.title, type: n.type }));
    },
    enabled: anchorTopicIds.length > 0
  });

  const anchorNotes = anchorLinksQueries.data ?? [];

  const [leftSearch, setLeftSearch] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const filteredAnchorNotes = useMemo(
    () =>
      anchorNotes.filter((n) =>
        n.title.toLowerCase().includes(leftSearch.toLowerCase())
      ),
    [anchorNotes, leftSearch]
  );

  const sections = manuscript?.sections ?? [];

  const referencedNotes = useMemo(() => {
    const map = new Map<string, { id: string; noteTitle: string | null }>();
    for (const s of sections) {
      if (s.note_id) map.set(s.note_id, { id: s.note_id, noteTitle: s.note_title });
    }
    return [...map.values()];
  }, [sections]);

  const addSectionMutation = useMutation({
    mutationFn: (args: { noteId?: string | null; isTransclusion: boolean }) =>
      api.addManuscriptSection(manuscriptId, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  const addFreeformMutation = useMutation({
    mutationFn: () =>
      api.addManuscriptSection(manuscriptId, {
        isTransclusion: false,
        frozenBodyMd: ""
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  const moveMutation = useMutation({
    mutationFn: async ({
      sectionId,
      direction
    }: {
      sectionId: string;
      direction: "up" | "down";
    }) => {
      const idx = sections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= sections.length) return;

      const prev = sections[targetIdx - 1];
      const next = sections[targetIdx + 1];

      let newPosition: number;
      if (direction === "up") {
        const before = sections[idx - 2];
        newPosition = before
          ? Math.floor((before.position + sections[idx - 1]!.position) / 2)
          : sections[idx - 1]!.position - 10;
      } else {
        const after = sections[idx + 2];
        newPosition = after
          ? Math.floor((sections[idx + 1]!.position + after.position) / 2)
          : sections[idx + 1]!.position + 10;
      }

      return api.updateManuscriptSection(sectionId, { position: newPosition });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  const toggleMutation = useMutation({
    mutationFn: ({ sectionId, isTransclusion }: { sectionId: string; isTransclusion: boolean }) =>
      api.updateManuscriptSection(sectionId, { isTransclusion }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  const updateHeadingMutation = useMutation({
    mutationFn: ({ sectionId, heading }: { sectionId: string; heading: string }) =>
      api.updateManuscriptSection(sectionId, { heading }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  const deleteSectionMutation = useMutation({
    mutationFn: (sectionId: string) => api.deleteManuscriptSection(sectionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  if (manuscriptQuery.isLoading) return <p>Loading…</p>;
  if (manuscriptQuery.isError)
    return <p style={{ color: "#f7768e" }}>Failed to load: {String(manuscriptQuery.error)}</p>;
  if (!manuscript) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr 240px",
        gap: 16,
        height: "calc(100vh - 120px)"
      }}
    >
      <LeftRail
        anchorTopicIds={anchorTopicIds}
        anchorNotes={filteredAnchorNotes}
        search={leftSearch}
        onSearchChange={setLeftSearch}
        selectedNoteId={selectedNoteId}
        onSelectNote={setSelectedNoteId}
        onTransclude={(noteId) => {
          addSectionMutation.mutate({ noteId, isTransclusion: true });
          setSelectedNoteId(null);
        }}
        onCopy={(noteId) => {
          addSectionMutation.mutate({ noteId, isTransclusion: false });
          setSelectedNoteId(null);
        }}
        isAdding={addSectionMutation.isPending}
      />

      <CenterPane
        manuscriptId={manuscriptId}
        sections={sections}
        onMoveUp={(id) => moveMutation.mutate({ sectionId: id, direction: "up" })}
        onMoveDown={(id) => moveMutation.mutate({ sectionId: id, direction: "down" })}
        onToggle={(id, current) =>
          toggleMutation.mutate({ sectionId: id, isTransclusion: !current })
        }
        onDelete={(id) => {
          if (confirm("Delete this section?")) deleteSectionMutation.mutate(id);
        }}
        onUpdateHeading={(id, heading) =>
          updateHeadingMutation.mutate({ sectionId: id, heading })
        }
        onAddFreeform={() => addFreeformMutation.mutate()}
      />

      <RightRail referencedNotes={referencedNotes} />
    </div>
  );
}

interface LeftRailProps {
  anchorTopicIds: string[];
  anchorNotes: { id: string; title: string; type: string }[];
  search: string;
  onSearchChange: (v: string) => void;
  selectedNoteId: string | null;
  onSelectNote: (id: string | null) => void;
  onTransclude: (noteId: string) => void;
  onCopy: (noteId: string) => void;
  isAdding: boolean;
}

function LeftRail({
  anchorTopicIds,
  anchorNotes,
  search,
  onSearchChange,
  selectedNoteId,
  onSelectNote,
  onTransclude,
  onCopy,
  isAdding
}: LeftRailProps) {
  return (
    <div
      style={{
        borderRight: "1px solid #2a2a3a",
        padding: "0 12px 12px 0",
        overflowY: "auto"
      }}
    >
      <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#888" }}>Note picker</h4>

      {anchorTopicIds.length === 0 ? (
        <p style={{ color: "#666", fontSize: 12 }}>
          Pick anchor topics to populate
        </p>
      ) : (
        <>
          <input
            placeholder="Filter by title…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ width: "100%", fontSize: 12, marginBottom: 8 }}
          />

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {anchorNotes.map((n) => (
              <li
                key={n.id}
                style={{
                  padding: "4px 6px",
                  marginBottom: 2,
                  cursor: "pointer",
                  background: selectedNoteId === n.id ? "#2a2a4a" : "transparent",
                  borderRadius: 4,
                  fontSize: 13
                }}
                onClick={() => onSelectNote(selectedNoteId === n.id ? null : n.id)}
              >
                {n.title}
                {selectedNoteId === n.id && (
                  <div
                    style={{ marginTop: 4, display: "flex", gap: 4 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      style={{ fontSize: 11 }}
                      disabled={isAdding}
                      onClick={() => onTransclude(n.id)}
                    >
                      Transclude
                    </button>
                    <button
                      style={{ fontSize: 11 }}
                      disabled={isAdding}
                      onClick={() => onCopy(n.id)}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </li>
            ))}
            {anchorNotes.length === 0 && (
              <li style={{ color: "#666", fontSize: 12 }}>No notes found.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

interface ExportDropdownProps {
  manuscriptId: string;
}

function ExportDropdown({ manuscriptId }: ExportDropdownProps) {
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport(format: ExportFormat) {
    setExportError(null);

    // For latex/docx we need to check if the server reports pandoc unavailable.
    // We HEAD/GET the URL — but since the browser can't easily read response
    // headers for window.location.href, we do a quick fetch check first for
    // non-md formats.
    if (format === "latex" || format === "docx") {
      try {
        const url = api.manuscriptExportUrl(manuscriptId, format);
        const res = await fetch(url, { method: "GET" });
        if (res.status === 503) {
          const body = (await res.json()) as { error?: string };
          setExportError(body.error ?? "Pandoc not installed");
          return;
        }
        // For binary formats that succeeded, trigger download via blob
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const cd = res.headers.get("content-disposition") ?? "";
        const filenameMatch = cd.match(/filename="([^"]+)"/);
        a.href = objectUrl;
        a.download = filenameMatch ? filenameMatch[1]! : `manuscript.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      } catch {
        setExportError("Export failed");
      }
      return;
    }

    // For markdown, let the browser handle it directly
    window.location.href = api.manuscriptExportUrl(manuscriptId, format);
  }

  return (
    <div
      data-testid="export-dropdown"
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}
    >
      <span style={{ fontSize: 13, color: "#888" }}>Export:</span>
      <button
        style={{ fontSize: 12 }}
        data-testid="export-md"
        onClick={() => void handleExport("md")}
      >
        Markdown
      </button>
      <button
        style={{ fontSize: 12 }}
        data-testid="export-latex"
        onClick={() => void handleExport("latex")}
      >
        LaTeX
      </button>
      <button
        style={{ fontSize: 12 }}
        data-testid="export-docx"
        onClick={() => void handleExport("docx")}
      >
        DOCX
      </button>
      {exportError && (
        <span
          data-testid="export-error"
          style={{ fontSize: 12, color: "#f7768e", marginLeft: 4 }}
        >
          {exportError}
        </span>
      )}
    </div>
  );
}

interface CenterPaneProps {
  manuscriptId: string;
  sections: ManuscriptSection[];
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onToggle: (id: string, isTransclusion: boolean) => void;
  onDelete: (id: string) => void;
  onUpdateHeading: (id: string, heading: string) => void;
  onAddFreeform: () => void;
}

function CenterPane({
  manuscriptId,
  sections,
  onMoveUp,
  onMoveDown,
  onToggle,
  onDelete,
  onUpdateHeading,
  onAddFreeform
}: CenterPaneProps) {
  return (
    <div style={{ overflowY: "auto" }}>
      <ExportDropdown manuscriptId={manuscriptId} />

      {sections.length === 0 && (
        <p style={{ color: "#666" }}>No sections yet. Add one from the left rail or below.</p>
      )}

      {sections.map((section, idx) => (
        <SectionCard
          key={section.id}
          section={section}
          isFirst={idx === 0}
          isLast={idx === sections.length - 1}
          onMoveUp={() => onMoveUp(section.id)}
          onMoveDown={() => onMoveDown(section.id)}
          onToggle={() => onToggle(section.id, section.is_transclusion)}
          onDelete={() => onDelete(section.id)}
          onUpdateHeading={(heading) => onUpdateHeading(section.id, heading)}
        />
      ))}

      <div style={{ marginTop: 16 }}>
        <button onClick={onAddFreeform}>+ Add free-form section</button>
      </div>
    </div>
  );
}

interface SectionCardProps {
  section: ManuscriptSection;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onUpdateHeading: (heading: string) => void;
}

function SectionCard({
  section,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggle,
  onDelete,
  onUpdateHeading
}: SectionCardProps) {
  const [editingHeading, setEditingHeading] = useState(false);
  const [headingDraft, setHeadingDraft] = useState(section.heading ?? "");

  const bodyPreview = section.body_md?.slice(0, 300) ?? null;

  return (
    <div
      style={{
        border: "1px solid #2a2a3a",
        borderRadius: 6,
        padding: 12,
        marginBottom: 12
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {editingHeading ? (
          <input
            autoFocus
            value={headingDraft}
            onChange={(e) => setHeadingDraft(e.target.value)}
            onBlur={() => {
              setEditingHeading(false);
              onUpdateHeading(headingDraft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditingHeading(false);
                onUpdateHeading(headingDraft);
              }
              if (e.key === "Escape") {
                setEditingHeading(false);
                setHeadingDraft(section.heading ?? "");
              }
            }}
            style={{ flex: 1, fontSize: 14, fontWeight: 600 }}
          />
        ) : (
          <span
            style={{ flex: 1, fontWeight: 600, cursor: "text", fontSize: 14 }}
            onDoubleClick={() => setEditingHeading(true)}
          >
            {section.heading || (
              <span style={{ color: "#666", fontWeight: 400 }}>
                {section.note_title ?? "Free-form"}
              </span>
            )}
          </span>
        )}

        <span
          style={{
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 3,
            background: section.is_transclusion ? "#1a3a1a" : "#3a1a1a",
            color: section.is_transclusion ? "#9ece6a" : "#f7768e"
          }}
        >
          {section.is_transclusion ? "transclude" : "copy"}
        </span>
      </div>

      {section.note_title && (
        <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#888" }}>
          Source:{" "}
          <Link
            to="/notes/$noteId"
            params={{ noteId: section.note_id! }}
            style={{ color: "#7aa2f7" }}
          >
            {section.note_title}
          </Link>
        </p>
      )}

      {bodyPreview !== null && (
        <pre
          style={{
            fontSize: 12,
            color: "#ccc",
            whiteSpace: "pre-wrap",
            margin: "4px 0",
            maxHeight: 120,
            overflow: "hidden",
            opacity: 0.8
          }}
        >
          {bodyPreview}
          {section.body_md && section.body_md.length > 300 && "…"}
        </pre>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button style={{ fontSize: 11 }} disabled={isFirst} onClick={onMoveUp}>
          Move up
        </button>
        <button style={{ fontSize: 11 }} disabled={isLast} onClick={onMoveDown}>
          Move down
        </button>
        <button style={{ fontSize: 11 }} onClick={onToggle}>
          {section.is_transclusion ? "→ Copy" : "→ Transclude"}
        </button>
        <button style={{ fontSize: 11, color: "#f7768e" }} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

interface RightRailProps {
  referencedNotes: { id: string; noteTitle: string | null }[];
}

function RightRail({ referencedNotes }: RightRailProps) {
  return (
    <div
      style={{
        borderLeft: "1px solid #2a2a3a",
        padding: "0 0 12px 12px",
        overflowY: "auto"
      }}
    >
      <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#888" }}>References</h4>

      {referencedNotes.length === 0 ? (
        <p style={{ color: "#666", fontSize: 12 }}>No notes referenced yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {referencedNotes.map((n) => (
            <li key={n.id} style={{ marginBottom: 6, fontSize: 13 }}>
              <Link
                to="/notes/$noteId"
                params={{ noteId: n.id }}
                style={{ color: "#7aa2f7" }}
              >
                {n.noteTitle ?? n.id.slice(0, 8)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
