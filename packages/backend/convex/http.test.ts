import { describe, expect, test } from "vitest";
import { newSignedOutBackend } from "./backend.test-utils";

describe("sign-in bounce routes", () => {
  test.each(["/auth/iphone", "/auth/mac"])("%s hands the query string to the lifeos:// deep link", async (path) => {
    const t = newSignedOutBackend();
    const response = await t.fetch(`${path}?convexAuthCode=one-time`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("lifeos://auth?convexAuthCode=one-time");
  });
});
