/**
 * 富文本 diff 核心包公共 API。
 *
 * 用法：
 *   const differ = createRichTextDiffer({ inlineTags: ['strong', 'em'] });
 *   const result = differ.diff(oldHtml, newHtml);
 *   // result.ops[i].oldHtml / newHtml → 装饰后的 HTML，可直接 v-html
 *   // result.ops[i].inlineDiff → 结构化 diff 数据，供程序化访问
 *   differ.updateConfig({ inlineTags: ['strong'] });
 *   const result2 = differ.diff(oldHtml, newHtml);
 */
import { DEFAULT_CONFIG, type RichTextDiffConfig } from './config';
import { parseBlocks } from './parser';
import { buildDiffResult } from './differ';
import type { DiffResult, RichTextBlock } from './types';

export interface RichTextDiffer {
  /** 执行 diff，返回包含装饰 HTML 和结构化数据的结果 */
  diff(oldHtml: string, newHtml: string): DiffResult;
  /** 更新配置（仅触发重新 diff，不重新解析） */
  updateConfig(config: Partial<RichTextDiffConfig>): void;
  /** 获取当前配置 */
  getConfig(): RichTextDiffConfig;
}

export function createRichTextDiffer(config?: Partial<RichTextDiffConfig>): RichTextDiffer {
  let currentConfig: RichTextDiffConfig = { ...DEFAULT_CONFIG, ...config };
  const parseCache = new Map<string, RichTextBlock[]>();

  function parse(html: string): RichTextBlock[] {
    const cached = parseCache.get(html);
    if (cached) return cached;
    const blocks = parseBlocks(html, currentConfig);
    parseCache.set(html, blocks);
    return blocks;
  }

  return {
    diff(oldHtml: string, newHtml: string): DiffResult {
      const oldBlocks = parse(oldHtml);
      const newBlocks = parse(newHtml);
      return buildDiffResult(oldBlocks, newBlocks, currentConfig);
    },

    updateConfig(newConfig: Partial<RichTextDiffConfig>) {
      currentConfig = { ...currentConfig, ...newConfig };
      // 不清空缓存——解析结果与配置无关
    },

    getConfig() {
      return currentConfig;
    },
  };
}

// 导出公共类型
export type {
  Mark,
  Segment,
  TextSegment,
  LinkSegment,
  TextBlock,
  MediaBlock,
  RichTextBlock,
  DiffPart,
  DiffSegment,
  InlineDiff,
  DiffOp,
  DiffResult,
} from './types';

export type { RichTextDiffConfig, IDiffClassNames } from './config';

export { DEFAULT_CONFIG } from './config';

export { parseBlocks } from './parser';

export { buildDiffResult } from './differ';
