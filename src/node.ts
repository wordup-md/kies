import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KiesFs } from "./types.ts";

/**
 * A `KiesFs` over a folder on disk.
 *
 * @example const { projects } = await sniff(nodeFs(process.cwd()));
 */
export function nodeFs(root: string): KiesFs {
  return {
    async readDir(path) {
      const entries = await readdir(join(root, path), { withFileTypes: true }).catch(() => []);
      return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
    },
    async readFile(path) {
      return readFile(join(root, path), "utf8").catch(() => undefined);
    },
  };
}
