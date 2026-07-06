/** 将纯文本安全地嵌入 HTML 字符串，避免被浏览器当作真实标签解析。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 默认文本归一化函数。
 * 统一空白和常见中英文标点前后空格，降低排版差异对 diff 的干扰。
 */
export function defaultNormalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+([，。；！？、：）】》])/g, '$1')
    .replace(/([（【《])\s+/g, '$1');
}
