import {
  SentimentLabel, CommentIntent, RiskLevel, MediaContentType,
  TopicTag, EmotionTag, DetectedObject, DetectedLogo, DetectedFace,
} from '../shared/types';

export interface StrategyColumnDef {
  name: string;
  type: 'number' | 'enum' | 'array' | 'string';
  label: string;
  min?: number;
  max?: number;
  enum_values?: string[];
  items_label?: string;
}

export interface StrategyJsonFieldDef {
  name: string;
  type: 'number' | 'enum' | 'array' | 'string';
  label: string;
  enum_values?: string[];
  items_label?: string;
}

export interface StrategyOutputSchema {
  columns: StrategyColumnDef[];
  json_fields: StrategyJsonFieldDef[];
}

export interface ParsedCommentResult {
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  intent: CommentIntent | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  topics: TopicTag[] | null;
  emotion_tags: EmotionTag[] | null;
  keywords: string[] | null;
  summary: string | null;
  raw: Record<string, unknown>;
}

export interface ParsedMediaResult {
  content_type: MediaContentType | null;
  description: string | null;
  ocr_text: string | null;
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  objects: DetectedObject[] | null;
  logos: DetectedLogo[] | null;
  faces: DetectedFace[] | null;
  raw: Record<string, unknown>;
}

export function parseCommentResult(rawText: string): ParsedCommentResult {
  const json = extractJson(rawText);
  const obj = typeof json === 'object' ? json as Record<string, unknown> : {};

  const sentiment = obj.sentiment as Record<string, unknown> | undefined;
  const risk = obj.risk as Record<string, unknown> | undefined;

  return {
    sentiment_label: normalizeSentiment((sentiment?.label as string) ?? null),
    sentiment_score: typeof sentiment?.score === 'number' ? sentiment.score : null,
    intent: normalizeIntent((obj.intent as string) ?? null),
    risk_flagged: Boolean(risk?.flagged),
    risk_level: normalizeRiskLevel((risk?.level as string) ?? null),
    risk_reason: typeof risk?.reason === 'string' ? risk.reason : null,
    topics: normalizeTopics(obj.topics),
    emotion_tags: normalizeEmotions(obj.emotion_tags ?? obj.emotions),
    keywords: normalizeKeywords(obj.keywords),
    summary: typeof obj.summary === 'string' ? obj.summary : null,
    raw: obj,
  };
}

export function parseMediaResult(rawText: string): ParsedMediaResult {
  const json = extractJson(rawText);
  const obj = typeof json === 'object' ? json as Record<string, unknown> : {};
  const risk = obj.risk as Record<string, unknown> | undefined;
  const sent = obj.sentiment as Record<string, unknown> | undefined;

  return {
    content_type: normalizeContentType((obj.content_type as string) ?? null),
    description: typeof obj.description === 'string' ? obj.description : null,
    ocr_text: typeof obj.ocr_text === 'string' ? obj.ocr_text : null,
    sentiment_label: normalizeSentiment((sent?.label as string) ?? null),
    sentiment_score: typeof sent?.score === 'number' ? sent.score : null,
    risk_flagged: Boolean(risk?.flagged),
    risk_level: normalizeRiskLevel((risk?.level as string) ?? null),
    risk_reason: typeof risk?.reason === 'string' ? risk.reason : null,
    objects: normalizeObjects(obj.objects),
    logos: normalizeLogos(obj.logos),
    faces: normalizeFaces(obj.faces),
    raw: obj,
  };
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]);
}

function normalizeSentiment(v: string | null): SentimentLabel | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['positive', 'negative', 'neutral'].includes(lower)) return lower as SentimentLabel;
  return null;
}

function normalizeIntent(v: string | null): CommentIntent | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['praise', 'complaint', 'question', 'suggestion', 'neutral', 'other'].includes(lower)) {
    return lower as CommentIntent;
  }
  return 'other';
}

function normalizeRiskLevel(v: string | null): RiskLevel | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['low', 'medium', 'high'].includes(lower)) return lower as RiskLevel;
  return null;
}

function normalizeContentType(v: string | null): MediaContentType | null {
  if (!v) return null;
  const valid = ['product', 'person', 'scene', 'text', 'screenshot', 'meme', 'other'];
  const lower = v.toLowerCase();
  if (valid.includes(lower)) return lower as MediaContentType;
  return null;
}

function normalizeTopics(v: unknown): TopicTag[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(t => {
    const o = t as Record<string, unknown>;
    return { name: String(o.name ?? ''), confidence: typeof o.confidence === 'number' ? o.confidence : 0 };
  });
}

function normalizeEmotions(v: unknown): EmotionTag[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(t => {
    const o = t as Record<string, unknown>;
    return { tag: String(o.tag ?? ''), confidence: typeof o.confidence === 'number' ? o.confidence : 0 };
  });
}

function normalizeKeywords(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(k => String(k));
}

function normalizeObjects(v: unknown): DetectedObject[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(o => {
    const obj = o as Record<string, unknown>;
    return { label: String(obj.label ?? ''), confidence: typeof obj.confidence === 'number' ? obj.confidence : 0 };
  });
}

function normalizeLogos(v: unknown): DetectedLogo[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(l => {
    const obj = l as Record<string, unknown>;
    return { name: String(obj.name ?? ''), confidence: typeof obj.confidence === 'number' ? obj.confidence : 0 };
  });
}

function normalizeFaces(v: unknown): DetectedFace[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(f => {
    const obj = f as Record<string, unknown>;
    return {
      age: typeof obj.age === 'number' ? obj.age : undefined,
      gender: typeof obj.gender === 'string' ? obj.gender : undefined,
      emotion: typeof obj.emotion === 'string' ? obj.emotion : undefined,
    };
  });
}

export function parseStrategyResult(
  rawText: string,
  outputSchema: Record<string, unknown>,
): { values: Record<string, unknown>; raw: Record<string, unknown> } {
  let obj: Record<string, unknown> = {};
  try {
    const json = extractJson(rawText);
    obj = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    // leave obj empty
  }

  const properties = (outputSchema.properties || {}) as Record<string, Record<string, unknown>>;
  const values: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(properties)) {
    values[key] = coerceJsonSchemaValue(obj[key], def);
  }

  return { values, raw: obj };
}

function coerceJsonSchemaValue(value: unknown, def: Record<string, unknown>): unknown {
  if (value === undefined || value === null) {
    if ((def.type as string) === 'array') return [];
    if ((def.type as string) === 'boolean') return null;
    return null;
  }

  const type = def.type as string;
  const enumValues = def.enum as string[] | undefined;

  if (type === 'number' || type === 'integer') {
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? null : parsed;
  }

  if (type === 'string') {
    const str = String(value);
    if (enumValues && enumValues.length > 0) {
      const lower = str.toLowerCase();
      const loweredEnums = enumValues.map(v => v.toLowerCase());
      const idx = loweredEnums.indexOf(lower);
      return idx >= 0 ? enumValues[idx] : null;
    }
    return str;
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
    if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
    return null;
  }

  if (type === 'array') {
    if (Array.isArray(value)) {
      const itemType = (def.items as Record<string, unknown> | undefined)?.type as string | undefined;
      return value.map(v => coerceItemType(v, itemType));
    }
    return [coerceItemType(value, (def.items as Record<string, unknown> | undefined)?.type as string | undefined)];
  }

  if (type === 'object') {
    if (typeof value === 'object' && value !== null) return value;
    return null;
  }

  return value;
}

function coerceItemType(value: unknown, itemType: string | undefined): unknown {
  if (itemType === 'string') return String(value);
  if (itemType === 'number' || itemType === 'integer') {
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? null : parsed;
  }
  if (itemType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
    if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
    return null;
  }
  return value;
}
