import { checkValue, toJsonSchema, type McpUser, type ToolCtx, type ToolDefinition } from "@convex-dev/mcp";
import { jsonSchema, tool, type JSONSchema7 } from "ai";
import { asObjectValidator, ConvexError } from "convex/values";
import { Predicate } from "effect";
import type { ActionCtx } from "../_generated/server";

const refusalOf = (error: unknown) => {
  if (!(error instanceof ConvexError)) throw error;
  return { refused: Predicate.isString(error.data) ? error.data : JSON.stringify(error.data) };
};

const call = async (definition: ToolDefinition, ctx: ToolCtx, caller: McpUser, input: unknown) => {
  const checked = checkValue(asObjectValidator(definition.args ?? {}), input);
  if (!checked.ok) return { refused: `Invalid arguments: ${checked.error}` };
  return definition.handler(ctx, checked.value as never, caller).catch(refusalOf);
};

export const aiToolOf = (definition: ToolDefinition, ctx: ActionCtx, caller: McpUser) =>
  tool({
    description: definition.description,
    inputSchema: jsonSchema<Record<string, unknown>>(toJsonSchema(asObjectValidator(definition.args ?? {})) as JSONSchema7),
    execute: (input) => call(definition, ctx as unknown as ToolCtx, caller, input),
  });

export const isReadOnly = (definition: ToolDefinition) => definition.annotations?.readOnlyHint === true;
