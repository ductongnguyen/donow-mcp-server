import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load .env from the root directory or local
dotenv.config({ path: join(__dirname, ".env") });
dotenv.config({ path: join(__dirname, "..", ".env") });
const DONOW_API_URL = process.env.DONOW_API_URL || "http://localhost:3000/api/mcp/donow";
const DONOW_MCP_TOKEN = process.env.DONOW_MCP_TOKEN;
if (!DONOW_MCP_TOKEN) {
    console.error("Error: DONOW_MCP_TOKEN is not set in environment variables.");
    process.exit(1);
}
const server = new Server({
    name: "donow-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
/**
 * Helper to call the DoNow Next.js API
 */
async function callDoNowApi(action, data = {}) {
    const response = await fetch(DONOW_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${DONOW_MCP_TOKEN}`,
        },
        body: JSON.stringify({
            action,
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
                        projectId: { type: "string", description: "Filter by project ID" },
                        status: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
                    },
                },
            },
            {
                name: "donow_create_task",
                description: "Create a new task in DoNow.",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Task title" },
                        priority: { type: "string", enum: ["low", "medium", "high"] },
                        dueDate: { type: "string", description: "Due date (YYYY-MM-DD)" },
                        projectId: { type: "string", description: "Target project ID" },
                        notes: { type: "string", description: "Task description/notes" },
                        tags: { type: "array", items: { type: "string" } },
                    },
                    required: ["title"],
                },
            },
            {
                name: "donow_update_task",
                description: "Update an existing task status, priority, or details.",
                inputSchema: {
                    type: "object",
                    properties: {
                        taskId: { type: "string", description: "ID of the task to update" },
                        patch: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                status: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
                                priority: { type: "string", enum: ["low", "medium", "high"] },
                                completed: { type: "boolean" },
                                notes: { type: "string" },
                            },
                        },
                    },
                    required: ["taskId", "patch"],
                },
            },
            {
                name: "donow_get_projects",
                description: "Get all projects in the DoNow workspace.",
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
        const result = await callDoNowApi(name, args);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map