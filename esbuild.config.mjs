import { build } from "esbuild";

try {
  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    outfile: "dist/index.js",
    sourcemap: true,
    minify: false,
    // @actions/cache (via @azure/*) references `import.meta.url`, which isn't
    // valid in a CJS bundle — esbuild replaces it with `undefined`, breaking the
    // `createRequire(import.meta.url)` those packages do at load time. Point it
    // at the bundle's own file URL so `createRequire` gets a real path.
    define: { "import.meta.url": "_importMetaUrl" },
    banner: {
      js: "const _importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
    // `supports-color` is an optional try-require (via `debug`, pulled in by
    // @actions/cache's deps). Whether esbuild inlines it depends on whether it
    // happens to be installed, which makes the bundle non-deterministic and
    // trips the "dist is up to date" CI check. Keep it external (the `debug`
    // require tolerates its absence) so the bundle is reproducible.
    external: ["supports-color"],
  });
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
