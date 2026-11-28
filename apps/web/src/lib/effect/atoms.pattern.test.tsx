import { RegistryProvider } from "@effect/atom-react";
import { selectedAtom } from "@lifeos/backend/effect/patterns/atoms";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { FaceSwitch, SelectionCount, SelectRow } from "./atoms.pattern";

test("components read atoms from the registry above them", () => {
  const html = renderToString(
    <RegistryProvider initialValues={[[selectedAtom, new Set(["a", "b"])]]}>
      <SelectionCount />
      <SelectRow taskKey="a" title="Draft intro" />
      <SelectRow taskKey="c" title="Email Sam" />
      <FaceSwitch />
    </RegistryProvider>,
  );
  expect(html).toContain("2<!-- --> selected");
  expect(html).toContain('aria-pressed="true">Draft intro');
  expect(html).toContain('aria-pressed="false">Email Sam');
  expect(html).toContain("List");
});
