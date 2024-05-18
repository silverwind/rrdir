import {defineConfig} from "vite";
import {fileURLToPath} from "node:url";
import dtsPlugin from "vite-plugin-dts";
import {builtinModules} from "node:module";
import {readFileSync} from "node:fs";

const {dependencies, peerDependencies} = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

export default defineConfig({
  build: {
    outDir: fileURLToPath(new URL("dist", import.meta.url)),
    minify: false,
    sourcemap: false,
    target: "modules",
    emptyOutDir: true,
    chunkSizeWarningLimit: Infinity,
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    lib: {
      entry: [fileURLToPath(new URL("index.ts", import.meta.url))],
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        ...Object.keys(dependencies || {}),
        ...Object.keys(peerDependencies || {}),
        ...builtinModules.map(module => `node:${module}`),
      ],
    }
  },
  plugins: [
    dtsPlugin({exclude: [
      "*.config.*",
      "*.test.*",
    ]}),
  ],
});
