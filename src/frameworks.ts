import { parseTOML, parseYAML } from "confbox";
import type { ProjectFiles } from "./fs.ts";
import type { Framework, FrameworkId } from "./types.ts";

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

interface Rule {
  id: FrameworkId;
  name: string;
  kind: Framework["kind"];
  /** Any of these in the dependencies. */
  packages: string[];
  /** Or any of these configs (`name` for `name.{ts,js,…}`). */
  configs?: string[];
}

/**
 * Meta-frameworks before the libraries they build on: a Nuxt app depends on Vue, a Next one on
 * React, and both on Vite or webpack.
 */
const RULES: Rule[] = [
  { id: "nuxt", name: "Nuxt", kind: "framework", packages: ["nuxt", "nuxt3", "nuxt-nightly"] },
  { id: "next", name: "Next.js", kind: "framework", packages: ["next"] },
  { id: "sveltekit", name: "SvelteKit", kind: "framework", packages: ["@sveltejs/kit"] },
  { id: "astro", name: "Astro", kind: "framework", packages: ["astro"] },
  {
    id: "remix",
    name: "Remix / React Router",
    kind: "framework",
    packages: ["@remix-run/dev", "@remix-run/react", "@react-router/dev"],
  },
  { id: "angular", name: "Angular", kind: "framework", packages: ["@angular/core"] },
  { id: "vitepress", name: "VitePress", kind: "ssg", packages: ["vitepress"] },
  { id: "docusaurus", name: "Docusaurus", kind: "ssg", packages: ["@docusaurus/core"] },
  {
    id: "eleventy",
    name: "Eleventy",
    kind: "ssg",
    packages: ["@11ty/eleventy"],
    configs: ["eleventy.config", ".eleventy"],
  },
  { id: "solid", name: "Solid", kind: "framework", packages: ["solid-js", "@solidjs/start"] },
  { id: "svelte", name: "Svelte", kind: "framework", packages: ["svelte"] },
  { id: "vue", name: "Vue", kind: "framework", packages: ["vue"] },
  { id: "react", name: "React", kind: "framework", packages: ["react"] },
  { id: "vite", name: "Vite", kind: "framework", packages: ["vite"] },
];

/** Dependencies and dev dependencies, by name. */
export function dependencies(pkg: PackageJson | undefined): Record<string, string> {
  return { ...pkg?.devDependencies, ...pkg?.dependencies };
}

/** The framework of a project: its packages, else a generator or plain files. */
export async function detectFramework(
  files: ProjectFiles,
  pkg: PackageJson | undefined,
  signals: string[],
): Promise<Framework | undefined> {
  const deps = dependencies(pkg);
  for (const rule of RULES) {
    const name = rule.packages.find((pkgName) => pkgName in deps);
    if (name) {
      signals.push(`package.json: ${name} ${deps[name]}`);
      return { id: rule.id, name: rule.name, kind: rule.kind, version: deps[name] };
    }
    for (const config of rule.configs ?? []) {
      const path = await files.config(config);
      if (path) {
        signals.push(`${path}: ${rule.name} config`);
        return { id: rule.id, name: rule.name, kind: rule.kind };
      }
    }
  }
  const generator = await detectGenerator(files, signals);
  if (generator) return generator;
  if (await files.isFile("index.html")) {
    signals.push("index.html: plain files");
    return { id: "vanilla", name: "Vanilla", kind: "vanilla" };
  }
  return undefined;
}

/** Hugo and Jekyll: no package, a config file of their own. */
async function detectGenerator(
  files: ProjectFiles,
  signals: string[],
): Promise<Framework | undefined> {
  const hugo = await hugoConfig(files);
  if (hugo) {
    signals.push(`${hugo.path}: Hugo config`);
    return { id: "hugo", name: "Hugo", kind: "ssg" };
  }
  if (await isJekyll(files)) {
    signals.push("_config.yml: Jekyll config");
    return { id: "jekyll", name: "Jekyll", kind: "ssg" };
  }
  return undefined;
}

const HUGO_CONFIGS = ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json"];
const LEGACY_HUGO_CONFIGS = ["config.toml", "config.yaml", "config.yml"];

/**
 * The Hugo config of a project, parsed: `hugo.*`, or a legacy `config.*` next to the folders of a
 * Hugo site (`archetypes/`, `layouts/`, `themes/`), or under `config/_default/`.
 */
export async function hugoConfig(
  files: ProjectFiles,
): Promise<{ path: string; config: Record<string, unknown> } | undefined> {
  let path = await files.firstFile(HUGO_CONFIGS);
  if (!path) {
    const hugoish = (
      await Promise.all(["archetypes", "layouts", "themes"].map((dir) => files.isDir(dir)))
    ).some(Boolean);
    if (hugoish) path = await files.firstFile(LEGACY_HUGO_CONFIGS);
  }
  path ??= await files.firstFile(
    [...HUGO_CONFIGS, ...LEGACY_HUGO_CONFIGS].map((name) => `config/_default/${name}`),
  );
  if (!path) return undefined;
  return { path, config: parseConfigFile(path, (await files.read(path)) ?? "") };
}

async function isJekyll(files: ProjectFiles): Promise<boolean> {
  if (!(await files.isFile("_config.yml")) && !(await files.isFile("_config.yaml"))) return false;
  const gemfile = await files.read("Gemfile");
  if (gemfile && /\bjekyll\b|github-pages/.test(gemfile)) return true;
  const folders = await Promise.all(
    ["_posts", "_layouts", "_includes"].map((dir) => files.isDir(dir)),
  );
  return folders.some(Boolean);
}

/** A TOML, YAML or JSON config, by its extension; empty when it doesn't parse. */
export function parseConfigFile(path: string, text: string): Record<string, unknown> {
  try {
    const value: unknown = path.endsWith(".toml")
      ? parseTOML(text)
      : path.endsWith(".json")
        ? JSON.parse(text)
        : parseYAML(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
