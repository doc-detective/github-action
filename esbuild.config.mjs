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
  });
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
