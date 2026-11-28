import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { compileToSource, mergeConfigs } from "cn/compiler";
import { defaultConfig } from "cn/config";
import { defineConfig, type VitePlugin } from "waku/config";
import { classConfig } from "./src/lib/utils";

const classHelperPath = fileURLToPath(new URL("./src/lib/utils.ts", import.meta.url));
const classTablesId = "virtual:lifeos-class-tables";
const resolvedClassTablesId = `\0${classTablesId}`;

const compiledClassHelper = {
  name: "lifeos-compiled-class-helper",
  apply: "build",
  enforce: "pre",
  resolveId(id) {
    if (id === classTablesId) return resolvedClassTablesId;
  },
  load(id) {
    if (id === resolvedClassTablesId) return compileToSource(mergeConfigs(defaultConfig(), classConfig));
  },
  transform(_code, id) {
    if (id === classHelperPath) {
      return {
        code: `import { createCn } from "cn/engine";
import tables from "${classTablesId}";
export const cn = createCn(tables);`,
        map: null,
      };
    }
  },
} satisfies VitePlugin;

const usedPhosphorWeights = {
  name: "lifeos-phosphor-weights",
  apply: "build",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("/@phosphor-icons/react/dist/defs/") || !id.endsWith(".es.js")) return;
    return {
      code: code.replace(/^  \[\n    "(?:thin|light|duotone)",\n[\s\S]*?^  \],?\n/gm, ""),
      map: null,
    };
  },
} satisfies VitePlugin;

const usedMotionFeatures = {
  name: "lifeos-motion-features",
  apply: "build",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/framer-motion/dist/es/render/components/motion/feature-bundle.mjs")) return;
    return { code: code.replace(", gestureAnimations, drag, layout", ", layout"), map: null };
  },
} satisfies VitePlugin;

const reactProfiling: Record<string, string> = process.env.WAKU_REACT_PROFILING === "1" ? { "react-dom/client": "react-dom/profiling" } : {};

export default defineConfig({
  distDir: process.env.WAKU_DIST_DIR ?? "dist",
  vite: {
    plugins: [tailwindcss(), compiledClassHelper, usedPhosphorWeights, usedMotionFeatures],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), ...reactProfiling },
    },
  },
});
