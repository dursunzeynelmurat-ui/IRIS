/**
 * IRIS Ingestion — RSS 2.0 & Atom Feed Parser
 *
 * Parses RSS 2.0 and Atom feeds using string operations and regex only.
 * No external XML or HTML parser libraries are required.
 *
 * Intentional constraints:
 *   - Regex-based extraction is sufficient for well-formed syndication feeds.
 *   - The parser is lenient: missing fields fall back to empty strings / null.
 *   - CDATA sections are stripped transparently wherever they appear.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface RssFeedMeta {
  title: string;
  description: string;
  link: string;
}

export interface RssItem {
  guid: string | null;
  title: string;
  link: string | null;
  /** From `<description>` (RSS 2) or `<summary>` (Atom). */
  summary: string;
  /** From `<content:encoded>` / `<content>` (Atom), or same as `summary`. */
  content: string;
  author: string | null;
  publishedAt: Date | null;
  /** From `<media:content>`, `<enclosure type="image/*">`, or first `<img>` in content. */
  imageUrl: string | null;
  categories: string[];
}

export interface ParsedFeed {
  meta: RssFeedMeta;
  items: RssItem[];
  format: 'rss2' | 'atom';
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Strip an outer CDATA wrapper from `text` if present:
 * `<![CDATA[...]]>` → `...`
 */
function stripCdata(text: string): string {
  const m = text.match(/^<!\[CDATA\[([\s\S]*?)]]>$/);
  return m ? m[1] : text;
}

/**
 * Extract the text content of the first occurrence of `<tag>…</tag>` in `xml`.
 *
 * Handles:
 *   - Namespaced tags (e.g. `dc:creator`, `content:encoded`)
 *   - CDATA wrappers
 *   - Multiline content
 *
 * @param xml - XML/HTML string to search.
 * @param tag - Tag name (may include namespace prefix, e.g. `"dc:creator"`).
 * @returns Inner text, CDATA-stripped and trimmed, or empty string if not found.
 */
function extractText(xml: string, tag: string): string {
  // Escape special regex characters in the tag name (e.g. the ':' in dc:creator).
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return stripCdata(m[1].trim());
}

/**
 * Extract all occurrences of `<tag>…</tag>` (or self-closing `<tag … />`)
 * from `xml` as raw element strings.
 *
 * Self-closing elements (e.g. `<category term="Tech"/>`) are included so that
 * attribute-only tags such as Atom categories are not silently dropped.
 *
 * @param xml - XML string to search.
 * @param tag - Tag name (may include namespace prefix).
 * @returns Array of full element strings in document order.
 */
function extractElements(xml: string, tag: string): string[] {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Matches either:
  //   a) a self-closing tag:  <tag ... />
  //   b) a paired tag:        <tag ...>...</tag>
  // The alternation tries the paired form first (longer match wins via
  // the capture group check in the replacement callback).
  const re = new RegExp(
    `(<${escapedTag}(?:\\s[^>]*)?/>)|(<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>)`,
    'gi',
  );

  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    // m[1] = self-closing match, m[2] = paired match
    results.push(m[1] ?? m[2]);
  }
  return results;
}

/**
 * Extract the value of `attr` from `element`.
 *
 * Handles both double-quoted and single-quoted attribute values.
 *
 * @param element - Raw XML element string (e.g. `<link href="…" />`).
 * @param attr    - Attribute name to locate.
 * @returns Attribute value string, or `null` if not found.
 */
function extractAttr(element: string, attr: string): string | null {
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escapedAttr}=(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = element.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * Parse a date string into a `Date` object.
 *
 * Accepts:
 *   - RFC 2822 (RSS `pubDate`): `"Mon, 02 Jan 2006 15:04:05 GMT"`
 *   - ISO 8601 (Atom `updated`): `"2006-01-02T15:04:05Z"`
 *   - Any format accepted by `new Date()`
 *
 * @param dateStr - Raw date string from the feed.
 * @returns Parsed `Date`, or `null` if the string is invalid or empty.
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr.trim()) return null;
  const d = new Date(dateStr.trim());
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Find the `src` of the first `<img>` tag inside an HTML string.
 *
 * @param html - HTML content (e.g. from `<content:encoded>`).
 * @returns Image URL string, or `null` if none found.
 */
function extractImageFromContent(html: string): string | null {
  const m = html.match(/<img[^>]+src=(?:"([^"]+)"|'([^']+)')/i);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * Extract all `<item>` elements from an RSS 2.0 XML string as raw strings.
 * Works by scanning for `<item>` open and `</item>` close tags.
 */
function extractRssItems(xml: string): string[] {
  return extractElements(xml, 'item');
}

/**
 * Extract all `<entry>` elements from an Atom feed XML string.
 */
function extractAtomEntries(xml: string): string[] {
  return extractElements(xml, 'entry');
}

// ── Image extraction helpers ─────────────────────────────────────────────────

/**
 * Derive an image URL from an RSS `<item>` element, trying multiple sources
 * in priority order:
 *   1. `<media:content url="…">` (only when type starts with "image/")
 *   2. Any `<media:content url="…">` (no type restriction, common in practice)
 *   3. `<enclosure url="…" type="image/…">`
 *   4. First `<img src="…">` found inside the item's content/description
 */
function extractItemImage(itemXml: string, contentHtml: string): string | null {
  // 1. <media:content url="…" type="image/…">
  const mediaRe = /<media:content\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = mediaRe.exec(itemXml)) !== null) {
    const tag = m[0];
    const type = extractAttr(tag, 'type');
    if (type === null || type.startsWith('image/')) {
      const url = extractAttr(tag, 'url');
      if (url) return url;
    }
  }

  // 2. <enclosure url="…" type="image/…">
  const encRe = /<enclosure\s[^>]*>/gi;
  while ((m = encRe.exec(itemXml)) !== null) {
    const tag = m[0];
    const type = extractAttr(tag, 'type') ?? '';
    if (type.startsWith('image/')) {
      const url = extractAttr(tag, 'url');
      if (url) return url;
    }
  }

  // 3. First <img> in rendered content
  return extractImageFromContent(contentHtml);
}

// ── RSS 2.0 parser ───────────────────────────────────────────────────────────

/**
 * Parse an RSS 2.0 feed XML string into a {@link ParsedFeed}.
 *
 * @param xml - Raw RSS 2.0 XML string.
 * @returns Parsed feed structure.
 */
export function parseRss2(xml: string): ParsedFeed {
  // Isolate the <channel> block so we don't mix item content with channel meta.
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channelXml = channelMatch ? channelMatch[1] : xml;

  // Channel meta — exclude any content inside <item> blocks.
  const channelWithoutItems = channelXml.replace(/<item[\s\S]*?<\/item>/gi, '');

  const meta: RssFeedMeta = {
    title:       extractText(channelWithoutItems, 'title'),
    description: extractText(channelWithoutItems, 'description'),
    link:        extractText(channelWithoutItems, 'link'),
  };

  const itemBlocks = extractRssItems(channelXml);

  const items: RssItem[] = itemBlocks.map((itemEl) => {
    // extractElements returns full <item>…</item> blocks; we need the inner content.
    const inner = itemEl.replace(/^<item[^>]*>/i, '').replace(/<\/item>$/i, '');

    const title   = extractText(inner, 'title');
    const link    = extractText(inner, 'link') || null;
    const guid    = extractText(inner, 'guid') || link;

    const rawDescription   = extractText(inner, 'description');
    const rawContentEncoded = extractText(inner, 'content:encoded')
                           || extractText(inner, 'content');

    const summary = rawDescription;
    const content = rawContentEncoded || rawDescription;

    const author =
      extractText(inner, 'author') ||
      extractText(inner, 'dc:creator') ||
      null;

    const pubDateStr = extractText(inner, 'pubDate');
    const publishedAt = parseDate(pubDateStr);

    const imageUrl = extractItemImage(inner, content);

    // <category> may appear multiple times.
    const categoryBlocks = extractElements(inner, 'category');
    const categories = categoryBlocks
      .map((el) => {
        const innerText = el.replace(/^<category[^>]*>/i, '').replace(/<\/category>$/i, '');
        return stripCdata(innerText.trim());
      })
      .filter(Boolean);

    return {
      guid:        guid || null,
      title,
      link,
      summary,
      content,
      author:      author || null,
      publishedAt,
      imageUrl,
      categories,
    };
  });

  return { meta, items, format: 'rss2' };
}

// ── Atom parser ──────────────────────────────────────────────────────────────

/**
 * Parse an Atom feed XML string into a {@link ParsedFeed}.
 *
 * @param xml - Raw Atom XML string.
 * @returns Parsed feed structure.
 */
export function parseAtom(xml: string): ParsedFeed {
  // Feed-level meta — exclude <entry> blocks.
  const feedWithoutEntries = xml.replace(/<entry[\s\S]*?<\/entry>/gi, '');

  // The feed link is typically <link rel="alternate" href="…"/>.
  const feedLinkMatch = feedWithoutEntries.match(/<link\s[^>]*>/i);
  let feedLink = '';
  if (feedLinkMatch) {
    const rel = extractAttr(feedLinkMatch[0], 'rel');
    if (!rel || rel === 'alternate') {
      feedLink = extractAttr(feedLinkMatch[0], 'href') ?? '';
    }
  }

  const meta: RssFeedMeta = {
    title:       extractText(feedWithoutEntries, 'title'),
    description: extractText(feedWithoutEntries, 'subtitle'),
    link:        feedLink,
  };

  const entryBlocks = extractAtomEntries(xml);

  const items: RssItem[] = entryBlocks.map((entryEl) => {
    const inner = entryEl.replace(/^<entry[^>]*>/i, '').replace(/<\/entry>$/i, '');

    const title = extractText(inner, 'title');
    const guid  = extractText(inner, 'id') || null;

    // Find <link rel="alternate" href="…"> or the first <link href="…">.
    let link: string | null = null;
    const linkRe = /<link\s[^>]*>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(inner)) !== null) {
      const rel = extractAttr(lm[0], 'rel');
      const href = extractAttr(lm[0], 'href');
      if (href && (!rel || rel === 'alternate')) {
        link = href;
        break;
      }
    }

    const summary = extractText(inner, 'summary');
    const content = extractText(inner, 'content') || summary;

    const author = extractText(inner, 'name') || null;

    const dateStr =
      extractText(inner, 'updated') ||
      extractText(inner, 'published');
    const publishedAt = parseDate(dateStr);

    const imageUrl = extractItemImage(inner, content);

    const categoryEls = extractElements(inner, 'category');
    const categories = categoryEls
      .map((el) => {
        // Atom categories use <category term="…"/> or inner text.
        const termAttr = extractAttr(el, 'term');
        if (termAttr) return termAttr;
        const innerText = el.replace(/^<category[^>]*>/i, '').replace(/<\/category>$/i, '');
        return stripCdata(innerText.trim());
      })
      .filter(Boolean);

    return {
      guid,
      title,
      link,
      summary,
      content,
      author,
      publishedAt,
      imageUrl,
      categories,
    };
  });

  return { meta, items, format: 'atom' };
}

// ── Auto-detect dispatcher ───────────────────────────────────────────────────

/**
 * Parse a feed of unknown format. The format is auto-detected by inspecting
 * the root tag:
 *   - Root element contains `feed` → Atom
 *   - Otherwise → RSS 2.0
 *
 * @param xml - Raw XML string of an RSS 2.0 or Atom feed.
 * @returns Parsed feed structure.
 */
export function parseFeed(xml: string): ParsedFeed {
  // Skip the XML declaration and find the first meaningful tag.
  const rootMatch = xml.match(/<([a-zA-Z][a-zA-Z0-9:_-]*)/);
  const rootTag = rootMatch ? rootMatch[1].toLowerCase() : '';

  if (rootTag.includes('feed')) {
    return parseAtom(xml);
  }
  return parseRss2(xml);
}

// ── HTTP fetch helper ────────────────────────────────────────────────────────

/**
 * Fetch the raw XML content of a feed URL.
 *
 * Uses the global `fetch` API available in Node 18+ without any polyfill.
 * Aborts automatically after `timeoutMs` milliseconds.
 *
 * @param url       - Fully-qualified feed URL.
 * @param timeoutMs - Request timeout in milliseconds (default: 10 000).
 * @returns Raw response body as a string.
 * @throws Error with the URL included in the message if the request fails or
 *         times out.
 */
export async function fetchFeed(url: string, timeoutMs = 10_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch feed at ${url}: HTTP ${response.status} ${response.statusText}`,
      );
    }
    return await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${timeoutMs}ms for feed at ${url}`);
    }
    if (err instanceof Error && err.message.includes(url)) {
      throw err; // already annotated above
    }
    throw new Error(`Failed to fetch feed at ${url}: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
