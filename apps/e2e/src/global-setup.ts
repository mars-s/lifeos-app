import { startStack, stopStack } from "./stack.ts";

export default async () => {
  const stack = await startStack();
  return async () => {
    if (process.env.E2E_KEEP !== "1" && process.env.E2E_REUSE !== "1") stopStack(stack);
  };
};
