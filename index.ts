#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DONOW_API_URL = process.env.DONOW_API_URL || "http://localhost:3000/api/mcp/donow";

const DONOW_API_KEY = process.env.DONOW_API_KEY || process.env.DONOW_MCP_TOKEN;
const DONOW_USER_ID = process.env.DONOW_USER_ID;

if (!DONOW_API_KEY) {
  console.error("Error: DONOW_API_KEY is not set in environment variables.");
  process.exit(1);
}

if (!DONOW_USER_ID) {
  console.error("Error: DONOW_USER_ID is not set in environment variables.");
  process.exit(1);
}

const server = new Server(
  {
    name: "donow-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Helper to call the DoNow Next.js API
 */
async function callDoNowApi(action: string, data: any = {}) {
  const response = await fetch(DONOW_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DONOW_API_KEY}`,
    },
    body: JSON.stringify({
      action,
      userId: DONOW_USER_ID,
      ...data,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DoNow API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "donow_list_tasks",
        description: "List tasks from DoNow workspace. Can filter by project or status.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project ID" },
            status: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
            completed: { type: "boolean" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "donow_create_task",
        description: "Create a new task in DoNow.",
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "object",
              properties: {
                title: { type: "string" },
                priority: { type: "string", enum: ["low", "medium", "high"] },
                dueDate: { type: "string", description: "YYYY-MM-DD" },
                notes: { type: "string", description: "Detailed description or notes about the task (Required)." },
                tags: { type: "array", items: { type: "string" } },
              },
              required: ["title", "notes"],
            },
            projectId: { type: "string" },
            project: {
              type: "object",
              properties: {
                name: { type: "string" },
                externalId: { type: "string" },
              },
            },
          },
        },
      },
      {
        name: "donow_bulk_create_tasks",
        description: "Create multiple tasks at once in DoNow.",
        inputSchema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  priority: { type: "string", enum: ["low", "medium", "high"] },
                  dueDate: { type: "string" },
                  notes: { type: "string", description: "Detailed description or notes about the task (Required)." },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["title", "notes"],
              },
            },
            projectId: { type: "string" },
            project: {
              type: "object",
              properties: {
                name: { type: "string" },
                externalId: { type: "string" },
              },
            },
          },
          required: ["tasks"],
        },
      },
      {
        name: "donow_upsert_task",
        description: "Create or update a task based on externalId or title.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "object" },
            projectId: { type: "string" },
            project: { type: "object" },
          },
        },
      },
      {
        name: "donow_update_task",
        description: "Update the status or details of an existing task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            patch: { type: "object" },
          },
          required: ["taskId", "patch"],
        },
      },
      {
        name: "donow_complete_task",
        description: "Mark a task as completed along with a verification summary.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            verificationSummary: { type: "string" },
            needsReview: { type: "boolean" },
          },
          required: ["taskId"],
        },
      },
      {
        name: "donow_get_projects",
        description: "Get a list of all projects in the workspace.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "donow_add_subtask",
        description: "Add a subtask to a task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            title: { type: "string" },
          },
          required: ["taskId", "title"],
        },
      },
      {
        name: "donow_get_guidelines",
        description: "Get detailed guidelines on how to properly fill data fields when creating or updating a task.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "donow_get_guidelines") {
      return {
        content: [{
          type: "text",
          text: `DONOW DATA FIELD GUIDELINES:
            
1. title:
   - Must be concise, clear, and actionable (start with a verb).
   - Example: "Update API documentation", "Fix login bug".
   
2. notes (Description):
   - THIS IS A REQUIRED FIELD.
   - Must provide full context, detailed requirements, and expected outcomes.
   - If there are multiple small steps, list them with bullet points for readability.

3. priority:
   - "high": Urgent, significantly impacts schedule.
   - "medium": Default for most tasks.
   - "low": Spare time work, not immediately necessary.

4. tags:
   - Used for categorization. Use English, lowercase, separated by hyphens.
   - Common examples: bug, feature, docs, research, design, frontend, backend.

5. dueDate:
   - Must be in YYYY-MM-DD format.
   - Only fill if the user specifically mentions a deadline.

6. status:
   - "todo" (Default): To be done.
   - "doing": Currently in progress.
   - "blocked": Stuck, waiting for someone or resources.
   - "done": Completed.

7. projectId / project.name (Project):
   - Assign to the exact project specified by the user.
   - If the user does NOT specify, ABSOLUTELY DO NOT create a new project. Leave it empty so the task falls into the Inbox.`
        }]
      };
    }

    const result = await callDoNowApi(name, args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
});

/**
 * Start the server using stdio transport
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DoNow MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
