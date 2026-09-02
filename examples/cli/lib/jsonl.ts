/**
 * JSON Lines 的纯逻辑层：**只有函数，没有 I/O，没有 console，没有 process**。
 *
 * 这是本例子最重要的一层。因为它是纯函数，测试它不需要起子进程、不需要临时文件，
 * 也不需要 mock 任何东西 —— 见 docs/08-cli-with-commander.md 的「可测试性架构」。
 */

// ---------------------------------------------------------------- 解析

export interface JsonlRecord {
  /** 1-based 行号（对应原始输入的行号，方便用户回到文件里定位） */
  line: number;
  value: Record<string, unknown>;
}

export interface JsonlBadLine {
  line: number;
  reason: string;
  /** 出错的原始内容（截断后），用于报错提示 */
  raw: string;
}

export interface JsonlDocument {
  records: JsonlRecord[];
  bad: JsonlBadLine[];
  /** 非空白行总数（空白行直接忽略，不计入任何统计） */
  total: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseJsonl(lines: readonly string[]): JsonlDocument {
  const records: JsonlRecord[] = [];
  const bad: JsonlBadLine[] = [];
  let total = 0;

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue; // 空行是合法的 JSONL 填充，直接跳过
    total += 1;
    const lineNo = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      bad.push({ line: lineNo, reason: 'invalid JSON', raw: truncate(line, 60) });
      continue;
    }
    if (!isPlainObject(parsed)) {
      bad.push({ line: lineNo, reason: 'not an object', raw: truncate(line, 60) });
      continue;
    }
    records.push({ line: lineNo, value: parsed });
  }

  return { records, bad, total };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------- 统计

export interface FieldStat {
  field: string;
  count: number;
  /** 该字段出现过的运行时类型（去重后按字母序） */
  types: string[];
}

export interface JsonlStats {
  total: number;
  valid: number;
  invalid: number;
  fields: FieldStat[];
}

function runtimeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function buildStats(doc: JsonlDocument): JsonlStats {
  const counts = new Map<string, { count: number; types: Set<string> }>();

  for (const rec of doc.records) {
    for (const [key, value] of Object.entries(rec.value)) {
      let slot = counts.get(key);
      if (slot == null) {
        slot = { count: 0, types: new Set<string>() };
        counts.set(key, slot);
      }
      slot.count += 1;
      slot.types.add(runtimeType(value));
    }
  }

  const fields = [...counts.entries()]
    .map(([field, { count, types }]) => ({ field, count, types: [...types].sort() }))
    // 出现次数降序，同次数按字段名升序 —— 排序必须是确定性的，否则输出没法做快照测试。
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));

  return { total: doc.total, valid: doc.records.length, invalid: doc.bad.length, fields };
}

// ---------------------------------------------------------------- 过滤

export interface WhereFilter {
  path: string[];
  value: string;
  negated: boolean;
}

/** 原型污染防护：这些键一律视为「取不到」。 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** 解析 `a.b=1` / `level!=error`。非法输入抛 Error，由调用方包成 UsageError。 */
export function parseWhere(spec: string): WhereFilter {
  const eq = spec.indexOf('=');
  if (eq < 0) throw new Error(`--where 必须是 key=value 形式，收到: ${JSON.stringify(spec)}`);

  const negated = eq > 0 && spec[eq - 1] === '!';
  const rawKey = spec.slice(0, negated ? eq - 1 : eq);
  const value = spec.slice(eq + 1);

  if (rawKey === '') throw new Error(`--where 的 key 不能为空: ${JSON.stringify(spec)}`);
  const path = rawKey.split('.');
  if (path.some((seg) => seg === '')) {
    throw new Error(`--where 的路径含空段: ${JSON.stringify(spec)}`);
  }
  return { path, value, negated };
}

/** 按点路径取值；任何一环不是对象/数组，或命中危险键，都返回 undefined。 */
export function getByPath(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (FORBIDDEN_KEYS.has(seg)) return undefined;
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function scalarToString(v: unknown): string {
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

export function matchesFilter(obj: unknown, filter: WhereFilter): boolean {
  const resolved = getByPath(obj, filter.path);
  // 字段缺失时 equal=false；配合 negated 就得到「缺失算不等于」，符合直觉。
  const equal = resolved === undefined ? false : scalarToString(resolved) === filter.value;
  return filter.negated ? !equal : equal;
}

export function matchesAll(obj: unknown, filters: readonly WhereFilter[]): boolean {
  return filters.every((f) => matchesFilter(obj, f));
}
