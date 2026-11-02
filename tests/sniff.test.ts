import { describe, expect, it } from "vite-plus/test";
import { sniff, sniffProject } from "../src/index.ts";
import { memoryFs } from "../src/memory.ts";

const pkg = (dependencies: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "site", dependencies, ...extra });

async function project(files: Record<string, string>) {
  return sniffProject(memoryFs(files));
}

describe("frameworks", () => {
  it.each([
    ["nuxt", { nuxt: "^4.1.0", vue: "^3.5.0" }, "Nuxt"],
    ["next", { next: "15.0.0", react: "^19.0.0" }, "Next.js"],
    ["sveltekit", { "@sveltejs/kit": "^2.0.0", svelte: "^5.0.0" }, "SvelteKit"],
    ["astro", { astro: "^5.0.0" }, "Astro"],
    ["angular", { "@angular/core": "^20.0.0" }, "Angular"],
    ["remix", { "@react-router/dev": "^7.0.0", react: "^19.0.0" }, "Remix / React Router"],
    ["vitepress", { vitepress: "^1.6.0", vue: "^3.5.0" }, "VitePress"],
    ["docusaurus", { "@docusaurus/core": "^3.0.0", react: "^19.0.0" }, "Docusaurus"],
    ["svelte", { svelte: "^5.0.0", vite: "^7.0.0" }, "Svelte"],
    ["vue", { vue: "^3.5.0", vite: "^7.0.0" }, "Vue"],
    ["react", { react: "^19.0.0", vite: "^7.0.0" }, "React"],
    ["vite", { vite: "^7.0.0" }, "Vite"],
  ])("detects %s from its packages, before the libraries it builds on", async (id, deps, name) => {
    const { framework } = await project({ "package.json": pkg(deps) });
    expect(framework).toMatchObject({ id, name });
  });

  it("keeps the version range of the package", async () => {
    const { framework, signals } = await project({ "package.json": pkg({ nuxt: "^4.1.0" }) });
    expect(framework?.version).toBe("^4.1.0");
    expect(signals).toContain("package.json: nuxt ^4.1.0");
  });

  it("reads dev dependencies too", async () => {
    const { framework } = await project({
      "package.json": JSON.stringify({ devDependencies: { vitepress: "^1.6.0" } }),
    });
    expect(framework?.id).toBe("vitepress");
  });

  it("takes plain files with an index.html for vanilla", async () => {
    const { framework } = await project({ "index.html": "<h1>Hi</h1>", "style.css": "" });
    expect(framework).toEqual({ id: "vanilla", name: "Vanilla", kind: "vanilla" });
  });

  it("finds nothing in a folder of notes", async () => {
    const { framework, contentDir } = await project({ "notes.md": "", "todo/a.md": "" });
    expect(framework).toBeUndefined();
    expect(contentDir).toBe("");
  });

  it("detects Eleventy from its config alone", async () => {
    const { framework } = await project({ "eleventy.config.js": "export default {}" });
    expect(framework?.id).toBe("eleventy");
  });
});

describe("content folder", () => {
  it("takes content/ when it exists, the root otherwise", async () => {
    expect((await project({ "content/index.md": "" })).contentDir).toBe("content");
    expect((await project({ "index.md": "", "blog/a.md": "" })).contentDir).toBe("");
  });

  it("takes the common parent of the collections of Nuxt Content", async () => {
    const { content, contentDir, signals } = await project({
      "package.json": pkg({ nuxt: "^4.1.0", "@nuxt/content": "^3.6.0" }),
      "content.config.ts": `
        import { defineCollection, defineContentConfig, z } from "@nuxt/content";
        export default defineContentConfig({
          collections: {
            blog: defineCollection({ type: "page", source: "blog/**/*.md" }),
            docs: defineCollection({ type: "page", source: { include: "docs/**", prefix: "/docs" } }),
            authors: defineCollection({ type: "data", source: "data/authors/*.yml", schema: z.object({}) }),
          },
        });`,
      "content/blog/a.md": "",
    });
    expect(content).toEqual({ id: "nuxt-content", name: "Nuxt Content", version: "^3.6.0" });
    expect(contentDir).toBe("content");
    expect(signals).toContain(
      "content.config.ts: 3 collection(s) (blog, docs, authors) in content",
    );
  });

  it("narrows to the folder of a single collection", async () => {
    const { contentDir } = await project({
      "package.json": pkg({ nuxt: "^4.1.0", "@nuxt/content": "^3.6.0" }),
      "content.config.ts": `export default defineContentConfig({
        collections: { docs: defineCollection({ type: "page", source: "docs/**" }) },
      })`,
    });
    expect(contentDir).toBe("content/docs");
  });

  it("places a collection with a relative cwd, skips a computed one", async () => {
    const { contentDir } = await project({
      "package.json": pkg({ nuxt: "^4.1.0", "@nuxt/content": "^3.6.0" }),
      "content.config.ts": `export default defineContentConfig({
        collections: {
          pages: defineCollection({ type: "page", source: { cwd: "pages", include: "**/*.md" } }),
          remote: defineCollection({ type: "page", source: { repository: "https://github.com/a/b", include: "**" } }),
          elsewhere: defineCollection({ type: "page", source: { cwd: resolve("other"), include: "**" } }),
        },
      })`,
    });
    expect(contentDir).toBe("pages");
  });

  it("falls back on content/ when the config can't be read", async () => {
    const { contentDir } = await project({
      "package.json": pkg({ nuxt: "^4.1.0", "@nuxt/content": "^3.6.0" }),
      "content.config.ts": "export default makeConfig()",
      "content/index.md": "",
    });
    expect(contentDir).toBe("content");
  });

  it("detects comark-content", async () => {
    const result = await project({
      "package.json": pkg({ "comark-content": "^0.4.0" }),
      "content/about.md": "",
    });
    expect(result.content?.id).toBe("comark-content");
    expect(result.contentDir).toBe("content");
  });

  it("follows Hugo's contentDir and staticDir", async () => {
    const result = await project({
      "hugo.toml": 'baseURL = "https://example.org/"\ncontentDir = "pages"\nstaticDir = "files"',
      "pages/_index.md": "",
      "files/logo.svg": "",
    });
    expect(result.framework?.id).toBe("hugo");
    expect(result.contentDir).toBe("pages");
    expect(result.assetsDir).toBe("files");
  });

  it("recognizes a legacy Hugo config next to its folders", async () => {
    const result = await project({
      "config.toml": 'title = "x"',
      "layouts/index.html": "",
      "content/a.md": "",
    });
    expect(result.framework?.id).toBe("hugo");
    expect(result.contentDir).toBe("content");
  });

  it("puts Jekyll's content at the root, or under collections_dir", async () => {
    const root = await project({
      "_config.yml": "title: Blog",
      "_posts/2024-01-01-a.md": "",
      "assets/a.png": "",
    });
    expect(root.framework?.id).toBe("jekyll");
    expect(root.contentDir).toBe("");
    expect(root.assetsDir).toBe("assets");
    const collections = await project({
      "_config.yml": "collections_dir: my_collections",
      Gemfile: 'gem "jekyll"',
    });
    expect(collections.contentDir).toBe("my_collections");
  });

  it("takes the source folder of VitePress", async () => {
    const result = await project({
      "package.json": pkg({ vitepress: "^1.6.0" }),
      "docs/.vitepress/config.ts": "export default {}",
      "docs/index.md": "",
      "docs/public/logo.svg": "",
    });
    expect(result.contentDir).toBe("docs");
    expect(result.assetsDir).toBe("docs/public");
  });

  it("holds the docs and the blog of Docusaurus", async () => {
    const result = await project({
      "package.json": pkg({ "@docusaurus/core": "^3.0.0" }),
      "docs/intro.md": "",
      "blog/a.md": "",
      "static/img/logo.svg": "",
    });
    expect(result.contentDir).toBe("");
    expect(result.assetsDir).toBe("static");
  });

  it("takes the content collections of Astro", async () => {
    const result = await project({
      "package.json": pkg({ astro: "^5.0.0" }),
      "src/content/blog/a.md": "",
    });
    expect(result.contentDir).toBe("src/content");
    expect(result.content?.id).toBe("astro-content");
  });
});

describe("git-based CMS", () => {
  it("prefers the folders of a Decap config over the conventions", async () => {
    const result = await project({
      "package.json": pkg({ nuxt: "^4.1.0", "@nuxt/content": "^3.6.0" }),
      "content/index.md": "",
      "public/admin/config.yml": `
backend: { name: github, repo: me/site }
media_folder: public/images/uploads
public_folder: /images/uploads
collections:
  - name: posts
    folder: content/blog/posts
  - name: pages
    files:
      - { name: about, file: content/blog/about.md }
`,
    });
    expect(result.cms).toEqual([
      { id: "decap", name: "Decap CMS", config: "public/admin/config.yml", read: true },
    ]);
    expect(result.contentDir).toBe("content/blog");
    expect(result.assetsDirs[0]).toEqual({ path: "public/images/uploads", kind: "media" });
    expect(result.assetsDir).toBe("public/images/uploads");
  });

  it("tells Sveltia from Decap by its admin page", async () => {
    const result = await project({
      "static/admin/config.yml": "collections: []",
      "static/admin/index.html":
        '<script src="https://unpkg.com/@sveltia/cms/dist/sveltia-cms.js"></script>',
    });
    expect(result.cms[0]?.id).toBe("sveltia");
  });

  it("reads the page folders of Front Matter CMS", async () => {
    const result = await project({
      "frontmatter.json": JSON.stringify({
        "frontMatter.content.pageFolders": [
          { title: "Posts", path: "[[workspace]]/src/posts" },
          { title: "Docs", path: "[[workspace]]/src/docs" },
        ],
        "frontMatter.content.publicFolder": "assets",
      }),
    });
    expect(result.cms[0]).toMatchObject({ id: "frontmatter", read: true });
    expect(result.contentDir).toBe("src");
    expect(result.assetsDir).toBe("assets");
  });

  it("only detects Tina, Keystatic and Nuxt Studio", async () => {
    const result = await project({
      "package.json": pkg({ nuxt: "^4.1.0", "nuxt-studio": "^1.0.0" }),
      "tina/config.ts": "export default defineConfig({})",
      "keystatic.config.ts": "export default config({})",
      "content/a.md": "",
    });
    expect(result.cms.map((cms) => [cms.id, cms.read])).toEqual([
      ["tina", false],
      ["keystatic", false],
      ["nuxt-studio", false],
    ]);
    expect(result.contentDir).toBe("content");
  });
});

describe("Nuxt", () => {
  it("finds the public and assets folders of Nuxt 4", async () => {
    const result = await project({
      "package.json": pkg({ nuxt: "^4.1.0" }),
      "app/app.vue": "",
      "app/assets/main.css": "",
      "public/favicon.ico": "",
    });
    expect(result.assetsDirs).toEqual([
      { path: "public", kind: "public" },
      { path: "app/assets", kind: "build" },
    ]);
    expect(result.assetsDir).toBe("public");
  });

  it("reads srcDir and dir.public from nuxt.config, relative to the source in Nuxt 3", async () => {
    const result = await project({
      "package.json": pkg({ nuxt: "^3.17.0" }),
      "nuxt.config.ts": `const dirs = { public: "static" };
        export default defineNuxtConfig({ srcDir: "src/", dir: dirs })`,
      "src/static/logo.svg": "",
      "src/assets/main.css": "",
    });
    expect(result.assetsDirs.slice(0, 2)).toEqual([
      { path: "src/static", kind: "public" },
      { path: "src/assets", kind: "build" },
    ]);
    expect(result.signals).toContain("nuxt.config.ts: srcDir src");
  });

  it("keeps the static values of app.config and nuxt.schema", async () => {
    const result = await project({
      "package.json": pkg({ nuxt: "^4.1.0" }),
      "app/app.vue": "",
      "app/app.config.ts": `export default defineAppConfig({
        site: { name: "My site", logo: "/logo.svg", year: 2026, dark: true },
        ui: { colors: { primary: "green" } },
        footer: { links: getLinks() },
      })`,
      "nuxt.schema.ts": `export default defineNuxtSchema({
        appConfig: { site: { name: { $default: "Site", $schema: { title: "Name", type: "string" } } } },
      })`,
    });
    expect(result.appConfig).toEqual({
      site: { name: "My site", logo: "/logo.svg", year: 2026, dark: true },
      ui: { colors: { primary: "green" } },
      footer: { links: { $dynamic: "getLinks()" } },
    });
    expect(result.appSchema).toEqual({
      appConfig: {
        site: { name: { $default: "Site", $schema: { title: "Name", type: "string" } } },
      },
    });
  });
});

describe("assets", () => {
  it("lists every folder found, the public ones first", async () => {
    const result = await project({
      "src/assets/a.css": "",
      ".assets/b.png": "",
      "images/c.png": "",
      "notes.md": "",
    });
    expect(result.assetsDirs.map((dir) => dir.path)).toEqual(["src/assets", ".assets", "images"]);
    expect(result.assetsDir).toBe(".assets");
  });

  it("has none in a folder without any", async () => {
    const result = await project({ "a.md": "" });
    expect(result.assetsDirs).toEqual([]);
    expect(result.assetsDir).toBeUndefined();
  });
});

describe("workspaces", () => {
  const monorepo = {
    "package.json": JSON.stringify({ name: "root", private: true }),
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/**\n  - '!packages/internal'\n",
    "apps/site/package.json": pkg({ nuxt: "^4.1.0", "@nuxt/content": "^3.6.0" }),
    "apps/site/content/index.md": "",
    "apps/site/public/logo.svg": "",
    "apps/docs/package.json": pkg({ vitepress: "^1.6.0" }),
    "apps/docs/.vitepress/config.ts": "",
    "apps/empty/README.md": "",
    "packages/ui/package.json": pkg({ vue: "^3.5.0" }),
    "packages/nested/kit/package.json": pkg({}),
    "packages/internal/package.json": pkg({}),
  };

  it("sniffs each package, its folders prefixed with its root", async () => {
    const { projects, workspaces } = await sniff(memoryFs(monorepo));
    expect(workspaces).toEqual(["apps/*", "packages/**", "!packages/internal"]);
    expect(projects.map((item) => item.root)).toEqual([
      "",
      "apps/docs",
      "apps/site",
      "packages/nested/kit",
      "packages/ui",
    ]);
    const site = projects.find((item) => item.root === "apps/site")!;
    expect(site.framework?.id).toBe("nuxt");
    expect(site.contentDir).toBe("apps/site/content");
    expect(site.assetsDir).toBe("apps/site/public");
    expect(projects.find((item) => item.root === "apps/docs")?.contentDir).toBe("apps/docs");
  });

  it("reads the workspaces of package.json", async () => {
    const { projects } = await sniff(
      memoryFs({
        "package.json": JSON.stringify({ workspaces: { packages: ["site"] } }),
        "site/package.json": pkg({ astro: "^5.0.0" }),
      }),
    );
    expect(projects.map((item) => [item.root, item.framework?.id])).toEqual([
      ["", undefined],
      ["site", "astro"],
    ]);
  });

  it("can skip them", async () => {
    const { projects } = await sniff(memoryFs(monorepo), { workspaces: false });
    expect(projects).toHaveLength(1);
  });
});
