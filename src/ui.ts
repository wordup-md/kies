import { isObject, readConfig } from "./config-object.ts";
import { join, type ProjectFiles } from "./fs.ts";
import { dependencies, type PackageJson } from "./frameworks.ts";
import type { UiLibrary } from "./types.ts";

/** The first of `packages` in the dependencies, with its version range. */
function dependency(
  deps: Record<string, string>,
  packages: string[],
): { name: string; version: string } | undefined {
  const name = packages.find((candidate) => candidate in deps);
  return name ? { name, version: deps[name]! } : undefined;
}

/** shadcn flavors, from the `$schema` of their `components.json`. */
const SHADCN_FLAVORS: [RegExp, string][] = [
  [/shadcn-vue/, "shadcn-vue"],
  [/shadcn-svelte/, "shadcn-svelte"],
  [/solid-ui|shadcn-solid/, "shadcn-solid"],
];

/**
 * The UI systems styling a project: component libraries with a theme (Nuxt UI, shadcn), CSS
 * engines (UnoCSS, Tailwind CSS). A project may use several, e.g. Nuxt UI on Tailwind CSS.
 */
export async function detectUi(
  files: ProjectFiles,
  pkg: PackageJson | undefined,
  signals: string[],
): Promise<{ ui: UiLibrary[]; styles: string[] }> {
  const deps = dependencies(pkg);
  const ui: UiLibrary[] = [];
  const styles: string[] = [];

  const nuxtUi = dependency(deps, ["@nuxt/ui", "@nuxt/ui-pro"]);
  if (nuxtUi) {
    ui.push({ id: "nuxt-ui", name: "Nuxt UI", version: nuxtUi.version });
    signals.push(`package.json: ${nuxtUi.name} ${nuxtUi.version}`);
  }

  if (await files.isFile("components.json")) {
    const config = await files.json<{ $schema?: string; tailwind?: { css?: string } }>(
      "components.json",
    );
    const name =
      SHADCN_FLAVORS.find(([pattern]) => pattern.test(config?.$schema ?? ""))?.[1] ?? "shadcn/ui";
    ui.push({ id: "shadcn", name, config: files.path("components.json") });
    signals.push(`${files.path("components.json")}: ${name}`);
    const css = config?.tailwind?.css;
    if (typeof css === "string" && css) styles.push(join(css.replace(/^\.\//, "")));
  }

  const uno = dependency(deps, ["unocss", "@unocss/nuxt", "@unocss/astro", "@unocss/vite"]);
  const unoConfig = (await files.config("uno.config")) ?? (await files.config("unocss.config"));
  if (uno || unoConfig) {
    ui.push({
      id: "unocss",
      name: "UnoCSS",
      ...(uno ? { version: uno.version } : {}),
      ...(unoConfig ? { config: files.path(unoConfig) } : {}),
    });
    signals.push(
      unoConfig ? `${files.path(unoConfig)}: UnoCSS` : `package.json: ${uno!.name} ${uno!.version}`,
    );
  }

  const tailwind = dependency(deps, ["tailwindcss", "@tailwindcss/vite", "@tailwindcss/postcss"]);
  if (tailwind) ui.push({ id: "tailwind", name: "Tailwind CSS", version: tailwind.version });

  return { ui, styles };
}

/** `~/assets/main.css` → `app/assets/main.css` for Nuxt 4; packages (`@nuxt/ui`) are left out. */
function nuxtCssPath(entry: string, srcDir: string): string | undefined {
  if (entry.startsWith("~~/") || entry.startsWith("@@/")) return join(entry.slice(3));
  if (entry.startsWith("~/") || entry.startsWith("@/")) return join(srcDir, entry.slice(2));
  if (entry.startsWith("./")) return join(entry.slice(2));
  return undefined;
}

/** Usual entry stylesheets, for projects that don't declare theirs. */
const CONVENTIONAL_STYLES = [
  "app/assets/css/main.css",
  "assets/css/main.css",
  "app/globals.css",
  "src/app/globals.css",
  "styles/globals.css",
  "src/styles/globals.css",
  "src/app.css",
  "src/index.css",
  "src/style.css",
  "src/assets/main.css",
  "src/assets/index.css",
];

/**
 * The entry stylesheets of a project, best first: those its config declares (`css` of
 * `nuxt.config`, `tailwind.css` of `components.json`), then the usual ones that exist.
 */
export async function entryStyles(
  files: ProjectFiles,
  declared: string[],
  nuxt?: { srcDir: string },
): Promise<string[]> {
  const candidates = [...declared];
  if (nuxt) {
    const path = await files.config("nuxt.config");
    const config = path ? await readConfig((await files.read(path)) ?? "") : undefined;
    const css = isObject(config) && Array.isArray(config.css) ? config.css : [];
    for (const entry of css) {
      const src = typeof entry === "string" ? entry : isObject(entry) ? entry.src : undefined;
      const relative = typeof src === "string" ? nuxtCssPath(src, nuxt.srcDir) : undefined;
      if (relative) candidates.push(relative);
    }
  }
  candidates.push(...CONVENTIONAL_STYLES);

  const styles: string[] = [];
  for (const path of new Set(candidates)) {
    if (await files.isFile(path)) styles.push(files.path(path));
  }
  return styles;
}
