import { asString, isObject, readConfig } from "./config-object.ts";
import { commonDir, globBase, join, type ProjectFiles } from "./fs.ts";
import { dependencies, type PackageJson } from "./frameworks.ts";
import type { ContentLayer, StaticValue } from "./types.ts";

export interface NuxtLayout {
  /** The source folder, relative to the project: `app` in Nuxt 4, `""` in Nuxt 3. */
  srcDir: string;
  /** The public folder, relative to the project. */
  publicDir: string;
  /** The folder of the assets processed by the bundler, relative to the project. */
  assetsDir: string;
  appConfig?: StaticValue;
  appSchema?: StaticValue;
}

/** The major version of a range: `^4.1.0` → 4; none for a tag or a URL. */
export function major(range: string | undefined): number | undefined {
  const match = range?.match(/(\d+)\./) ?? range?.match(/^\D*(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

/** A path of a config, relative to the project: `./static` and `static` alike. */
function relative(path: string): string {
  return join(path.replace(/^\.\//, ""));
}

/** The folders of a Nuxt project, from its `nuxt.config` read statically, else the defaults. */
export async function nuxtLayout(
  files: ProjectFiles,
  version: string | undefined,
  signals: string[],
): Promise<NuxtLayout> {
  const path = await files.config("nuxt.config");
  const config = path ? await readConfig((await files.read(path)) ?? "") : undefined;
  const nuxt = isObject(config) ? config : {};
  const dir = isObject(nuxt.dir) ? nuxt.dir : {};
  const future = isObject(nuxt.future) ? nuxt.future : {};
  const v4 = (major(version) ?? 3) >= 4 || future.compatibilityVersion === 4;

  let srcDir = asString(nuxt.srcDir);
  if (srcDir !== undefined) {
    srcDir = relative(srcDir);
    signals.push(`${files.path(path!)}: srcDir ${srcDir || "."}`);
  } else {
    // Nuxt 4 takes `app/` when it exists.
    srcDir = v4 && (await files.isDir("app")) ? "app" : "";
  }
  // The public folder is relative to the root in Nuxt 4, to the source folder in Nuxt 3.
  const publicSetting = asString(dir.public);
  const publicDir = publicSetting
    ? relative(v4 ? publicSetting : join(srcDir, publicSetting))
    : v4
      ? "public"
      : join(srcDir, "public");
  if (publicSetting) signals.push(`${files.path(path!)}: dir.public ${publicSetting}`);
  const assetsDir = join(srcDir, relative(asString(dir.assets) ?? "assets"));

  const appConfigPath =
    (await files.config(join(srcDir, "app.config"))) ?? (await files.config("app.config"));
  const schemaPath =
    (await files.config(join(srcDir, "nuxt.schema"))) ?? (await files.config("nuxt.schema"));
  const [appConfig, appSchema] = await Promise.all([
    appConfigPath ? readConfig((await files.read(appConfigPath)) ?? "") : undefined,
    schemaPath ? readConfig((await files.read(schemaPath)) ?? "") : undefined,
  ]);
  if (appConfigPath) signals.push(`${files.path(appConfigPath)}: app config`);
  if (schemaPath) signals.push(`${files.path(schemaPath)}: app config schema`);
  return { srcDir, publicDir, assetsDir, appConfig, appSchema };
}

/** Nuxt Content, comark-content: the content layer and the folder of its content. */
export async function contentLayer(
  files: ProjectFiles,
  pkg: PackageJson | undefined,
  signals: string[],
): Promise<{ layer: ContentLayer; dir?: string } | undefined> {
  const deps = dependencies(pkg);
  if ("@nuxt/content" in deps) {
    const version = deps["@nuxt/content"];
    const layer: ContentLayer = { id: "nuxt-content", name: "Nuxt Content", version };
    if ((major(version) ?? 3) >= 3) {
      const dir = await nuxtContentDir(files, signals);
      if (dir !== undefined) return { layer, dir };
    }
    return { layer, dir: (await files.isDir("content")) ? "content" : undefined };
  }
  if ("comark-content" in deps) {
    return {
      layer: { id: "comark-content", name: "Comark Content", version: deps["comark-content"] },
      dir: (await files.isDir("content")) ? "content" : undefined,
    };
  }
  return undefined;
}

/**
 * The folder holding every collection of `content.config` (Nuxt Content 3): the common parent of
 * their sources, relative to `content/` unless a `cwd` says otherwise. Undefined when no source
 * can be read statically.
 */
async function nuxtContentDir(files: ProjectFiles, signals: string[]): Promise<string | undefined> {
  const path = await files.config("content.config");
  if (!path) return undefined;
  const config = await readConfig((await files.read(path)) ?? "");
  const collections = isObject(config) && isObject(config.collections) ? config.collections : {};
  const dirs: string[] = [];
  for (const collection of Object.values(collections)) {
    if (!isObject(collection)) continue;
    const sources = Array.isArray(collection.source) ? collection.source : [collection.source];
    for (const source of sources) {
      // A remote repository is not in the folder.
      if (isObject(source) && source.repository !== undefined) continue;
      const include =
        typeof source === "string"
          ? source
          : isObject(source)
            ? asString(source.include)
            : undefined;
      if (include === undefined) continue;
      const cwd = isObject(source) ? source.cwd : undefined;
      // An absolute or computed `cwd` (`resolve(…)`) can't be placed in the project.
      if (cwd !== undefined && (typeof cwd !== "string" || cwd.startsWith("/"))) continue;
      dirs.push(join(cwd === undefined ? "content" : relative(cwd), globBase(include)));
    }
  }
  if (!dirs.length) return undefined;
  const dir = commonDir(dirs);
  const names = Object.keys(collections);
  signals.push(
    `${files.path(path)}: ${names.length} collection(s) (${names.join(", ")}) in ${dir || "."}`,
  );
  return dir;
}
