/**
 * 工具 4：当前时间。
 *
 * 无参工具的 schema 就是 `z.object({})`。注意生成的 JSON Schema 里
 * 不会自动带 properties / required，需要在 toolToOpenAiTool 里补齐，
 * 否则 strict 模式会 400。
 */

import { z } from 'zod';
import { defineTool } from '../lib/tool-registry.js';

export const nowTool = defineTool({
  name: 'now',
  description: '获取当前时间（ISO 8601，UTC）。无参数。',
  schema: z.object({}),
  execute: () => new Date().toISOString(),
});
