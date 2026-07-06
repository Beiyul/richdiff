import { defaultNormalizeText } from './text-utils';

/** diff 高亮 CSS class 名称（可自定义） */
export interface IDiffClassNames {
  /** 文本删除高亮 */
  inlineDeleted: string;
  /** 文本新增高亮 */
  inlineInserted: string;
  /** 链接删除高亮 */
  linkDeleted: string;
  /** 链接新增高亮 */
  linkInserted: string;
  /** 样式变更高亮（加粗、斜体等 marks 变化） */
  styleChanged: string;
}

/** 核心配置 */
export interface RichTextDiffConfig {
  /** 参与比对的内联标签
   *  空数组 = 忽略所有格式（纯文本 diff）
   *  ['strong', 'em'] = 检测加粗、斜体的变化
   *  ['strong', 'em', 'span'] = 还检测 span 的属性变化 */
  inlineTags: string[];

  /** 参与比对的标签属性
   *  ['href'] = 只比链接地址（默认）
   *  ['href', 'style'] = 还比行内样式 */
  compareAttributes: string[];

  /** 参与比对的块级 CSS 属性（Experimental）
   *  [] = 不比对块级样式
   *  ['text-align'] = 检测对齐方式变化
   *  v1 仅处理行内 style 属性的字面比对，不做 class 推导、不做计算属性等价判断 */
  compareBlockStyles: string[];

  /** 块级标签集合（决定哪些标签作为一个独立块参与块级 diff）
   *  不同富文本编辑器（Tiptap / Quill / TinyMCE）的块级标签不同 */
  blockTags: string[];

  /** diff 粒度（v1 仅支持 'char'，'word' 为后续方向） */
  granularity: 'char' | 'word';

  /** 文本归一化函数（自定义空白、标点处理等） */
  normalizeText?: (text: string) => string;

  /** diff 高亮 CSS class 名称 */
  classNames: IDiffClassNames;
}

/** 默认配置（等价于纯文本 diff，忽略所有格式变化） */
export const DEFAULT_CONFIG: RichTextDiffConfig = {
  inlineTags: [],
  compareAttributes: ['href'],
  compareBlockStyles: [],
  blockTags: ['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  granularity: 'char',
  normalizeText: defaultNormalizeText,
  classNames: {
    inlineDeleted: 'diff-inline-deleted',
    inlineInserted: 'diff-inline-inserted',
    linkDeleted: 'diff-link-deleted',
    linkInserted: 'diff-link-inserted',
    styleChanged: 'diff-style-changed',
  },
};

