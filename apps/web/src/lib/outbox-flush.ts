import { listPending, markFlushed } from "./outbox";

export interface FlushApi {
  createNote(input: {
    type: "fleeting";
    title: string;
    body_md?: string;
  }): Promise<unknown>;
}

async function flush(api: FlushApi): Promise<void> {
  const pending = await listPending();
  for (const record of pending) {
    try {
      await api.createNote({
        type: "fleeting",
        title: record.body.title,
        body_md: record.body.body_md
      });
      await markFlushed(record.id!);
    } catch {
      // Leave in queue — will retry next flush
    }
  }
}

export function startFlushLoop(api: FlushApi): () => void {
  const intervalId = setInterval(() => {
    void flush(api);
  }, 30_000);

  const onOnline = () => {
    void flush(api);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
  }

  return () => {
    clearInterval(intervalId);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
    }
  };
}
