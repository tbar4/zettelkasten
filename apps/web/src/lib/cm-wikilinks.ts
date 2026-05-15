import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import {
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from "@codemirror/autocomplete";
import { WIKILINK_REGEX } from "@zk/shared";

const wikilinkMark = Decoration.mark({ class: "cm-wikilink" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const re = new RegExp(WIKILINK_REGEX.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      builder.add(start, end, wikilinkMark);
    }
  }
  return builder.finish();
}

export function wikilinkDecorations() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

type SearchFn = (q: string) => Promise<{
  notes: { id: string; title: string; type: string }[];
}>;

export function wikilinkCompletionSource(searchFn: SearchFn): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // Look backwards from the cursor for an unclosed `[[`.
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.doc.sliceString(line.from, ctx.pos);
    const open = before.lastIndexOf("[[");
    if (open === -1) return null;
    // If a closing ]] occurs between open and cursor, we're past the link.
    const closeBetween = before.indexOf("]]", open);
    if (closeBetween !== -1 && closeBetween + line.from < ctx.pos) return null;

    const q = before.slice(open + 2);
    if (!ctx.explicit && q.length === 0) return null;

    const { notes } = await searchFn(q);
    return {
      from: line.from + open + 2,
      to: ctx.pos,
      options: notes.map((n) => ({
        label: n.title,
        detail: n.type,
        apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
          // Replace from current open position through `]]` if present, else insert `]]`.
          const docAfter = view.state.doc.sliceString(to, to + 2);
          const insertion = docAfter === "]]" ? n.title : `${n.title}]]`;
          view.dispatch({
            changes: { from, to, insert: insertion },
            selection: { anchor: from + insertion.length }
          });
        }
      })),
      validFor: /^[^\[\]\n]*$/
    };
  };
}
