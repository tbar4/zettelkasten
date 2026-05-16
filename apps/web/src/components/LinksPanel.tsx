import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api } from "../lib/api-client";
import type { NoteLink } from "@zk/shared";

const BUILT_IN_TYPES = [
  "references",
  "elaborates",
  "supports",
  "contradicts",
  "example_of",
  "defines",
  "questions",
  "derived_from"
] as const;

interface LinksPanelProps {
  noteId: string;
}

function groupByType(links: NoteLink[]): Map<string, NoteLink[]> {
  const groups = new Map<string, NoteLink[]>();
  for (const l of links) {
    const displayType = l.custom_link_type_name ?? l.link_type;
    const existing = groups.get(displayType);
    if (existing) existing.push(l);
    else groups.set(displayType, [l]);
  }
  return groups;
}

export function LinksPanel({ noteId }: LinksPanelProps) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [toNoteSearch, setToNoteSearch] = useState("");
  const [selectedToId, setSelectedToId] = useState<string | null>(null);
  const [selectedLinkType, setSelectedLinkType] = useState("references");
  const [selectedCustomTypeId, setSelectedCustomTypeId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const linksQuery = useQuery({
    queryKey: ["notes", noteId, "links"],
    queryFn: () => api.getNoteLinks(noteId)
  });

  const customTypesQuery = useQuery({
    queryKey: ["custom-link-types"],
    queryFn: () => api.listCustomLinkTypes()
  });

  const searchQuery = useQuery({
    queryKey: ["notes", "search", toNoteSearch],
    queryFn: () => api.searchNotes(toNoteSearch),
    enabled: toNoteSearch.length >= 1
  });

  const allReferencedIds = useMemo(() => {
    if (!linksQuery.data) return [];
    const ids = new Set<string>();
    for (const l of linksQuery.data.outgoing) ids.add(l.to_note_id);
    for (const l of linksQuery.data.incoming) ids.add(l.from_note_id);
    return [...ids];
  }, [linksQuery.data]);

  const titlesQuery = useQuery({
    queryKey: ["notes", "titles", allReferencedIds],
    queryFn: () => api.listNoteSummariesByIds(allReferencedIds),
    enabled: allReferencedIds.length > 0
  });

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of titlesQuery.data?.notes ?? []) map.set(n.id, n.title);
    return map;
  }, [titlesQuery.data]);

  const createLinkMutation = useMutation({
    mutationFn: () => {
      if (!selectedToId) throw new Error("no target note selected");
      return api.createLink({
        from_note_id: noteId,
        to_note_id: selectedToId,
        ...(selectedCustomTypeId
          ? { custom_link_type_id: selectedCustomTypeId }
          : { link_type: selectedLinkType })
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", noteId, "links"] });
      setShowAdd(false);
      setToNoteSearch("");
      setSelectedToId(null);
      setSelectedLinkType("references");
      setSelectedCustomTypeId(null);
      setAddError(null);
    },
    onError: (err) => setAddError(String(err))
  });

  const deleteLinkMutation = useMutation({
    mutationFn: (id: string) => api.deleteLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", noteId, "links"] })
  });

  if (linksQuery.isLoading) {
    return (
      <div className="links-panel">
        <p style={{ color: "#666" }}>Loading…</p>
      </div>
    );
  }
  if (linksQuery.isError || !linksQuery.data) {
    return (
      <div className="links-panel">
        <p style={{ color: "#f7768e" }}>Failed to load links.</p>
      </div>
    );
  }

  const outgoing = groupByType(linksQuery.data.outgoing);
  const incoming = groupByType(linksQuery.data.incoming);

  const labelFor = (id: string) => titleById.get(id) ?? `${id.slice(0, 8)}…`;
  const customTypes = customTypesQuery.data?.customLinkTypes ?? [];

  return (
    <div className="links-panel">
      <div className="links-panel-group">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>Outgoing</h4>
          <button
            style={{ fontSize: 11 }}
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? "Cancel" : "+ Add link"}
          </button>
        </div>

        {showAdd && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              placeholder="Search target note…"
              value={toNoteSearch}
              onChange={(e) => {
                setToNoteSearch(e.target.value);
                setSelectedToId(null);
              }}
              style={{ fontSize: 12 }}
            />
            {searchQuery.data && toNoteSearch && !selectedToId && (
              <ul style={{ margin: 0, padding: "4px 0", listStyle: "none", background: "#1a1b26", border: "1px solid #2a2a3a" }}>
                {searchQuery.data.notes.filter((n) => n.id !== noteId).map((n) => (
                  <li
                    key={n.id}
                    style={{ padding: "4px 8px", cursor: "pointer", fontSize: 12 }}
                    onClick={() => {
                      setSelectedToId(n.id);
                      setToNoteSearch(n.title);
                    }}
                  >
                    {n.title}
                  </li>
                ))}
              </ul>
            )}
            <select
              value={selectedCustomTypeId ?? `builtin:${selectedLinkType}`}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("builtin:")) {
                  setSelectedCustomTypeId(null);
                  setSelectedLinkType(v.slice(8));
                } else {
                  setSelectedCustomTypeId(v);
                }
              }}
              style={{ fontSize: 12 }}
            >
              {BUILT_IN_TYPES.map((t) => (
                <option key={t} value={`builtin:${t}`}>{t}</option>
              ))}
              {customTypes.length > 0 && (
                <option disabled>───</option>
              )}
              {customTypes.map((ct) => (
                <option key={ct.id} value={ct.id}>{ct.name}</option>
              ))}
            </select>
            {addError && <p style={{ color: "#f7768e", fontSize: 11, margin: 0 }}>{addError}</p>}
            <button
              onClick={() => createLinkMutation.mutate()}
              disabled={!selectedToId || createLinkMutation.isPending}
              style={{ fontSize: 12 }}
            >
              {createLinkMutation.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        )}

        {outgoing.size === 0 ? (
          <p className="links-panel-empty">No outgoing links.</p>
        ) : (
          [...outgoing.entries()].map(([type, links]) => (
            <div key={type} style={{ marginBottom: 6 }}>
              <span style={{ color: "#888", fontSize: 11 }}>{type}</span>
              <ul style={{ margin: "2px 0" }}>
                {links.map((l) => (
                  <li key={l.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Link to="/notes/$noteId" params={{ noteId: l.to_note_id }}>
                      {labelFor(l.to_note_id)}
                    </Link>
                    {l.context && (
                      <span style={{ color: "#666", fontSize: 11 }}>
                        {" "}— {l.context}
                      </span>
                    )}
                    <button
                      style={{ fontSize: 10, marginLeft: "auto", color: "#666" }}
                      onClick={() => deleteLinkMutation.mutate(l.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="links-panel-group">
        <h4>Backlinks</h4>
        {incoming.size === 0 ? (
          <p className="links-panel-empty">No backlinks.</p>
        ) : (
          [...incoming.entries()].map(([type, links]) => (
            <div key={type} style={{ marginBottom: 6 }}>
              <span style={{ color: "#888", fontSize: 11 }}>{type}</span>
              <ul style={{ margin: "2px 0" }}>
                {links.map((l) => (
                  <li key={l.id}>
                    <Link to="/notes/$noteId" params={{ noteId: l.from_note_id }}>
                      {labelFor(l.from_note_id)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
