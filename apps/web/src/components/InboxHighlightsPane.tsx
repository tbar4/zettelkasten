interface HighlightItem {
  id: string;
  text: string;
}

interface InboxHighlightsPaneProps {
  items: HighlightItem[];
}

export function InboxHighlightsPane({ items }: InboxHighlightsPaneProps) {
  return (
    <div className="inbox-pane">
      <h3>Highlights ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">
          No Readwise highlights yet. (Wired in M1 Plan 5.)
        </p>
      ) : (
        items.map((h) => (
          <div key={h.id} className="inbox-row">
            <span className="inbox-row-title">{h.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
