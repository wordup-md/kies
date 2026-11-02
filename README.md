# @wordup-md/kies

Sniff a project from its files: its framework (or static site generator, or plain files), its content layer, its git-based CMS, the folders of its content and assets, and the same for each package of its workspaces.

**Isomorphic**: the same code runs in browsers and Node.js, with no API of a given runtime. Only the `@wordup-md/kies/node` adapter imports Node.js modules; the core reads through an interface you implement for any file system (a folder on disk, a folder opened with the File System Access API, the tree of a git forge, an unstorage storage).

Config files are **parsed, never run** (with [magicast](https://github.com/unjs/magicast), loaded on demand): no `eval`, no `require`, nothing of the project executes.

```sh
pnpm add @wordup-md/kies
```

```ts
import { sniff } from "@wordup-md/kies";
import { nodeFs } from "@wordup-md/kies/node";

const { projects } = await sniff(nodeFs("."));
const [site] = projects;
site.framework; // { id: "nuxt", name: "Nuxt", kind: "framework", version: "^4.1.0" }
site.content; // { id: "nuxt-content", name: "Nuxt Content", version: "^3.6.0" }
site.contentDir; // "content"
site.assetsDir; // "public"
site.assetsDirs; // [{ path: "public", kind: "public" }, { path: "app/assets", kind: "build" }]
site.ui; // [{ id: "nuxt-ui", name: "Nuxt UI", version: "^4.12.0" }, { id: "tailwind", name: "Tailwind CSS", version: "^4.1.0" }]
site.styles; // ["app/assets/css/main.css"]
site.signals; // ["package.json: nuxt ^4.1.0", "content.config.ts: 2 collection(s) (blog, docs) in content", …]
```

## What it detects

|                        |                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frameworks             | Nuxt, Next.js, SvelteKit, Astro, Remix / React Router, Angular, Solid, Svelte, Vue, React, Vite; `vanilla` for plain files with an `index.html`                                         |
| Static site generators | Hugo, Jekyll, Eleventy, VitePress, Docusaurus                                                                                                                                           |
| Content layers         | Nuxt Content (collections of `content.config`), Comark Content, Astro content collections                                                                                               |
| Git-based CMS          | Decap CMS, Sveltia CMS, Front Matter CMS (configs read); TinaCMS, Keystatic, Nuxt Studio (detected)                                                                                     |
| UI systems             | Nuxt UI, shadcn (ui, vue, svelte, solid: `components.json`), UnoCSS, Tailwind CSS; the entry stylesheets (`css` of `nuxt.config`, `tailwind.css` of `components.json`, the usual paths) |
| Nuxt                   | `srcDir`, `dir.public`, `dir.assets` of `nuxt.config`; static values of `app.config` and `nuxt.schema`                                                                                  |
| Workspaces             | `pnpm-workspace.yaml`, `workspaces` of `package.json` (`*`, `**`, `!` globs)                                                                                                            |

## Folders

The **content folder** comes from, in order:

1. the config of a git-based CMS: the common parent of its collections;
2. the config or conventions of the framework: the common parent of the collections of Nuxt Content, `contentDir` of Hugo, `collections_dir` of Jekyll, the source folder of VitePress, `src/content` of Astro…;
3. a `content/` folder;
4. else the root (`""`).

The **assets folders** are every candidate that exists, best first: the media folder of a CMS, then the public and bundled folders of the framework (`public/` and `app/assets/` for Nuxt 4, `static/` for SvelteKit and Hugo…), then the usual ones (`public`, `static`, `assets`, `.assets`, `images`, `img`, `media`). `assetsDir` is the first one served as is (`kind` `public` or `media`).

Paths are relative to what was sniffed, so those of a workspace package start with its folder (`apps/site/content`).

## File systems

`sniff` reads through a two-method interface:

```ts
interface KiesFs {
  readDir(path: string): Promise<{ name: string; directory: boolean }[]>; // [] when missing
  readFile(path: string): Promise<string | undefined>; // undefined when missing
}
```

- `@wordup-md/kies/node`: `nodeFs(root)`, a folder on disk.
- `@wordup-md/kies/memory`: `memoryFs(files)`, an object of paths and contents, or `memoryFs(paths, read)`: a list of paths (the keys of a storage, the tree of a repository) and a function reading a file on demand.

Each file and folder is read once per `sniff`.

## Config values

`readConfig(code)` is exported: the default export of a config file, its literal parts only. What only exists when the file runs (a function call, an import, `process.env`) is `{ $dynamic: "<source>" }`.

```ts
await readConfig(`export default defineAppConfig({ site: { name: "Blog" }, links: getLinks() })`);
// → { site: { name: "Blog" }, links: { $dynamic: "getLinks()" } }
```

## License

MIT
