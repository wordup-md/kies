import { cmsContentDir, detectCms } from "./cms.ts";
import { cached, commonDir, join, ProjectFiles } from "./fs.ts";
import { detectFramework, hugoConfig, parseConfigFile, type PackageJson } from "./frameworks.ts";
import { contentLayer, nuxtLayout } from "./nuxt.ts";
import type { AssetsDir, KiesFs, Project, SniffOptions, SniffResult } from "./types.ts";
import { expandWorkspaces, workspaceGlobs } from "./workspaces.ts";

export type * from "./types.ts";
export { readConfig } from "./config-object.ts";

/**
 * What a project is made of, from its files only: its framework (or static site generator, or
 * plain files), its content layer and git-based CMS, the folders of its content and assets, and
 * the same for each package of its workspaces.
 *
 * The folder of the content comes from, in order: the config of a git-based CMS (Decap, Sveltia,
 * Front Matter), the config or conventions of the framework (`content.config` of Nuxt Content,
 * Hugo's `contentDir`…), a `content/` folder, else the root.
 *
 * @example
 * import { sniff } from "@wordup-md/kies";
 * import { nodeFs } from "@wordup-md/kies/node";
 * const { projects } = await sniff(nodeFs("."));
 * projects[0].framework?.name; // "Nuxt"
 * projects[0].contentDir; // "content"
 */
export async function sniff(fs: KiesFs, options: SniffOptions = {}): Promise<SniffResult> {
  const reader = cached(fs);
  const root = await sniffProject(reader, "");
  const rootFiles = new ProjectFiles(reader, "");
  const globs =
    options.workspaces === false
      ? undefined
      : await workspaceGlobs(rootFiles, await rootFiles.json<PackageJson>("package.json"));
  if (!globs?.length) return { projects: [root] };
  const dirs = (await expandWorkspaces(rootFiles, globs)).slice(0, options.maxProjects ?? 50);
  const packages = await Promise.all(dirs.map((dir) => sniffProject(reader, dir)));
  return { projects: [root, ...packages], workspaces: globs };
}

/** A string setting of a parsed config. */
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One project, its folder as `root`. */
export async function sniffProject(fs: KiesFs, root = ""): Promise<Project> {
  const files = new ProjectFiles(fs, root);
  const signals: string[] = [];
  const pkg = await files.json<PackageJson>("package.json");
  const [framework, cms, layer] = await Promise.all([
    detectFramework(files, pkg, signals),
    detectCms(files, pkg, signals),
    contentLayer(files, pkg, signals),
  ]);
  const project: Project = {
    root,
    name: pkg?.name,
    framework,
    content: layer?.layer,
    cms: cms.map((item) => item.cms),
    contentDir: "",
    assetsDirs: [],
    signals,
  };

  // Folders the framework or generator declares or uses by convention, relative to the project.
  let frameworkContent: string | undefined = layer?.dir;
  const assets: AssetsDir[] = cms.flatMap((item) =>
    item.media ? [{ path: item.media, kind: "media" as const }] : [],
  );
  const conventions: AssetsDir[] = [];
  switch (framework?.id) {
    case "nuxt": {
      const nuxt = await nuxtLayout(files, framework.version, signals);
      conventions.push(
        { path: nuxt.publicDir, kind: "public" },
        { path: nuxt.assetsDir, kind: "build" },
      );
      project.appConfig = nuxt.appConfig;
      project.appSchema = nuxt.appSchema;
      break;
    }
    case "hugo": {
      const config = (await hugoConfig(files))?.config ?? {};
      frameworkContent = join(text(config.contentDir) ?? "content");
      conventions.push(
        { path: join(text(config.staticDir) ?? "static"), kind: "public" },
        { path: join(text(config.assetDir) ?? "assets"), kind: "build" },
      );
      break;
    }
    case "jekyll": {
      const configPath = (await files.isFile("_config.yml")) ? "_config.yml" : "_config.yaml";
      const config = parseConfigFile(configPath, (await files.read(configPath)) ?? "");
      // Posts and pages at the root, collections under `collections_dir`.
      frameworkContent = join(text(config.collections_dir) ?? "");
      conventions.push({ path: "assets", kind: "public" });
      break;
    }
    case "docusaurus": {
      const folders = [];
      for (const dir of ["docs", "blog"]) if (await files.isDir(dir)) folders.push(dir);
      frameworkContent = folders.length ? commonDir(folders) : undefined;
      conventions.push({ path: "static", kind: "public" });
      break;
    }
    case "vitepress": {
      // The source folder holds `.vitepress/`: the root, or `docs/` by convention.
      const srcDir = (await files.isDir(".vitepress"))
        ? ""
        : (await files.isDir("docs/.vitepress"))
          ? "docs"
          : "";
      frameworkContent = srcDir;
      conventions.push({ path: join(srcDir, "public"), kind: "public" });
      break;
    }
    case "astro": {
      if (await files.isDir("src/content")) {
        frameworkContent = "src/content";
        project.content ??= { id: "astro-content", name: "Astro content collections" };
      }
      conventions.push({ path: "public", kind: "public" }, { path: "src/assets", kind: "build" });
      break;
    }
    case "sveltekit":
      conventions.push(
        { path: "static", kind: "public" },
        { path: "src/lib/assets", kind: "build" },
      );
      break;
    case "angular":
      conventions.push({ path: "public", kind: "public" }, { path: "src/assets", kind: "build" });
      break;
    default:
      conventions.push({ path: "public", kind: "public" }, { path: "src/assets", kind: "build" });
  }

  const contentFromCms = cmsContentDir(cms);
  let contentDir: string;
  if (contentFromCms !== undefined) {
    contentDir = contentFromCms;
  } else if (frameworkContent !== undefined) {
    contentDir = frameworkContent;
  } else {
    contentDir = (await files.isDir("content")) ? "content" : "";
  }
  project.contentDir = files.path(contentDir);

  // Then the usual folders of plain sites. Only those that exist, but the media folder of a CMS,
  // which it creates on the first upload.
  const generic: AssetsDir[] = [
    "public",
    "static",
    "assets",
    ".assets",
    "images",
    "img",
    "media",
  ].map((path) => ({ path, kind: "public" }));
  const seen = new Set<string>();
  for (const candidate of [...assets, ...conventions, ...generic]) {
    if (seen.has(candidate.path) || !candidate.path) continue;
    seen.add(candidate.path);
    if (candidate.kind !== "media" && !(await files.isDir(candidate.path))) continue;
    project.assetsDirs.push({ ...candidate, path: files.path(candidate.path) });
  }
  // The best: one served as is (public or media), else one the bundler processes.
  project.assetsDir = (
    project.assetsDirs.find((dir) => dir.kind !== "build") ?? project.assetsDirs[0]
  )?.path;
  return project;
}
