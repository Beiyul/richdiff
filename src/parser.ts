/**
 * 富文本 diff 的解析层。
 *
 * 将原始 HTML 解析为 SemanticBlock[]，始终捕获完整样式链（marks），
 * 不根据配置过滤——配置仅在 diff 阶段生效。
 */
import { escapeHtml, defaultNormalizeText } from './text-utils';
import type { RichTextDiffConfig } from './config';
import type { Mark, Segment, TextSegment, LinkSegment, RichTextBlock, TextBlock, MediaBlock } from './types';

// ===== 属性提取 =====

/** 提取标签属性，跳过对 diff 无意义的 data-* / aria-* 属性以减少内存占用 */
function extractAttrs(el: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const name = attr.name;
    // data-* 和 aria-* 属性对富文本 diff 无意义，跳过
    if (name.startsWith('data-') || name.startsWith('aria-')) continue;
    attrs[name] = attr.value;
  }
  return attrs;
}

function extractBlockStyles(el: HTMLElement): Record<string, string> {
  const styles: Record<string, string> = {};
  const styleMap = el.style;
  for (let i = 0; i < styleMap.length; i++) {
    const prop = styleMap[i];
    styles[prop] = styleMap.getPropertyValue(prop);
  }
  return styles;
}

// ===== Marks 工具 =====

/** 完整比较两组 marks（用于解析阶段的 segment 合并判断） */
function marksEqual(a: Mark[], b: Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.tag === b[i].tag && attrsEqual(m.attrs, b[i].attrs));
}

function attrsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, i) => key === bKeys[i] && a[key] === b[key]);
}

// ===== Segment 收集 =====

function pushTextSegment(segments: Segment[], rawText: string, marks: Mark[]) {
  if (!rawText) return;

  const lastSegment = segments[segments.length - 1];
  if (lastSegment && lastSegment.type === 'text' && marksEqual(lastSegment.marks, marks)) {
    lastSegment.text += rawText;
    return;
  }

  segments.push({
    type: 'text',
    text: rawText,
    marks: [...marks],
  });
}

function collectInlineSegments(
  node: Node,
  segments: Segment[],
  parentMarks: Mark[],
  normalizeText: (text: string) => string,
) {
  if (node.nodeType === Node.TEXT_NODE) {
    pushTextSegment(segments, node.textContent ?? '', parentMarks);
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  const tagName = node.tagName.toLowerCase();

  // <br> 没有文本语义，跳过
  if (tagName === 'br') return;

  // <a> 作为链接 segment，携带当前 marks 栈
  if (tagName === 'a') {
    const text = normalizeText(node.textContent ?? '');
    if (text) {
      segments.push({
        type: 'link',
        text,
        href: (node.getAttribute('href') || '').trim(),
        marks: [...parentMarks],
      });
    }
    return;
  }

  // 其他标签：记录到 marks 栈，递归子节点
  const mark: Mark = { tag: tagName, attrs: extractAttrs(node) };
  const currentMarks = [...parentMarks, mark];

  Array.from(node.childNodes).forEach(child =>
    collectInlineSegments(child, segments, currentMarks, normalizeText),
  );
}

// ===== Segment 归一化 =====

function normalizeInlineSegments(
  segments: Segment[],
  normalizeText: (text: string) => string,
): Segment[] {
  const result = segments.reduce<Segment[]>((acc, segment) => {
    // 链接 segment
    if (segment.type === 'link') {
      if (!segment.text) return acc;
      acc.push(segment);
      return acc;
    }

    // 文本 segment：应用 normalizeText（不再包含 trim）
    const text = normalizeText(segment.text);
    if (!text) return acc;

    const lastSegment = acc[acc.length - 1];
    if (lastSegment && lastSegment.type === 'text' && marksEqual(lastSegment.marks, segment.marks)) {
      lastSegment.text = normalizeText(lastSegment.text + text);
      return acc;
    }

    acc.push({
      type: 'text',
      text,
      marks: segment.marks,
    });

    return acc;
  }, []);

  // Block-level trim: 仅修剪首尾空白，保留 segment 之间的空白
  trimBlockLevelWhitespace(result);

  return result;
}

/** 块级 trim：移除第一个文本 segment 的前导空白和最后一个文本 segment 的尾部空白 */
function trimBlockLevelWhitespace(segments: Segment[]): void {
  // Trim leading whitespace from first text segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'link') continue;
    seg.text = seg.text.trimStart();
    if (seg.text) break;
    // Segment became empty, remove it and continue to next
    segments.splice(i, 1);
    i--;
  }

  // Trim trailing whitespace from last text segment
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.type === 'link') continue;
    seg.text = seg.text.trimEnd();
    if (seg.text) break;
    // Segment became empty, remove it and continue to previous
    segments.splice(i, 1);
  }
}

// ===== Block 创建 =====

function createTextBlockFromElement(
  element: HTMLElement,
  normalizeText: (text: string) => string,
): TextBlock | null {
  const html = element.outerHTML;
  const rawSegments: Segment[] = [];
  collectInlineSegments(element, rawSegments, [], normalizeText);
  const segments = normalizeInlineSegments(rawSegments, normalizeText);

  if (!segments.length) return null;

  return {
    type: 'text',
    html,
    segments,
    blockStyles: extractBlockStyles(element),
  };
}

function createTextBlockFromText(
  text: string,
  normalizeText: (text: string) => string,
): TextBlock | null {
  const normalized = normalizeText(text).trim();
  if (!normalized) return null;

  return {
    type: 'text',
    html: '<p>' + escapeHtml(normalized) + '</p>',
    segments: [{ type: 'text', text: normalized, marks: [] }],
    blockStyles: {},
  };
}

// ===== Block 遍历 =====

function walkBlocks(
  node: Node,
  blocks: RichTextBlock[],
  blockTagSet: Set<string>,
  normalizeText: (text: string) => string,
) {
  if (node.nodeType === Node.TEXT_NODE) {
    const block = createTextBlockFromText(node.textContent ?? '', normalizeText);
    if (block) blocks.push(block);
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  const tagName = node.tagName.toLowerCase();

  // 图片
  if (tagName === 'img') {
    const src = node.getAttribute('src')?.trim();
    if (src) {
      blocks.push({ type: 'image', html: node.outerHTML, src });
    }
    return;
  }

  // 视频
  if (tagName === 'iframe' || tagName === 'video') {
    const src = (node.getAttribute('src') || node.getAttribute('data-src') || '').trim();
    if (src) {
      blocks.push({ type: 'video', html: node.outerHTML, src });
    }
    return;
  }

  // 链接作为文本块
  if (tagName === 'a') {
    const block = createTextBlockFromElement(node, normalizeText);
    if (block) blocks.push(block);
    return;
  }

  // 块级标签
  if (blockTagSet.has(tagName)) {
    const hasMediaDescendant = !!node.querySelector('img, iframe, video');
    if (!hasMediaDescendant) {
      const block = createTextBlockFromElement(node, normalizeText);
      if (block) {
        blocks.push(block);
        return;
      }
    }
  }

  // 递归子节点
  Array.from(node.childNodes).forEach(child =>
    walkBlocks(child, blocks, blockTagSet, normalizeText),
  );
}

// ===== 公共 API =====

export function parseBlocks(html: string, config: RichTextDiffConfig): RichTextBlock[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  const blocks: RichTextBlock[] = [];
  const blockTagSet = new Set(config.blockTags);
  const normalizeText = config.normalizeText ?? defaultNormalizeText;

  Array.from(container.childNodes).forEach(node =>
    walkBlocks(node, blocks, blockTagSet, normalizeText),
  );

  return blocks;
}
