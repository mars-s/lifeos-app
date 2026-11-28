import { existsSync } from "node:fs";
import { readStack, stackFile, stopStack } from "./stack.ts";

if (existsSync(stackFile)) stopStack(readStack());
