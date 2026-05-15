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
  }
};
