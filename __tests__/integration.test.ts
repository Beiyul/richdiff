import { describe, it, expect } from 'vitest';
import { createRichTextDiffer } from '../src/index';

function diff(oldHtml: string, newHtml: string, opts?: Parameters<typeof createRichTextDiffer>[0]) {
  const differ = createRichTextDiffer(opts);
  return differ.diff(oldHtml, newHtml);
}

describe('集成测试', () => {
  describe('端到端 diff 场景', () => {
    it('场景1：仅文本变更', () => {
      const result = diff(
        '<p>庆历四年春，滕子京谪守巴陵郡。</p>',
        '<p>庆历四年春，滕子京谪守巴陵郡。越明年</p>',
      );
      expect(result.hasDiff).toBe(true);
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].changed).toBe(true);
      // "越明年"是纯新增，旧版本无删除内容，所以 oldHtml 不含 diff class
      // newHtml 包含 diff-inline-inserted（高亮"越明年"）
      expect(result.ops[0].newHtml).toContain('diff-inline-inserted');
    });

    it('场景2：新增段落', () => {
      const result = diff(
        '<p>第一段</p><p>第三段</p>',
        '<p>第一段</p><p>第二段</p><p>第三段</p>',
      );
      expect(result.hasDiff).toBe(true);
      const insertOp = result.ops.find(op => op.type === 'insert');
      expect(insertOp).toBeDefined();
      expect(insertOp!.newHtml).toContain('diff-inline-inserted');
    });

    it('场景3：删除段落', () => {
      const result = diff(
        '<p>第一段</p><p>第二段</p><p>第三段</p>',
        '<p>第一段</p><p>第三段</p>',
      );
      expect(result.hasDiff).toBe(true);
      const deleteOp = result.ops.find(op => op.type === 'delete');
      expect(deleteOp).toBeDefined();
      expect(deleteOp!.oldHtml).toContain('diff-inline-deleted');
    });

    it('场景4：修改前20字以内的内容 → 走相似度合并', () => {
      const oldHtml = '<p>若夫淫雨霏霏，连月不开，阴风怒号，浊浪排空，日星隐曜，山岳潜形</p>';
      const newHtml = '<p>若夫淫雨霏霏1111，连月不开，阴风怒号，浊浪排空，日星隐曜，山岳潜形</p>';
      const result = diff(oldHtml, newHtml);
      // 不应该是 delete+insert，应该是 equal+changed
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].type).toBe('equal');
      expect(result.ops[0].changed).toBe(true);
    });

    it('场景5：修改前20字以外的内容 → 直接 equal+changed', () => {
      const oldHtml = '<p>若夫淫雨霏霏，连月不开，阴风怒号，浊浪排空，日星隐曜，山岳潜形，商旅不行</p>';
      const newHtml = '<p>若夫淫雨霏霏，连月不开，阴风怒号，浊浪排空，日星隐曜，山岳潜形，商旅不行吗</p>';
      const result = diff(oldHtml, newHtml);
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].type).toBe('equal');
      expect(result.ops[0].changed).toBe(true);
    });

    it('场景6：格式标签不参与 diff（inlineTags=[]）→ 不检测格式变化', () => {
      const result = diff(
        '<p>普通文字</p>',
        '<p><strong>普通文字</strong></p>',
        { inlineTags: [] },
      );
      expect(result.hasDiff).toBe(false);
    });

    it('场景7：格式标签参与 diff（inlineTags=[strong]）→ 检测格式变化', () => {
      const result = diff(
        '<p>普通文字</p>',
        '<p><strong>普通文字</strong></p>',
        { inlineTags: ['strong'] },
      );
      expect(result.hasDiff).toBe(true);
      expect(result.ops[0].changed).toBe(true);
    });

    it('场景8：多个变更混合（新增 + 修改 + 删除）', () => {
      const oldHtml = '<p>第一段</p><p>第二段原文</p><p>第三段</p>';
      const newHtml = '<p>第一段</p><p>第二段修改</p><p>新增段</p>';
      const result = diff(oldHtml, newHtml);
      expect(result.hasDiff).toBe(true);
      // 第三段被删除
      expect(result.ops.some(op => op.type === 'delete')).toBe(true);
    });
  });

  describe('配置切换', () => {
    it('updateConfig 后重新 diff 不需重新解析', () => {
      const differ = createRichTextDiffer();
      const oldHtml = '<p><strong>bold</strong></p>';
      const newHtml = '<p><em>bold</em></p>';

      // inlineTags=[] → 无差异
      const r1 = differ.diff(oldHtml, newHtml);
      expect(r1.hasDiff).toBe(false);

      // 切换配置
      differ.updateConfig({ inlineTags: ['strong', 'em'] });

      // inlineTags=[strong, em] → 有差异
      const r2 = differ.diff(oldHtml, newHtml);
      expect(r2.hasDiff).toBe(true);
    });
  });

  describe('DiffResult 结构', () => {
    it('每个 op 同时包含 oldHtml 和 inlineDiff', () => {
      const result = diff('<p>hello world</p>', '<p>hello earth</p>');
      const op = result.ops[0];
      expect(op.oldHtml).toBeDefined();
      expect(op.newHtml).toBeDefined();
      expect(op.inlineDiff).toBeDefined();
      expect(op.oldBlock).toBeDefined();
      expect(op.newBlock).toBeDefined();
    });

    it('未变更的 op 只有 oldHtml/newHtml，无 inlineDiff', () => {
      const result = diff('<p>same</p>', '<p>same</p>');
      const op = result.ops[0];
      expect(op.changed).toBe(false);
      expect(op.inlineDiff).toBeUndefined();
      expect(op.oldHtml).toBe(op.oldBlock!.html);
      expect(op.newHtml).toBe(op.newBlock!.html);
    });
  });

  describe('inline mark 场景（Fix 验证）', () => {
    it('加粗部分文字时保留单词间空格', () => {
      // Fix 1: .trim() 不应吃掉 segment 间的空白
      const result = diff(
        '<p>Hello world</p>',
        '<p><strong>Hello</strong> world</p>',
        { inlineTags: ['strong'] },
      );
      expect(result.hasDiff).toBe(true);
      const op = result.ops[0];
      expect(op.type).toBe('equal');
      expect(op.changed).toBe(true);

      // newHtml 应包含完整文本 "Hello world"，空格不能丢失
      // "Hello" 应该被 <strong> 包裹
      expect(op.newHtml).toContain('Hello');
      expect(op.newHtml).toContain('world');
      // 文本 "Helloworld"（无空格）不应出现
      const textContent = op.newHtml!.replace(/<[^>]*>/g, '');
      expect(textContent).toBe('Hello world');
    });

    it('加粗文字应在 newHtml 中带有 diff 高亮', () => {
      // Fix 2: 样式变更的字符应复用已有 class，开箱即用
      const result = diff(
        '<p>Hello world</p>',
        '<p><strong>Hello</strong> world</p>',
        { inlineTags: ['strong'] },
      );
      const op = result.ops[0];
      // newHtml 中 "Hello" 应被高亮（复用 diff-inline-inserted）
      expect(op.newHtml).toContain('diff-inline-inserted');
      expect(op.newHtml).toMatch(/<span class="diff-inline-inserted">Hello<\/span>/);
    });

    it('inlineDiff parts 中样式变更的字符应有 styleChanged 标记', () => {
      const result = diff(
        '<p>Hello world</p>',
        '<p><strong>Hello</strong> world</p>',
        { inlineTags: ['strong'] },
      );
      const op = result.ops[0];
      expect(op.inlineDiff).toBeDefined();

      // 新版本的 parts 中 "Hello" 应有 styleChanged 标记
      const newParts = op.inlineDiff!.newSegments.flatMap(s => s.parts);
      const helloPart = newParts.find(p => p.text.includes('Hello'));
      expect(helloPart).toBeDefined();
      expect(helloPart!.styleChanged).toBe(true);

      // "world" 部分不应有 styleChanged
      const worldPart = newParts.find(p => p.text.includes('world'));
      expect(worldPart).toBeDefined();
      expect(worldPart!.styleChanged).toBeFalsy();
    });

    it('仅文本变更不应有 styleChanged 标记', () => {
      const result = diff('<p>hello world</p>', '<p>hello earth</p>');
      const op = result.ops[0];
      expect(op.inlineDiff).toBeDefined();

      const allParts = [
        ...op.inlineDiff!.oldSegments.flatMap(s => s.parts),
        ...op.inlineDiff!.newSegments.flatMap(s => s.parts),
      ];
      const hasStyleChanged = allParts.some(p => p.styleChanged);
      expect(hasStyleChanged).toBe(false);
    });

    it('块首尾空白应被正确 trim', () => {
      // 验证 block-level trim 正常工作
      const result = diff(
        '<p>  Hello world  </p>',
        '<p>Hello world</p>',
      );
      // 归一化后应无差异
      expect(result.hasDiff).toBe(false);
    });

    it('inline mark 中间的空白不被 trim', () => {
      // 验证 segment 间的空白得到保留
      const result = diff(
        '<p>Hello world</p>',
        '<p><strong>Hello</strong> world</p>',
        { inlineTags: ['strong'] },
      );
      const op = result.ops[0];
      // identity key 应匹配（空格未被吃掉）
      expect(op.type).toBe('equal');
    });
  });
});
