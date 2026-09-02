/** 把 5 个工具组装成注册表。 */

import { createRegistry } from '../lib/tool-registry.js';
import type { ToolRegistry } from '../lib/tool-registry.js';
import { createListDirTool } from './list-dir.js';
import { createReadFileTool } from './read-file.js';
import { calculateTool } from './calculate.js';
import { nowTool } from './now.js';
import { createWriteNoteTool } from './write-note.js';

/** root 是文件类工具的安全边界，通常是 process.cwd()。 */
export function createToolRegistry(root: string): ToolRegistry {
  return createRegistry([
    createListDirTool(root),
    createReadFileTool(root),
    calculateTool,
    nowTool,
    createWriteNoteTool(root),
  ]);
}
