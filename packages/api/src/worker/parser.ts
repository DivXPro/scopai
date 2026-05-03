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

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Try full-string parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }
  // Try markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // ignore
    }
  }
  // Fall back to first balanced braces object
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) throw new Error('No JSON found in response');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(firstBrace, i + 1));
    }
  }
  throw new Error('No JSON found in response');
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

export function parseBatchStrategyResult(
  rawText: string,
  outputSchema: Record<string, unknown>,
): { values: Record<string, unknown>[]; raw: Record<string, unknown> } {
  let obj: Record<string, unknown> = {};
  try {
    const json = extractJson(rawText);
    obj = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Invalid JSON in batch response: ${rawText.slice(0, 200)}`);
  }

  const results = obj.results ?? obj.data ?? obj.items ?? obj;
  if (!Array.isArray(results)) {
    throw new Error('Batch response must contain a results array');
  }

  const properties = (outputSchema.properties || {}) as Record<string, Record<string, unknown>>;
  const parsed: Record<string, unknown>[] = [];

  for (const item of results) {
    const row: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(properties)) {
      row[key] = coerceJsonSchemaValue((item as Record<string, unknown>)?.[key], def);
    }
    parsed.push(row);
  }

  return { values: parsed, raw: obj };
}

function coerceJsonSchemaValue(value: unknown, def: Record<string, unknown>): unknown {
  if (value === undefined || value === null) {
    if ((def.type as string) === 'array') return [];
    if ((def.type as string) === 'boolean') return null;
    return null;
  }

  const type = def.type as string;
  const enumValues = def.enum as string[] | undefined;

  if (type === 'number') {
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? null : parsed;
  }

  if (type === 'integer') {
    if (typeof value === 'number') return Number.isInteger(value) ? value : null;
    const parsed = parseFloat(String(value));
    return !isNaN(parsed) && Number.isInteger(parsed) ? parsed : null;
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
  if (itemType === 'number') {
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? null : parsed;
  }
  if (itemType === 'integer') {
    if (typeof value === 'number') return Number.isInteger(value) ? value : null;
    const parsed = parseFloat(String(value));
    return !isNaN(parsed) && Number.isInteger(parsed) ? parsed : null;
  }
  if (itemType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
    if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
    return null;
  }
  if (itemType === 'object') {
    if (typeof value === 'object' && value !== null) return value;
    return null;
  }
  return value;
}
