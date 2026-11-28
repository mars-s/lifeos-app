import { Predicate } from "effect";

export const QUIET_CHANGE_LIMIT = 10;

export type ToolCallFacts = {
  readonly toolName: string;
  readonly input: unknown;
  readonly readOnly: boolean;
  readonly changesSoFar: number;
  readonly askFirst: boolean;
};

const trashes = (toolName: string, input: unknown) => toolName === "set_task_status" && Predicate.isObject(input) && input.status === "trashed";

export const asksFirst = ({ toolName, input, readOnly, changesSoFar, askFirst }: ToolCallFacts) =>
  !readOnly && (askFirst || toolName === "convert_task_to_project" || trashes(toolName, input) || changesSoFar >= QUIET_CHANGE_LIMIT);
