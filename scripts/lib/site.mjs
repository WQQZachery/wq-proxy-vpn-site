// Shared route table and helpers used by build.mjs and check.mjs.

export const PAGES = ['home', 'download', 'changelog', 'docs', 'privacy', 'licenses'];
export const LANGS = ['zh', 'en'];

/** URL path of a page in a language. Chinese is the default (no prefix). */
export function pagePath(page, lang) {
  const prefix = lang === 'en' ? '/en' : '';
  if (page === 'home') return lang === 'en' ? '/en/' : '/';
  return `${prefix}/${page}`;
}

/** Output file (relative to dist/) for a page; html_handling "auto-trailing-slash" maps
 *  /x → x.html and /en/ → en/index.html. */
export function pageFile(page, lang) {
  const dir = lang === 'en' ? 'en/' : '';
  return page === 'home' ? `${dir}index.html` : `${dir}${page}.html`;
}

export const HREFLANG = { zh: 'zh-CN', en: 'en' };

export function normalizeSiteUrl(raw) {
  if (!raw) return null;
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error(`SITE_URL must be https: ${raw}`);
  return u.origin;
}
