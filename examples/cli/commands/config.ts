/**
 * `jsonl config show` / `jsonl config path` —— 示范**嵌套子命令**。
 *
 * 顺便演示配置优先级：命令行 > 环境变量 > 配置文件 > 默认值。
 */

import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { CONFIG_FILE_NAME, configFromEnv, findConfigUpwards, loadConfigFile, mergeLayers, userConfigPath } from '../lib/config.js';
import type { FileConfig } from '../lib/config.js';
import type { AppContext, ContextHolder } from '../lib/context.js';
import { requireContext } from '../lib/context.js';
import { formatTable } from '../lib/output.js';

export interface ResolvedConfigView {
  configPath: string | null;
  effective: FileConfig;
}

export async function resolveEffectiveConfig(
  cwd: string,
  env: Record<string, string | undefined>,
  cliLayer: FileConfig,
): Promise<ResolvedConfigView> {
  const defaults: FileConfig = { json: false, color: true, verbose: false, top: 10 };
  const found = findConfigUpwards(cwd, CONFIG_FILE_NAME, existsSync) ?? nullIfMissing(userConfigPath());
  const fileLayer = found == null ? {} : await loadConfigFile(found);

  return {
    configPath: found,
    // mergeLayers 会忽略 undefined —— 这是四级优先级能正确工作的关键。
    effective: mergeLayers<FileConfig>(defaults, fileLayer, configFromEnv(env), cliLayer),
  };
}

function nullIfMissing(path: string): string | null {
  return existsSync(path) ? path : null;
}

export function makeConfigCommand(holder: ContextHolder): Command {
  const config = new Command('config').description('查看配置来源与最终生效值');

  config
    .command('path')
    .description('打印配置文件查找结果')
    .action(async () => {
      const ctx = requireContext(holder);
      const view = await resolveEffectiveConfig(process.cwd(), process.env, {});
      if (ctx.globals.json) {
        ctx.reporter.json({ configPath: view.configPath, userConfigPath: userConfigPath() });
        return;
      }
      ctx.reporter.data(`项目配置: ${view.configPath ?? '(未找到 ' + CONFIG_FILE_NAME + ')'}`);
      ctx.reporter.data(`用户配置: ${userConfigPath()}`);
    });

  // 默认子命令：`jsonl config` 等价于 `jsonl config show`
  const show = new Command('show')
    .description('打印最终生效的配置')
    .action(async () => {
      const ctx = requireContext(holder);
      await printEffective(ctx);
    });
  config.addCommand(show, { isDefault: true });

  return config;
}

async function printEffective(ctx: AppContext): Promise<void> {
  // 命令行层：只把「用户真的传了」的全局选项放进去。
  const cliLayer: FileConfig = {
    json: ctx.globals.json ? true : undefined,
    verbose: ctx.globals.verbose ? true : undefined,
    color: ctx.globals.color ? undefined : false,
  };
  const view = await resolveEffectiveConfig(process.cwd(), process.env, cliLayer);

  if (ctx.globals.json) {
    ctx.reporter.json(view);
    return;
  }
  ctx.reporter.data(
    formatTable(
      Object.entries(view.effective).map(([k, v]) => [k, String(v)]),
      { header: ['key', 'value'] },
    ),
  );
  ctx.reporter.info(`配置文件: ${view.configPath ?? '(无)'}`);
}
