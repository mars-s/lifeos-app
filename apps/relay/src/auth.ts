import { createRemoteJWKSet, jwtVerify } from "jose";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const keySetFor = (convexUrl: string) => {
  const known = keySets.get(convexUrl);
  if (known) return known;
  const created = createRemoteJWKSet(new URL(`${convexUrl}/.well-known/jwks.json`));
  keySets.set(convexUrl, created);
  return created;
};

export const verifyOwnerToken = async (token: string, convexUrl: string) => {
  try {
    await jwtVerify(token, keySetFor(convexUrl), {
      issuer: `${convexUrl}/components/auth`,
      audience: "convex-auth",
      algorithms: ["ES256"],
    });
    return true;
  } catch {
    return false;
  }
};

export const bearerToken = (request: Request) => {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;
};
