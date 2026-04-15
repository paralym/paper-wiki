import * as cheerio from 'cheerio';

export interface HtmlChunk {
  id: string;        // CSS selector or path to locate this node
  text: string;      // original text content
  tag: string;       // parent element tag
}

/**
 * Check if arxiv HTML version exists (only arxiv.org/html)
 */
export async function checkHtmlAvailable(arxivId: string): Promise<{ available: boolean }> {
  try {
    const res = await fetch(`https://arxiv.org/html/${arxivId}`, {
      method: 'HEAD',
      redirect: 'follow',
    });
    return { available: res.ok };
  } catch {
    return { available: false };
  }
}

/**
 * Fetch arxiv HTML page
 */
export async function fetchArxivHtml(arxivId: string): Promise<string> {
  const res = await fetch(`https://arxiv.org/html/${arxivId}`, {
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`无法获取 HTML 版本: ${res.status}`);
  return await res.text();
}

/**
 * Extract translatable text segments from arxiv HTML.
 * Returns chunks with path identifiers so we can put translations back.
 */
export function extractTextChunks(html: string): { chunks: HtmlChunk[]; articleHtml: string } {
  const $ = cheerio.load(html);

  // Remove scripts, styles, nav, header, footer
  $('script, style, nav, header, footer, .ltx_page_header, .ltx_page_footer').remove();

  // Get the article content
  const article = $('.ltx_document, .ltx_page_content, article, main').first();
  const articleHtml = article.length ? article.html() || '' : $('body').html() || '';

  const chunks: HtmlChunk[] = [];
  let chunkId = 0;

  // Walk through text-containing elements
  const textSelectors = [
    '.ltx_title',
    '.ltx_abstract .ltx_p',
    '.ltx_section .ltx_p',
    '.ltx_para .ltx_p',
    'h1, h2, h3, h4, h5, h6',
    '.ltx_caption .ltx_p',
    '.ltx_item .ltx_p',
    'figcaption',
  ];

  const seen = new Set<string>();

  $(textSelectors.join(', ')).each((_, el) => {
    const $el = $(el);
    // Skip if inside math
    if ($el.closest('.ltx_Math, .ltx_equation, math, .MathJax').length) return;

    const text = $el.text().trim();
    if (!text || text.length < 5) return;

    // Create a unique identifier
    const id = `chunk-${chunkId++}`;
    $el.attr('data-translate-id', id);

    // Skip duplicates
    if (seen.has(text)) return;
    seen.add(text);

    chunks.push({
      id,
      text,
      tag: el.type === 'tag' ? el.tagName : 'span',
    });
  });

  return { chunks, articleHtml: $.html() };
}

/**
 * Merge chunks into groups for batch translation, respecting natural boundaries.
 * Returns groups where each group is multiple chunks joined with separators.
 */
export function groupChunksForTranslation(
  chunks: HtmlChunk[],
  maxChars: number = 8000
): { chunkIds: string[]; text: string }[] {
  const groups: { chunkIds: string[]; text: string }[] = [];
  let currentIds: string[] = [];
  let currentText = '';
  const SEP = '\n---CHUNK_BOUNDARY---\n';

  for (const chunk of chunks) {
    if (currentText.length + chunk.text.length + SEP.length > maxChars && currentText) {
      groups.push({ chunkIds: [...currentIds], text: currentText });
      currentIds = [];
      currentText = '';
    }

    if (currentText) currentText += SEP;
    currentText += chunk.text;
    currentIds.push(chunk.id);
  }

  if (currentText) {
    groups.push({ chunkIds: [...currentIds], text: currentText });
  }

  return groups;
}

/**
 * Apply translations back into the HTML.
 * Returns two HTML strings: original and translated.
 */
export function buildBilingualHtml(
  fullHtml: string,
  translations: Map<string, string>
): { originalHtml: string; translatedHtml: string } {
  const $original = cheerio.load(fullHtml);
  const $translated = cheerio.load(fullHtml);

  // Clean both copies
  for (const $ of [$original, $translated]) {
    $('script, style, .ltx_page_header, .ltx_page_footer').remove();
  }

  // Apply translations to the translated copy
  translations.forEach((translatedText, id) => {
    const el = $translated(`[data-translate-id="${id}"]`);
    if (el.length) {
      // Preserve child elements (math, links, etc) by only replacing text nodes
      // Simple approach: replace entire content but keep math elements
      const mathElements: string[] = [];
      el.find('.ltx_Math, math, .MathJax, .ltx_ref, .ltx_cite').each((i, mathEl) => {
        const placeholder = `__MATH_${i}__`;
        mathElements.push($translated(mathEl).prop('outerHTML') || '');
        $translated(mathEl).replaceWith(placeholder);
      });

      // Now set translated text
      let newContent = translatedText;
      // Restore math elements
      mathElements.forEach((mathHtml, i) => {
        newContent = newContent.replace(`__MATH_${i}__`, mathHtml);
      });

      el.html(newContent);
    }
  });

  // Extract body content
  const getContent = ($: cheerio.CheerioAPI) => {
    const article = $('.ltx_document, .ltx_page_content, article, main').first();
    return article.length ? article.html() || '' : $('body').html() || '';
  };

  return {
    originalHtml: getContent($original),
    translatedHtml: getContent($translated),
  };
}
