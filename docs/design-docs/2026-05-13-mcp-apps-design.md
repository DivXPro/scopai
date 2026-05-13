# MCP Apps 扩展设计文档

## 背景

当前 scopai MCP Server 返回帖子信息为纯 JSON 文本，Agent client 无法直观查看帖子中的图片等媒体内容。引入 MCP Apps 扩展后，可以通过 HTML UI 在 iframe 中渲染帖子信息，支持图片轮播等交互功能。

## 目标

1. 将 MCP Server 从 `Server` 类重构为 `McpServer` 类
2. 引入 `@modelcontextprotocol/ext-apps`，支持交互式 HTML UI
3. `get_post` 工具返回帖子信息时，触发客户端渲染帖子展示 UI（含图片轮播）
4. 一并恢复 `platform_post_id` 查询能力
5. 保持向后兼容：不支持 Apps 的客户端仍能看到 JSON 文本

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                   自建 Agent Client (Host)                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  @modelcontextprotocol/ext-apps/app-bridge             │  │
│  │  - 接收 tool result → 创建 iframe → 加载 ui://...       │  │
│  │  - 管理 ui/initialize 握手                              │  │
│  └────────────────────────────────────────────────────────┘  │
│                          ↑ postMessage                       │
│                          ↓                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  iframe: Post Viewer UI                                │  │
│  │  - @modelcontextprotocol/ext-apps (App 类)             │  │
│  │  - 轮播组件 (Vanilla JS)                                │  │
│  │  - 接收 tool result → 渲染帖子信息 + 图片轮播            │  │
│  │  - "查看更多"按钮 → app.callServerTool()               │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              ↑ stdio
                              ↓
┌──────────────────────────────────────────────────────────────┐
│                  scopai MCP Server                           │
│                                                              │
│  McpServer ({ name: 'scopai', version: '1.3.29' })         │
│  ├─ registerTool('list_posts', ...)                         │
│  ├─ registerTool('search_posts', ...)                       │
│  ├─ registerAppTool('get_post', {                           │
│  │     _meta: { ui: { resourceUri: 'ui://scopai/post-viewer' } }
│  │   }, ...)                                                 │
│  ├─ registerAppResource('post-viewer', 'ui://scopai/post-viewer', ...)
│  └─ ... (其余 12 个 tool)                                    │
│                                                              │
│  传输层: StdioServerTransport (不变)                         │
└──────────────────────────────────────────────────────────────┘
```

## 服务端设计

### 依赖

```json
{
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@modelcontextprotocol/ext-apps": "^1.x",
  "zod": "^4.x"
}
```

`zod` 通过 `@modelcontextprotocol/sdk` 的 peer dependency 已间接安装。

### McpServer 重构

将 `packages/cli/src/mcp-server.ts` 从 `Server` + switch-case 模式重构为 `McpServer` + `registerTool`/`registerAppTool` 模式。

**关键变化：**

| 当前 (`Server`) | 重构后 (`McpServer`) |
|-----------------|---------------------|
| `new Server(...)` | `new McpServer(...)` |
| `TOOLS` 数组集中声明 | 逐个 `registerTool()` 注册 |
| `setRequestHandler(ListToolsRequestSchema, ...)` | 自动处理，无需手动设置 |
| `setRequestHandler(CallToolRequestSchema, switch-case)` | 每个 tool 独立 handler |
| 手动 try-catch + isError result | 直接 `throw Error`，自动转换 |
| JSON schema inputSchema | Zod schema inputSchema |
| `Record<string, unknown>` 参数 | Zod 推断的强类型参数 |

### `get_post` Tool 设计

使用 `registerAppTool`，支持两种查询方式 + UI 关联：

```typescript
import { z } from 'zod';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE }
  from '@modelcontextprotocol/ext-apps/server';

registerAppTool(server, 'get_post', {
  description: 'Get detailed information about a specific post',
  inputSchema: z.object({
    id: z.string().optional().describe('Internal post ID'),
    platform_post_id: z.string().optional().describe('Original platform post ID'),
    platform: z.string().optional().describe('Platform ID (required with platform_post_id)'),
  }).refine((data) => data.id || (data.platform_post_id && data.platform), {
    message: 'Provide either id or platform_post_id + platform',
  }),
  _meta: {
    ui: {
      resourceUri: 'ui://scopai/post-viewer',
      visibility: ['model', 'app'],
    },
  },
}, async (args) => {
  let post: any;

  if (args.platform_post_id) {
    const params = new URLSearchParams();
    params.set('platform_post_id', args.platform_post_id);
    params.set('platform', args.platform!);
    const result = await apiGet<{ posts?: any[] }>('/posts?' + params.toString());
    if (!result.posts || result.posts.length === 0) {
      throw new Error('Post not found');
    }
    post = result.posts[0];
  } else {
    post = await apiGet(`/posts/${args.id}`);
  }

  // 额外获取媒体列表
  const media = await apiGet<any[]>(`/posts/${post.id}/media`);
  const enrichedPost = { ...post, media_files: media };

  return {
    content: [{ type: 'text', text: JSON.stringify(enrichedPost) }],
  };
});
```

### Resource 注册

```typescript
registerAppResource(
  server,
  'post-viewer',
  'ui://scopai/post-viewer',
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(
      path.join(__dirname, 'mcp-ui/post-viewer.html'),
      'utf-8'
    );
    return {
      contents: [{
        uri: 'ui://scopai/post-viewer',
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
      }],
    };
  },
);
```

### 其余 Tool 迁移

其余 14 个 tool（`list_posts`、`search_posts`、`list_tasks` 等）使用 `server.registerTool()` 注册，逻辑保持不变，仅 inputSchema 从 JSON schema 改为 Zod schema。

## HTML UI 设计

### 文件位置

`packages/cli/src/mcp-ui/post-viewer.html`

### 布局

```
┌─────────────────────────────────────────────┐
│  📌 帖子详情                                  │
│  ─────────────────────────────────────────   │
│  上海美食探店｜作者：小红书用户123              │
│  点赞 1.2k  收藏 300  评论 50                  │
│  ─────────────────────────────────────────   │
│  ┌─────────────────────────────────────┐    │
│  │         [图片轮播区域]               │    │
│  │                                     │    │
│  │      ◀  1 / 5  ▶                    │    │
│  │                                     │    │
│  └─────────────────────────────────────┘    │
│  ─────────────────────────────────────────   │
│  帖子正文内容...                              │
│                                              │
│  [🏷️ 标签: 上海, 美食, 火锅]                 │
│  [📅 2026-05-10]                             │
└─────────────────────────────────────────────┘
```

### 技术方案

- **纯 HTML + CSS + JS**，不引入前端构建工具
- CSS 内联在 `<style>` 中
- JS 使用 `ext-apps` 的 `App` 类与 Host 通信
- 图片轮播使用原生 JS 实现

### `App` 类加载方式

客户端（Host）创建 iframe 时预注入 `ext-apps` 脚本：

```javascript
// Host 端
const extAppsScript = `<script type="module">
  import { App } from "/static/ext-apps/index.js";
  window.__MCP_APP__ = { App };
</script>`;
iframe.srcdoc = extAppsScript + htmlContent;
```

UI HTML 中 fallback 加载：

```html
<script type="module">
  let App;
  try {
    ({ App } = await import("@modelcontextprotocol/ext-apps"));
  } catch {
    App = window.__MCP_APP__?.App;
  }

  const app = new App({ name: "post-viewer", version: "1.0.0" });

  app.ontoolresult = (result) => {
    const post = JSON.parse(result.content[0].text);
    renderPost(post);
  };

  await app.connect();
</script>
```

### 轮播交互

- 左右箭头切换图片
- 底部指示器显示当前位置（1/5）
- 点击放大（可选，V2）
- "查看更多帖子"按钮调用 `app.callServerTool({ name: 'search_posts', ... })`

## 数据流

1. LLM/用户发起请求："查看帖子 xxx"
2. Agent Client 调用 `tools/list`，发现 `get_post` 有 `_meta.ui.resourceUri`
3. Agent Client 调用 `tools/call(get_post, {id: "xxx"})`
4. MCP Server 查询帖子详情 + 媒体列表，返回 JSON
5. Agent Client 收到 tool result + `_meta.ui.resourceUri`
6. Agent Client 调用 `resources/read(ui://scopai/post-viewer)`
7. MCP Server 返回 HTML 字符串
8. Agent Client 创建 iframe，预注入 `ext-apps` 脚本 + HTML
9. iframe 内 `App.connect()` → 接收 `ui/tool_result` → 渲染帖子 + 轮播

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 参数缺失（id 和 platform_post_id 都未提供） | Zod schema `.refine()` 自动返回 validation error |
| 帖子不存在 | Handler 内 `throw new Error('Post not found')`，McpServer 自动转为 error result |
| 媒体获取失败 | 返回帖子数据（`media_files: []`），UI 展示"无媒体" |
| UI iframe 加载失败 | 客户端降级：直接展示 `get_post` 返回的 JSON 文本 |
| `ext-apps` 脚本加载失败 | UI fallback 到 `window.__MCP_APP__`，再失败则展示原始 JSON |

## 兼容性

- **不支持 Apps 的客户端**：`get_post` 仍返回标准 JSON，`_meta.ui` 被忽略，功能完全正常
- **支持 Apps 但 iframe 渲染失败**：客户端降级为展示 JSON 文本
- **所有其他 tool**：不受影响，行为完全一致

## 测试策略

| 类型 | 内容 |
|------|------|
| API e2e（已有） | 验证 `/posts/:id/media` 正常工作 |
| MCP Server 单元测试 | 验证 `get_post` Zod schema 校验、参数互斥逻辑 |
| HTML UI 测试 | 浏览器中测试轮播交互、`App` 类初始化、fallback 逻辑 |
| 端到端 | 完整链路：daemon → MCP Server → mock client，验证 tool call → iframe 渲染 |

## 风险评估

| 风险 | 缓解措施 |
|------|---------|
| `ext-apps` 包未发布或 API 变化 | 优先使用 `McpServer` 原生 API，helper 作为可选层 |
| 重构引入 regression | 所有 123 个 API e2e 测试必须全部通过 |
| Zod schema 与 JSON schema 行为不一致 | 仔细对照现有参数验证逻辑，确保等价 |
| HTML UI 文件路径问题 | 使用 `__dirname` 解析绝对路径，支持开发/生产环境 |
