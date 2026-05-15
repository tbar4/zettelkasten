import type { Note } from "@zk/shared";

interface LiteratureSourceBlockProps {
  sources: Note["sources"];
}

export function LiteratureSourceBlock({ sources }: LiteratureSourceBlockProps) {
  if (sources.length === 0) return null;
  return (
    <div
      style={{
        background: "#161616",
        border: "1px solid #222",
        borderRadius: 4,
        padding: 12,
        marginTop: 12,
        marginBottom: 12,
        fontSize: 13
      }}
    >
      <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>
        Source
      </div>
      {sources.map((s) => (
        <div key={s.id}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          ) : (
            s.title
          )}
          {s.author && (
            <span style={{ color: "#888" }}> — {s.author}</span>
          )}
        </div>
      ))}
    </div>
  );
}
