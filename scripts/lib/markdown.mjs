// Tiny, safe Markdown → HTML converter used at build time.
// Every piece of source text is HTML-escaped first; only a fixed set of constructs is turned into
// tags. Raw HTML in the source is therefore rendered as text, never injected.
//
// Supported: # headings (h2–h4 after shifting), paragraphs, - / * / 1. lists (one level),
// > blockquote, ``` fenced code, | tables |, **bold**, `code`, [text](https://… or /path or #id),
// bare https URLs, ==tag== (pending/verify badge), and {#id} heading anchors.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EXT = 'target="_blank" rel="noopener noreferrer"';

function safeHref(href) {
  if (/^https:\/\/[^\s"'<>]+$/.test(href)) return { href, external: true };
  if (/^\/[A-Za-z0-9/_.#-]*$/.test(href) || /^#[A-Za-z0-9_-]+$/.test(href)) return { href, external: false };
  return null; // anything else (javascript:, http:, data:) is dropped and rendered as text
}

export function inline(src) {
  // Protect code spans first.
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Links before escaping so we can validate the raw href.
  const links = [];
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    const h = safeHref(href);
    if (!h) return m;
    links.push({ text, ...h });
    return `\u0001${links.length - 1}\u0001`;
  });
  s = escapeHtml(s);
  // bare https URLs
  s = s.replace(/(^|[\s(（：:])(https:\/\/[A-Za-z0-9\-._~/?#@!$&*+,;=%]+[A-Za-z0-9/])/g, (m, pre, url) => {
    const raw = url.replace(/&amp;/g, '&');
    return `${pre}<a href="${escapeHtml(raw)}" ${EXT}>${url}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/==([^=]+)==/g, '<span class="tag tag-warn">$1</span>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => {
    const l = links[Number(i)];
    const text = inline(l.text);
    return l.external
      ? `<a href="${escapeHtml(l.href)}" ${EXT}>${text}</a>`
      : `<a href="${escapeHtml(l.href)}">${text}</a>`;
  });
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return s;
}

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

/**
 * @param {string} md
 * @param {{ headingShift?: number, toc?: Array }} opts  headingShift: '#' → h(1+shift)
 */
export function markdownToHtml(md, opts = {}) {
  const shift = opts.headingShift ?? 1;
  const toc = opts.toc;
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const used = new Set();
  const isBlockStart = (l) => /^(#{1,4}\s|```|>\s?|\s*[-*]\s+|\s*\d+\.\s+|\|)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="code" tabindex="0"><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*?)\s*(?:\{#([A-Za-z0-9_-]+)\})?\s*$/);
    if (h) {
      const level = Math.min(6, h[1].length + shift);
      let id = h[3] || slug(h[2]);
      let k = 2;
      while (used.has(id)) id = `${h[3] || slug(h[2])}-${k++}`;
      used.add(id);
      if (toc && level === 1 + shift) toc.push({ id, text: h[2] });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<div class="callout">${markdownToHtml(buf.join('\n'), { headingShift: shift })}</div>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(rows[0]);
      const body = rows.slice(rows[1] && /^\|[\s:|-]+\|?$/.test(rows[1]) ? 2 : 1).map(cells);
      out.push(
        '<div class="table-wrap" tabindex="0"><table><thead><tr>' +
          head.map((c) => `<th scope="col">${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>',
      );
      continue;
    }
    const ul = /^\s*[-*]\s+/;
    const ol = /^\s*\d+\.\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items = [];
      while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !(buf.length && isBlockStart(lines[i]))) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}
