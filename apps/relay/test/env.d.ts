declare namespace Cloudflare {
  interface Env {
    NOTE: DurableObjectNamespace<import("../src/note.ts").Note>;
    CONVEX_CLOUD_URL: string;
    TEST_PRIVATE_JWK: string;
  }
}
