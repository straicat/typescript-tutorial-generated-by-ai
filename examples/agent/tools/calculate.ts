/**
 * 工具 3：算术求值。
 *
 * ❌ 绝不要用 `eval` / `new Function` 来算模型给的表达式 ——
 *    那等于把任意代码执行权交给模型（和给它交出 shell 没区别）。
 *    这是 Agent 最常见的 RCE 来源。
 * ✅ 正确做法：白名单字符 + 手写递归下降解析器（下面 50 行）。
 */

import { z } from 'zod';
import { defineTool } from '../lib/tool-registry.js';

export const calculateTool = defineTool({
  name: 'calculate',
  description: '计算一个算术表达式，只支持数字、+ - * / % ( ) 和小数点。',
  schema: z.object({
    expression: z.string().describe('例如 "(1 + 2) * 3.5"'),
  }),
  execute: ({ expression }) => String(evalArithmetic(expression)),
});

/** 语法：expr := term (('+'|'-') term)* ; term := factor (('*'|'/'|'%') factor)* ; factor := '-'? (number | '(' expr ')') */
export function evalArithmetic(input: string): number {
  if (!/^[\d\s+\-*/%().]+$/.test(input)) {
    throw new Error(`表达式含非法字符，只允许数字和 + - * / % ( ) . ：${input}`);
  }

  let pos = 0;
  const skip = (): void => {
    while (input[pos] === ' ') pos += 1;
  };

  const parseFactor = (): number => {
    skip();
    if (input[pos] === '-') {
      pos += 1;
      return -parseFactor();
    }
    if (input[pos] === '(') {
      pos += 1;
      const value = parseExpr();
      skip();
      if (input[pos] !== ')') throw new Error('括号不匹配');
      pos += 1;
      return value;
    }
    const start = pos;
    // noUncheckedIndexedAccess 下 input[pos] 是 string | undefined，
    // 所以要写 `?? ''` 而不是直接丢给正则。
    while (pos < input.length && /[\d.]/.test(input[pos] ?? '')) pos += 1;
    if (start === pos) throw new Error(`位置 ${pos} 处期望一个数字`);
    const n = Number(input.slice(start, pos));
    // 别忘了这一步：Number('1.2.3') 是 NaN，NaN 会一路静默传播到最终结果。
    if (!Number.isFinite(n)) throw new Error(`不是合法数字: ${input.slice(start, pos)}`);
    return n;
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    for (;;) {
      skip();
      const op = input[pos];
      if (op !== '*' && op !== '/' && op !== '%') return left;
      pos += 1;
      const right = parseFactor();
      if ((op === '/' || op === '%') && right === 0) throw new Error('除数为 0');
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
  };

  const parseExpr = (): number => {
    let left = parseTerm();
    for (;;) {
      skip();
      const op = input[pos];
      if (op !== '+' && op !== '-') return left;
      pos += 1;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
  };

  const result = parseExpr();
  skip();
  if (pos !== input.length) throw new Error(`位置 ${pos} 处有多余内容`);
  if (!Number.isFinite(result)) throw new Error('计算结果不是有限数字');
  return result;
}
