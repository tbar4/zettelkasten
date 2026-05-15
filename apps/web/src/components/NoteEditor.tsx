import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import { api } from "../lib/api-client";
import {
  wikilinkDecorations,
  wikilinkCompletionSource
} from "../lib/cm-wikilinks";

const theme = EditorView.theme({
  "&": {
    fontSize: "14px",
    backgroundColor: "#1a1a1a",
    color: "#e8e8e8",
    border: "1px solid #333",
    borderRadius: "4px"
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "12px"
  },
  ".cm-focused": { outline: "none" },
  ".cm-wikilink": {
    color: "#7aa2f7",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    cursor: "pointer"
  }
}, { dark: true });

interface NoteEditorProps {
  value: string;
  onChange: (next: string) => void;
}

export function NoteEditor({ value, onChange }: NoteEditorProps) {
  const extensions = useMemo(
    () => [
      markdown(),
      theme,
      wikilinkDecorations(),
      autocompletion({
        override: [wikilinkCompletionSource((q) => api.searchNotes(q))]
      })
    ],
    []
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false
      }}
      style={{ marginTop: 16 }}
    />
  );
}
