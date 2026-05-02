import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { config } from '@scopai/core';
import type { Comment, MediaFile, PromptTemplate, Strategy, Post } from '@scopai/core';
import { listMediaFilesByPost } from '@scopai/core';
import { getPlatformById } from '@scopai/core';
import { getCommentById } from '@scopai/core';

const client = new Anthropic({
  apiKey: config.anthropic.api_key,
  baseURL: config.anthropic.base_url,
});

// === OpenAI-compatible API client ===

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentBlock[];
}

interface OpenAIContentBlock {
  type: 'text' | 'image_url' | 'video_url';
  text?: string;
  image_url?: { url: string; detail?: string };
  video_url?: { url: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

async function callOpenAI(
  messages: OpenAIMessage[],
  tools: OpenAITool[],
  toolChoice: { type: 'function'; function: { name: string } },
): Promise<string> {
  let baseUrl = config.openai.base_url?.replace(/\/$/, '') || 'https://api.openai.com';
  // Append /v3 if base_url does not already include a version path
  if (!baseUrl.match(/\/v\d+$/)) {
    baseUrl += '/v3';
  }
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model: config.openai.model,
    max_tokens: config.openai.max_tokens,
    temperature: config.openai.temperature,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? toolChoice : undefined,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openai.api_key}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json() as OpenAIResponse;
  const choice = data.choices?.[0];

  // Prefer tool call result
  const toolCall = choice?.message?.tool_calls?.[0];
  if (toolCall) {
    return toolCall.function.arguments;
  }

  // Fallback to text content
  const content = choice?.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  return '';
}

function anthropicToolToOpenAI(tool: { name: string; description: string; input_schema: Record<string, unknown> }): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

// === Anthropic API client (existing) ===

async function callAnthropic(
  content: Anthropic.Messages.ContentBlockParam[],
  tools: Anthropic.Messages.Tool[],
): Promise<string> {
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? { type: 'tool', name: tools[0].name } : undefined,
    messages: [{ role: 'user', content }],
  });

  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse && 'input' in toolUse) {
    return JSON.stringify(toolUse.input);
  }

  const text = response.content.find(c => c.type === 'text');
  return text && 'text' in text ? text.text : '';
}

// === Unified LLM call ===

async function callLLM(
  promptText: string,
  mediaBlocks: Array<{ type: string; source: { type: 'base64'; media_type: string; data: string } }>,
  outputSchema: Record<string, unknown>,
): Promise<string> {
  const isOpenAI = config.api_format === 'openai';

  if (isOpenAI) {
    const content: OpenAIContentBlock[] = [{ type: 'text', text: promptText }];
    for (const m of mediaBlocks) {
      const isVideo = m.type === 'video';
      const url = `data:${m.source.media_type};base64,${m.source.data}`;
      if (isVideo) {
        content.push({ type: 'video_url', video_url: { url } });
      } else {
        content.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
      }
    }

    const tools: OpenAITool[] = [
      anthropicToolToOpenAI({
        name: 'output_analysis',
        description: 'Return the analysis result in the required JSON structure',
        input_schema: outputSchema,
      }),
    ];

    return callOpenAI(
      [{ role: 'user', content }],
      tools,
      { type: 'function', function: { name: 'output_analysis' } },
    );
  }

  // Anthropic format
  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'text', text: promptText },
  ];
  for (const m of mediaBlocks) {
    content.push(m as Anthropic.Messages.ContentBlockParam);
  }

  const tools: Anthropic.Messages.Tool[] = [
    {
      name: 'output_analysis',
      description: 'Return the analysis result in the required JSON structure',
      input_schema: outputSchema as any,
    },
  ];

  return callAnthropic(content, tools);
}

// === Exported functions ===

export async function analyzeComment(
  comment: Comment,
  platformName: string,
  template: PromptTemplate,
): Promise<string> {
  const prompt = fillTemplate(template.template, {
    content: comment.content,
    platform: platformName,
    published_at: comment.published_at?.toISOString() ?? '未知',
    author_name: comment.author_name ?? '匿名',
  });

  return callLLM(prompt, [], {});
}

export async function analyzeMedia(
  media: MediaFile,
  platformName: string,
  template: PromptTemplate,
): Promise<string> {
  const prompt = fillTemplate(template.template, {
    media_url: media.url,
    platform: platformName,
  });

  return callLLM(prompt, [], {});
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

export async function buildCommentPrompt(
  comment: Comment,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const platform = comment.platform_id ? await getPlatformById(comment.platform_id) : null;

  let parentAuthor = '';
  if (comment.parent_comment_id) {
    const parent = await getCommentById(comment.parent_comment_id);
    parentAuthor = parent?.author_name ?? '';
  }

  const vars: Record<string, string> = {
    content: comment.content ?? '',
    author_name: comment.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: comment.published_at?.toISOString() ?? '未知',
    depth: String(comment.depth ?? 0),
    parent_author: parentAuthor,
    reply_count: String(comment.reply_count ?? 0),
    media_urls: '',
    upstream_result: upstreamResult ? JSON.stringify(upstreamResult, null, 2) : '',
    original_content: strategy.include_original ? (comment.content ?? '') : '',
  };

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    result += `\n\n${schemaHint}`;
  }
  return result;
}

export async function analyzeWithStrategy(
  target: Post | Comment,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const isPost = 'post_id' in target;
  const promptText = isPost
    ? await buildStrategyPrompt(target as Post, strategy, upstreamResult)
    : await buildCommentPrompt(target as Comment, strategy, upstreamResult);

  // Build media blocks for upload
  const mediaBlocks: Array<{ type: string; source: { type: 'base64'; media_type: string; data: string } }> = [];

  if (isPost && strategy.needs_media?.enabled && strategy.needs_media.upload_images) {
    const mediaFiles = await listMediaFilesByPost((target as Post).id);
    const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
    for (const m of filtered) {
      const block = await buildMediaContentBlock(m);
      if (block) {
        mediaBlocks.push(block);
      }
    }
  }

  return callLLM(promptText, mediaBlocks, strategy.output_schema);
}

export async function analyzeBatchWithStrategy(
  comments: Comment[],
  strategy: Strategy,
): Promise<string> {
  const platform = comments[0]?.platform_id
    ? await getPlatformById(comments[0].platform_id)
    : null;

  const lines = comments.map((c, i) => {
    const parts = [
      `\n[评论 ${i + 1}]`,
      `作者: ${c.author_name ?? '匿名'}`,
      `内容: ${c.content ?? ''}`,
      `深度: ${c.depth ?? 0}`,
    ];
    if (c.parent_comment_id) {
      parts.push(`回复对象: ${c.author_name ?? ''}`);
    }
    return parts.join('\n');
  });

  const batchSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: strategy.output_schema,
        description: `分析结果数组，长度必须为 ${comments.length}，顺序与输入评论一致`,
      },
    },
    required: ['results'],
  };

  let prompt = `请分析以下 ${comments.length} 条评论，逐条返回分析结果。\n\n`;
  prompt += lines.join('\n');
  prompt += `\n\n请严格按以下 JSON 格式返回，results 数组长度必须为 ${comments.length}，顺序与上方评论编号一致：`;
  prompt += `\n${JSON.stringify({ results: [strategy.output_schema] }, null, 2)}`;
  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    prompt += `\n\n${schemaHint}`;
  }

  return callLLM(prompt, [], batchSchema);
}

export async function buildStrategyPrompt(
  target: Post,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const platform = target.platform_id ? await getPlatformById(target.platform_id) : null;
  const vars: Record<string, string> = {
    content: target.content ?? '',
    title: target.title ?? '',
    author_name: target.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: target.published_at?.toISOString() ?? '未知',
    tags: target.tags ? JSON.stringify(target.tags) : '',
    media_urls: '',
    upstream_result: upstreamResult ? JSON.stringify(upstreamResult, null, 2) : '',
    original_content: strategy.include_original ? (target.content ?? '') : '',
  };

  if (strategy.needs_media?.enabled) {
    const mediaFiles = await listMediaFilesByPost(target.id);
    const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
    if (filtered.length > 0) {
      const lines = filtered.map((m, i) => {
        const filePath = m.local_path ?? m.url ?? '';
        return `[媒体 ${i + 1}] ${filePath}`;
      });
      vars.media_urls = '\n' + lines.join('\n') + '\n';
    }
  }

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    result += `\n\n${schemaHint}`;
  }
  return result;
}

// === Media handling ===

async function buildMediaContentBlock(
  media: MediaFile,
): Promise<{ type: string; source: { type: 'base64'; media_type: string; data: string } } | null> {
  let filePath = media.local_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const mediaType = detectMediaType(filePath);
  if (!mediaType) {
    return null;
  }

  // Compress video if too large
  const isVideo = mediaType.startsWith('video/');
  const stats = fs.statSync(filePath);
  const maxSize = 20 * 1024 * 1024;

  if (isVideo && stats.size > maxSize) {
    const compressed = await compressVideo(filePath);
    if (compressed) {
      filePath = compressed;
    } else {
      return null;
    }
  }

  try {
    const data = fs.readFileSync(filePath);
    const base64 = data.toString('base64');
    const blockType = isVideo ? 'video' : 'image';
    return {
      type: blockType,
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    };
  } catch {
    return null;
  }
}

async function compressVideo(inputPath: string): Promise<string | null> {
  const tmpDir = path.dirname(inputPath);
  const basename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(tmpDir, `${basename}_compressed.mp4`);

  // Check if already compressed
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    if (stats.size < 10 * 1024 * 1024) {
      return outputPath;
    }
  }

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-vf', 'scale=360:-2',
      '-c:v', 'libx264',
      '-crf', '32',
      '-preset', 'fast',
      '-an',
      '-y',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size < 10 * 1024 * 1024) {
          resolve(outputPath);
          return;
        }
      }
      resolve(null);
    });

    ffmpeg.on('error', () => {
      resolve(null);
    });
  });
}

function detectMediaType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.avi':
      return 'video/x-msvideo';
    case '.mkv':
      return 'video/x-matroska';
    default:
      return null;
  }
}

// === Schema helpers ===

function buildSchemaHint(outputSchema: Record<string, unknown>): string | null {
  if (typeof outputSchema !== 'object' || outputSchema === null) return null;
  const properties = (outputSchema.properties || {}) as Record<string, Record<string, unknown>>;
  const keys = Object.keys(properties);
  if (keys.length === 0) return null;

  const lines = keys.map(key => {
    const def = properties[key];
    const title = (def?.title as string) || key;
    return `  "${key}": ${schemaDefToHint(def)}  // ${title}`;
  });
  const example = `{\n${lines.join(',\n')}\n}`;

  const titleLines = keys.map(key => {
    const def = properties[key];
    const title = (def?.title as string) || key;
    const desc = (def?.description as string) || '';
    return `  - ${key}: ${title}${desc ? ' — ' + desc : ''}`;
  });

  return `=== 输出要求 ===\n请严格按以下 JSON 格式返回结果，只输出纯 JSON，不要添加 markdown 代码块标记或额外解释。字段含义如下：\n${titleLines.join('\n')}\n\n示例格式：\n${example}`;
}

function schemaDefToHint(def: Record<string, unknown>): string {
  if (typeof def !== 'object' || def === null) return 'any';
  const type = def.type as string | undefined;
  const enumValues = def.enum as unknown[] | undefined;
  const items = def.items as Record<string, unknown> | undefined;
  const props = def.properties as Record<string, Record<string, unknown>> | undefined;

  if (enumValues && enumValues.length > 0) {
    return enumValues.map(v => JSON.stringify(v)).join(' | ');
  }

  if (type === 'array' && items) {
    return `[${schemaDefToHint(items)}]`;
  }

  if (type === 'object' && props && Object.keys(props).length > 0) {
    const lines = Object.keys(props).map(k => `    "${k}": ${schemaDefToHint(props[k])}`);
    return `{\n${lines.join(',\n')}\n  }`;
  }

  if (type) return type;
  return 'any';
}

function filterMediaFiles(mediaFiles: MediaFile[], cfg: { media_types?: string[]; max_media?: number; mode?: string }): MediaFile[] {
  let result = mediaFiles;
  if (cfg.media_types && cfg.media_types.length > 0) {
    result = result.filter(m => cfg.media_types!.includes(m.media_type));
  }
  if (cfg.mode === 'best_quality') {
    result = result
      .filter(m => m.width && m.height)
      .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));
  }
  if (cfg.max_media && cfg.max_media > 0) {
    result = result.slice(0, cfg.max_media);
  }
  return result;
}
