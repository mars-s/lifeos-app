import { getRandomValues } from "expo-crypto";

const webcrypto = {
  ensureSecure: () => undefined,
  subtle: {},
  getRandomValues,
};

export default webcrypto;
