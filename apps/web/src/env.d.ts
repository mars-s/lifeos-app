interface ImportMetaEnv {
  readonly WAKU_PUBLIC_CONVEX_URL?: string;
  readonly DEV?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
