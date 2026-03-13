import {defineConfig} from "vitest/config";
import {backend} from "vitest-config-silverwind";

export default defineConfig(backend({
  url: import.meta.url,
  sequence: {concurrent: true},
}));
