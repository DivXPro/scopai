// MiMo API 测试脚本 — 测试 OpenAI 兼容 和 Anthropic 兼容 API
// 用法: node scripts/test-mimo-api.js [本地图片路径] [本地视频路径]
// 示例: node scripts/test-mimo-api.js ~/test.jpg ~/test.mp4

const fs = require("fs");
const path = require("path");

// 让脚本能找到 packages/api 下的 @anthropic-ai/sdk
const apiNodeModules = path.join(
  __dirname,
  "..",
  "packages",
  "api",
  "node_modules",
);
module.paths.unshift(apiNodeModules);

const OpenAI = require("openai");
let Anthropic;
try {
  Anthropic = require("@anthropic-ai/sdk");
} catch (e) {
  console.warn("⚠️  @anthropic-ai/sdk 未找到，Anthropic 测试将跳过");
  console.warn(
    "   请先在 packages/api 下安装: pnpm --filter @scopai/api install",
  );
}

// ===== 配置 =====
const CONFIG = {
  openaiBaseURL: "https://token-plan-cn.xiaomimimo.com/v1",
  anthropicBaseURL: "https://token-plan-cn.xiaomimimo.com/anthropic",
  apiKey: "tp-cek89hh3m421cklxkyaca09shzyel9wr31yvketx5a0tvwvy",
  model: "mimo-v2.5",
};

const CONFIG_ARK = {
  openaiBaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
  anthropicBaseURL: "https://ark.cn-beijing.volces.com/api/plan",
  apiKey: "ark-f7aa0446-edf9-4c65-ac0b-86b21f2d8694-c37a4",
  model: "doubao-seed-2.0-pro",
};

// 方式2: 从环境变量读取（优先级更高）
const config = {
  openaiBaseURL: process.env.MIMO_OPENAI_BASE_URL || CONFIG_ARK.openaiBaseURL,
  anthropicBaseURL:
    process.env.MIMO_ANTHROPIC_BASE_URL || CONFIG_ARK.anthropicBaseURL,
  apiKey: process.env.MIMO_API_KEY || CONFIG_ARK.apiKey,
  model: process.env.MIMO_MODEL || CONFIG_ARK.model,
};

const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.openaiBaseURL,
});

const anthropic = Anthropic
  ? new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.anthropicBaseURL,
    })
  : null;

// MiMo 官方示例文件（在线URL）
const ONLINE_IMAGE_URL =
  "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png";
const ONLINE_VIDEO_URL =
  "https://example-files.cnbj1.mi-fds.com/example-files/video/video_example.mp4";

const https = require("https");

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      resolve(destPath);
      return;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    https
      .get(url, { timeout: 60000 }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(destPath);
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

// 如果没有提供本地文件，自动下载到 /tmp/mimo-test/
const DEFAULT_TEST_DIR = "/tmp/mimo-test";
const DEFAULT_IMAGE_PATH = path.join(DEFAULT_TEST_DIR, "image_example.png");
const DEFAULT_VIDEO_PATH = path.join(DEFAULT_TEST_DIR, "video_example.mp4");

let imagePath = process.argv[2];
let videoPath = process.argv[3];

async function ensureLocalFiles() {
  if (!imagePath) {
    try {
      imagePath = await downloadFile(ONLINE_IMAGE_URL, DEFAULT_IMAGE_PATH);
      console.log(`Downloaded image: ${imagePath}`);
    } catch (e) {
      console.warn("Failed to download image:", e.message);
    }
  }
  if (!videoPath) {
    try {
      videoPath = await downloadFile(ONLINE_VIDEO_URL, DEFAULT_VIDEO_PATH);
      console.log(`Downloaded video: ${videoPath}`);
    } catch (e) {
      console.warn("Failed to download video:", e.message);
    }
  }
}

function divider(title) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}`);
}

function fileToBase64(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".mp4"
              ? "video/mp4"
              : ext === ".mov"
                ? "video/quicktime"
                : "application/octet-stream";
  return { data: data.toString("base64"), mimeType, size: data.length };
}

// ==================== OpenAI 兼容 API 测试 ====================

async function testChatCompletionsText() {
  divider("[OpenAI] Test 1: Chat Completions — 纯文本");
  try {
    const res = await openai.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: "你好，请简单自我介绍" }],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", res.choices[0]?.message?.content?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testChatCompletionsImageOnline() {
  divider("[OpenAI] Test 2: Chat Completions — 文本 + 在线图片URL");
  try {
    const res = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            { type: "image_url", image_url: { url: ONLINE_IMAGE_URL } },
          ],
        },
      ],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", res.choices[0]?.message?.content?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testChatCompletionsImageBase64() {
  divider("[OpenAI] Test 3: Chat Completions — 文本 + Base64图片");
  if (!imagePath) {
    console.log("跳过: 未提供本地图片路径");
    return;
  }
  const img = fileToBase64(imagePath);
  if (!img) {
    console.log("跳过: 图片文件不存在", imagePath);
    return;
  }
  console.log(`图片: ${imagePath}, size=${img.size}, mime=${img.mimeType}`);

  try {
    const res = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            {
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            },
          ],
        },
      ],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", res.choices[0]?.message?.content?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testChatCompletionsVideoOnline() {
  divider("[OpenAI] Test 4: Chat Completions — 文本 + 在线视频URL");
  try {
    const res = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这个视频的内容" },
            { type: "video_url", video_url: { url: ONLINE_VIDEO_URL } },
          ],
        },
      ],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", res.choices[0]?.message?.content?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testChatCompletionsVideoBase64() {
  divider("[OpenAI] Test 5: Chat Completions — 文本 + Base64视频");
  if (!videoPath) {
    console.log("跳过: 未提供本地视频路径");
    return;
  }
  const vid = fileToBase64(videoPath);
  if (!vid) {
    console.log("跳过: 视频文件不存在", videoPath);
    return;
  }
  console.log(`视频: ${videoPath}, size=${vid.size}, mime=${vid.mimeType}`);

  try {
    const res = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这个视频的内容" },
            {
              type: "video_url",
              video_url: { url: `data:${vid.mimeType};base64,${vid.data}` },
            },
          ],
        },
      ],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", res.choices[0]?.message?.content?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testResponsesText() {
  divider("[OpenAI] Test 6: Responses API — 纯文本");
  try {
    const res = await openai.responses.create({
      model: config.model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "你好，请简单自我介绍" }],
        },
      ],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("output_text:", res.output_text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testResponsesImageOnline() {
  divider("[OpenAI] Test 7: Responses API — 文本 + 在线图片URL");
  try {
    const res = await openai.responses.create({
      model: config.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "描述这张图片" },
            { type: "input_image", image_url: ONLINE_IMAGE_URL },
          ],
        },
      ],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("output_text:", res.output_text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testResponsesVideoOnline() {
  divider("[OpenAI] Test 8: Responses API — 文本 + 在线视频URL");
  try {
    const content = [
      { type: "input_text", text: "描述这个视频的内容" },
      { type: "input_video", video_url: ONLINE_VIDEO_URL },
    ];
    const res = await openai.responses.create({
      model: config.model,
      input: [{ role: "user", content }],
    });
    console.log("Status: ✅ SUCCESS");
    console.log("output_text:", res.output_text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testChatCompletionsTools() {
  divider("[OpenAI] Test 9: Chat Completions — 文本 + Tools");
  try {
    const res = await openai.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: "上海今天天气怎么样？" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "获取指定城市的天气",
            parameters: {
              type: "object",
              properties: { city: { type: "string", description: "城市名" } },
              required: ["city"],
            },
          },
        },
      ],
      tool_choice: "auto",
    });
    const msg = res.choices[0]?.message;
    console.log("Status: ✅ SUCCESS");
    console.log(
      "Tool calls:",
      msg?.tool_calls ? JSON.stringify(msg.tool_calls, null, 2) : "无",
    );
    console.log("Content:", msg?.content?.slice(0, 200) || "无");
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

// ==================== Anthropic 兼容 API 测试 ====================

async function testAnthropicText() {
  divider("[Anthropic] Test 10: Messages API — 纯文本");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: "你好，请简单自我介绍" }],
    });
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", text?.text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testAnthropicImageOnline() {
  divider("[Anthropic] Test 11: Messages API — 文本 + 在线图片URL");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            { type: "image", source: { type: "url", url: ONLINE_IMAGE_URL } },
          ],
        },
      ],
    });
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", text?.text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testAnthropicVideoOnline() {
  divider("[Anthropic] Test 12: Messages API — 文本 + 在线视频URL");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这个视频的内容" },
            { type: "video", source: { type: "url", url: ONLINE_VIDEO_URL } },
          ],
        },
      ],
    });
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", text?.text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testAnthropicImageBase64() {
  divider("[Anthropic] Test 13: Messages API — 文本 + Base64图片");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  if (!imagePath) {
    console.log("跳过: 未提供本地图片路径");
    return;
  }
  const img = fileToBase64(imagePath);
  if (!img) {
    console.log("跳过: 图片文件不存在", imagePath);
    return;
  }
  console.log(`图片: ${imagePath}, size=${img.size}, mime=${img.mimeType}`);

  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data,
              },
            },
          ],
        },
      ],
    });
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", text?.text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testAnthropicVideoBase64() {
  divider("[Anthropic] Test 14: Messages API — 文本 + Base64视频");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  if (!videoPath) {
    console.log("跳过: 未提供本地视频路径");
    return;
  }
  const vid = fileToBase64(videoPath);
  if (!vid) {
    console.log("跳过: 视频文件不存在", videoPath);
    return;
  }
  console.log(`视频: ${videoPath}, size=${vid.size}, mime=${vid.mimeType}`);

  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这个视频的内容" },
            {
              type: "video",
              source: {
                type: "base64",
                media_type: vid.mimeType,
                data: vid.data,
              },
            },
          ],
        },
      ],
    });
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", text?.text?.slice(0, 200));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testAnthropicTools() {
  divider("[Anthropic] Test 15: Messages API — 文本 + Tools");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: "上海今天天气怎么样？" }],
      tools: [
        {
          name: "get_weather",
          description: "获取指定城市的天气",
          input_schema: {
            type: "object",
            properties: { city: { type: "string", description: "城市名" } },
            required: ["city"],
          },
        },
      ],
      tool_choice: { type: "auto" },
    });
    const toolUse = res.content.find((c) => c.type === "tool_use");
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Tool use:", toolUse ? JSON.stringify(toolUse, null, 2) : "无");
    console.log("Content:", text?.text?.slice(0, 200) || "无");
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

async function testAnthropicCache() {
  divider("[Anthropic] Test 16: Messages API — Prompt Caching");
  if (!anthropic) {
    console.log("跳过: Anthropic SDK 未加载");
    return;
  }
  try {
    const res = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "你好",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
      extraHeaders: { "anthropic-beta": "prompt-caching-2024-07-31" },
    });
    const text = res.content.find((c) => c.type === "text");
    console.log("Status: ✅ SUCCESS");
    console.log("Content:", text?.text?.slice(0, 200));
    console.log("Usage:", JSON.stringify(res.usage, null, 2));
  } catch (err) {
    console.log("Status: ❌ FAILED");
    console.log("Error:", err.status, err.message);
    if (err.error) console.log("Detail:", JSON.stringify(err.error, null, 2));
  }
}

// ==================== 主函数 ====================

async function main() {
  await ensureLocalFiles();

  console.log("MiMo API 测试脚本");
  console.log(`OpenAI baseURL: ${config.openaiBaseURL}`);
  console.log(`Anthropic baseURL: ${config.anthropicBaseURL}`);
  console.log(`model: ${config.model}`);
  console.log(`本地图片: ${imagePath || "(未提供)"}`);
  console.log(`本地视频: ${videoPath || "(未提供)"}`);
  console.log(`Anthropic SDK: ${anthropic ? "✅ 已加载" : "❌ 未加载"}`);

  // OpenAI 兼容测试
  await testChatCompletionsText();
  await testChatCompletionsImageOnline();
  await testChatCompletionsImageBase64();
  await testChatCompletionsVideoOnline();
  await testChatCompletionsVideoBase64();
  await testResponsesText();
  await testResponsesImageOnline();
  await testResponsesVideoOnline();
  await testChatCompletionsTools();

  // Anthropic 兼容测试
  await testAnthropicText();
  await testAnthropicImageOnline();
  await testAnthropicVideoOnline();
  await testAnthropicImageBase64();
  await testAnthropicVideoBase64();
  await testAnthropicTools();
  await testAnthropicCache();

  divider("测试完成");
}

main().catch(console.error);
