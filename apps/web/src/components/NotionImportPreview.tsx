import { useState } from "react";

type NoteType = "fleeting" | "literature" | "permanent" | "topic";

interface PreviewPage {
  notionPageId: string;
  title: string;
  body: string;
  detectedType: NoteType;
}

interface NotionImportPreviewProps {
  initialPages: PreviewPage[];
  onCommit: (
    pages: {
      notionPageId: string;
      title: string;
      body: string;
      type: NoteType;
    }[]
  ) => void;
  committing: boolean;
}

const TYPES: NoteType[] = ["fleeting", "literature", "permanent", "topic"];

export function NotionImportPreview({
  initialPages,
  onCommit,
  committing
}: NotionImportPreviewProps) {
  const [types, setTypes] = useState<Map<string, NoteType>>(
    () => new Map(initialPages.map((p) => [p.notionPageId, p.detectedType]))
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const setRowType = (id: string, type: NoteType) => {
    setTypes((m) => {
      const next = new Map(m);
      next.set(id, type);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkSet = (type: NoteType) => {
    if (selected.size === 0) return;
    setTypes((m) => {
      const next = new Map(m);
      for (const id of selected) next.set(id, type);
      return next;
    });
  };

  const submit = () => {
    onCommit(
      initialPages.map((p) => ({
        notionPageId: p.notionPageId,
        title: p.title,
        body: p.body,
        type: types.get(p.notionPageId) ?? p.detectedType
      }))
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <span style={{ color: "#888", fontSize: 12 }}>
          {selected.size} selected
        </span>
        <span style={{ color: "#666", fontSize: 12 }}>Bulk set to:</span>
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => bulkSet(t)}
            disabled={selected.size === 0}
            style={{ fontSize: 12, padding: "2px 8px" }}
          >
            {t}
          </button>
        ))}
        <button
          onClick={submit}
          disabled={committing}
          style={{ marginLeft: "auto" }}
        >
          {committing ? "Importing…" : `Import ${initialPages.length} pages`}
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#888", fontSize: 11 }}>
            <th style={{ padding: 4 }}></th>
            <th style={{ padding: 4 }}>Title</th>
            <th style={{ padding: 4 }}>Type</th>
            <th style={{ padding: 4 }}>Body preview</th>
          </tr>
        </thead>
        <tbody>
          {initialPages.map((p) => (
            <tr key={p.notionPageId} style={{ borderTop: "1px solid #222" }}>
              <td style={{ padding: 4 }}>
                <input
                  type="checkbox"
                  checked={selected.has(p.notionPageId)}
                  onChange={() => toggleSelected(p.notionPageId)}
                />
              </td>
              <td style={{ padding: 4 }}>{p.title}</td>
              <td style={{ padding: 4 }}>
                <select
                  value={types.get(p.notionPageId) ?? p.detectedType}
                  onChange={(e) =>
                    setRowType(p.notionPageId, e.target.value as NoteType)
                  }
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 4, color: "#888" }}>
                {p.body.slice(0, 120).replace(/\n+/g, " ")}
                {p.body.length > 120 ? "…" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
