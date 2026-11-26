import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

const serveKeys = async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "ES256", use: "sig" }] });
  const server = createServer((request, response) => {
    if (request.url !== "/.well-known/jwks.json") return response.writeHead(404).end();
    return response.writeHead(200, { "Content-Type": "application/json" }).end(jwks);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  return {
    convexUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    privateJwk: JSON.stringify({ ...(await exportJWK(privateKey)), kid: "test" }),
  };
};

export default defineConfig(async () => {
  const keys = await serveKeys();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { CONVEX_CLOUD_URL: keys.convexUrl, TEST_PRIVATE_JWK: keys.privateJwk } },
      }),
    ],
  };
});
