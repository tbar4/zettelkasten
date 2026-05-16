/**
 * Pandoc wrapper for manuscript export.
 *
 * runPandoc() pipes a markdown string to pandoc via stdin and returns
 * stdout as a Buffer. isPandocAvailable() is memoized.
 */
import { spawn } from "node:child_process";

/** Cached result: undefined = not yet checked, true/false = checked */
let pandocAvailableCache: boolean | undefined = undefined;

/** Run `which pandoc` once and cache the result. */
export async function isPandocAvailable(): Promise<boolean> {
  if (pandocAvailableCache !== undefined) return pandocAvailableCache;

  pandocAvailableCache = await new Promise<boolean>((resolve) => {
    const child = spawn("which", ["pandoc"]);
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });

  return pandocAvailableCache;
}

/** Reset the memoized cache (used in tests). */
export function _resetPandocCache(): void {
  pandocAvailableCache = undefined;
}

/**
 * Run pandoc with the given args, piping `input` to stdin.
 * Resolves with stdout as Buffer; rejects with an Error containing stderr on non-zero exit.
 */
export function runPandoc(input: string, args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("pandoc", args, { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(stderr || `pandoc exited with code ${code ?? "null"}`));
      }
    });

    child.stdin.write(input, "utf-8");
    child.stdin.end();
  });
}
