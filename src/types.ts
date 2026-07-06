/**
 * 富文本 diff 核心包的公共类型定义。
 *
 * DiffOp 同时包含：
 * - oldHtml / newHtml：装饰后的 HTML（带 diff class），可直接 v-html 渲染
 * - inlineDiff：结构化 diff 数据，供程序化访问
 */

// ===== Mark：样式标记 =====

/** 记录文本节点被哪些标签包裹，从外到内有序 */
export interface Mark {
  /** 标签名，如 'strong'、'em'、'span' */
  tag: string;
  /** 属性键值对，如 { style: 'color: red' } */
  attrs: Record<string, string>;
}

// ===== Segment：解析后的行内片段 =====

export interface TextSegment {
  type: 'text';
  text: string;
  /** 包裹此文本的样式标签链，空数组 = 无样式 */
  marks: Mark[];
}

export interface LinkSegment {
  type: 'link';
  text: string;
  href: string;
  /** 链接也可以被加粗等 */
  marks: Mark[];
}

export type Segment = TextSegment | LinkSegment;

// ===== Block：解析后的语义块 =====

export interface TextBlock {
  type: 'text';
  /** 原始 HTML（未装饰） */
  html: string;
  segments: Segment[];
  /** 块级 CSS 属性，如 { 'text-align': 'center' } */
  blockStyles: Record<string, string>;
}

export interface MediaBlock {
  type: 'image' | 'video';
  html: string;
  src: string;
}

export type RichTextBlock = TextBlock | MediaBlock;

// ===== Diff 输出 =====

/** 字符级 diff 片段 */
export interface DiffPart {
  text: string;
  /** true = 新增或删除的部分 */
  changed: boolean;
  /** true = 样式（marks）发生了变化但文本未变 */
  styleChanged?: boolean;
}

/** 行内 diff 的单个 segment 结果 */
export interface DiffSegment {
  type: 'text' | 'link';
  parts: DiffPart[];
  /** 链接地址（仅 link 类型） */
  href?: string;
  /** 链接地址是否变更（仅 link 类型） */
  hrefChanged?: boolean;
  /** 样式变更类型 */
  styleChange?: 'added' | 'removed' | 'changed' | null;
}

/** 块内行内 diff 详情 */
export interface InlineDiff {
  oldSegments: DiffSegment[];
  newSegments: DiffSegment[];
}

/** 块级 diff 操作 */
export interface DiffOp {
  type: 'equal' | 'insert' | 'delete';
  oldBlock?: RichTextBlock;
  newBlock?: RichTextBlock;
  /** equal 类型：内容是否有变化（文本、样式等） */
  changed?: boolean;
  /** 装饰后的旧 HTML（带 diff class），可直接 v-html */
  oldHtml?: string;
  /** 装饰后的新 HTML（带 diff class），可直接 v-html */
  newHtml?: string;
  /** changed=true 时的行内详情（结构化数据，供程序化访问） */
  inlineDiff?: InlineDiff;
}

/** diff 最终结果 */
export interface DiffResult {
  /** 块级操作序列（LCS 对齐后的结果） */
  ops: DiffOp[];
  /** 是否存在差异 */
  hasDiff: boolean;
}
