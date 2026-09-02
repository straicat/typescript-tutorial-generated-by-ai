import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * 练习题的解法有两份：
 *   exercises/  —— 你要填空的地方（默认）
 *   solutions/  —— 参考答案
 *
 * 测试统一从 '@exercises/xxx' 导入，由这里的 alias 决定指向哪一份：
 *   pnpm test            -> exercises/  （你自己写，一开始应该是红的）
 *   pnpm test:solutions  -> solutions/  （参考答案，应该全绿）
 */
const dir = process.env.SOLUTIONS === '1' ? 'solutions' : 'exercises';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@exercises\/(.*)$/,
        replacement: fileURLToPath(new URL(`./${dir}/$1`, import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
  },
});
