import type { Note } from "@zk/shared";
import { TagEditor } from "./TagEditor";

interface NoteTopBarProps {
  note: Note;
  onBack: () => void;
}

export function NoteTopBar({ note, onBack }: NoteTopBarProps) {
  return (
    <div className="note-top-bar">
      <button onClick={onBack}>← Back</button>
      <span className="note-type-chip">{note.type}</span>
      <TagEditor noteId={note.id} tags={note.tags} />
      <span style={{ marginLeft: "auto", color: "#888" }}>
        updated {new Date(note.updated_at).toLocaleString()}
      </span>
    </div>
  );
}
