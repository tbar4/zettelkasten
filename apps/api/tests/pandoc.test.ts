import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter, Readable, Writable } from "node:stream";

// Mock node:child_process before importing the module under test
vi.mock("node:child_process");

import { runPandoc, isPandocAvailable, _resetPandocCache } from "../src/manuscripts/pandoc";
import { spawn as mockSpawn } from "node:child_process";

// Helper that builds a fake child process returned by spawn
function makeChildProcess({
  stdoutData,
  stderrData = "",
  exitCode = 0
}: {
  stdoutData: string | Buffer;
  stderrData?: string;
  exitCode?: number;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    stdin: Writable;
  };

  const stdinChunks: Buffer[] = [];
  const stdin = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      stdinChunks.push(chunk);
      cb();
    }
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stdin as any).getWritten = () => Buffer.concat(stdinChunks).toString("utf-8");

  child.stdin = stdin;

  // Emit stdout / stderr data and exit asynchronously
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });

  // Schedule async events after current tick so consumers can attach listeners
  setImmediate(() => {
    if (stdoutData) {
      child.stdout.push(Buffer.from(stdoutData));
    }
    child.stdout.push(null); // EOF

    if (stderrData) {
      child.stderr.push(Buffer.from(stderrData));
    }
    child.stderr.push(null); // EOF

    child.emit("exit", exitCode, null);
  });

  return child;
}

describe("runPandoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPandocCache();
  });

  it("resolves with stdout buffer on exit code 0", async () => {
    const fakeChild = makeChildProcess({ stdoutData: "converted output" });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    const result = await runPandoc("# Hello", ["-f", "markdown", "-t", "latex"]);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString("utf-8")).toBe("converted output");
  });

  it("calls pandoc with the provided args", async () => {
    const fakeChild = makeChildProcess({ stdoutData: "ok" });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    await runPandoc("input", ["-f", "markdown", "-t", "docx"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      "pandoc",
      ["-f", "markdown", "-t", "docx"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
    );
  });

  it("rejects with stderr message on non-zero exit", async () => {
    const fakeChild = makeChildProcess({
      stdoutData: "",
      stderrData: "pandoc: unknown format",
      exitCode: 1
    });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    await expect(runPandoc("bad", ["-t", "invalid"])).rejects.toThrow("pandoc: unknown format");
  });

  it("rejects with generic message when stderr is empty on non-zero exit", async () => {
    const fakeChild = makeChildProcess({
      stdoutData: "",
      stderrData: "",
      exitCode: 2
    });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    await expect(runPandoc("bad", [])).rejects.toThrow("pandoc exited with code 2");
  });
});

describe("isPandocAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPandocCache();
  });

  it("returns true when `which pandoc` exits 0", async () => {
    const fakeChild = makeChildProcess({ stdoutData: "/usr/local/bin/pandoc" });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    const result = await isPandocAvailable();
    expect(result).toBe(true);
  });

  it("returns false when `which pandoc` exits 1", async () => {
    const fakeChild = makeChildProcess({ stdoutData: "", exitCode: 1 });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    const result = await isPandocAvailable();
    expect(result).toBe(false);
  });

  it("memoizes the result and calls spawn only once", async () => {
    const fakeChild = makeChildProcess({ stdoutData: "/usr/bin/pandoc" });
    vi.mocked(mockSpawn).mockReturnValue(fakeChild as ReturnType<typeof mockSpawn>);

    await isPandocAvailable();
    await isPandocAvailable(); // second call – should not spawn again

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("returns false when spawn emits an error", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      stdin: Writable;
    };
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.stdin = new Writable({ write(_c: unknown, _e: unknown, cb: () => void) { cb(); } });

    setImmediate(() => {
      child.emit("error", new Error("spawn ENOENT"));
    });

    vi.mocked(mockSpawn).mockReturnValue(child as ReturnType<typeof mockSpawn>);

    const result = await isPandocAvailable();
    expect(result).toBe(false);
  });
});
