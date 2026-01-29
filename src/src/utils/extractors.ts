import * as cheerio from 'cheerio';
import { normalizePhone } from './phoneNormalizer.js';
import { classifyEmail } from './emailClassifier.js';

export type ExtractedType = 'email' | 'phone' | 'social' | 'form';

export interface ExtractedItem {
  type: ExtractedType;
  value: string;
  sourceUrl: string;
  confidence: number; // 0–1
  platform?: 'facebook' | 'instagram' | 'linkedin';
}

const EMAIL_REGEX =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const OBFUSCATED_EMAIL_REGEX =
  /([a-zA-Z0-9._%+-]+)\s*(?:@|\(at\)|\[at\]| at )\s*([a-zA-Z0-9.-]+)\s*(?:\.|\(dot\)|\[dot\]| dot )\s*([a-zA-Z]{2,})/gi;

const SOCIAL_HREF_REGEX = /href=["']([^"']+)["']/gi;

const PRIVACY_TERMS_PATTERN =
  /(privacy|terms|gdpr|cookies|πολιτικη απορρητου|πολιτική απορρήτου)/i;

const CONTACT_PATH_PATTERN = /(contact|επικοινων)/i;

export function scoreConfidence(
  url: string,
  type: ExtractedType,
  options?: { isObfuscatedEmail?: boolean; isFooter?: boolean }
): number {
  const { isObfuscatedEmail = false, isFooter = false } = options || {};
  const lowerUrl = url.toLowerCase();

  let score = 0.5;

  if (CONTACT_PATH_PATTERN.test(lowerUrl)) {
    score = 0.9;
  } else if (PRIVACY_TERMS_PATTERN.test(lowerUrl)) {
    score = 0.3;
  } else if (isFooter) {
    score = 0.6;
  }

  if (type === 'form') {
    // Forms on contact pages are usually strong signals
    if (CONTACT_PATH_PATTERN.test(lowerUrl)) {
      score = 0.9;
    }
  }

  if (isObfuscatedEmail) {
    score = Math.min(1, score + 0.1);
  }

  return score;
}

export function extractFromHtmlPage(
  html: string,
  url: string
): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const $ = cheerio.load(html);
  const lowerHtml = html.toLowerCase();
  const isFooter =
    lowerHtml.includes('<footer') || lowerHtml.includes('class="footer"');

  // Emails: plain and mailto:
  const emailSet = new Set<string>();
  const obfuscatedSet = new Set<string>();

  const matches = html.match(EMAIL_REGEX) || [];
  for (const raw of matches) {
    const normalized = raw.toLowerCase().trim();
    if (!normalized) continue;
    if (emailSet.has(normalized)) continue;
    emailSet.add(normalized);

    const { normalized: classified } = classifyEmail(normalized);
    const confidence = scoreConfidence(url, 'email', {
      isFooter
    });

    items.push({
      type: 'email',
      value: classified,
      sourceUrl: url,
      confidence,
      // platform unused for email
    });
  }

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const raw = href.replace(/^mailto:/i, '').split('?')[0].trim();
    if (!raw) return;
    const normalized = raw.toLowerCase();
    if (emailSet.has(normalized)) return;
    emailSet.add(normalized);

    const { normalized: classified } = classifyEmail(normalized);
    const confidence = scoreConfidence(url, 'email', {
      isFooter
    });

    items.push({
      type: 'email',
      value: classified,
      sourceUrl: url,
      confidence
    });
  });

  // Obfuscated emails (simple patterns)
  let obMatch: RegExpExecArray | null;
  while ((obMatch = OBFUSCATED_EMAIL_REGEX.exec(html)) !== null) {
    const email = `${obMatch[1]}@${obMatch[2]}.${obMatch[3]}`.toLowerCase();
    if (!email || obfuscatedSet.has(email)) continue;
    obfuscatedSet.add(email);
    if (emailSet.has(email)) continue;
    emailSet.add(email);

    const { normalized: classified } = classifyEmail(email);
    const confidence = scoreConfidence(url, 'email', {
      isFooter,
      isObfuscatedEmail: true
    });

    items.push({
      type: 'email',
      value: classified,
      sourceUrl: url,
      confidence
    });
  }

  // Phones (Greek + basic international)
  const phoneSet = new Set<string>();

  const phoneRegex =
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}/g;
  let phoneMatch: RegExpExecArray | null;

  while ((phoneMatch = phoneRegex.exec(html)) !== null) {
    const raw = phoneMatch[0].trim();
    const normalizedPhone = normalizePhone(raw);
    if (!normalizedPhone) continue;

    const normalized = normalizedPhone.normalized;
    if (phoneSet.has(normalized)) continue;
    phoneSet.add(normalized);

    const confidence = scoreConfidence(url, 'phone', { isFooter });

    items.push({
      type: 'phone',
      value: normalized,
      sourceUrl: url,
      confidence
    });
  }

  // Social links
  let socialMatch: RegExpExecArray | null;
  while ((socialMatch = SOCIAL_HREF_REGEX.exec(html)) !== null) {
    const href = socialMatch[1].trim();
    if (!href) continue;

    const lower = href.toLowerCase();
    let platform: ExtractedItem['platform'] | undefined;

    if (lower.includes('facebook.com')) platform = 'facebook';
    else if (lower.includes('instagram.com')) platform = 'instagram';
    else if (lower.includes('linkedin.com')) platform = 'linkedin';
    else continue;

    items.push({
      type: 'social',
      value: href,
      sourceUrl: url,
      confidence: scoreConfidence(url, 'social', { isFooter }),
      platform
    });
  }

  // Contact form detection (boolean per page)
  const hasForm =
    $('form').length > 0 &&
    (CONTACT_PATH_PATTERN.test(url) ||
      $('form input[name*="message"], form textarea[name*="message"]').length >
        0 ||
      $('form').text().toLowerCase().includes('contact'));

  if (hasForm) {
    items.push({
      type: 'form',
      value: 'contact_form',
      sourceUrl: url,
      confidence: scoreConfidence(url, 'form', { isFooter })
    });
  }

  return items;
}

