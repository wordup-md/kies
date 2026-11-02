import { parseYAML } from "confbox";
import { join, type ProjectFiles } from "./fs.ts";
import type { PackageJson } from "./frameworks.ts";

/** The globs of the workspaces: `pnpm-workspace.yaml`, else `workspaces` of package.json. */
export async function workspaceGlobs(
  files: ProjectFiles,
  pkg: PackageJson | undefined,
): Promise<string[] | undefined> {
  const pnpm = await files.read("pnpm-workspace.yaml");
  if (pnpm !== undefined) {
    try {
      const packages = (parseYAML(pnpm) as { packages?: unknown } | null)?.packages;
      if (Array.isArray(packages)) return packages.filter((glob) => typeof glob === "string");
    } catch {
      // Unreadable: no workspace.
    }
  }
  const workspaces = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  return Array.isArray(workspaces)
    ? workspaces.filter((glob) => typeof glob === "string")
    : undefined;
}

/** Deepest `**` walks: a workspace glob names packages, not every folder of the repository. */
const MAX_DEPTH = 3;
const SKIPPED = new Set(["node_modules", ".git"]);

/**
 * The folders matching workspace globs (`apps/*`, `packages/**`, `docs`), those of `!` globs left
 * out, and only those with a package.json.
 */
export async function expandWorkspaces(files: ProjectFiles, globs: string[]): Promise<string[]> {
  const include = globs.filter((glob) => !glob.startsWith("!"));
  const exclude = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
  const found = new Set<string>();
  for (const glob of include) {
    for (const dir of await expand(files, segments(glob), "", 0)) found.add(dir);
  }
  const excluded = new Set<string>();
  for (const glob of exclude) {
    for (const dir of await expand(files, segments(glob), "", 0)) excluded.add(dir);
  }
  const dirs = [...found].filter((dir) => dir && !excluded.has(dir)).sort();
  const withPackage = await Promise.all(dirs.map((dir) => files.isFile(join(dir, "package.json"))));
  return dirs.filter((_, i) => withPackage[i]);
}

function segments(glob: string): string[] {
  return glob
    .replace(/^\.\//, "")
    .split("/")
    .filter((segment) => segment && segment !== ".");
}

async function expand(
  files: ProjectFiles,
  rest: string[],
  dir: string,
  depth: number,
): Promise<string[]> {
  if (!rest.length) return [dir];
  const [segment, ...next] = rest as [string, ...string[]];
  const children = async () =>
    (await files.entries(dir))
      .filter((entry) => entry.directory && !SKIPPED.has(entry.name))
      .map((entry) => join(dir, entry.name));
  if (segment === "**") {
    // Zero folders, or one more and `**` again.
    const here = await expand(files, next, dir, depth);
    if (depth >= MAX_DEPTH) return here;
    const deeper = await Promise.all(
      (await children()).map((child) => expand(files, rest, child, depth + 1)),
    );
    return [...here, ...deeper.flat()];
  }
  if (/[*?[\]{}]/.test(segment)) {
    const pattern = new RegExp(
      `^${segment
        .replace(/[.+^$()|\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")}$`,
    );
    const matching = (await children()).filter((child) => pattern.test(child.split("/").pop()!));
    const expanded = await Promise.all(
      matching.map((child) => expand(files, next, child, depth + 1)),
    );
    return expanded.flat();
  }
  const child = join(dir, segment);
  return (await files.isDir(child)) ? expand(files, next, child, depth + 1) : [];
}
