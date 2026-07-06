<div align="center">
    <h1>richdiff</h1>
    <h5>Configurable Rich-Text HTML Diff</h5>
    <span>
        <a href="https://beiyul.github.io/richdiff">Live Demo</a> ·
        <a href="./README.md">中文</a>
    </span>
</div>

---

## 💡 What problem does this solve

When building rich-text editors, you often need to diff two versions of HTML. Existing tools aren't great at this:

- **htmldiff.js** compares everything — tags, CSS classes, inline styles. Changing a color looks the same as rewriting a paragraph. Too noisy.
- **jsdiff** strips all tags and diffs plain text. You can't tell if bold or links changed. Too coarse.

richdiff takes a simple approach: **you decide which tags matter.**

```text
Just text?         inlineTags: []                          → plain text diff
Care about format? inlineTags: ['strong', 'em']             → format-aware
Everything?        inlineTags: ['strong','em','u','s','span'] → full diff
```

Output comes in two flavors: HTML with diff highlights (ready for `v-html`) and structured data (if you want custom rendering).

[Try it live →](https://beiyul.github.io/richdiff)

## 📦 Install

```bash
npm install richdiff
```

## 🚀 Quick Start

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

In Vue:

```vue
<template>
  <div v-for="(op, i) in result.ops" :key="i" class="diff-row">
    <div class="diff-cell" v-html="op.oldHtml"></div>
    <div class="diff-cell" v-html="op.newHtml"></div>
  </div>
</template>
```

CSS (customize as needed):

```css
.diff-inline-deleted  { background: #fdb4b0; border-radius: 4px; padding: 0 2px; }
.diff-inline-inserted { background: #a7f3d0; border-radius: 4px; padding: 0 2px; }
.diff-link-deleted    { background: #fdb4b0; border-radius: 4px; padding: 0 2px; }
.diff-link-inserted   { background: #a7f3d0; border-radius: 4px; padding: 0 2px; }
```

## 🎛️ Configuration

```typescript
const differ = createRichTextDiffer({

  // Tags that participate in diff
  inlineTags: ['strong', 'em', 'u', 's'],

  // Attributes to compare
  compareAttributes: ['href', 'style'],

  // Block-level CSS properties to compare (experimental)
  compareBlockStyles: ['text-align'],

  // Block-level tags
  blockTags: ['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],

  // Custom CSS class names
  classNames: {
    inlineDeleted: 'diff-inline-deleted',
    inlineInserted: 'diff-inline-inserted',
    linkDeleted: 'diff-link-deleted',
    linkInserted: 'diff-link-inserted',
  },

  // Text normalization (optional)
  normalizeText: (text) => text.trim(),
});
```

### Supported inlineTags

| Tag | Label | What it detects |
|-----|-------|-----------------|
| `strong` `b` | Bold | Added/removed |
| `em` `i` | Italic | Added/removed |
| `u` | Underline | Added/removed |
| `s` `del` | Strikethrough | Added/removed |
| `mark` | Highlight | Added/removed |
| `small` | Small text | Font size change |
| `sub` `sup` | Sub/superscript | Added/removed |
| `code` | Inline code | Added/removed |
| `span` | Inline style | Color, font-size, etc. |
| `a` | Link | Always compared |

## 🔄 Runtime Config

Changing config only re-runs diff, not re-parse:

```typescript
const differ = createRichTextDiffer();

const result1 = differ.diff(oldHtml, newHtml);

differ.updateConfig({ inlineTags: ['strong', 'em'] });
const result2 = differ.diff(oldHtml, newHtml); // uses cache
```

## 📐 Output Structure

```typescript
interface DiffResult {
  hasDiff: boolean;
  ops: DiffOp[];
}

interface DiffOp {
  type: 'equal' | 'insert' | 'delete';
  changed?: boolean;
  oldHtml?: string;
  newHtml?: string;
  inlineDiff?: InlineDiff;
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

Using structured data:

```typescript
const result = differ.diff(oldHtml, newHtml);

result.ops.forEach(op => {
  if (op.type === 'insert') console.log('New block');

  if (op.changed && op.inlineDiff) {
    op.inlineDiff.newSegments.forEach(seg => {
      seg.parts.forEach(part => {
        if (part.changed) console.log('Changed:', part.text);
      });
      if (seg.styleChange) {
        // 'added' | 'removed' | 'changed'
      }
    });
  }
});
```

## ⚙️ How It Works

```
HTML → Parse into Block[] (with full style marks)
              │
           Cached
              │
      ┌───────┴───────┐
      │                 │
   LCS exact match   Similarity fallback
      │                 │
      └───────┬─────────┘
              │
         Inline diff
         (diffChars)
              │
        Inject CSS classes
              │
          DiffResult
```

## 📊 Comparison

| Library | Configurable | Inline Highlight | Structured Data |
|---------|:-----------:|:----------------:|:---------------:|
| **richdiff** | ✅ | ✅ | ✅ |
| htmldiff.js | ❌ | ✅ | ❌ |
| jsdiff | ❌ | ❌ | ✅ |
| diff2html | ❌ | ✅ | ✅ |

## ⚠️ Limitations

- Uses `document.createElement` for parsing — needs browser environment or jsdom
- Character-level diff only, word-level not done yet
- `compareBlockStyles` is experimental

## 📖 API

### `createRichTextDiffer(config?)`

```typescript
const differ = createRichTextDiffer({ inlineTags: ['strong'] });
```

### `differ.diff(oldHtml, newHtml)`

Returns `DiffResult`.

### `differ.updateConfig(partialConfig)`

Updates config at runtime without re-parsing.

### `differ.getConfig()`

Returns current config.

## 📄 License

MIT
