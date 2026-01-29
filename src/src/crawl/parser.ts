/**
 * HTML parsing utilities
 */

import * as cheerio from 'cheerio';
import { resolveUrl, canonicalize, sameRegistrableDomain, isCrawlableUrl } from './url.js';

export interface ParsedPage {
  url: string;
  links: string[];
  contactPageUrls: string[];
  text: string;
}

/**
 * Contact page patterns (URL paths and anchor text)
 */
const CONTACT_PATTERNS = [
  // English
  '/contact',
  '/contact-us',
  '/contactus',
  '/about',
  '/about-us',
  '/team',
  '/staff',
  '/support',
  '/help',
  '/impressum',
  '/privacy',
  // Greek
  '/επικοινωνια',
  '/επικοινωνία',
  '/συνεργασία',
  '/εταιρεία',
  '/ποιοι-ειμαστε',
  '/σχετικα',
  '/ομαδα'
];

/**
 * Check if URL is likely a contact page
 */
export function isContactPage(url: string, anchorText?: string): boolean {
  const urlLower = url.toLowerCase();
  const anchorLower = (anchorText || '').toLowerCase();

  // Check URL patterns
  for (const pattern of CONTACT_PATTERNS) {
    if (urlLower.includes(pattern)) {
      return true;
    }
  }

  // Check anchor text
  const contactKeywords = [
    'contact', 'about', 'team', 'staff', 'support', 'help',
    'επικοινωνία', 'συνεργασία', 'εταιρεία', 'σχετικά'
  ];

  for (const keyword of contactKeywords) {
    if (anchorLower.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse HTML and extract links
 */
export function parseHtml(html: string, baseUrl: string, baseDomain: string): ParsedPage {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  const contactPageUrls: string[] = [];

  // Extract all links
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const anchorText = $(element).text().trim();
    const resolved = resolveUrl(baseUrl, href);

    if (!resolved) return;
    if (!isCrawlableUrl(resolved)) return;
    if (!sameRegistrableDomain(resolved, baseDomain)) return;

    const canonical = canonicalize(resolved);
    links.add(canonical);

    // Check if it's a contact page
    if (isContactPage(canonical, anchorText)) {
      contactPageUrls.push(canonical);
    }
  });

  // Extract visible text (for context)
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  return {
    url: baseUrl,
    links: Array.from(links),
    contactPageUrls: Array.from(new Set(contactPageUrls)), // Dedupe
    text
  };
}

/**
 * Extract text snippets around a keyword (for email/phone context)
 */
export function extractContext(text: string, keyword: string, contextLength = 50): string {
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (index === -1) return '';

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + keyword.length + contextLength);
  
  return text.substring(start, end).trim();
}
