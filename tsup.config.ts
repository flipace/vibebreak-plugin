import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/vibebreak.ts"],
  outDir: "dist/bin",
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  shims: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
