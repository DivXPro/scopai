import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { Comment, MediaFile, PromptTemplate, Strategy, Post } from '../shared/types';
import { listMediaFilesByPost } from '../db/media-files';
import { getPlatformById } from '../db/platforms';
import { getCommentById } from '../db/comments';

const client = new Anthropic({
  apiKey: config.anthropic.api_key,
  baseURL: config.anthropic.base_url,
});

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

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
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

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

export async function buildCommentPrompt(comment: Comment, strategy: Strategy): Promise<string> {
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
): Promise<string> {
  const prompt = 'post_id' in target
    ? await buildCommentPrompt(target, strategy)
    : await buildStrategyPrompt(target, strategy);

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: [
      {
        name: 'output_analysis',
        description: 'Return the analysis result in the required JSON structure',
        input_schema: strategy.output_schema as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'output_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse && 'input' in toolUse) {
    return JSON.stringify(toolUse.input);
  }

  // fallback to text response if model did not use tool
  const text = response.content.find(c => c.type === 'text');
  return text && 'text' in text ? text.text : '';
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

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: [
      {
        name: 'output_analysis',
        description: 'Return batch analysis results as an array',
        input_schema: batchSchema as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'output_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse && 'input' in toolUse) {
    return JSON.stringify(toolUse.input);
  }
  const text = response.content.find(c => c.type === 'text');
  return text && 'text' in text ? text.text : '';
}

export async function buildStrategyPrompt(target: Post, strategy: Strategy): Promise<string> {
  const platform = target.platform_id ? await getPlatformById(target.platform_id) : null;
  const vars: Record<string, string> = {
    content: target.content ?? '',
    title: target.title ?? '',
    author_name: target.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: target.published_at?.toISOString() ?? '未知',
    tags: target.tags ? JSON.stringify(target.tags) : '',
    media_urls: '',
  };

  if (strategy.needs_media?.enabled) {
    const mediaFiles = await listMediaFilesByPost(target.id);
    const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
    if (filtered.length > 0) {
      const lines = filtered.map((m, i) => {
        const path = m.local_path ?? m.url ?? '';
        return `[媒体 ${i + 1}] ${path}`;
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

function buildSchemaHint(outputSchema: Record<string, unknown>): string | null {
  if (typeof outputSchema !== 'object' || outputSchema === null) return null;
  const properties = (outputSchema.properties || {}) as Record<string, Record<string, unknown>>;
  const keys = Object.keys(properties);
  if (keys.length === 0) return null;

  const lines = keys.map(key => `  "${key}": ${schemaDefToHint(properties[key])}`);
  const example = `{\n${lines.join(',\n')}\n}`;

  return `=== 输出要求 ===\n请严格按以下 JSON 格式返回结果，只输出纯 JSON，不要添加 markdown 代码块标记或额外解释：\n${example}`;
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

function filterMediaFiles(mediaFiles: MediaFile[], config: { media_types?: string[]; max_media?: number; mode?: string }): MediaFile[] {
  let result = mediaFiles;
  if (config.media_types && config.media_types.length > 0) {
    result = result.filter(m => config.media_types!.includes(m.media_type));
  }
  if (config.mode === 'best_quality') {
    result = result
      .filter(m => m.width && m.height)
      .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));
  }
  if (config.max_media && config.max_media > 0) {
    result = result.slice(0, config.max_media);
  }
  return result;
}
