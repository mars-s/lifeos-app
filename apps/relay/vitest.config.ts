import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

const readBody = (request: import("node:http").IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => resolve(body));
  });

const serveCore = async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "ES256", use: "sig" }] });
  const projections: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/.well-known/jwks.json") {
      return response.writeHead(200, { "Content-Type": "application/json" }).end(jwks);
    }
    if (request.url === "/api/mutation" && request.method === "POST") {
      projections.push(JSON.parse(await readBody(request)));
      return response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "success", value: null }));
    }
    if (request.url === "/projections") {
      return response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(projections));
    }
    return response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  return {
    convexUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    privateJwk: JSON.stringify({ ...(await exportJWK(privateKey)), kid: "test" }),
  };
};

export default defineConfig(async () => {
  const core = await serveCore();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            CONVEX_CLOUD_URL: core.convexUrl,
            TEST_PRIVATE_JWK: core.privateJwk,
            CORE_WORKER_TOKEN: "relay-test-token",
            QUIET_MS: "100",
          },
        },
      }),
    ],
  };
});
