<div align="center">
    <h1>richdiff</h1>
    <h5>可配置的富文本 HTML Diff 库</h5>
    <span>
        <a href="https://beiyul.github.io/richdiff">在线演示</a> ·
        <a href="./README.en.md">English</a>
    </span>
</div>

---

## 💡 解决了什么问题

做富文本编辑器的时候，经常需要对比两段 HTML 的变化。现有的 diff 工具不太好用：

- **htmldiff.js** 什么标签都比，字体颜色、CSS class、行内样式全算进去，改个颜色跟重写内容没区别，太吵。
- **jsdiff** 把所有 HTML 标签都去掉，只比纯文本，加粗变了、链接改了完全看不出来，太糙。

richdiff 的思路很简单：**哪些标签参与 diff，你说了算。**

```text
只想比文字？         inlineTags: []                          → 纯文本 diff
关心加粗和斜体？     inlineTags: ['strong', 'em']             → 格式变化也会标出来
所有标签都要？       inlineTags: ['strong','em','u','s','span'] → 完整对比
```

输出分两种：带 diff 高亮的 HTML（直接塞 `v-html` 就行）和结构化数据（想自己渲染也行）。

[在线试用 →](https://beiyul.github.io/richdiff)

## 📦 安装

```bash
npm install richdiff
```

## 🚀 快速上手

```typescript
import { createRichTextDiffer } from 'richdiff';

const differ = createRichTextDiffer();

const result = differ.diff(
  '<p>Hello <strong>world</strong></p>',
  '<p>Hello <strong>earth</strong></p>',
);

console.log(result.hasDiff); // true
console.log(result.ops[0].oldHtml);
// <p>Hello <strong><span class="diff-inline-deleted">world</span></strong></p>
console.log(result.ops[0].newHtml);
// <p>Hello <strong><span class="diff-inline-inserted">earth</span></strong></p>
```

Vue 里这样用：

```vue
<template>
  <div v-for="(op, i) in result.ops" :key="i" class="diff-row">
    <div class="diff-cell" v-html="op.oldHtml"></div>
    <div class="diff-cell" v-html="op.newHtml"></div>
  </div>
</template>
```

CSS 自己调：

```css
.diff-inline-deleted  { background: #fdb4b0; border-radius: 4px; padding: 0 2px; }
.diff-inline-inserted { background: #a7f3d0; border-radius: 4px; padding: 0 2px; }
.diff-link-deleted    { background: #fdb4b0; border-radius: 4px; padding: 0 2px; }
.diff-link-inserted   { background: #a7f3d0; border-radius: 4px; padding: 0 2px; }
```

## 🎛️ 配置

```typescript
const differ = createRichTextDiffer({

  // 哪些内联标签参与 diff
  inlineTags: ['strong', 'em', 'u', 's'],

  // 哪些标签属性参与比对
  compareAttributes: ['href', 'style'],

  // 块级 CSS 属性比对（实验性）
  compareBlockStyles: ['text-align'],

  // 作为独立段落处理的块级标签
  blockTags: ['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],

  // 自定义 CSS class 名
  classNames: {
    inlineDeleted: 'diff-inline-deleted',
    inlineInserted: 'diff-inline-inserted',
    linkDeleted: 'diff-link-deleted',
    linkInserted: 'diff-link-inserted',
  },

  // 文本归一化（可选）
  normalizeText: (text) => text.trim(),
});
```

### 支持的 inlineTags

| 标签 | 含义 | 检测内容 |
|-----|------|---------|
| `strong` `b` | 加粗 | 加粗新增/删除 |
| `em` `i` | 斜体 | 斜体新增/删除 |
| `u` | 下划线 | 下划线新增/删除 |
| `s` `del` | 删除线 | 删除线新增/删除 |
| `mark` | 高亮 | 高亮新增/删除 |
| `small` | 小号文字 | 字号变化 |
| `sub` `sup` | 上下标 | 上下标新增/删除 |
| `code` | 代码 | 行内代码新增/删除 |
| `span` | 行内样式 | 颜色、字号等属性变化 |
| `a` | 链接 | 始终比对 |

## 🔄 运行时改配置

改配置不会重新解析 HTML，只重新跑 diff：

```typescript
const differ = createRichTextDiffer();

const result1 = differ.diff(oldHtml, newHtml); // 默认配置

differ.updateConfig({ inlineTags: ['strong', 'em'] });
const result2 = differ.diff(oldHtml, newHtml); // 用了缓存
```

## 📐 输出结构

```typescript
interface DiffResult {
  hasDiff: boolean;
  ops: DiffOp[];
}

interface DiffOp {
  type: 'equal' | 'insert' | 'delete';
  changed?: boolean;
  oldHtml?: string;           // 直接 v-html 渲染
  newHtml?: string;
  inlineDiff?: InlineDiff;    // 结构化数据
  oldBlock?: RichTextBlock;
  newBlock?: RichTextBlock;
}

interface InlineDiff {
  oldSegments: DiffSegment[];
  newSegments: DiffSegment[];
}

interface DiffSegment {
  type: 'text' | 'link';
  parts: DiffPart[];
  href?: string;
  hrefChanged?: boolean;
  styleChange?: 'added' | 'removed' | 'changed' | null;
}

interface DiffPart {
  text: string;
  changed: boolean;
}
```

用结构化数据：

```typescript
const result = differ.diff(oldHtml, newHtml);

result.ops.forEach(op => {
  if (op.type === 'insert') console.log('新增段落');

  if (op.changed && op.inlineDiff) {
    op.inlineDiff.newSegments.forEach(seg => {
      seg.parts.forEach(part => {
        if (part.changed) console.log('变更:', part.text);
      });
      if (seg.styleChange) {
        // 'added' | 'removed' | 'changed'
      }
    });
  }
});
```

## ⚙️ 原理

```
HTML → 解析为 Block[]（保留完整样式链）
              │
          缓存起来
              │
      ┌───────┴───────┐
      │                 │
   LCS 精确匹配      相似度回退
   （相同段落）      （>50% 就认为是修改）
      │                 │
      └───────┬─────────┘
              │
         行内 diff
         （diffChars）
              │
         注入 CSS class
              │
          DiffResult
```

## 📊 和其他库对比

| 库 | 可配置 | 行内高亮 | 结构化数据 |
|----|:------:|:-------:|:---------:|
| **richdiff** | ✅ | ✅ | ✅ |
| htmldiff.js | ❌ | ✅ | ❌ |
| jsdiff | ❌ | ❌ | ✅ |
| diff2html | ❌ | ✅ | ✅ |

## ⚠️ 局限

- 用 `document.createElement` 解析 HTML，需要浏览器环境，Node 端用的话得配 jsdom
- 目前只支持字符级 diff，词级还没做
- `compareBlockStyles` 还是实验性的，只比行内 style

## 📖 API

### `createRichTextDiffer(config?)`

```typescript
const differ = createRichTextDiffer({ inlineTags: ['strong'] });
```

### `differ.diff(oldHtml, newHtml)`

返回 `DiffResult`。

### `differ.updateConfig(partialConfig)`

运行时更新配置，不重新解析 HTML。

### `differ.getConfig()`

返回当前配置。

## 📄 License

MIT
