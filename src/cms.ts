import { parseYAML } from "confbox";
import { commonDir, dirname, join, type ProjectFiles } from "./fs.ts";
import type { PackageJson } from "./frameworks.ts";
import { dependencies } from "./frameworks.ts";
import type { GitCms } from "./types.ts";

/** A git-based CMS, and the folders its config declares (relative to the project). */
export interface CmsFolders {
  cms: GitCms;
  /** Folders of its collections. */
  content: string[];
  /** Where it uploads media. */
  media?: string;
}

/** Where Decap (ex Netlify CMS) and Sveltia read their config: the admin page of the site. */
const DECAP_CONFIGS = [
  "admin",
  "static/admin",
  "public/admin",
  "src/admin",
  "app/public/admin",
].flatMap((dir) => [`${dir}/config.yml`, `${dir}/config.yaml`]);

/** The git-based CMS of a project: those whose config is read first, best first. */
export async function detectCms(
  files: ProjectFiles,
  pkg: PackageJson | undefined,
  signals: string[],
): Promise<CmsFolders[]> {
  const found = (
    await Promise.all([decap(files), frontMatter(files), tina(files), keystatic(files)])
  ).filter((item) => item !== undefined);
  const deps = dependencies(pkg);
  const studio = ["nuxt-studio", "@nuxthq/studio"].find((name) => name in deps);
  if (studio) {
    found.push({ cms: { id: "nuxt-studio", name: "Nuxt Studio", read: false }, content: [] });
  }
  for (const { cms, content, media } of found) {
    const folders = [
      ...content.map((dir) => `content ${dir || "."}`),
      ...(media ? [`media ${media}`] : []),
    ];
    signals.push(
      `${cms.config ?? "package.json"}: ${cms.name}${folders.length ? ` (${folders.join(", ")})` : ""}`,
    );
  }
  return found;
}

/** `/images/uploads` and `./static/img` alike: a path of the repository. */
function repoPath(path: string): string {
  return join(path.replace(/^\.?\/+/, ""));
}

async function decap(files: ProjectFiles): Promise<CmsFolders | undefined> {
  const path = await files.firstFile(DECAP_CONFIGS);
  if (!path) return undefined;
  let config: Record<string, unknown> = {};
  try {
    config = (parseYAML((await files.read(path)) ?? "") as Record<string, unknown>) ?? {};
  } catch {
    // Unreadable: still Decap, without folders.
  }
  const page = await files.read(join(dirname(path), "index.html"));
  const sveltia = !!page && /sveltia/i.test(page);
  const content: string[] = [];
  for (const collection of asArray(config.collections)) {
    if (typeof collection.folder === "string") content.push(repoPath(collection.folder));
    for (const file of asArray(collection.files)) {
      if (typeof file.file === "string") content.push(dirname(repoPath(file.file)));
    }
  }
  const media = typeof config.media_folder === "string" ? repoPath(config.media_folder) : undefined;
  return {
    cms: {
      id: sveltia ? "sveltia" : "decap",
      name: sveltia ? "Sveltia CMS" : "Decap CMS",
      config: files.path(path),
      read: true,
    },
    content,
    media,
  };
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

/** Front Matter CMS (VS Code): `frontmatter.json`, its paths prefixed with `[[workspace]]`. */
async function frontMatter(files: ProjectFiles): Promise<CmsFolders | undefined> {
  if (!(await files.isFile("frontmatter.json"))) return undefined;
  const config = (await files.json("frontmatter.json")) ?? {};
  const workspacePath = (path: unknown) =>
    typeof path === "string" ? repoPath(path.replace("[[workspace]]", "")) : undefined;
  const content = asArray(config["frontMatter.content.pageFolders"])
    .map((folder) => workspacePath(folder.path))
    .filter((path) => path !== undefined);
  const publicFolder = config["frontMatter.content.publicFolder"];
  const media = workspacePath(
    publicFolder && typeof publicFolder === "object"
      ? (publicFolder as Record<string, unknown>).path
      : publicFolder,
  );
  return {
    cms: {
      id: "frontmatter",
      name: "Front Matter CMS",
      config: files.path("frontmatter.json"),
      read: true,
    },
    content,
    media,
  };
}

/** TinaCMS: its config is code, only detected. */
async function tina(files: ProjectFiles): Promise<CmsFolders | undefined> {
  const path =
    (await files.config("tina/config", ["ts", "tsx", "js", "jsx"])) ??
    (await files.config(".tina/config", ["ts", "tsx", "js", "jsx"]));
  if (!path) return undefined;
  return {
    cms: { id: "tina", name: "TinaCMS", config: files.path(path), read: false },
    content: [],
  };
}

/** Keystatic: its config is code, only detected. */
async function keystatic(files: ProjectFiles): Promise<CmsFolders | undefined> {
  const path = await files.config("keystatic.config", ["ts", "tsx", "js", "mjs"]);
  if (!path) return undefined;
  return {
    cms: { id: "keystatic", name: "Keystatic", config: files.path(path), read: false },
    content: [],
  };
}

/** The folder holding the content of every collection. */
export function cmsContentDir(found: CmsFolders[]): string | undefined {
  const folders = found.flatMap((item) => item.content);
  return folders.length ? commonDir(folders) : undefined;
}
