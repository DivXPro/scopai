import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { Comment, MediaFile, PromptTemplate } from '../shared/types';

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
