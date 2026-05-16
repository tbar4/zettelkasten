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
  }
};
