import { describe, it, expect } from 'vitest';
import { buildDiffResult } from '../src/differ';
import { parseBlocks } from '../src/parser';
import { DEFAULT_CONFIG, type RichTextDiffConfig } from '../src/config';

function diff(oldHtml: string, newHtml: string, config?: Partial<RichTextDiffConfig>) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const oldBlocks = parseBlocks(oldHtml, cfg);
  const newBlocks = parseBlocks(newHtml, cfg);
  return buildDiffResult(oldBlocks, newBlocks, cfg);
}

function getOpTypes(result: ReturnType<typeof diff>) {
  return result.ops.map(op => op.type + (op.changed ? ':changed' : ''));
}

describe('differ', () => {
  describe('块级 LCS', () => {
    it('完全相同的 HTML → 无差异', () => {
      const result = diff('<p>hello</p>', '<p>hello</p>');
      expect(result.hasDiff).toBe(false);
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].type).toBe('equal');
      expect(result.ops[0].changed).toBe(false);
    });

    it('新增段落 → insert', () => {
      const result = diff('<p>A</p>', '<p>A</p><p>B</p>');
      expect(getOpTypes(result)).toEqual(['equal', 'insert']);
    });

    it('删除段落 → delete', () => {
      const result = diff('<p>A</p><p>B</p>', '<p>A</p>');
      expect(getOpTypes(result)).toEqual(['equal', 'delete']);
    });

    it('段落顺序不变 → LCS 正确对齐', () => {
      const result = diff('<p>A</p><p>B</p><p>C</p>', '<p>A</p><p>B2</p><p>C</p>');
      expect(getOpTypes(result)).toEqual(['equal', 'equal:changed', 'equal']);
    });
  });

  describe('相似度回退', () => {
    it('修改前20字以内 → 相似度合并为 equal+changed', () => {
      const oldHtml = '<p>若夫淫雨霏霏，连月不开，阴风怒号，浊浪排空，日星隐曜</p>';
      const newHtml = '<p>若夫淫雨霏霏1111，连月不开，阴风怒号，浊浪排空，日星隐曜</p>';
      const result = diff(oldHtml, newHtml);
      // 应合并为 equal+changed，不是 delete+insert
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].type).toBe('equal');
      expect(result.ops[0].changed).toBe(true);
      expect(result.ops[0].inlineDiff).toBeDefined();
    });

    it('完全不同的段落 → 保持 delete+insert', () => {
      const oldHtml = '<p>这是完全不同的内容A</p>';
      const newHtml = '<p>这是完全不同的内容B但是非常非常非常非常非常非常非常非常非常非常非常不同</p>';
      const result = diff(oldHtml, newHtml);
      // 相似度低于 50%，不合并
      expect(result.ops.some(op => op.type === 'delete')).toBe(true);
      expect(result.ops.some(op => op.type === 'insert')).toBe(true);
    });

    it('中间新增段落 + 修改后续段落 → 正确合并', () => {
      const oldHtml = '<p>第一段</p><p>若夫淫雨霏霏，连月不开，阴风怒号，浊浪排空，日星隐曜</p>';
      const newHtml = '<p>第一段</p><p>22222</p><p>若夫淫雨霏霏1111，连月不开，阴风怒号，浊浪排空，日星隐曜</p>';
      const result = diff(oldHtml, newHtml);
      const types = getOpTypes(result);
      // 应该是 [equal, insert, equal:changed]，不是 [equal, delete, insert, insert]
      expect(types).toContain('insert');
      expect(types).toContain('equal:changed');
      // 不应该有 delete（因为 delete 被合并了）
      expect(types).not.toContain('delete');
    });
  });

  describe('顺序正确性', () => {
    it('新增段落在前 + 修改后续段落 → insert 在 changed 前面', () => {
      const oldHtml = '<p>前一段</p><p>若夫淫雨霏霏，连月不开，阴风怒号，浊浪排空，日星隐曜</p>';
      const newHtml = '<p>前一段</p><p>22222</p><p>若夫淫雨霏霏1111，连月不开，阴风怒号，浊浪排空，日星隐曜</p>';
      const result = diff(oldHtml, newHtml);
      const types = getOpTypes(result);
      // insert 应在 equal:changed 前面（跟随新版本顺序）
      const insertIdx = types.indexOf('insert');
      const changedIdx = types.indexOf('equal:changed');
      expect(insertIdx).toBeGreaterThanOrEqual(0);
      expect(changedIdx).toBeGreaterThanOrEqual(0);
      expect(insertIdx).toBeLessThan(changedIdx);
    });
  });

  describe('inlineTags 配置', () => {
    it('inlineTags=[] → 忽略格式变化', () => {
      const oldHtml = '<p>普通文字</p>';
      const newHtml = '<p><strong>普通文字</strong></p>';
      const result = diff(oldHtml, newHtml, { inlineTags: [] });
      expect(result.hasDiff).toBe(false);
    });

    it('inlineTags=[strong] → 检测加粗变化', () => {
      const oldHtml = '<p>普通文字</p>';
      const newHtml = '<p><strong>普通文字</strong></p>';
      const result = diff(oldHtml, newHtml, { inlineTags: ['strong'] });
      expect(result.hasDiff).toBe(true);
      expect(result.ops[0].changed).toBe(true);
    });

    it('inlineTags=[] → 格式标签不导致误判 changed', () => {
      // 旧版本无 s 标签，新版本有 s 标签，但 inlineTags=[]
      // 文本内容相同 → 不应判定为 changed
      const oldHtml = '<p>若夫淫雨霏霏，连月不开，阴风怒号</p>';
      const newHtml = '<p>若夫淫雨霏霏<s>，连月不开</s>，阴风怒号</p>';
      const result = diff(oldHtml, newHtml, { inlineTags: [] });
      expect(result.hasDiff).toBe(false);
    });
  });

  describe('行内 diff', () => {
    it('文本变更 → inlineDiff 有 parts', () => {
      const result = diff('<p>hello world</p>', '<p>hello earth</p>');
      const op = result.ops[0];
      expect(op.changed).toBe(true);
      expect(op.inlineDiff).toBeDefined();
      if (op.inlineDiff) {
        expect(op.inlineDiff.oldSegments.length).toBeGreaterThan(0);
        expect(op.inlineDiff.newSegments.length).toBeGreaterThan(0);
        // 应有 changed parts
        const hasChanged = op.inlineDiff.oldSegments.some(seg =>
          seg.parts.some(p => p.changed)
        );
        expect(hasChanged).toBe(true);
      }
    });

    it('装饰 HTML 包含 diff class', () => {
      const result = diff('<p>hello world</p>', '<p>hello earth</p>');
      const op = result.ops[0];
      expect(op.oldHtml).toBeDefined();
      expect(op.newHtml).toBeDefined();
      expect(op.newHtml).toContain('diff-inline-inserted');
      expect(op.oldHtml).toContain('diff-inline-deleted');
    });
  });

  describe('媒体块', () => {
    it('图片 src 变更 → 整块高亮', () => {
      const result = diff('<img src="a.jpg">', '<img src="b.jpg">');
      expect(result.hasDiff).toBe(true);
    });

    it('图片不变 → equal', () => {
      const result = diff('<img src="a.jpg">', '<img src="a.jpg">');
      expect(result.hasDiff).toBe(false);
    });
  });
});
