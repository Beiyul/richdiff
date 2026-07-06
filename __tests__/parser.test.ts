import { describe, it, expect } from 'vitest';
import { parseBlocks } from '../src/parser';
import { DEFAULT_CONFIG } from '../src/config';
import type { RichTextDiffConfig } from '../src/config';

const config: RichTextDiffConfig = { ...DEFAULT_CONFIG };

describe('parser', () => {
  describe('基础解析', () => {
    it('解析简单文本段落', () => {
      const blocks = parseBlocks('<p>hello world</p>', config);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('text');
      if (blocks[0].type === 'text') {
        expect(blocks[0].segments).toHaveLength(1);
        expect(blocks[0].segments[0].text).toBe('hello world');
      }
    });

    it('解析多个段落', () => {
      const blocks = parseBlocks('<p>A</p><p>B</p>', config);
      expect(blocks).toHaveLength(2);
    });

    it('解析图片', () => {
      const blocks = parseBlocks('<img src="http://a.com/x.jpg">', config);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('image');
      if (blocks[0].type === 'image') {
        expect(blocks[0].src).toBe('http://a.com/x.jpg');
      }
    });

    it('解析视频', () => {
      const blocks = parseBlocks('<iframe src="http://a.com/x.mp4"></iframe>', config);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('video');
    });
  });

  describe('Marks 捕获', () => {
    it('捕获 strong 标签为 mark', () => {
      const blocks = parseBlocks('<p>普通<strong>加粗</strong>普通</p>', config);
      expect(blocks).toHaveLength(1);
      if (blocks[0].type === 'text') {
        const segs = blocks[0].segments;
        // 3 segments: "普通", "加粗"(strong), "普通"
        expect(segs).toHaveLength(3);
        expect(segs[0].marks.filter(m => m.tag === 'strong')).toHaveLength(0);
        expect(segs[1].marks.filter(m => m.tag === 'strong')).toHaveLength(1);
        expect(segs[2].marks.filter(m => m.tag === 'strong')).toHaveLength(0);
      }
    });

    it('捕获嵌套标签为 marks 链', () => {
      const blocks = parseBlocks('<p><strong><em>text</em></strong></p>', config);
      if (blocks[0].type === 'text') {
        const seg = blocks[0].segments[0];
        const inlineMarks = seg.marks.filter(m => m.tag !== 'p');
        expect(inlineMarks).toHaveLength(2);
        expect(inlineMarks[0].tag).toBe('strong');
        expect(inlineMarks[1].tag).toBe('em');
      }
    });

    it('链接携带当前 marks 栈', () => {
      const html = '<p><strong><a href="http://a.com">link</a></strong></p>';
      const blocks = parseBlocks(html, config);
      if (blocks[0].type === 'text') {
        const linkSeg = blocks[0].segments[0];
        expect(linkSeg.type).toBe('link');
        if (linkSeg.type === 'link') {
          expect(linkSeg.href).toBe('http://a.com');
          expect(linkSeg.marks.filter(m => m.tag === 'strong')).toHaveLength(1);
        }
      }
    });
  });

  describe('Segment 归一化', () => {
    it('相同 marks 的相邻文本 segment 合并', () => {
      const html = '<p>aa<strong>b</strong>cc<strong>d</strong>ee</p>';
      const blocks = parseBlocks(html, config);
      if (blocks[0].type === 'text') {
        const segs = blocks[0].segments;
        // "aa", "b"(strong), "cc", "d"(strong), "ee" → 5 segments
        // "cc" and "ee" have same marks (no strong) but are not adjacent
        expect(segs).toHaveLength(5);
      }
    });

    it('不同 marks 的相邻文本 segment 不合并', () => {
      const html = '<p>a<strong>b</strong>c</p>';
      const blocks = parseBlocks(html, config);
      if (blocks[0].type === 'text') {
        expect(blocks[0].segments).toHaveLength(3);
        expect(blocks[0].segments[0].text).toBe('a');
        expect(blocks[0].segments[1].text).toBe('b');
        expect(blocks[0].segments[2].text).toBe('c');
      }
    });
  });

  describe('Block 样式', () => {
    it('提取块级 CSS 属性', () => {
      const html = '<p style="text-align: center;">text</p>';
      const blocks = parseBlocks(html, config);
      if (blocks[0].type === 'text') {
        expect(blocks[0].blockStyles['text-align']).toBe('center');
      }
    });

    it('无 style 属性时 blockStyles 为空', () => {
      const blocks = parseBlocks('<p>text</p>', config);
      if (blocks[0].type === 'text') {
        expect(Object.keys(blocks[0].blockStyles)).toHaveLength(0);
      }
    });
  });

  describe('可配置 blockTags', () => {
    it('自定义 blockTags 识别自定义块级标签', () => {
      const customConfig = { ...config, blockTags: ['p', 'section'] };
      const blocks = parseBlocks('<section>text</section>', customConfig);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('text');
    });

    it('默认配置不识别 section 为块级标签', () => {
      const blocks = parseBlocks('<section><p>text</p></section>', config);
      // section 不是块级标签，递归到 p
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('text');
    });
  });
});
