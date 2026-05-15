#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { dirname, basename, join } from "path";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DONOW_API_URL = process.env.DONOW_API_URL || "http://localhost:3000/api/mcp/donow";

const DONOW_API_KEY = process.env.DONOW_API_KEY || process.env.DONOW_MCP_TOKEN;
const DONOW_USER_ID = process.env.DONOW_USER_ID;

/**
 * Detect current project from cwd / git so that all task operations
 * attach to a single stable project per repo, instead of letting the AI
 * invent fresh project names on every call.
 */
type DetectSource = "marker" | "env" | "git-remote" | "git-path" | "cwd";

type ProjectIdentity = {
  projectId: string | null;
  name: string;
  externalId: string;
  repoPath: string;
  branch: string | null;
  remoteUrl: string | null;
  markerPath: string | null;
  source: DetectSource;
};

const MARKER_DIR = ".donow";
const MARKER_FILE = "project.json";

function safeGit(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function findMarkerFile(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 30; i++) {
    const candidate = join(dir, MARKER_DIR, MARKER_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readMarker(path: string): { projectId?: string; externalId?: string; name?: string } | null {
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch {
    /* ignore */
  }
  return null;
}

function hashRepoId(idSource: string): string {
  return "repo:" + createHash("sha1").update(idSource).digest("hex").slice(0, 16);
}

function detectCurrentProject(): ProjectIdentity | null {
  const cwd = process.env.DONOW_PROJECT_ROOT || process.cwd();
  const topLevel = safeGit("git rev-parse --show-toplevel", cwd);
  const repoPath = topLevel || cwd;
  const remoteUrl = safeGit("git config --get remote.origin.url", repoPath) || null;
  const branch = safeGit("git rev-parse --abbrev-ref HEAD", repoPath) || null;

  // 1. Marker file (.donow/project.json) — highest precedence (explicit, commit-able).
  const markerPath = findMarkerFile(cwd);
  if (markerPath) {
    const data = readMarker(markerPath);
    if (data && (data.projectId || data.externalId || data.name)) {
      const name = data.name || process.env.DONOW_PROJECT_NAME || basename(repoPath);
      const externalId = data.externalId
        || process.env.DONOW_PROJECT_EXTERNAL_ID
        || hashRepoId((remoteUrl || repoPath).replace(/\.git$/, "").toLowerCase());
      return {
        projectId: data.projectId || null,
        name,
        externalId,
        repoPath,
        branch,
        remoteUrl,
        markerPath,
        source: "marker",
      };
    }
  }

  // 2. Env override — explicit per-machine.
  if (process.env.DONOW_PROJECT_EXTERNAL_ID || process.env.DONOW_PROJECT_NAME) {
    const name = process.env.DONOW_PROJECT_NAME || basename(repoPath);
    const externalId = process.env.DONOW_PROJECT_EXTERNAL_ID
      || hashRepoId((remoteUrl || repoPath).replace(/\.git$/, "").toLowerCase());
    return {
      projectId: null,
      name,
      externalId,
      repoPath,
      branch,
      remoteUrl,
      markerPath: null,
      source: "env",
    };
  }

  // 3. Git remote URL — strongest auto signal (stable across machines).
  if (remoteUrl) {
    const name = basename(repoPath);
    if (!name) return null;
    const externalId = hashRepoId(remoteUrl.replace(/\.git$/, "").toLowerCase());
    return { projectId: null, name, externalId, repoPath, branch, remoteUrl, markerPath: null, source: "git-remote" };
  }

  // 4. Git toplevel path — stable within one machine.
  if (topLevel) {
    const name = basename(repoPath);
    if (!name) return null;
    const externalId = hashRepoId(repoPath.toLowerCase());
    return { projectId: null, name, externalId, repoPath, branch, remoteUrl, markerPath: null, source: "git-path" };
  }

  // 5. cwd fallback — last resort.
  const name = basename(cwd);
  if (!name) return null;
  return {
    projectId: null,
    name,
    externalId: hashRepoId(cwd.toLowerCase()),
    repoPath: cwd,
    branch: null,
    remoteUrl: null,
    markerPath: null,
    source: "cwd",
  };
}

function writeMarker(repoPath: string, data: { projectId?: string | null; externalId?: string | null; name?: string | null }): string {
  const dir = join(repoPath, MARKER_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, MARKER_FILE);
  const payload: Record<string, string> = {};
  if (data.projectId) payload.projectId = data.projectId;
  if (data.externalId) payload.externalId = data.externalId;
  if (data.name) payload.name = data.name;
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return path;
}

let CURRENT_PROJECT = detectCurrentProject();
function logCurrentProject() {
  if (CURRENT_PROJECT) {
    console.error(
      `DoNow MCP: bound to project "${CURRENT_PROJECT.name}" via ${CURRENT_PROJECT.source} (projectId=${CURRENT_PROJECT.projectId || "-"}, externalId=${CURRENT_PROJECT.externalId}, repo=${CURRENT_PROJECT.repoPath})`
    );
  } else {
    console.error("DoNow MCP: no project context detected (tasks will go to Inbox unless caller passes projectId/project).");
  }
}
logCurrentProject();

/**
 * Inject the detected project into task-related calls, unless the caller
 * already specified projectId or project.{name|externalId}.
 */
function withProjectContext(args: any): any {
  const next = { ...(args || {}) };
  if (!CURRENT_PROJECT) return next;
  if (Object.prototype.hasOwnProperty.call(next, "projectId")) return next;
  const proj = next.project && typeof next.project === "object" ? next.project : null;
  if (proj && (proj.externalId || proj.name)) return next;

  // If marker file pinned an explicit projectId, prefer that (deterministic).
  if (CURRENT_PROJECT.projectId) {
    next.projectId = CURRENT_PROJECT.projectId;
    return next;
  }

  next.project = {
    name: CURRENT_PROJECT.name,
    externalId: CURRENT_PROJECT.externalId,
    repoPath: CURRENT_PROJECT.repoPath,
    branch: CURRENT_PROJECT.branch,
    source: "mcp",
  };
  return next;
}

const PROJECT_SCOPED_ACTIONS = new Set([
  "donow_create_task",
  "donow_bulk_create_tasks",
  "donow_upsert_task",
  "donow_list_tasks",
]);

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
        name: "donow_get_current_project",
        description: "Return the project automatically bound to the current working directory. Detection cascade: .donow/project.json marker file > DONOW_PROJECT_* env > git remote URL > git toplevel path > cwd. Use this to confirm which project tasks will be created in.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "donow_link_project",
        description: "Pin the current repository to a specific DoNow project by writing .donow/project.json. Pass projectId to bind to an existing project, or projectName to find-or-create. Commit the file so the whole team shares the same project binding. Useful when re-cloning without git history or when multiple repos share a name.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Existing DoNow project id to bind to." },
            projectName: { type: "string", description: "Project name to find-or-create when projectId is not provided." },
          },
        },
      },
      {
        name: "donow_delete_task",
        description: "Permanently delete a task from DoNow. This action is irreversible.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "The ID of the task to delete." },
          },
          required: ["taskId"],
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
    if (name === "donow_get_current_project") {
      return {
        content: [{
          type: "text",
          text: CURRENT_PROJECT
            ? JSON.stringify(CURRENT_PROJECT, null, 2)
            : "No project context detected. Tasks without an explicit project will go to the Inbox.",
        }],
      };
    }

    if (name === "donow_link_project") {
      if (!CURRENT_PROJECT) {
        throw new Error("Cannot link: no repository context detected (no cwd / repoPath available).");
      }
      const linkArgs = (args || {}) as { projectId?: string; projectName?: string };
      let projectId = linkArgs.projectId;
      let projectName = linkArgs.projectName || CURRENT_PROJECT.name;
      let externalId: string | null = null;

      if (!projectId) {
        // find-or-create on backend using current repo's externalId as canonical key.
        const result: any = await callDoNowApi("donow_find_or_create_project", {
          project: {
            name: projectName,
            externalId: CURRENT_PROJECT.externalId,
            repoPath: CURRENT_PROJECT.repoPath,
            branch: CURRENT_PROJECT.branch,
            source: "mcp",
          },
        });
        const project = result?.project || {};
        projectId = project.id;
        projectName = project.name || projectName;
        externalId = project.externalId || CURRENT_PROJECT.externalId;
      }

      if (!projectId) {
        throw new Error("Failed to resolve a projectId to link.");
      }

      const markerPath = writeMarker(CURRENT_PROJECT.repoPath, {
        projectId,
        externalId,
        name: projectName,
      });

      // Refresh detection so subsequent calls in this session use the new binding.
      CURRENT_PROJECT = detectCurrentProject();
      logCurrentProject();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            linked: { projectId, name: projectName, externalId },
            markerPath,
            current: CURRENT_PROJECT,
          }, null, 2),
        }],
      };
    }

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
   - The MCP server auto-binds every task to the current repository's project. Detection cascade: .donow/project.json marker > DONOW_PROJECT_* env > git remote URL > git path > cwd. Confirm via donow_get_current_project.
   - DO NOT invent a new project name or pass project.{name,externalId} to "switch" repos — that creates duplicates. Only pass project/projectId when the user explicitly names a different project.
   - If detection is unstable (e.g. source="cwd" or "git-path") and the user wants permanent binding, call donow_link_project to write .donow/project.json (commit it for team-share).
   - To put a task in the global Inbox instead, pass projectId: "" (empty string) explicitly.`
        }]
      };
    }

    if (name === "donow_delete_task") {
      const taskId = (args as any)?.taskId;
      if (!taskId) throw new Error("taskId is required.");
      const result = await callDoNowApi("donow_delete_task", { taskId });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    const finalArgs = PROJECT_SCOPED_ACTIONS.has(name) ? withProjectContext(args) : args;
    const result = await callDoNowApi(name, finalArgs);
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
