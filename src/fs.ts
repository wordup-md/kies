import type { DirEntry, KiesFs } from "./types.ts";

/** `a/b` + `c` → `a/b/c`; an empty side is dropped. */
export function join(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split("/"))
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

/** `a/b/c.md` → `a/b`; `c.md` → `""`. */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/** The deepest folder holding every path: `a/b` and `a/c` → `a`. */
export function commonDir(paths: string[]): string {
  if (!paths.length) return "";
  const split = paths.map((path) => path.split("/").filter(Boolean));
  const first = split[0]!;
  let length = 0;
  while (length < first.length && split.every((segments) => segments[length] === first[length])) {
    length++;
  }
  return first.slice(0, length).join("/");
}

/**
 * The folder a glob starts from: its segments up to the first one with a glob character.
 *
 * @example globBase("blog/**\/*.md") // → "blog"
 */
export function globBase(glob: string): string {
  const segments: string[] = [];
  for (const segment of glob.split("/")) {
    if (/[*?[\]{}!]/.test(segment)) break;
    segments.push(segment);
  }
  // A glob without any glob character names a file: its folder.
  return segments.length === glob.split("/").length ? dirname(glob) : segments.join("/");
}

/**
 * The fs with every read done once: the detectors ask the same files and folders again.
 */
export function cached(fs: KiesFs): KiesFs {
  const dirs = new Map<string, Promise<DirEntry[]>>();
  const files = new Map<string, Promise<string | undefined>>();
  return {
    readDir(path) {
      let entries = dirs.get(path);
      if (!entries) {
        entries = fs.readDir(path).catch(() => []);
        dirs.set(path, entries);
      }
      return entries;
    },
    readFile(path) {
      let text = files.get(path);
      if (!text) {
        text = fs.readFile(path).catch(() => undefined);
        files.set(path, text);
      }
      return text;
    },
  };
}

/** Reads of a project, its folder as the root. */
export class ProjectFiles {
  constructor(
    readonly fs: KiesFs,
    /** The folder of the project, relative to what is sniffed. */
    readonly root: string,
  ) {}

  /** A path of the project as a path of what is sniffed. */
  path(path: string): string {
    return join(this.root, path);
  }

  async entries(path = ""): Promise<DirEntry[]> {
    return this.fs.readDir(this.path(path));
  }

  async read(path: string): Promise<string | undefined> {
    return this.fs.readFile(this.path(path));
  }

  async isDir(path: string): Promise<boolean> {
    const name = path.split("/").pop()!;
    const entries = await this.entries(dirname(path));
    return entries.some((entry) => entry.directory && entry.name === name);
  }

  async isFile(path: string): Promise<boolean> {
    const name = path.split("/").pop()!;
    const entries = await this.entries(dirname(path));
    return entries.some((entry) => !entry.directory && entry.name === name);
  }

  /** The first of `paths` that is a file. */
  async firstFile(paths: string[]): Promise<string | undefined> {
    for (const path of paths) if (await this.isFile(path)) return path;
    return undefined;
  }

  /** `name.{ts,js,…}`: the first that exists. */
  async config(name: string, extensions = CONFIG_EXTENSIONS): Promise<string | undefined> {
    return this.firstFile(extensions.map((extension) => `${name}.${extension}`));
  }

  async json<T = Record<string, unknown>>(path: string): Promise<T | undefined> {
    const text = await this.read(path);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }
}

export const CONFIG_EXTENSIONS = ["ts", "mts", "js", "mjs", "cjs"];
