declare namespace Cloudflare {
  interface Env {
    NOTE: DurableObjectNamespace<import("../src/note.ts").Note>;
    CONVEX_CLOUD_URL: string;
    TEST_PRIVATE_JWK: string;
    CORE_WORKER_TOKEN: string;
    QUIET_MS: string;
    SAVE_MS: string;
  }
}
