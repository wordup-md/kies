/**
 * The files `kies` reads, whatever holds them: a folder on disk, a browser folder, a git forge.
 * Paths are relative to the root of what is sniffed, `/`-separated, `""` being the root.
 */
export interface KiesFs {
  /** The entries of a directory, none when it doesn't exist. */
  readDir(path: string): Promise<DirEntry[]>;
  /** The text of a file, undefined when it doesn't exist. */
  readFile(path: string): Promise<string | undefined>;
}

export interface DirEntry {
  name: string;
  directory: boolean;
}

/** What drives the build of the site. */
export interface Framework {
  id: FrameworkId;
  name: string;
  /** `framework`: an app framework; `ssg`: a static site generator; `vanilla`: plain files. */
  kind: "framework" | "ssg" | "vanilla";
  /** The version range of its package, e.g. `^4.1.0`. */
  version?: string;
}

export type FrameworkId =
  | "nuxt"
  | "next"
  | "sveltekit"
  | "astro"
  | "angular"
  | "remix"
  | "vitepress"
  | "docusaurus"
  | "eleventy"
  | "hugo"
  | "jekyll"
  | "svelte"
  | "vue"
  | "react"
  | "solid"
  | "vite"
  | "vanilla";

/** A content layer on top of the framework, e.g. Nuxt Content. */
export interface ContentLayer {
  id: "nuxt-content" | "comark-content" | "astro-content";
  name: string;
  version?: string;
}

/** A git-based CMS configured in the project. */
export interface GitCms {
  id: "decap" | "sveltia" | "frontmatter" | "tina" | "keystatic" | "nuxt-studio";
  name: string;
  /** Its configuration file, when it has one. */
  config?: string;
  /** Its configuration was read for the folders: false when only detected. */
  read: boolean;
}

/** A UI system styling the project: a component library with a theme, or a CSS engine. */
export interface UiLibrary {
  id: "nuxt-ui" | "shadcn" | "unocss" | "tailwind";
  name: string;
  /** The version range of its package, e.g. `^4.0.0`. */
  version?: string;
  /** Its configuration file, when it has one: `components.json`, `uno.config.ts`. */
  config?: string;
}
/** A folder that may hold the assets of the site. */
export interface AssetsDir {
  path: string;
  /**
   * `public`: served as is, at the root of the site (`/logo.svg`); `build`: processed by the
   * bundler (`~/assets/logo.svg`); `media`: where a CMS uploads.
   */
  kind: "public" | "build" | "media";
}

/** One project: the root, or a package of a workspace. */
export interface Project {
  /** Its folder, `""` for the root. */
  root: string;
  /** The `name` of its package.json. */
  name?: string;
  framework?: Framework;
  content?: ContentLayer;
  cms: GitCms[];
  /**
   * Folder of the content, relative to the root of what was sniffed (so prefixed with `root`);
   * `""` when the content is at the root of the project.
   */
  contentDir: string;
  /** The best folder for the assets, relative to the root of what was sniffed; none found. */
  assetsDir?: string;
  /** Every candidate, best first. */
  assetsDirs: AssetsDir[];
  /** Its UI systems, e.g. Nuxt UI and Tailwind CSS. */
  ui: UiLibrary[];
  /**
   * Its entry stylesheets, relative to the root of what was sniffed, best first: those its
   * config declares (`css` of `nuxt.config`, `tailwind.css` of `components.json`), then the
   * usual ones that exist (`app/assets/css/main.css`, `src/app.css`…).
   */
  styles: string[];
  /** Static values of its `app.config` (Nuxt), when it has one. */
  appConfig?: StaticValue;
  /** Its `nuxt.schema` (Nuxt Studio): the fields of the app config. */
  appSchema?: StaticValue;
  /** Why: one line per clue, e.g. `package.json: nuxt ^4.1.0`. */
  signals: string[];
}

export interface SniffResult {
  /** The root first, then the packages of its workspaces. */
  projects: Project[];
  /** Globs of the workspaces of the root, when it is a monorepo. */
  workspaces?: string[];
}

/**
 * A value read from a config file without running it. What can't be known statically (a
 * function, a variable from elsewhere, a computed key) is `{ $dynamic: "<source code>" }`.
 */
export type StaticValue =
  | string
  | number
  | boolean
  | null
  | StaticValue[]
  | StaticObject
  | DynamicValue;

/** An object read statically. */
export interface StaticObject {
  [key: string]: StaticValue | undefined;
  $dynamic?: never;
}

/** A part of a config only known when it runs: its source code. */
export interface DynamicValue {
  $dynamic: string;
}

export interface SniffOptions {
  /** Read the packages of the workspaces too. @default true */
  workspaces?: boolean;
  /** Most packages read in a workspace. @default 50 */
  maxProjects?: number;
}
