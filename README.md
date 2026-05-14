# DoNow MCP Server

This is a standalone Model Context Protocol (MCP) server for the DoNow application. It allows AI agents (like Claude Desktop or Cline) to interact with your DoNow tasks and projects.

## Cấu hình Client

Thêm vào file cấu hình mcp của AI Assistant:

### Dành cho Cline (VSCode)
Mở Settings của Cline > MCP Servers và dán nội dung này vào `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "donow": {
      "command": "npx",
      "args": [
        "-y",
        "github:ductongnguyen/donow-mcp-server"
      ],
      "env": {
        "DONOW_API_URL": "https://usedonow.vercel.app/api/mcp/donow",
        "DONOW_API_KEY": "<YOUR_TOKEN>",
        "DONOW_USER_ID": "B6GSPacuXaTIpBdLhGv1WyXUYCN2"
      }
    }
  }
}
```

### Dành cho Claude Desktop
Chỉnh sửa file `claude_desktop_config.json` (Lưu ý: bạn cần clone repo mcp server về máy local thay vì npx):

```json
{
  "mcpServers": {
    "donow-tasks": {
      "command": "node",
      "args": [
        "D:/Coding/todo/donow-mcp-server/dist/index.js"
      ],
      "env": {
        "DONOW_API_URL": "http://localhost:3000/api/mcp/donow",
        "DONOW_API_KEY": "<YOUR_TOKEN>",
        "DONOW_USER_ID": "B6GSPacuXaTIpBdLhGv1WyXUYCN2"
      }
    }
  }
}
```

*Lưu ý: Thay thế `D:/Coding/todo` bằng đường dẫn thực tế đến dự án của bạn.*

## Setup Local (Optional)

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Build Server:**
   ```bash
   npm run build
   ```

## Tools Provided

- `donow_list_tasks`: Liệt kê task (lọc theo dự án/trạng thái).
- `donow_create_task`: Tạo task mới.
- `donow_bulk_create_tasks`: Tạo nhiều task cùng lúc (từ danh sách).
- `donow_update_task`: Cập nhật trạng thái hoặc chi tiết task.
- `donow_get_projects`: Lấy danh sách dự án.
