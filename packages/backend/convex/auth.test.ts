import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { newSignedOutBackend } from "./backend.test-utils";

const refusesReturnTo = async (redirectTo: string) => {
  const thrown: unknown = await newSignedOutBackend()
    .mutation(api.auth.startSignInWithGithub, { redirectTo })
    .then(
      () => null,
      (error: unknown) => error,
    );
  return thrown instanceof Error && thrown.message.includes("is not in allowedRedirectOrigins");
};

test.each([
  ["https://lifeos.zephyrus.qzz.io/", false],
  ["https://lifeos.zephyrus.qzz.io/upcoming?view=week", false],
  ["http://localhost:3000/", false],
  ["https://lifeos-test.convex.site/auth/mac", false],
  ["https://lifeos-test.convex.site/auth/iphone", false],
  ["https://evil.example/", true],
  ["https://lifeos.zephyrus.qzz.io.evil.example/", true],
  ["http://lifeos.zephyrus.qzz.io/", true],
  ["http://localhost:3001/", true],
])("sign-in returning to %s is refused: %s", async (redirectTo, refused) => {
  expect(await refusesReturnTo(redirectTo)).toBe(refused);
});
