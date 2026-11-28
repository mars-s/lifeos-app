declare module "*?url" {
  const url: string;
  export default url;
}

interface ImportMeta {
  glob: (pattern: readonly string[], options: { query: "?raw"; import: "default"; eager: true }) => Record<string, string>;
}
