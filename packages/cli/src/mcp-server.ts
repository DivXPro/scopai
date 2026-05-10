import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { apiGet, apiPost } from './api-client';

const TOOLS = [
  {
    name: 'list_posts',
    description: 'List imported posts with optional filters (platform, author_id, starred, label)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', description: 'Filter by platform ID' },
        author_id: { type: 'string', description: 'Filter by author ID' },
        starred: { type: 'boolean', description: 'Only show starred posts' },
        label: { type: 'string', description: 'Filter by label name' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
        offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
      },
    },
  },
  {
    name: 'search_posts',
    description: 'Search posts by keyword query',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', description: 'Platform ID (required)' },
        query: { type: 'string', description: 'Search query text (required)' },
        author_id: { type: 'string', description: 'Filter by author ID' },
        starred: { type: 'boolean', description: 'Only show starred posts' },
        label: { type: 'string', description: 'Filter by label name' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
      required: ['platform', 'query'],
    },
  },
  {
    name: 'get_post',
    description: 'Get detailed information about a specific post',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Post ID (required)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List analysis tasks with optional filters',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status (pending/running/paused/completed/failed)' },
        query: { type: 'string', description: 'Search by task name' },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Get detailed status and progress of a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Task ID (required)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new analysis task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Task name (required)' },
        description: { type: 'string', description: 'Task description' },
        cli_templates: {
          type: 'object',
          description: 'OpenCLI command templates as a JSON object, e.g. {"fetch_note":"opencli xiaohongshu note {url} -f json"}',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_task_posts',
    description: 'Add posts to an existing task for analysis',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID (required)' },
        post_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of post IDs to add (required)',
        },
      },
      required: ['task_id', 'post_ids'],
    },
  },
  {
    name: 'add_task_step',
    description: 'Add an analysis strategy step to a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID (required)' },
        strategy_id: { type: 'string', description: 'Strategy ID (required)' },
        name: { type: 'string', description: 'Step name (optional, defaults to strategy name)' },
        order: { type: 'number', description: 'Step order (optional, auto-incremented if omitted)' },
        depends_on_step_id: { type: 'string', description: 'Upstream step ID for secondary strategies' },
      },
      required: ['task_id', 'strategy_id'],
    },
  },
  {
    name: 'run_task_prepare',
    description: 'Prepare task data by fetching post details, comments, and media via opencli',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID (required)' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'run_task_analysis',
    description: 'Run all pending/failed analysis steps for a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID (required)' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_strategies',
    description: 'List all available analysis strategies',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_creators',
    description: 'List subscribed creators with optional filters',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', description: 'Filter by platform ID' },
        status: { type: 'string', description: 'Filter by status (active/paused/unsubscribed)' },
        name: { type: 'string', description: 'Filter by author name (partial match)' },
      },
    },
  },
  {
    name: 'get_task_results',
    description: 'Get analysis results for a completed task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID (required)' },
        strategy_id: { type: 'string', description: 'Strategy ID (auto-detected from task steps if omitted)' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_queue_jobs',
    description: 'List queue jobs for a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID (required)' },
        failed_only: { type: 'boolean', description: 'Show only failed jobs' },
        limit: { type: 'number', description: 'Max jobs to show (default: 20)' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'retry_failed_jobs',
    description: 'Retry failed queue jobs for a task or all tasks',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Limit retries to a specific task (optional)' },
      },
    },
  },
];

function makeTextResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'scopai', version: '1.3.29' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_posts': {
          const params = new URLSearchParams();
          const a = (args ?? {}) as Record<string, unknown>;
          if (a.platform) params.set('platform', String(a.platform));
          if (a.author_id) params.set('author_id', String(a.author_id));
          if (a.starred) params.set('starred', 'true');
          if (a.label) params.set('label', String(a.label));
          if (a.limit) params.set('limit', String(a.limit));
          if (a.offset) params.set('offset', String(a.offset));
          const result = await apiGet('/posts?' + params.toString());
          return makeTextResult(result);
        }

        case 'search_posts': {
          const a = args as Record<string, unknown>;
          const params = new URLSearchParams();
          params.set('query', String(a.query));
          params.set('platform', String(a.platform));
          if (a.author_id) params.set('author_id', String(a.author_id));
          if (a.starred) params.set('starred', 'true');
          if (a.label) params.set('label', String(a.label));
          if (a.limit) params.set('limit', String(a.limit));
          const result = await apiGet('/posts?' + params.toString());
          return makeTextResult(result);
        }

        case 'get_post': {
          const a = args as Record<string, unknown>;
          const result = await apiGet(`/posts/${a.id}`);
          return makeTextResult(result);
        }

        case 'list_tasks': {
          const params = new URLSearchParams();
          const a = (args ?? {}) as Record<string, unknown>;
          if (a.status) params.set('status', String(a.status));
          if (a.query) params.set('query', String(a.query));
          const result = await apiGet('/tasks?' + params.toString());
          return makeTextResult(result);
        }

        case 'get_task': {
          const a = args as Record<string, unknown>;
          const result = await apiGet(`/tasks/${a.id}`);
          return makeTextResult(result);
        }

        case 'create_task': {
          const a = args as Record<string, unknown>;
          const { generateId } = await import('@scopai/core');
          const body: Record<string, unknown> = {
            id: generateId(),
            name: a.name,
            description: a.description ?? null,
          };
          if (a.cli_templates) {
            body.cli_templates = typeof a.cli_templates === 'string'
              ? a.cli_templates
              : JSON.stringify(a.cli_templates);
          } else {
            body.cli_templates = null;
          }
          const result = await apiPost('/tasks', body);
          return makeTextResult(result);
        }

        case 'add_task_posts': {
          const a = args as Record<string, unknown>;
          const postIds = Array.isArray(a.post_ids) ? a.post_ids : [a.post_ids];
          const result = await apiPost(`/tasks/${a.task_id}/add-posts`, { post_ids: postIds });
          return makeTextResult(result);
        }

        case 'add_task_step': {
          const a = args as Record<string, unknown>;
          const body: Record<string, unknown> = { strategy_id: a.strategy_id };
          if (a.name) body.name = a.name;
          if (a.order) body.order = Number(a.order);
          if (a.depends_on_step_id) body.depends_on_step_id = a.depends_on_step_id;
          const result = await apiPost(`/tasks/${a.task_id}/steps`, body);
          return makeTextResult(result);
        }

        case 'run_task_prepare': {
          const a = args as Record<string, unknown>;
          const result = await apiPost(`/tasks/${a.task_id}/prepare-data`);
          return makeTextResult(result);
        }

        case 'run_task_analysis': {
          const a = args as Record<string, unknown>;
          const result = await apiPost(`/tasks/${a.task_id}/run-all-steps`);
          return makeTextResult(result);
        }

        case 'list_strategies': {
          const result = await apiGet('/strategies');
          return makeTextResult(result);
        }

        case 'list_creators': {
          const params = new URLSearchParams();
          const a = (args ?? {}) as Record<string, unknown>;
          if (a.platform) params.set('platform', String(a.platform));
          if (a.status) params.set('status', String(a.status));
          if (a.name) params.set('name', String(a.name));
          const result = await apiGet('/creators?' + params.toString());
          return makeTextResult(result);
        }

        case 'get_task_results': {
          const a = args as Record<string, unknown>;
          let strategyId = a.strategy_id as string | undefined;
          if (!strategyId) {
            const task = await apiGet<any>(`/tasks/${a.task_id}`);
            const steps = task.phases?.steps ?? task.steps ?? [];
            const ids = steps
              .map((s: any) => s.strategyId ?? s.strategy_id)
              .filter(Boolean);
            if (ids.length === 0) {
              return makeTextResult({ error: 'No strategy steps found. Use strategy_id parameter.' });
            }
            const results: Record<string, unknown> = {};
            for (const sid of ids) {
              const r = await apiGet(`/tasks/${a.task_id}/results?strategy_id=${sid}`);
              results[sid] = r;
            }
            return makeTextResult(results);
          }
          const result = await apiGet(`/tasks/${a.task_id}/results?strategy_id=${strategyId}`);
          return makeTextResult(result);
        }

        case 'list_queue_jobs': {
          const a = args as Record<string, unknown>;
          const params = new URLSearchParams();
          params.set('task_id', String(a.task_id));
          if (a.failed_only) params.set('status', 'failed');
          params.set('limit', String(a.limit ?? 20));
          const result = await apiGet('/queue?' + params.toString());
          return makeTextResult(result);
        }

        case 'retry_failed_jobs': {
          const a = (args ?? {}) as Record<string, unknown>;
          const result = await apiPost('/queue/retry', { task_id: a.task_id ?? null });
          return makeTextResult(result);
        }

        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
