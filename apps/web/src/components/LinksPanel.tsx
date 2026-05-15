import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { api } from "../lib/api-client";
import type { NoteLink } from "@zk/shared";

interface LinksPanelProps {
  noteId: string;
}

function groupByType(links: NoteLink[]): Map<string, NoteLink[]> {
  const groups = new Map<string, NoteLink[]>();
  for (const l of links) {
    const existing = groups.get(l.link_type);
    if (existing) existing.push(l);
    else groups.set(l.link_type, [l]);
  }
  return groups;
}

export function LinksPanel({ noteId }: LinksPanelProps) {
  const linksQuery = useQuery({
    queryKey: ["notes", noteId, "links"],
    queryFn: () => api.getNoteLinks(noteId)
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

  return (
    <div className="links-panel">
      <div className="links-panel-group">
        <h4>Outgoing</h4>
        {outgoing.size === 0 ? (
          <p className="links-panel-empty">No outgoing links.</p>
        ) : (
          [...outgoing.entries()].map(([type, links]) => (
            <div key={type} style={{ marginBottom: 6 }}>
              <span style={{ color: "#888", fontSize: 11 }}>{type}</span>
              <ul style={{ margin: "2px 0" }}>
                {links.map((l) => (
                  <li key={l.id}>
                    <Link to="/notes/$noteId" params={{ noteId: l.to_note_id }}>
                      {labelFor(l.to_note_id)}
                    </Link>
                    {l.context && (
                      <span style={{ color: "#666", fontSize: 11 }}>
                        {" "}— {l.context}
                      </span>
                    )}
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
