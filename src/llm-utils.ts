import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure helpers shared by the built-in LLM (DeepSeek) integration and its tests.
 * Kept free of Express/app imports so they can be unit-tested in isolation.
 */

/** Strips the markdown code fences LLMs love to wrap JSON in, then parses. */
export function parseLlmJson(raw: string | null): any {
  if (!raw) throw new Error('LLM returned an empty response');
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/** Flattens a Gemini-style response schema into a compact JSON example string. */
export function schemaToPrompt(schema: any): string {
  if (!schema || typeof schema !== 'object') return '"..."';
  if (schema.type === 'array') return `[${schemaToPrompt(schema.items)}]`;
  if (schema.type === 'object' && schema.properties) {
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const parts = Object.entries<any>(schema.properties).map(([k, v]) => {
      const optional = required.includes(k) ? '' : ' /* optional */';
      return `"${k}": ${schemaToPrompt(v)}${optional}`;
    });
    return `{ ${parts.join(', ')} }`;
  }
  return schema.type === 'integer' ? '0' : '"..."';
}

/**
 * Upserts `KEY="value"` into an `.env` file: drops any previous line for the
 * same key (comments and blank lines are preserved), appends the new one and
 * creates parent directories as needed.
 */
export function upsertEnvKey(filePath: string, keyName: string, keyValue: string): void {
  let existing = '';
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    existing = '';
  }
  const filtered = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() &&
        !line.trim().startsWith('#') &&
        !line.startsWith(`${keyName}=`) &&
        !line.startsWith(`${keyName} =`)
    );
  filtered.push(`${keyName}="${keyValue.replace(/"/g, '')}"`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, filtered.join('\n') + '\n', 'utf8');
}

/** Loopback-only guard for credential-mutating endpoints (v4, v6 and v4-mapped). */
export function isLoopbackAddress(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
