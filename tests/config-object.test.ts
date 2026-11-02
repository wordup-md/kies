import { describe, expect, it } from "vite-plus/test";
import { readConfig } from "../src/config-object.ts";

describe("readConfig", () => {
  it("reads the object of a define call", async () => {
    expect(
      await readConfig('export default defineNuxtConfig({ dir: { public: "static" } })'),
    ).toEqual({
      dir: { public: "static" },
    });
  });

  it("reads literals of every kind", async () => {
    expect(
      await readConfig(`export default {
        string: "a", template: \`b\`, number: 1.5, negative: -2, yes: true, none: null,
        list: [1, "two", [3]], "quoted key": 4, 5: "five",
      }`),
    ).toEqual({
      string: "a",
      template: "b",
      number: 1.5,
      negative: -2,
      yes: true,
      none: null,
      list: [1, "two", [3]],
      "quoted key": 4,
      "5": "five",
    });
  });

  it("follows the constants of the module, not the imports", async () => {
    expect(
      await readConfig(`import shared from "./shared";
        const site = { name: "x" };
        export const theme = "dark";
        export default defineAppConfig({ site, theme, shared })`),
    ).toEqual({ site: { name: "x" }, theme: "dark", shared: { $dynamic: "shared" } });
  });

  it("marks what it can't know", async () => {
    expect(
      await readConfig(`export default {
        fn: () => 1, call: compute(), env: process.env.URL, tpl: \`\${a}b\`, ...rest,
      }`),
    ).toEqual({
      fn: { $dynamic: "() => 1" },
      call: { $dynamic: "compute()" },
      env: { $dynamic: "process.env.URL" },
      tpl: { $dynamic: "`${a}b`" },
    });
  });

  it("unwraps TypeScript assertions", async () => {
    expect(await readConfig('export default { a: "x" as const } satisfies Config')).toEqual({
      a: "x",
    });
  });

  it("reads module.exports", async () => {
    expect(await readConfig('module.exports = { input: "src" }')).toEqual({ input: "src" });
  });

  it("does not loop on a constant naming itself", async () => {
    expect(await readConfig("const a = { b: a }; export default a")).toEqual({
      b: { $dynamic: "a" },
    });
  });

  it("returns nothing for a file without default export, or one that doesn't parse", async () => {
    expect(await readConfig("export const a = 1")).toBeUndefined();
    expect(await readConfig("export default {")).toBeUndefined();
  });
});
