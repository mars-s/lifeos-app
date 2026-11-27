import type { ToolDefinition } from "@convex-dev/mcp";
import { notesReadTools } from "./notes/agentReads";
import { platformTools } from "./platform/agentTools";
import { plannerReadTools } from "./planner/agentReads";
import { smartBlockTools } from "./planner/agentSmartBlocks";
import { plannerWriteTools } from "./planner/agentWrites";

export const LIFEOS_TOOLS: Record<string, ToolDefinition> = { ...plannerReadTools, ...plannerWriteTools, ...smartBlockTools, ...notesReadTools, ...platformTools };
