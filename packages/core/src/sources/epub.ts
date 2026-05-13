import { basename } from 'node:path';

import type { LoadedSource } from './types.js';
import { SourceError } from './types.js';

// Strip HTML to plaintext: drop tags, decode the few entities that matter.
// epub2 hands us small, well-formed XHTML chapters, so we don't need a full
// DOM walk like Readability does for arbitrary web pages.
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|br|tr|hr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function loadEpubSource(path: string): Promise<LoadedSource> {
  const { EPub } = await import('epub2');

  let book: InstanceType<typeof EPub>;
  try {
    book = await EPub.createAsync(path);
  } catch (err) {
    throw new SourceError(`Could not open EPUB ${path}: ${(err as Error).message}`);
  }

  const chapters: string[] = [];
  for (const item of book.flow) {
    if (!item.id) continue;
    let html: string;
    try {
      html = await book.getChapterAsync(item.id);
    } catch (err) {
      throw new SourceError(
        `Could not read chapter '${item.id}' from ${path}: ${(err as Error).message}`,
      );
    }
    const text = htmlToText(html);
    if (text.length > 0) chapters.push(text);
  }

  const content = chapters.join('\n\n');
  if (content.trim().length === 0) {
    throw new SourceError(`EPUB ${path} extracted to empty text (no readable chapters).`);
  }

  return {
    source: basename(path),
    source_url: null,
    source_kind: 'epub',
    content,
  };
}
