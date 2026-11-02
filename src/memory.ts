import { dirname } from "./fs.ts";
import type { DirEntry, KiesFs } from "./types.ts";

/**
 * A `KiesFs` over a list of files: tests, or a host that already holds the list of paths (the
 * keys of a storage, the tree of a repository) and reads files on demand.
 *
 * @example memoryFs({ "package.json": '{"dependencies":{"nuxt":"^4.0.0"}}', "content/index.md": "" })
 * @example memoryFs(paths, (path) => storage.getItem(path))
 */
export function memoryFs(
  files: Record<string, string> | string[],
  read?: (path: string) => Promise<string | undefined>,
): KiesFs {
  const contents = Array.isArray(files) ? undefined : files;
  const paths = Array.isArray(files) ? files : Object.keys(files);
  const dirs = new Map<string, Map<string, boolean>>([["", new Map()]]);
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      const directory = i < segments.length - 1;
      let entries = dirs.get(parent);
      if (!entries) dirs.set(parent, (entries = new Map()));
      if (directory || !entries.has(segments[i]!)) entries.set(segments[i]!, directory);
      if (directory && !dirs.has(segments.slice(0, i + 1).join("/"))) {
        dirs.set(segments.slice(0, i + 1).join("/"), new Map());
      }
    }
  }
  return {
    async readDir(path) {
      const entries = dirs.get(path.replace(/^\/+|\/+$/g, ""));
      if (!entries) return [];
      return [...entries].map(([name, directory]): DirEntry => ({ name, directory }));
    },
    async readFile(path) {
      const normalized = path.replace(/^\/+/, "");
      const name = normalized.split("/").pop()!;
      if (dirs.get(dirname(normalized))?.get(name) !== false) return undefined;
      return contents ? contents[normalized] : read?.(normalized);
    },
  };
}
