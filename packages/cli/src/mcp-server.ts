import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
declare const __dirname: string;
import { apiGet, apiPost, getApiBaseUrl } from './api-client';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE }
  from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

function makeTextResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'scopai', version: '1.3.29' },
  );

  // === Tools will be registered below ===

  server.registerTool('list_posts', {
    description: 'List imported posts with optional filters (platform, author_id, starred, label)',
    inputSchema: z.object({
      platform: z.string().optional().describe('Filter by platform ID'),
      author_id: z.string().optional().describe('Filter by author ID'),
      starred: z.boolean().optional().describe('Only show starred posts'),
      label: z.string().optional().describe('Filter by label name'),
      limit: z.number().optional().describe('Max results (default: 50)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
  }, async (args) => {
    const params = new URLSearchParams();
    if (args.platform) params.set('platform', args.platform);
    if (args.author_id) params.set('author_id', args.author_id);
    if (args.starred) params.set('starred', 'true');
    if (args.label) params.set('label', args.label);
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.offset !== undefined) params.set('offset', String(args.offset));
    const result = await apiGet('/posts?' + params.toString());
    return makeTextResult(result);
  });

  server.registerTool('search_posts', {
    description: 'Search posts by keyword query or natural language concept. When query is provided, uses full-text search across post content and analysis results.',
    inputSchema: z.object({
      query: z.string().optional().describe('Natural language search query (e.g. "高级感美妆产品首图")'),
      platform: z.string().optional().describe('Filter by platform ID'),
      author_id: z.string().optional().describe('Filter by author ID'),
      starred: z.boolean().optional().describe('Only show starred posts'),
      label: z.string().optional().describe('Filter by label name'),
      limit: z.number().optional().describe('Max results (default: 50 for list, 5 for search)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
  }, async (args) => {
    // If query is provided, use full-text search
    if (args.query) {
      const params = new URLSearchParams();
      params.set('query', args.query);
      params.set('limit', String(args.limit ?? 5));
      const result = await apiGet('/search?' + params.toString());
      return makeTextResult(result);
    }

    // Otherwise fall back to list/filter
    const params = new URLSearchParams();
    if (args.platform) params.set('platform', args.platform);
    if (args.author_id) params.set('author_id', args.author_id);
    if (args.starred) params.set('starred', 'true');
    if (args.label) params.set('label', args.label);
    params.set('limit', String(args.limit ?? 50));
    if (args.offset !== undefined) params.set('offset', String(args.offset));
    const result = await apiGet('/posts?' + params.toString());
    return makeTextResult(result);
  });

  server.registerTool('list_tasks', {
    description: 'List analysis tasks with optional filters',
    inputSchema: z.object({
      status: z.string().optional().describe('Filter by status (pending/running/paused/completed/failed)'),
      query: z.string().optional().describe('Search by task name'),
      limit: z.number().optional().describe('Max results (default: 50)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
  }, async (args) => {
    const params = new URLSearchParams();
    if (args.status) params.set('status', args.status);
    if (args.query) params.set('query', args.query);
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.offset !== undefined) params.set('offset', String(args.offset));
    const result = await apiGet('/tasks?' + params.toString());
    return makeTextResult(result);
  });

  server.registerTool('get_task', {
    description: 'Get detailed status and progress of a task',
    inputSchema: z.object({
      id: z.string().describe('Task ID (required)'),
    }),
  }, async (args) => {
    const result = await apiGet(`/tasks/${args.id}`);
    return makeTextResult(result);
  });

  server.registerTool('list_strategies', {
    description: 'List all available analysis strategies',
    inputSchema: z.object({}),
  }, async () => {
    const result = await apiGet('/strategies');
    return makeTextResult(result);
  });

  server.registerTool('list_creators', {
    description: 'List subscribed creators with optional filters',
    inputSchema: z.object({
      platform: z.string().optional().describe('Filter by platform ID'),
      status: z.string().optional().describe('Filter by status (active/paused/unsubscribed)'),
      name: z.string().optional().describe('Filter by author name (partial match)'),
      limit: z.number().optional().describe('Max results (default: 50)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
  }, async (args) => {
    const params = new URLSearchParams();
    if (args.platform) params.set('platform', args.platform);
    if (args.status) params.set('status', args.status);
    if (args.name) params.set('name', args.name);
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.offset !== undefined) params.set('offset', String(args.offset));
    const result = await apiGet('/creators?' + params.toString());
    return makeTextResult(result);
  });

  server.registerTool('get_task_results', {
    description: 'Get analysis results for a completed task',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID (required)'),
      strategy_id: z.string().optional().describe('Strategy ID (auto-detected from task steps if omitted)'),
      limit: z.number().optional().describe('Max results (default: 100)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
  }, async (args) => {
    const limit = args.limit !== undefined ? `&limit=${args.limit}` : '';
    const offset = args.offset !== undefined ? `&offset=${args.offset}` : '';

    if (!args.strategy_id) {
      const task = await apiGet<any>(`/tasks/${args.task_id}`);
      const steps = task.phases?.steps ?? task.steps ?? [];
      const ids = steps
        .map((s: any) => s.strategyId ?? s.strategy_id)
        .filter(Boolean);
      if (ids.length === 0) {
        return makeTextResult({ error: 'No strategy steps found. Use strategy_id parameter.' });
      }
      const results: Record<string, unknown> = {};
      for (const sid of ids) {
        const r = await apiGet(`/tasks/${args.task_id}/results?strategy_id=${sid}${limit}${offset}`);
        results[sid] = r;
      }
      return makeTextResult(results);
    }

    const result = await apiGet(`/tasks/${args.task_id}/results?strategy_id=${args.strategy_id}${limit}${offset}`);
    return makeTextResult(result);
  });

  server.registerTool('list_queue_jobs', {
    description: 'List queue jobs for a task',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID (required)'),
      failed_only: z.boolean().optional().describe('Show only failed jobs'),
      limit: z.number().optional().describe('Max jobs to show (default: 20)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
  }, async (args) => {
    const params = new URLSearchParams();
    params.set('task_id', args.task_id);
    if (args.failed_only) params.set('status', 'failed');
    params.set('limit', String(args.limit ?? 20));
    if (args.offset !== undefined) params.set('offset', String(args.offset));
    const result = await apiGet('/queue?' + params.toString());
    return makeTextResult(result);
  });

  server.registerTool('retry_failed_jobs', {
    description: 'Retry failed queue jobs for a task or all tasks',
    inputSchema: z.object({
      task_id: z.string().optional().describe('Limit retries to a specific task (optional)'),
    }),
  }, async (args) => {
    const result = await apiPost('/queue/retry', { task_id: args.task_id ?? null });
    return makeTextResult(result);
  });

  server.registerTool('create_task', {
    description: 'Create a new analysis task',
    inputSchema: z.object({
      name: z.string().describe('Task name (required)'),
      description: z.string().optional().describe('Task description'),
      cli_templates: z.record(z.string()).optional().describe(
        'OpenCLI command templates as a JSON object, e.g. {"fetch_note":"opencli xiaohongshu note {url} -f json"}'
      ),
    }),
  }, async (args) => {
    const { generateId } = await import('@scopai/core');
    const body: Record<string, unknown> = {
      id: generateId(),
      name: args.name,
      description: args.description ?? null,
    };
    if (args.cli_templates) {
      body.cli_templates = JSON.stringify(args.cli_templates);
    } else {
      body.cli_templates = null;
    }
    const result = await apiPost('/tasks', body);
    return makeTextResult(result);
  });

  server.registerTool('add_task_posts', {
    description: 'Add posts to an existing task for analysis',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID (required)'),
      post_ids: z.array(z.string()).describe('Array of post IDs to add (required)'),
    }),
  }, async (args) => {
    const result = await apiPost(`/tasks/${args.task_id}/add-posts`, {
      post_ids: args.post_ids,
    });
    return makeTextResult(result);
  });

  server.registerTool('add_task_step', {
    description: 'Add an analysis strategy step to a task',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID (required)'),
      strategy_id: z.string().describe('Strategy ID (required)'),
      name: z.string().optional().describe('Step name (optional, defaults to strategy name)'),
      order: z.number().optional().describe('Step order (optional, auto-incremented if omitted)'),
    }),
  }, async (args) => {
    const body: Record<string, unknown> = { strategy_id: args.strategy_id };
    if (args.name) body.name = args.name;
    if (args.order !== undefined) body.order = args.order;
    const result = await apiPost(`/tasks/${args.task_id}/steps`, body);
    return makeTextResult(result);
  });

  server.registerTool('run_task_prepare', {
    description: 'Prepare task data by fetching post details, comments, and media via opencli',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID (required)'),
    }),
  }, async (args) => {
    const result = await apiPost(`/tasks/${args.task_id}/prepare-data`);
    return makeTextResult(result);
  });

  server.registerTool('run_task_analysis', {
    description: 'Run all pending/failed analysis steps for a task',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID (required)'),
    }),
  }, async (args) => {
    const result = await apiPost(`/tasks/${args.task_id}/run-all-steps`);
    return makeTextResult(result);
  });

  registerAppTool(server, 'get_post', {
    description: 'Get detailed information about a specific post by internal ID or platform post ID',
    inputSchema: z.object({
      id: z.string().optional().describe('Internal post ID'),
      platform_post_id: z.string().optional().describe('Original platform post ID (e.g. xiaohongshu note ID)'),
      platform: z.string().optional().describe('Platform ID (required when using platform_post_id)'),
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
      if (!args.platform) {
        throw new Error('platform is required when using platform_post_id');
      }
      const params = new URLSearchParams();
      params.set('platform_post_id', args.platform_post_id);
      params.set('platform', args.platform);
      const result = await apiGet<{ posts?: Array<{ id: string } & Record<string, unknown>> }>(
        '/posts?' + params.toString()
      );
      if (!result.posts || result.posts.length === 0) {
        throw new Error('Post not found');
      }
      post = result.posts[0];
    } else if (args.id) {
      post = await apiGet<{ id: string } & Record<string, unknown>>(`/posts/${args.id}`);
    } else {
      throw new Error('Provide either id or platform_post_id');
    }

    // Fetch media files and convert relative src to absolute URLs
    const media = await apiGet<Array<{ src?: string; url?: string; media_type?: string; description?: string }>>(
      `/posts/${post.id}/media`
    );
    const baseUrl = getApiBaseUrl();
    const absoluteMedia = media.map((m) => ({
      ...m,
      src: m.src && m.src.startsWith('/') ? `${baseUrl}${m.src}` : m.src,
    }));
    const enrichedPost = { ...post, media_files: absoluteMedia };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(enrichedPost) }],
      _meta: {
        ui: {
          resourceUri: 'ui://scopai/post-viewer',
          visibility: ['model', 'app'],
        },
      },
    };
  });

  server.registerTool('get_post_reference', {
    description: 'Get structured creative reference card for a post. Includes copy deconstruction, visual style, topic angle analysis if available.',
    inputSchema: z.object({
      post_id: z.string().describe('Post ID (required)'),
    }),
  }, async (args) => {
    const result = await apiGet(`/posts/${args.post_id}/reference`);
    return makeTextResult(result);
  });

  server.registerTool('generate_creative_brief', {
    description: 'Generate a creative brief based on multiple reference posts. Creates a task with creative analysis steps and runs them. Returns task_id for polling.',
    inputSchema: z.object({
      post_ids: z.array(z.string()).describe('Array of post IDs to use as references (required)'),
      brief_type: z.enum(['短视频脚本', '产品图方案', '种草文案', '通用']).optional().describe('Brief type (default: 通用)'),
      requirements: z.string().optional().describe('Additional creative requirements'),
    }),
  }, async (args) => {
    const { generateId } = await import('@scopai/core');

    // 1. Create task
    const taskId = generateId();
    const taskResult = await apiPost('/tasks', {
      id: taskId,
      name: `创作简报: ${args.brief_type ?? '通用'}`,
      description: args.requirements ?? null,
    });

    // 2. Add posts to task
    await apiPost(`/tasks/${taskId}/add-posts`, {
      post_ids: args.post_ids,
    });

    // 3. Add creative analysis steps
    const stepConfigs = [
      { strategy_id: 'creative-copy-deconstruct', name: '文案解构' },
      { strategy_id: 'creative-visual-style', name: '视觉风格' },
      { strategy_id: 'creative-topic-angle', name: '话题角度' },
    ];

    for (const config of stepConfigs) {
      await apiPost(`/tasks/${taskId}/steps`, {
        strategy_id: config.strategy_id,
        name: config.name,
      });
    }

    // 4. Run all steps
    await apiPost(`/tasks/${taskId}/run-all-steps`);

    return makeTextResult({
      task_id: taskId,
      status: 'running',
      message: 'Creative brief task created and running. Use get_task to poll for completion.',
      post_count: args.post_ids.length,
    });
  });

  registerAppResource(
    server,
    'post-viewer',
    'ui://scopai/post-viewer',
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const htmlPath = path.join(__dirname, 'mcp-ui', 'post-viewer.html');
      const html = await fs.promises.readFile(htmlPath, 'utf-8');
      const baseUrl = getApiBaseUrl();
      return {
        contents: [{
          uri: 'ui://scopai/post-viewer',
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              csp: {
                resourceDomains: [baseUrl],
              },
            },
          },
        }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
