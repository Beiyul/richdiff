/**
 * 富文本 diff 的核心算法层。
 *
 * 两级 diff + 样式变更检测 + HTML 装饰：
 * 1. 块级 LCS 对齐（配置驱动的内容键）
 * 2. 行内 diff（四场景策略：结构一致 / 结构不一致 + marks 叠加）
 * 3. HTML 装饰（将 diff 结果注入原始 HTML，生成可直接渲染的带 class 的 HTML）
 */
import { diffChars, type Change } from 'diff';

import { escapeHtml, defaultNormalizeText } from './text-utils';
import type { RichTextDiffConfig, IDiffClassNames } from './config';
import type {
  Mark,
  Segment,
  TextSegment,
  LinkSegment,
  TextBlock,
  RichTextBlock,
  DiffPart,
  DiffSegment,
  InlineDiff,
  DiffOp,
  DiffResult,
} from './types';

/** 身份键不再截断前缀，使用全文精确匹配。
 *  修改过的块通过相似度回退（mergeSimilarDeleteInsertPairs）处理。 */

// ===== Marks 过滤与比较（配置驱动） =====

/** 按配置筛选 marks，只保留参与比对的标签和属性 */
export function filterMarks(marks: Mark[], config: RichTextDiffConfig): Mark[] {
  return marks
    .filter(m => config.inlineTags.includes(m.tag))
    .map(m => ({
      tag: m.tag,
      attrs: filterAttrs(m.attrs, config.compareAttributes),
    }));
}

function filterAttrs(attrs: Record<string, string>, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (key in attrs) {
      result[key] = attrs[key];
    }
  }
  return result;
}

/** 比较两组 marks 在配置范围内是否等价 */
export function filteredMarksEqual(
  a: Mark[],
  b: Mark[],
  config: RichTextDiffConfig,
): boolean {
  const fa = filterMarks(a, config);
  const fb = filterMarks(b, config);
  if (fa.length !== fb.length) return false;
  return fa.every((m, i) => {
    if (m.tag !== fb[i].tag) return false;
    const aKeys = Object.keys(m.attrs).sort();
    const bKeys = Object.keys(fb[i].attrs).sort();
    return aKeys.length === bKeys.length && aKeys.every((k, j) => k === bKeys[j] && m.attrs[k] === fb[i].attrs[k]);
  });
}

/** 按配置序列化 marks，用于内容键 */
function serializeMarks(marks: Mark[], config: RichTextDiffConfig): string {
  return filterMarks(marks, config)
    .map(m => {
      const attrs = Object.entries(filterAttrs(m.attrs, config.compareAttributes))
        .map(([k, v]) => k + '=' + v)
        .join(',');
      return m.tag + '{' + attrs + '}';
    })
    .join('>');
}

/** 按配置序列化块级样式，用于内容键 */
function serializeBlockStyles(styles: Record<string, string>, config: RichTextDiffConfig): string {
  return config.compareBlockStyles
    .filter(prop => prop in styles)
    .map(prop => prop + '=' + styles[prop])
    .join(',');
}

// ===== 块级身份键与内容键 =====

function isPureLinkTextBlock(block: TextBlock): boolean {
  return block.segments.length === 1 && block.segments[0].type === 'link';
}

function getTextIdentityContent(block: TextBlock): string {
  return block.segments
    .map(s => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 身份键：以文本为主，保证相同文本的块能对齐（配置无关） */
function getBlockIdentityKey(block: RichTextBlock): string {
  switch (block.type) {
    case 'text':
      if (isPureLinkTextBlock(block)) {
        return 'link:' + (block.segments[0] as LinkSegment).href;
      }
      return 'text:' + getTextIdentityContent(block);
    case 'image':
      return 'image:' + block.src;
    case 'video':
      return 'video:' + block.src;
  }
}

/** 内容键：纳入配置中开启的样式信息 */
function getBlockContentKey(block: RichTextBlock, config: RichTextDiffConfig): string {
  switch (block.type) {
    case 'text': {
      // 当 inlineTags 为空时，忽略 segment 边界，只用完整文本做内容键
      // 避免"未参与 diff 的标签"导致 segment 切分不同而误判为 changed
      if (config.inlineTags.length === 0) {
        const fullText = block.segments
          .map(seg => seg.type === 'link' ? 'link:' + seg.href + '|' + seg.text : seg.text)
          .join('');
        return 'text:' + fullText;
      }

      const segPart = block.segments
        .map(seg => {
          if (seg.type === 'text') {
            const stylePart = ':' + serializeMarks(seg.marks, config);
            return 'text:' + seg.text + stylePart;
          }
          const linkStyle = ':' + serializeMarks(seg.marks, config);
          return 'link:' + seg.href + '|' + seg.text + linkStyle;
        })
        .join('||');
      const blockStylePart = config.compareBlockStyles.length
        ? '|block:' + serializeBlockStyles(block.blockStyles, config)
        : '';
      return segPart + blockStylePart;
    }
    case 'image':
      return 'image:' + block.src;
    case 'video':
      return 'video:' + block.src;
  }
}

// ===== 块级 LCS =====

function buildLcsMatrix(oldList: string[], newList: string[]): number[][] {
  const dp: number[][] = Array.from({ length: oldList.length + 1 }, () =>
    Array(newList.length + 1).fill(0),
  );
  for (let oldIndex = oldList.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newList.length - 1; newIndex >= 0; newIndex--) {
      if (oldList[oldIndex] === newList[newIndex]) {
        dp[oldIndex][newIndex] = dp[oldIndex + 1][newIndex + 1] + 1;
      } else {
        dp[oldIndex][newIndex] = Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
      }
    }
  }
  return dp;
}

function buildBlockDiffOps(
  oldBlocks: RichTextBlock[],
  newBlocks: RichTextBlock[],
  config: RichTextDiffConfig,
): DiffOp[] {
  const oldKeys = oldBlocks.map(b => getBlockIdentityKey(b));
  const newKeys = newBlocks.map(b => getBlockIdentityKey(b));
  const dp = buildLcsMatrix(oldKeys, newKeys);
  const ops: DiffOp[] = [];

  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldBlocks.length && newIndex < newBlocks.length) {
    if (oldKeys[oldIndex] === newKeys[newIndex]) {
      const changed = getBlockContentKey(oldBlocks[oldIndex], config) !== getBlockContentKey(newBlocks[newIndex], config);
      ops.push({
        type: 'equal',
        oldBlock: oldBlocks[oldIndex],
        newBlock: newBlocks[newIndex],
        changed,
      });
      oldIndex++;
      newIndex++;
      continue;
    }

    if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      ops.push({ type: 'delete', oldBlock: oldBlocks[oldIndex] });
      oldIndex++;
      continue;
    }

    ops.push({ type: 'insert', newBlock: newBlocks[newIndex] });
    newIndex++;
  }

  while (oldIndex < oldBlocks.length) {
    ops.push({ type: 'delete', oldBlock: oldBlocks[oldIndex] });
    oldIndex++;
  }

  while (newIndex < newBlocks.length) {
    ops.push({ type: 'insert', newBlock: newBlocks[newIndex] });
    newIndex++;
  }

  return ops;
}

// ===== 行内 diff 工具 =====

function pushPart(parts: DiffPart[], text: string, changed: boolean, styleChanged?: boolean) {
  if (!text) return;
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.changed === changed && lastPart.styleChanged === styleChanged) {
    lastPart.text += text;
    return;
  }
  const part: DiffPart = { text, changed };
  if (styleChanged) part.styleChanged = true;
  parts.push(part);
}

function buildTextDiff(oldText: string, newText: string) {
  const oldParts: DiffPart[] = [];
  const newParts: DiffPart[] = [];

  diffChars(oldText, newText).forEach((change: Change) => {
    if (change.added) {
      pushPart(newParts, change.value, true);
      return;
    }
    if (change.removed) {
      pushPart(oldParts, change.value, true);
      return;
    }
    pushPart(oldParts, change.value, false);
    pushPart(newParts, change.value, false);
  });

  return { oldParts, newParts };
}

function createPlainParts(text: string, changed: boolean): DiffPart[] {
  return text ? [{ text, changed }] : [];
}

// ===== 行内 diff：四场景策略 =====

/** 判断 segment 结构是否一致（数量和类型相同） */
function segmentsStructureMatch(oldSegs: Segment[], newSegs: Segment[]): boolean {
  if (oldSegs.length !== newSegs.length) return false;
  return oldSegs.every((seg, i) => seg.type === newSegs[i].type);
}

/** 获取样式变更类型 */
function getStyleChange(
  oldMarks: Mark[],
  newMarks: Mark[],
  config: RichTextDiffConfig,
  side: 'old' | 'new',
): 'added' | 'removed' | 'changed' | null {
  if (filteredMarksEqual(oldMarks, newMarks, config)) return null;

  const oldFiltered = filterMarks(oldMarks, config);
  const newFiltered = filterMarks(newMarks, config);

  // 同数量同标签 → 属性变更
  if (oldFiltered.length === newFiltered.length) {
    const sameTags = oldFiltered.every((m, i) => m.tag === newFiltered[i].tag);
    if (sameTags) return 'changed';
  }

  // 不同标签或不同数量
  return side === 'old' ? 'removed' : 'added';
}

/** 场景 1：segment 结构一致 → 逐 segment 比较 */
function buildInlineDiffStructured(
  oldSegs: Segment[],
  newSegs: Segment[],
  config: RichTextDiffConfig,
): InlineDiff {
  return {
    oldSegments: oldSegs.map((oldSeg, i) =>
      buildDiffSegment(oldSeg, newSegs[i], 'old', config),
    ),
    newSegments: newSegs.map((newSeg, i) =>
      buildDiffSegment(oldSegs[i], newSeg, 'new', config),
    ),
  };
}

function buildDiffSegment(
  oldSeg: Segment,
  newSeg: Segment,
  side: 'old' | 'new',
  config: RichTextDiffConfig,
): DiffSegment {
  // 文本 segment
  if (oldSeg.type === 'text' && newSeg.type === 'text') {
    const styleChange = getStyleChange(oldSeg.marks, newSeg.marks, config, side);
    const { oldParts, newParts } = buildTextDiff(oldSeg.text, newSeg.text);
    const parts = side === 'old' ? oldParts : newParts;

    // Mark unchanged parts as styleChanged when marks differ
    if (styleChange) {
      for (const part of parts) {
        if (!part.changed) {
          part.styleChanged = true;
        }
      }
    }

    return {
      type: 'text',
      parts,
      styleChange,
    };
  }

  // 链接 segment
  const oldLink = oldSeg as LinkSegment;
  const newLink = newSeg as LinkSegment;
  const hrefChanged = oldLink.href !== newLink.href;
  const styleChange = getStyleChange(oldLink.marks, newLink.marks, config, side);

  let parts: DiffPart[];
  if (hrefChanged) {
    parts = createPlainParts(side === 'old' ? oldLink.text : newLink.text, true);
  } else {
    const { oldParts, newParts } = buildTextDiff(oldLink.text, newLink.text);
    parts = side === 'old' ? oldParts : newParts;
  }

  return {
    type: 'link',
    parts,
    href: side === 'old' ? oldLink.href : newLink.href,
    hrefChanged,
    styleChange,
  };
}

/** 场景 2：segment 结构不一致 → 文本 diff + marks 叠加 */
function flattenSegments(segs: Segment[]): { text: string; charMarks: Mark[][] } {
  let text = '';
  const charMarks: Mark[][] = [];

  for (const seg of segs) {
    const chars = Array.from(seg.text);
    text += seg.text;
    for (const _ of chars) {
      charMarks.push(seg.marks);
    }
  }

  return { text, charMarks };
}

function buildInlineDiffWithOverlay(
  oldSegs: Segment[],
  newSegs: Segment[],
  config: RichTextDiffConfig,
): InlineDiff {
  const oldFlat = flattenSegments(oldSegs);
  const newFlat = flattenSegments(newSegs);

  const changes = diffChars(oldFlat.text, newFlat.text);
  const oldParts: DiffPart[] = [];
  const newParts: DiffPart[] = [];
  let oldPos = 0;
  let newPos = 0;
  let hasStyleChange = false;

  for (const change of changes) {
    if (change.added) {
      pushPart(newParts, change.value, true);
      newPos += Array.from(change.value).length;
    } else if (change.removed) {
      pushPart(oldParts, change.value, true);
      oldPos += Array.from(change.value).length;
    } else {
      // Unchanged text — split at mark-change boundaries so that
      // style-changed characters get their own highlighted parts
      const chars = Array.from(change.value);
      let runStart = 0;
      let prevMarksSame: boolean | null = null;

      for (let i = 0; i <= chars.length; i++) {
        const atEnd = i === chars.length;
        const marksSame = !atEnd &&
          filteredMarksEqual(oldFlat.charMarks[oldPos + i], newFlat.charMarks[newPos + i], config);

        if (prevMarksSame === null) {
          prevMarksSame = marksSame;
          continue;
        }

        if (atEnd || marksSame !== prevMarksSame) {
          const runText = chars.slice(runStart, i).join('');
          if (runText) {
            if (prevMarksSame) {
              pushPart(oldParts, runText, false);
              pushPart(newParts, runText, false);
            } else {
              hasStyleChange = true;
              pushPart(oldParts, runText, false, true);
              pushPart(newParts, runText, false, true);
            }
          }
          runStart = i;
          prevMarksSame = marksSame;
        }
      }

      oldPos += chars.length;
      newPos += chars.length;
    }
  }

  return {
    oldSegments: [{
      type: 'text',
      parts: oldParts,
      styleChange: hasStyleChange ? 'changed' : null,
    }],
    newSegments: [{
      type: 'text',
      parts: newParts,
      styleChange: hasStyleChange ? 'changed' : null,
    }],
  };
}

/** 行内 diff 主入口 */
function buildInlineDiff(
  oldBlock: TextBlock,
  newBlock: TextBlock,
  config: RichTextDiffConfig,
): InlineDiff {
  const oldSegs = oldBlock.segments;
  const newSegs = newBlock.segments;

  // 场景 1：结构一致 → 逐 segment 精细比较
  if (segmentsStructureMatch(oldSegs, newSegs)) {
    return buildInlineDiffStructured(oldSegs, newSegs, config);
  }

  // 场景 2：结构不一致 → 文本 diff + marks 叠加
  return buildInlineDiffWithOverlay(oldSegs, newSegs, config);
}

// ===== HTML 装饰：将 diff 结果注入原始 HTML =====

/** 把 parts 转成最终可插入 DOM 的 HTML 字符串 */
function buildPartsHtml(parts: DiffPart[], className: string): string {
  return parts
    .map(p => {
      if (p.changed || p.styleChanged) {
        return '<span class="' + className + '">' + escapeHtml(p.text) + '</span>';
      }
      return escapeHtml(p.text);
    })
    .join('');
}

/** parts 消费游标 */
function createPartsCursor(parts: DiffPart[]) {
  return { partIndex: 0, charIndex: 0, parts };
}

/** 按原始文本节点的边界分配已切好的 diff parts */
function consumeParts(
  cursor: ReturnType<typeof createPartsCursor>,
  length: number,
): DiffPart[] {
  let remain = length;
  const result: DiffPart[] = [];

  while (remain > 0 && cursor.partIndex < cursor.parts.length) {
    const part = cursor.parts[cursor.partIndex];
    const chars = Array.from(part.text);
    const chunk = chars.slice(cursor.charIndex, cursor.charIndex + remain).join('');

    if (chunk) {
      const last = result[result.length - 1];
      if (last && last.changed === part.changed && last.styleChanged === part.styleChanged) {
        last.text += chunk;
      } else {
        const newPart: DiffPart = { text: chunk, changed: part.changed };
        if (part.styleChanged) newPart.styleChanged = true;
        result.push(newPart);
      }
    }

    const consumed = Array.from(chunk).length;
    cursor.charIndex += consumed;
    remain -= consumed;

    if (cursor.charIndex >= chars.length) {
      cursor.partIndex++;
      cursor.charIndex = 0;
    }
  }

  return result;
}

/** 收集 DOM 中所有非空白文本节点（深度优先） */
function collectTextNodes(root: Node): { node: Node; rawText: string }[] {
  const result: { node: Node; rawText: string }[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const rawText = node.textContent ?? '';
      if (rawText.trim()) {
        result.push({ node, rawText });
      }
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    Array.from(node.childNodes).forEach(child => walk(child));
  };
  walk(root);
  return result;
}

/** 将行内 diff 高亮注入文本块的原始 HTML */
function decorateTextBlockHtml(
  block: TextBlock,
  segments: DiffSegment[],
  side: 'old' | 'new',
  config: RichTextDiffConfig,
): string {
  const container = document.createElement('div');
  container.innerHTML = block.html;
  const cn = config.classNames;
  const inlineClass = side === 'old' ? cn.inlineDeleted : cn.inlineInserted;
  const linkClass = side === 'old' ? cn.linkDeleted : cn.linkInserted;

  const textSegments = segments.filter(s => s.type === 'text');
  const linkSegments = segments.filter(s => s.type === 'link');

  const normalizeFn = config.normalizeText ?? defaultNormalizeText;

  // Pre-scan: collect text nodes, then trim first/last to match block-level parser trim
  const textNodes = collectTextNodes(container);

  let cursor = textSegments[0] ? createPartsCursor(textSegments[0].parts) : null;
  let segIdx = 0;

  const advanceCursor = () => {
    segIdx++;
    cursor = textSegments[segIdx] ? createPartsCursor(textSegments[segIdx].parts) : null;
  };

  // Process text nodes with block-level trim awareness
  for (let i = 0; i < textNodes.length; i++) {
    if (!cursor) break;

    const { node, rawText } = textNodes[i];
    let normalized = normalizeFn(rawText);
    if (!normalized) continue;

    // Block-level trim: match what the parser does
    if (i === 0) {
      normalized = normalized.trimStart();
    }
    if (i === textNodes.length - 1) {
      normalized = normalized.trimEnd();
    }
    if (!normalized) continue;

    const parts = consumeParts(cursor, Array.from(normalized).length);
    const span = document.createElement('span');
    span.innerHTML = buildPartsHtml(parts, inlineClass);
    node.parentNode?.replaceChild(span, node);

    if (cursor.partIndex >= cursor.parts.length) {
      advanceCursor();
    }
  }

  // Handle <a> tags (links)
  let linkIdx = 0;
  const walkLinks = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName.toLowerCase() === 'a') {
      const seg = linkSegments[linkIdx];
      if (seg) {
        if (seg.parts && seg.parts.length) {
          node.innerHTML = buildPartsHtml(seg.parts, inlineClass);
        } else if (seg.hrefChanged) {
          node.classList.add(linkClass);
        }
      }
      linkIdx++;
      return;
    }
    Array.from(node.childNodes).forEach(child => walkLinks(child));
  };
  Array.from(container.childNodes).forEach(child => walkLinks(child));

  return container.innerHTML;
}

/** 整块高亮（用于 insert/delete 的块） */
function decorateWholeTextBlockHtml(
  block: TextBlock,
  side: 'old' | 'new',
  config: RichTextDiffConfig,
): string {
  const container = document.createElement('div');
  container.innerHTML = block.html;
  const cn = config.classNames;
  const inlineClass = side === 'old' ? cn.inlineDeleted : cn.inlineInserted;
  const linkClass = side === 'old' ? cn.linkDeleted : cn.linkInserted;
  const normalizeFn = config.normalizeText ?? defaultNormalizeText;

  const textNodes = collectTextNodes(container);

  for (let i = 0; i < textNodes.length; i++) {
    const { node, rawText } = textNodes[i];
    let normalized = normalizeFn(rawText);
    if (!normalized) continue;

    // Block-level trim: match what the parser does
    if (i === 0) {
      normalized = normalized.trimStart();
    }
    if (i === textNodes.length - 1) {
      normalized = normalized.trimEnd();
    }
    if (!normalized) continue;

    const span = document.createElement('span');
    span.innerHTML = '<span class="' + inlineClass + '">' + escapeHtml(normalized) + '</span>';
    node.parentNode?.replaceChild(span, node);
  }

  // Handle <a> tags (links)
  const walkLinks = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName.toLowerCase() === 'a') {
      node.classList.add(linkClass);
      return;
    }
    Array.from(node.childNodes).forEach(child => walkLinks(child));
  };
  Array.from(container.childNodes).forEach(child => walkLinks(child));

  return container.innerHTML;
}

/** 根据 diff 状态决定装饰方式，生成最终 HTML */
function renderBlockHtml(
  block: RichTextBlock,
  segments: DiffSegment[] | undefined,
  side: 'old' | 'new',
  highlightWhole: boolean,
  config: RichTextDiffConfig,
): string {
  if (block.type === 'text') {
    if (segments) {
      return decorateTextBlockHtml(block, segments, side, config);
    }
    if (highlightWhole) {
      return decorateWholeTextBlockHtml(block, side, config);
    }
  }
  return block.html;
}

// ===== 相似度回退：delete+insert → equal+changed =====

/** 相似度阈值：unchanged 占比超过此值则认为是同一段落 */
const SIMILARITY_THRESHOLD = 0.5;

/** 用 diffChars 计算两段文本的相似度（unchanged 字符占比） */
function textSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const changes = diffChars(a, b);
  const totalLen = Math.max(Array.from(a).length, Array.from(b).length);
  if (totalLen === 0) return 1;
  const unchangedLen = changes
    .filter(c => !c.added && !c.removed)
    .reduce((sum, c) => sum + Array.from(c.value).length, 0);
  return unchangedLen / totalLen;
}

/**
 * 扫描 ops，将连续的非 equal ops 作为一个"变更窗口"，
 * 在窗口内双向匹配 delete+insert 对（不限于相邻）。
 *
 * 借鉴 Git --word-diff 的两段式策略：
 * 1. LCS 精确匹配未变更块（equal）
 * 2. 变更窗口内按相似度匹配 delete↔insert，合并为 equal+changed
 */
function mergeSimilarDeleteInsertPairs(ops: DiffOp[]): DiffOp[] {
  const result: DiffOp[] = [];
  let i = 0;

  while (i < ops.length) {
    // equal 块直接输出
    if (ops[i].type === 'equal') {
      result.push(ops[i]);
      i++;
      continue;
    }

    // 收集变更窗口：连续的非 equal ops
    const groupStart = i;
    while (i < ops.length && ops[i].type !== 'equal') {
      i++;
    }
    const group = ops.slice(groupStart, i);

    // 第一遍：在窗口内找到所有 delete↔insert 匹配
    const matchedInserts = new Set<number>();
    const matchedDeletes = new Set<number>();
    // mergeAtInsert[j] = { oldBlock, newBlock }：在 insert 位置 j 放置合并 op
    const mergeAtInsert = new Map<number, { oldBlock: RichTextBlock; newBlock: RichTextBlock }>();

    for (let g = 0; g < group.length; g++) {
      const op = group[g];
      if (op.type !== 'delete' || !op.oldBlock || op.oldBlock.type !== 'text') continue;

      const oldText = op.oldBlock.segments.map(s => s.text).join('');
      let bestIdx = -1;
      let bestSim = 0;

      for (let j = 0; j < group.length; j++) {
        if (matchedInserts.has(j)) continue;
        const candidate = group[j];
        if (candidate.type !== 'insert' || !candidate.newBlock || candidate.newBlock.type !== 'text') continue;

        const newText = candidate.newBlock.segments.map(s => s.text).join('');
        const sim = textSimilarity(oldText, newText);

        if (sim >= SIMILARITY_THRESHOLD && sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }

      if (bestIdx >= 0) {
        matchedInserts.add(bestIdx);
        matchedDeletes.add(g);
        // 合并 op 放在 insert 的位置（新版本的顺序），不是 delete 的位置
        mergeAtInsert.set(bestIdx, { oldBlock: op.oldBlock!, newBlock: group[bestIdx].newBlock! });
      }
    }

    // 第二遍：按原始顺序输出，匹配的 insert 位置替换为合并 op
    const groupResult: DiffOp[] = [];
    for (let g = 0; g < group.length; g++) {
      // 跳过已匹配的 delete（它的内容已合并到 insert 位置）
      if (matchedDeletes.has(g)) continue;

      // 如果此位置是匹配的 insert，输出合并 op
      if (mergeAtInsert.has(g)) {
        const m = mergeAtInsert.get(g)!;
        groupResult.push({
          type: 'equal' as const,
          oldBlock: m.oldBlock,
          newBlock: m.newBlock,
          changed: true,
        });
        continue;
      }

      // 跳过已匹配的 insert（已被合并 op 替代）
      if (matchedInserts.has(g)) continue;

      groupResult.push(group[g]);
    }

    result.push(...groupResult);
  }

  return result;
}

// ===== DiffResult 组装 =====

export function buildDiffResult(
  oldBlocks: RichTextBlock[],
  newBlocks: RichTextBlock[],
  config: RichTextDiffConfig,
): DiffResult {
  let ops = buildBlockDiffOps(oldBlocks, newBlocks, config);

  // 相似度回退：将匹配失败但实际是同一段落的 delete+insert 合并为 equal+changed
  ops = mergeSimilarDeleteInsertPairs(ops);

  for (const op of ops) {
    if (op.type === 'equal' && op.oldBlock && op.newBlock) {
      if (op.changed) {
        // 块内容有变化：生成 inlineDiff + 装饰 HTML
        if (op.oldBlock.type === 'text' && op.newBlock.type === 'text') {
          op.inlineDiff = buildInlineDiff(op.oldBlock, op.newBlock, config);
          op.oldHtml = renderBlockHtml(op.oldBlock, op.inlineDiff.oldSegments, 'old', false, config);
          op.newHtml = renderBlockHtml(op.newBlock, op.inlineDiff.newSegments, 'new', false, config);
        } else {
          // 媒体块变更：整块高亮
          op.oldHtml = renderBlockHtml(op.oldBlock, undefined, 'old', true, config);
          op.newHtml = renderBlockHtml(op.newBlock, undefined, 'new', true, config);
        }
      } else {
        // 无变化：原始 HTML
        op.oldHtml = op.oldBlock.html;
        op.newHtml = op.newBlock.html;
      }
    } else if (op.type === 'delete' && op.oldBlock) {
      op.oldHtml = renderBlockHtml(op.oldBlock, undefined, 'old', true, config);
    } else if (op.type === 'insert' && op.newBlock) {
      op.newHtml = renderBlockHtml(op.newBlock, undefined, 'new', true, config);
    }
  }

  return {
    ops,
    hasDiff: ops.some(op => op.type !== 'equal' || op.changed),
  };
}
