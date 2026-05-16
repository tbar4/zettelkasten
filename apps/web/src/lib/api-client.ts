import type { Note, NewNote, NoteLink } from "@zk/shared";

async function request<T>(
  path: string,
  init: RequestInit & { method: string }
): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* fall through */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listNotes(params: { type?: string } = {}): Promise<{ notes: Note[] }> {
    const search = new URLSearchParams();
    if (params.type) search.set("type", params.type);
    const qs = search.toString();
    return request(`/api/notes${qs ? `?${qs}` : ""}`, { method: "GET" });
  },

  listNotesByIds(ids: string[]): Promise<{ notes: Note[] }> {
    if (ids.length === 0) return Promise.resolve({ notes: [] });
    return request(
      `/api/notes?ids=${ids.map(encodeURIComponent).join(",")}`,
      { method: "GET" }
    );
  },

  listNoteSummariesByIds(
    ids: string[]
  ): Promise<{ notes: Pick<Note, "id" | "title" | "type">[] }> {
    if (ids.length === 0) return Promise.resolve({ notes: [] });
    return request(
      `/api/notes?ids=${ids.map(encodeURIComponent).join(",")}&fields=id,title,type`,
      { method: "GET" }
    );
  },

  getNote(id: string): Promise<Note> {
    return request(`/api/notes/${id}`, { method: "GET" });
  },

  createNote(input: NewNote): Promise<Note> {
    return request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  updateNote(
    id: string,
    input: Partial<NewNote>,
    ifMatch: string
  ): Promise<Note> {
    return request(`/api/notes/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": ifMatch
      },
      body: JSON.stringify(input)
    });
  },

  archiveNote(id: string): Promise<void> {
    return request(`/api/notes/${id}`, { method: "DELETE" });
  },

  searchNotes(q: string): Promise<{ notes: Pick<Note, "id" | "title" | "type">[] }> {
    const qs = new URLSearchParams({ q }).toString();
    return request(`/api/notes/search?${qs}`, { method: "GET" });
  },

  getNoteLinks(
    id: string
  ): Promise<{ outgoing: NoteLink[]; incoming: NoteLink[] }> {
    return request(`/api/notes/${id}/links`, { method: "GET" });
  },

  createLink(input: {
    from_note_id: string;
    to_note_id: string;
    link_type?: string;
    context?: string;
    custom_link_type_id?: string;
  }): Promise<NoteLink> {
    return request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  deleteLink(id: string): Promise<void> {
    return request(`/api/links/${id}`, { method: "DELETE" });
  },

  setNoteTags(noteId: string, tagNames: string[]): Promise<{ tags: string[] }> {
    return request(`/api/notes/${noteId}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: tagNames })
    });
  },

  suggestTags(q: string): Promise<{ tags: { name: string; count: number }[] }> {
    const qs = new URLSearchParams({ q }).toString();
    return request(`/api/tags/suggest?${qs}`, { method: "GET" });
  },

  getGraph(): Promise<{
    nodes: { id: string; title: string; type: string }[];
    edges: { id: string; source: string; target: string; link_type: string }[];
  }> {
    return request("/api/graph", { method: "GET" });
  },

  getInbox(): Promise<{
    due: { id: string; title: string; type: string; next_due_at: string }[];
    fleeting: { id: string; title: string; type: string }[];
    highlights: { id: string; text: string; source_title: string }[];
  }> {
    return request("/api/inbox", { method: "GET" });
  },

  postReview(
    noteId: string,
    action: "keep" | "archive"
  ): Promise<void | { interval_days: number; next_due_at: string }> {
    return request(`/api/notes/${noteId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
  },

  promoteToPermanent(noteId: string, ifMatch: string): Promise<Note> {
    return request(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": ifMatch
      },
      body: JSON.stringify({ type: "permanent" })
    });
  },

  promoteHighlight(
    highlightId: string,
    titleOverride?: string
  ): Promise<Note> {
    return request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(titleOverride ? { title: titleOverride } : {})
    });
  },

  notionPreview(token: string, databaseId: string): Promise<{
    pages: {
      notionPageId: string;
      title: string;
      body: string;
      detectedType: "fleeting" | "literature" | "permanent" | "topic";
    }[];
  }> {
    return request("/api/notion/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, databaseId })
    });
  },

  notionCommit(pages: {
    notionPageId: string;
    title: string;
    body: string;
    type: "fleeting" | "literature" | "permanent" | "topic";
  }[]): Promise<{ inserted: number; updated: number }> {
    return request("/api/notion/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pages })
    });
  },

  listCustomLinkTypes(): Promise<{
    customLinkTypes: { id: string; name: string; description: string | null; created_at: string }[];
  }> {
    return request("/api/custom-link-types", { method: "GET" });
  },

  createCustomLinkType(input: {
    name: string;
    description?: string;
  }): Promise<{ id: string; name: string; description: string | null; created_at: string }> {
    return request("/api/custom-link-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  updateCustomLinkType(
    id: string,
    input: { name?: string; description?: string | null }
  ): Promise<{ id: string; name: string; description: string | null; created_at: string }> {
    return request(`/api/custom-link-types/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  deleteCustomLinkType(id: string): Promise<void> {
    return request(`/api/custom-link-types/${id}`, { method: "DELETE" });
  },

  canvasByTopic(topicNoteId: string): Promise<{
    id: string;
    topic_note_id: string;
    scene_data: string | null;
    viewport: string | null;
    theme: string | null;
    created_at: string;
    updated_at: string;
    items: {
      id: string;
      canvas_id: string;
      note_id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color: string | null;
      z_index: number;
      created_at: string;
    }[];
    edges: {
      id: string;
      canvas_id: string;
      from_item_id: string;
      to_item_id: string;
      label: string | null;
      color: string | null;
      created_at: string;
    }[];
  }> {
    return request(`/api/canvases/by-topic/${topicNoteId}`, { method: "GET" });
  },

  updateCanvas(
    id: string,
    patch: { scene_data?: string; viewport?: string; theme?: string }
  ): Promise<{
    id: string;
    topic_note_id: string;
    scene_data: string | null;
    viewport: string | null;
    theme: string | null;
    created_at: string;
    updated_at: string;
    items: unknown[];
    edges: unknown[];
  }> {
    return request(`/api/canvases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
  },

  addCanvasItem(
    canvasId: string,
    body: { noteId: string; x: number; y: number; width?: number; height?: number; color?: string }
  ): Promise<{
    id: string;
    canvas_id: string;
    note_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string | null;
    z_index: number;
    created_at: string;
  }> {
    return request(`/api/canvases/${canvasId}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  },

  updateCanvasItem(
    itemId: string,
    patch: { x?: number; y?: number; width?: number; height?: number; color?: string | null; zIndex?: number }
  ): Promise<{
    id: string;
    canvas_id: string;
    note_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string | null;
    z_index: number;
    created_at: string;
  }> {
    return request(`/api/canvases/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
  },

  deleteCanvasItem(itemId: string): Promise<void> {
    return request(`/api/canvases/items/${itemId}`, { method: "DELETE" });
  },

  addCanvasEdge(
    canvasId: string,
    body: { fromItemId: string; toItemId: string; label?: string; color?: string }
  ): Promise<{
    id: string;
    canvas_id: string;
    from_item_id: string;
    to_item_id: string;
    label: string | null;
    color: string | null;
    created_at: string;
  }> {
    return request(`/api/canvases/${canvasId}/edges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  },

  deleteCanvasEdge(edgeId: string): Promise<void> {
    return request(`/api/canvases/edges/${edgeId}`, { method: "DELETE" });
  },

  listManuscripts(): Promise<{
    manuscripts: {
      id: string;
      title: string;
      anchor_topic_ids: string[];
      anchor_count: number;
      section_count: number;
      created_at: string;
      updated_at: string;
    }[];
  }> {
    return request("/api/manuscripts", { method: "GET" });
  },

  createManuscript(input: {
    title: string;
    anchorTopicIds?: string[];
  }): Promise<ManuscriptDetail> {
    return request("/api/manuscripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  getManuscript(id: string): Promise<ManuscriptDetail> {
    return request(`/api/manuscripts/${id}`, { method: "GET" });
  },

  updateManuscript(
    id: string,
    input: { title?: string; anchorTopicIds?: string[]; bodyMd?: string | null }
  ): Promise<ManuscriptDetail> {
    return request(`/api/manuscripts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  deleteManuscript(id: string): Promise<void> {
    return request(`/api/manuscripts/${id}`, { method: "DELETE" });
  },

  addManuscriptSection(
    manuscriptId: string,
    input: {
      position?: number;
      noteId?: string | null;
      isTransclusion?: boolean;
      heading?: string | null;
      frozenBodyMd?: string | null;
    }
  ): Promise<ManuscriptSection> {
    return request(`/api/manuscripts/${manuscriptId}/sections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  updateManuscriptSection(
    sectionId: string,
    input: {
      position?: number;
      heading?: string | null;
      isTransclusion?: boolean;
      frozenBodyMd?: string | null;
    }
  ): Promise<ManuscriptSection> {
    return request(`/api/manuscripts/sections/${sectionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  deleteManuscriptSection(sectionId: string): Promise<void> {
    return request(`/api/manuscripts/sections/${sectionId}`, { method: "DELETE" });
  },

  manuscriptExportUrl(id: string, format: "md" | "latex" | "docx"): string {
    return `/api/manuscripts/${id}/export?format=${format}`;
  },

  listSourcesStats(): Promise<{ count: number; last_updated: string | null }> {
    return request("/api/sources", { method: "GET" });
  },

  bibtexUrl(): string {
    return "/api/sources/bibtex";
  }
};

export type ManuscriptSection = {
  id: string;
  manuscript_id: string;
  position: number;
  note_id: string | null;
  note_title: string | null;
  is_transclusion: boolean;
  frozen_body_md: string | null;
  body_md: string | null;
  heading: string | null;
  created_at: string;
};

export type ManuscriptDetail = {
  id: string;
  title: string;
  anchor_topic_ids: string[];
  body_md: string | null;
  created_at: string;
  updated_at: string;
  sections: ManuscriptSection[];
};
