/**
 * 类型安全的工具注册表。
 *
 * 核心是 `defineTool`：它在运行时什么都不做，全部价值在类型上 ——
 * `execute` 的参数类型由 zod schema **自动推导**，你不需要写第二遍。
 * 这是 TS 写 Agent 最舒服的地方，Java/Go 侧要么手写 JSON Schema，
 * 要么靠注解 + 反射，都没法在编译期把两边对上。
 */

import { z } from 'zod';
import type { ZodType } from 'zod';
import type { ChatMessage, OpenAiFunctionTool, ToolCall } from './types.js';

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  schema: ZodType<TArgs>;
  /** 返回值必须是字符串：它会成为 `role: 'tool'` 消息的 content 回给模型。 */
  execute: (args: TArgs) => string | Promise<string>;
  /** 危险工具（写文件、执行命令……）标 true，主流程会要求人类确认。 */
  dangerous?: boolean;
}

/**
 * 擦除参数类型后的 Tool，用于放进注册表。
 * 这里必须是 `any` 而不是 `unknown`：`execute` 在逆变位置，
 * `Tool<{path: string}>` 不能赋值给 `Tool<unknown>`。
 */
export type AnyTool = Tool<any>;

export type ToolRegistry = Record<string, AnyTool>;

export function defineTool<TSchema extends ZodType>(spec: {
  name: string;
  description: string;
  schema: TSchema;
  execute: (args: z.output<TSchema>) => string | Promise<string>;
  dangerous?: boolean;
}): Tool<z.output<TSchema>> {
  return spec as Tool<z.output<TSchema>>;
}

export function createRegistry(tools: readonly AnyTool[]): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const tool of tools) {
    if (registry[tool.name] != null) throw new Error(`工具名重复: ${tool.name}`);
    registry[tool.name] = tool;
  }
  return registry;
}

/** zod schema -> OpenAI 要的 JSON Schema。 */
export function toolToOpenAiTool(tool: AnyTool): OpenAiFunctionTool {
  // io: 'input' = 「模型要构造的输入形状」。默认的 'output' 语义不同。
  const raw = z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>;
  // $schema 必须删掉，strict 模式下 OpenAI 不认识这个键会直接 400。
  const { $schema: _ignored, ...schema } = raw;
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        ...schema,
        // z.object({}) 不会生成 properties / required，但 strict 模式要求它们存在。
        properties: schema['properties'] ?? {},
        required: schema['required'] ?? [],
        additionalProperties: false,
      },
      strict: true,
    },
  };
}

/** 排序是为了让请求体可复现（便于做 prompt 缓存、便于 diff 调试）。 */
export function buildToolsParam(registry: ToolRegistry): OpenAiFunctionTool[] {
  return Object.keys(registry)
    .sort()
    .map((name) => toolToOpenAiTool(registry[name] as AnyTool));
}

/**
 * 执行一次工具调用。**永远不抛异常** —— 所有失败都变成文本回给模型，
 * 让它自己看懂错误后重试。抛一次异常整个 Agent 就死了。
 */
export async function executeToolCall(
  registry: ToolRegistry,
  call: ToolCall,
): Promise<ChatMessage> {
  const reply = (content: string): ChatMessage => ({
    role: 'tool',
    tool_call_id: call.id,
    content,
  });

  const tool = registry[call.function.name];
  if (tool == null) return reply(`错误: 未注册的工具 "${call.function.name}"`);

  const raw = call.function.arguments.trim();
  let json: unknown;
  try {
    json = raw === '' ? {} : JSON.parse(raw);
  } catch {
    return reply(`错误: 参数不是合法 JSON: ${call.function.arguments}`);
  }

  const checked = tool.schema.safeParse(json);
  if (!checked.success) {
    const detail = checked.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return reply(`错误: 参数校验失败: ${detail}。请按 schema 重新调用。`);
  }

  try {
    return reply(await tool.execute(checked.data));
  } catch (err) {
    return reply(`错误: 工具执行失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface SystemPromptOptions {
  role?: string;
  constraints?: readonly string[];
  outputFormat?: string;
}

export function buildSystemPrompt(registry: ToolRegistry, options?: SystemPromptOptions): string {
  const { role = '你是一个严谨的命令行助手。', constraints, outputFormat } = options ?? {};
  const sections: string[] = [role];

  const names = Object.keys(registry).sort();
  if (names.length > 0) {
    sections.push(
      ['可用工具：', ...names.map((n) => `- ${n}: ${(registry[n] as AnyTool).description}`)].join('\n'),
    );
  }
  if (constraints != null && constraints.length > 0) {
    sections.push(['约束：', ...constraints.map((c, i) => `${i + 1}. ${c}`)].join('\n'));
  }
  if (outputFormat != null && outputFormat !== '') {
    sections.push(`输出格式：\n${outputFormat}`);
  }
  return sections.join('\n\n');
}
