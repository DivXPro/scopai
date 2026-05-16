import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { promisify } from "util";
import { config } from "@scopai/core";
import type { Comment, MediaFile, Strategy, Post } from "@scopai/core";
import { listMediaFilesByPost } from "@scopai/core";
import { getPlatformById } from "@scopai/core";
import { getCommentById } from "@scopai/core";
import { getCachedMediaBlocks, setCachedMediaBlocks } from "./media-cache";

const client = new Anthropic({
  apiKey: config.anthropic.api_key,
  baseURL: config.anthropic.base_url,
});

// === OpenAI-compatible API client ===

const openai = new OpenAI({
  apiKey: config.openai.api_key,
  baseURL: config.openai.base_url,
});

interface OpenAIMessage {
  role: "user" | "assistant" | "system";
  content: string | OpenAIContentBlock[];
}

interface OpenAIContentBlock {
  type: "text" | "image_url" | "video_url";
  text?: string;
  image_url?: { url: string; detail?: string };
  video_url?: { url: string };
}

async function callOpenAI(
  messages: OpenAIMessage[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  toolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption,
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.openai.model,
    max_tokens: config.openai.max_tokens,
    temperature: config.openai.temperature,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? toolChoice : undefined,
  });

  // Prefer tool call result
  const msg = response.choices[0]?.message;
  if (msg?.tool_calls && msg.tool_calls.length > 0) {
    return msg.tool_calls[0].function.arguments;
  }

  // Fallback to text content
  return msg?.content ?? "";
}

function anthropicToolToOpenAI(tool: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as Record<string, unknown>,
    },
  };
}

// === Anthropic API client (existing) ===

async function callAnthropic(
  content: Anthropic.Messages.ContentBlockParam[],
  tools: Anthropic.Messages.Tool[],
  useCache: boolean = false,
): Promise<string> {
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice:
      tools.length > 0 ? { type: "tool", name: tools[0].name } : undefined,
    messages: [{ role: "user", content }],
    extraHeaders: useCache
      ? { "anthropic-beta": "prompt-caching-2024-07-31" }
      : undefined,
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (toolUse && "input" in toolUse) {
    return JSON.stringify(toolUse.input);
  }

  const text = response.content.find((c) => c.type === "text");
  return text && "text" in text ? text.text : "";
}

// === Unified LLM call ===

async function callLLM(
  promptText: string,
  mediaBlocks: Array<{
    type: string;
    source: { type: "base64"; media_type: string; data: string };
  }>,
  outputSchema: Record<string, unknown>,
  options: { useCache?: boolean } = {},
): Promise<string> {
  const isOpenAI = config.api_format === "openai";

  if (isOpenAI) {
    const content: OpenAIContentBlock[] = [{ type: "text", text: promptText }];
    for (const m of mediaBlocks) {
      const isVideo = m.type === "video";
      const url = `data:${m.source.media_type};base64,${m.source.data}`;
      if (isVideo) {
        content.push({ type: "video_url", video_url: { url } });
      } else {
        content.push({ type: "image_url", image_url: { url, detail: "auto" } });
      }
    }

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      anthropicToolToOpenAI({
        name: "output_analysis",
        description:
          "Return the analysis result in the required JSON structure",
        input_schema: outputSchema,
      }),
    ];

    return callOpenAI([{ role: "user", content }], tools, {
      type: "function",
      function: { name: "output_analysis" },
    });
  }

  // Anthropic format with optional prompt caching
  // Note: Anthropic Messages API does not support video content blocks.
  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: promptText },
  ];
  for (const m of mediaBlocks) {
    if (m.type === "video") {
      console.warn(
        `[callLLM] Skipping video block for Anthropic API (not supported), media_type=${m.source.media_type}`,
      );
      continue;
    }
    content.push({
      ...m,
      cache_control: options.useCache ? { type: "ephemeral" } : undefined,
    } as Anthropic.Messages.ContentBlockParam);
  }

  // Append a cache breakpoint after media blocks so that
  // subsequent requests with the same prefix can hit the cache.
  if (options.useCache && mediaBlocks.length > 0) {
    content.push({
      type: "text",
      text: "[media-end]",
      cache_control: { type: "ephemeral" },
    } as Anthropic.Messages.ContentBlockParam);
  }

  console.log(
    `[callLLM] Sending ${content.length} content blocks (${mediaBlocks.length} media, cache=${options.useCache ?? false}) to LLM, model=${config.anthropic.model ?? "default"}`,
  );

  const tools: Anthropic.Messages.Tool[] = [
    {
      name: "output_analysis",
      description: "Return the analysis result in the required JSON structure",
      input_schema: outputSchema as any,
    },
  ];

  return callAnthropic(content, tools, options.useCache);
}

// === Exported functions ===

export async function buildCommentPrompt(
  comment: Comment,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const platform = comment.platform_id
    ? await getPlatformById(comment.platform_id)
    : null;

  let parentAuthor = "";
  if (comment.parent_comment_id) {
    const parent = await getCommentById(comment.parent_comment_id);
    parentAuthor = parent?.author_name ?? "";
  }

  const vars: Record<string, string> = {
    content: comment.content ?? "",
    author_name: comment.author_name ?? "匿名",
    platform: platform?.name ?? "unknown",
    published_at: comment.published_at?.toISOString() ?? "未知",
    depth: String(comment.depth ?? 0),
    parent_author: parentAuthor,
    reply_count: String(comment.reply_count ?? 0),
    media_urls: "",
    upstream_result: upstreamResult
      ? JSON.stringify(upstreamResult, null, 2)
      : "",
    original_content: strategy.include_original ? (comment.content ?? "") : "",
  };

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
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
  const isPost = strategy.target === "post";
  const promptText = isPost
    ? await buildStrategyPrompt(target as Post, strategy, upstreamResult)
    : await buildCommentPrompt(target as Comment, strategy, upstreamResult);

  // Build media blocks for upload
  const mediaBlocks: Array<{
    type: string;
    source: { type: "base64"; media_type: string; data: string };
  }> = [];
  let useCache = false;

  if (isPost && strategy.needs_media?.enabled) {
    const postId = (target as Post).id;

    // Try local cache first (same post, multiple strategies within cache TTL)
    const cached = getCachedMediaBlocks(postId);
    if (cached) {
      mediaBlocks.push(...cached);
      useCache = true;
      console.log(
        `[analyzeWithStrategy] Post ${postId}: using ${cached.length} cached media blocks`,
      );
    } else {
      const mediaFiles = await listMediaFilesByPost(postId);
      const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
      for (const m of filtered) {
        const block = await buildMediaContentBlock(m);
        if (block) {
          mediaBlocks.push(block);
        }
      }
      // Cache for subsequent strategies on the same post
      if (mediaBlocks.length > 0) {
        setCachedMediaBlocks(postId, mediaBlocks);
        useCache = true;
      }
      console.log(
        `[analyzeWithStrategy] Post ${postId}: ${mediaFiles.length} media files, ${filtered.length} filtered, ${mediaBlocks.length} blocks built (cached)`,
      );
    }
  }

  return callLLM(promptText, mediaBlocks, strategy.output_schema, { useCache });
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
      `作者: ${c.author_name ?? "匿名"}`,
      `内容: ${c.content ?? ""}`,
      `深度: ${c.depth ?? 0}`,
    ];
    if (c.parent_comment_id) {
      parts.push(`回复对象: ${c.author_name ?? ""}`);
    }
    return parts.join("\n");
  });

  const batchSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: strategy.output_schema,
        description: `分析结果数组，长度必须为 ${comments.length}，顺序与输入评论一致`,
      },
    },
    required: ["results"],
  };

  let prompt = `请分析以下 ${comments.length} 条评论，逐条返回分析结果。\n\n`;
  prompt += lines.join("\n");
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
  const platform = target.platform_id
    ? await getPlatformById(target.platform_id)
    : null;
  const vars: Record<string, string> = {
    content: target.content ?? "",
    title: target.title ?? "",
    author_name: target.author_name ?? "匿名",
    platform: platform?.name ?? "unknown",
    published_at: target.published_at?.toISOString() ?? "未知",
    tags: target.tags ? JSON.stringify(target.tags) : "",
    media_urls: "",
    upstream_result: upstreamResult
      ? JSON.stringify(upstreamResult, null, 2)
      : "",
    original_content: strategy.include_original ? (target.content ?? "") : "",
  };

  if (strategy.needs_media?.enabled) {
    const mediaFiles = await listMediaFilesByPost(target.id);
    const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
    if (filtered.length > 0) {
      const lines = filtered.map((m, i) => {
        const filePath = m.local_path ?? m.url ?? "";
        return `[媒体 ${i + 1}] ${filePath}`;
      });
      vars.media_urls = "\n" + lines.join("\n") + "\n";
    }
  }

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    result += `\n\n${schemaHint}`;
  }
  return result;
}

// === Media handling ===

async function buildMediaContentBlock(media: MediaFile): Promise<{
  type: string;
  source: { type: "base64"; media_type: string; data: string };
} | null> {
  let filePath = media.local_path;
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(`[MediaBlock] File not found: ${filePath}`);
    return null;
  }

  const mediaType = detectMediaType(filePath);
  if (!mediaType) {
    console.warn(`[MediaBlock] Unknown media type for: ${filePath}`);
    return null;
  }

  // Compress video if too large
  const isVideo = mediaType.startsWith("video/");
  const stats = fs.statSync(filePath);
  const maxSize = 20 * 1024 * 1024;

  if (isVideo && stats.size > maxSize) {
    console.log(
      `[MediaBlock] Compressing video: ${filePath} (${stats.size} bytes)`,
    );
    const compressed = await compressVideo(filePath);
    if (compressed) {
      filePath = compressed;
    } else {
      console.warn(`[MediaBlock] Video compression failed: ${filePath}`);
      return null;
    }
  }

  try {
    const data = fs.readFileSync(filePath);
    const base64 = data.toString("base64");
    const blockType = isVideo ? "video" : "image";
    console.log(
      `[MediaBlock] Built ${blockType} block: ${path.basename(filePath)}, size=${data.length}, base64_len=${base64.length}`,
    );
    return {
      type: blockType,
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64,
      },
    };
  } catch (err) {
    console.error(
      `[MediaBlock] Failed to read file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-vf",
      "scale=360:-2",
      "-c:v",
      "libx264",
      "-crf",
      "32",
      "-preset",
      "fast",
      "-an",
      "-y",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size < 10 * 1024 * 1024) {
          resolve(outputPath);
          return;
        }
      }
      resolve(null);
    });

    ffmpeg.on("error", () => {
      resolve(null);
    });
  });
}

function detectMediaType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    case ".mkv":
      return "video/x-matroska";
    default:
      return null;
  }
}

// === Schema helpers ===

function buildSchemaHint(outputSchema: Record<string, unknown>): string | null {
  if (typeof outputSchema !== "object" || outputSchema === null) return null;
  const properties = (outputSchema.properties || {}) as Record<
    string,
    Record<string, unknown>
  >;
  const keys = Object.keys(properties);
  if (keys.length === 0) return null;

  const lines = keys.map((key) => {
    const def = properties[key];
    const title = (def?.title as string) || key;
    return `  "${key}": ${schemaDefToHint(def)}  // ${title}`;
  });
  const example = `{\n${lines.join(",\n")}\n}`;

  const titleLines = keys.map((key) => {
    const def = properties[key];
    const title = (def?.title as string) || key;
    const desc = (def?.description as string) || "";
    return `  - ${key}: ${title}${desc ? " — " + desc : ""}`;
  });

  return `=== 输出要求 ===\n请严格按以下 JSON 格式返回结果，只输出纯 JSON，不要添加 markdown 代码块标记或额外解释。字段含义如下：\n${titleLines.join("\n")}\n\n示例格式：\n${example}`;
}

function schemaDefToHint(def: Record<string, unknown>): string {
  if (typeof def !== "object" || def === null) return "any";
  const type = def.type as string | undefined;
  const enumValues = def.enum as unknown[] | undefined;
  const items = def.items as Record<string, unknown> | undefined;
  const props = def.properties as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (enumValues && enumValues.length > 0) {
    return enumValues.map((v) => JSON.stringify(v)).join(" | ");
  }

  if (type === "array" && items) {
    return `[${schemaDefToHint(items)}]`;
  }

  if (type === "object" && props && Object.keys(props).length > 0) {
    const lines = Object.keys(props).map(
      (k) => `    "${k}": ${schemaDefToHint(props[k])}`,
    );
    return `{\n${lines.join(",\n")}\n  }`;
  }

  if (type) return type;
  return "any";
}

function filterMediaFiles(
  mediaFiles: MediaFile[],
  cfg: { media_types?: string[]; max_media?: number; mode?: string },
): MediaFile[] {
  let result = mediaFiles;
  if (cfg.media_types && cfg.media_types.length > 0) {
    result = result.filter((m) => cfg.media_types!.includes(m.media_type));
  }
  if (cfg.mode === "best_quality") {
    result = result
      .filter((m) => m.width && m.height)
      .sort((a, b) => b.width! * b.height! - a.width! * a.height!);
  }
  if (cfg.max_media && cfg.max_media > 0) {
    result = result.slice(0, cfg.max_media);
  }
  return result;
}

export async function analyzeMultiPostWithStrategy(
  promptText: string,
  strategy: { output_schema: Record<string, unknown> },
): Promise<string> {
  return callLLM(promptText, [], strategy.output_schema);
}
