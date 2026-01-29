import * as cheerio from 'cheerio';
import { canonicalizeUrl, isSameDomain, shouldSkipPath } from './url.js';

export function extractInternalLinks(
  html: string,
  baseUrl: string
): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
      return;
    }

    try {
      const absolute = new URL(href, baseUrl).toString();
      const canonical = canonicalizeUrl(absolute);
      const path = new URL(canonical).pathname;

      if (!isSameDomain(canonical, baseUrl)) return;
      if (shouldSkipPath(path)) return;

      links.add(canonical);
    } catch {
      // Ignore invalid URLs
    }
  });

  return Array.from(links);
}

