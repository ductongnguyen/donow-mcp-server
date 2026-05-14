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
        description: "Liệt kê các công việc từ workspace DoNow. Có thể lọc theo dự án hoặc trạng thái.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "ID của dự án" },
            status: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
            completed: { type: "boolean" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "donow_create_task",
        description: "Tạo một công việc mới trong DoNow.",
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "object",
              properties: {
                title: { type: "string" },
                priority: { type: "string", enum: ["low", "medium", "high"] },
                dueDate: { type: "string", description: "YYYY-MM-DD" },
                notes: { type: "string", description: "Mô tả chi tiết hoặc ghi chú về công việc (Bắt buộc)." },
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
        description: "Tạo nhiều công việc cùng lúc trong DoNow.",
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
                  notes: { type: "string", description: "Mô tả chi tiết hoặc ghi chú về công việc (Bắt buộc)." },
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
        description: "Tạo mới hoặc cập nhật công việc dựa trên externalId hoặc tiêu đề.",
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
        description: "Cập nhật trạng thái hoặc chi tiết của một công việc đã có.",
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
        description: "Đánh dấu công việc là hoàn thành kèm theo tóm tắt xác minh.",
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
        description: "Lấy danh sách tất cả các dự án trong workspace.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "donow_add_subtask",
        description: "Thêm một bước nhỏ (subtask) vào công việc.",
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
        description: "Lấy hướng dẫn chi tiết về cách điền các trường dữ liệu (fields) chuẩn mực khi tạo hoặc cập nhật task.",
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
          text: `HƯỚNG DẪN ĐIỀN CÁC TRƯỜNG DỮ LIỆU TRONG DONOW:
            
1. title (Tiêu đề):
   - Phải ngắn gọn, rõ ràng và có tính hành động (bắt đầu bằng động từ).
   - Ví dụ: "Cập nhật tài liệu API", "Sửa lỗi đăng nhập".
   
2. notes (Mô tả):
   - ĐÂY LÀ TRƯỜNG BẮT BUỘC.
   - Phải cung cấp đầy đủ ngữ cảnh, yêu cầu chi tiết, và kết quả mong muốn.
   - Nếu có nhiều bước nhỏ, hãy liệt kê bằng gạch đầu dòng để người đọc dễ theo dõi.

3. priority (Độ ưu tiên):
   - "high": Cần xử lý gấp, ảnh hưởng lớn đến tiến độ.
   - "medium": Mặc định cho hầu hết công việc.
   - "low": Việc rảnh rỗi, chưa cần thiết ngay.

4. tags (Nhãn):
   - Dùng để phân loại. Nên dùng tiếng Anh, viết thường, ngăn cách bằng dấu gạch ngang.
   - Ví dụ phổ biến: bug, feature, docs, research, design, frontend, backend.

5. dueDate (Ngày đến hạn):
   - Phải đúng định dạng YYYY-MM-DD.
   - Chỉ điền nếu người dùng có đề cập đến thời gian cụ thể.

6. status (Trạng thái):
   - "todo" (Mặc định): Sẽ làm.
   - "doing": Đang làm.
   - "blocked": Đang bị kẹt, chờ người khác hoặc chờ tài nguyên.
   - "done": Đã xong.

7. projectId / project.name (Dự án):
   - Phân bổ đúng vào dự án mà người dùng chỉ định.
   - Nếu người dùng KHÔNG chỉ định, TUYỆT ĐỐI không tự tạo dự án mới, hãy để trống để task rơi vào Inbox.`
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
