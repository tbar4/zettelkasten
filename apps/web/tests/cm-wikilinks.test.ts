import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  wikilinkDecorations,
  wikilinkCompletionSource
} from "../src/lib/cm-wikilinks";

describe("wikilink decorations", () => {
  it("renders a doc with wikilinks without throwing", () => {
    const state = EditorState.create({
      doc: "see [[Foo]] and [[Bar]]",
      extensions: [wikilinkDecorations()]
    });
    const view = new EditorView({
      state,
      parent: document.createElement("div")
    });
    expect(view.state.doc.length).toBe("see [[Foo]] and [[Bar]]".length);
    view.destroy();
  });

  it("renders a doc without wikilinks without throwing", () => {
    const state = EditorState.create({
      doc: "plain text",
      extensions: [wikilinkDecorations()]
    });
    const view = new EditorView({
      state,
      parent: document.createElement("div")
    });
    expect(view.state.doc.toString()).toBe("plain text");
    view.destroy();
  });
});

describe("wikilinkCompletionSource", () => {
  it("returns null when not inside [[", async () => {
    const source = wikilinkCompletionSource(async () => ({ notes: [] }));
    const state = EditorState.create({ doc: "hello" });
    const ctx = new CompletionContext(state, 5, false);
    const result = await source(ctx);
    expect(result).toBeNull();
  });

  it("returns options when inside [[", async () => {
    const source = wikilinkCompletionSource(async () => ({
      notes: [
        { id: "1", title: "Foo Bar", type: "permanent" },
        { id: "2", title: "Foo Baz", type: "permanent" }
      ]
    }));
    const state = EditorState.create({ doc: "see [[foo" });
    const ctx = new CompletionContext(state, 9, true);
    const result = await source(ctx);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
    expect(result!.options.map((o) => o.label)).toEqual(["Foo Bar", "Foo Baz"]);
  });
});
