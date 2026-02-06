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

  // STEP 1: Extract from schema.org JSON-LD (LocalBusiness)
  try {
    $('script[type="application/ld+json"]').each((_, el) => {
      const jsonText = $(el).html();
      if (!jsonText) return;
      
      try {
        const json = JSON.parse(jsonText);
        const schemas = Array.isArray(json) ? json : [json];
        
        for (const schema of schemas) {
          if (schema['@type'] === 'LocalBusiness' || schema['@type'] === 'Organization') {
            // Extract email
            if (schema.email) {
              const email = String(schema.email).toLowerCase().trim();
              if (EMAIL_REGEX.test(email)) {
                const { normalized: classified } = classifyEmail(email);
                items.push({
                  type: 'email',
                  value: classified,
                  sourceUrl: url,
                  confidence: 0.95 // High confidence from structured data
                });
              }
            }
            
            // Extract phone
            if (schema.telephone) {
              const phone = String(schema.telephone).trim();
              const normalizedPhone = normalizePhone(phone);
              if (normalizedPhone) {
                items.push({
                  type: 'phone',
                  value: normalizedPhone.normalized,
                  sourceUrl: url,
                  confidence: 0.95 // High confidence from structured data
                });
              }
            }
          }
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    });
  } catch (e) {
    // Error parsing JSON-LD, continue
  }

  // STEP 2: Extract emails: plain, mailto:, and @domain patterns
  const emailSet = new Set<string>();
  const obfuscatedSet = new Set<string>();

  // Standard email regex
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
    });
  }

  // Extract from mailto: links
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
  
  // Extract @domain patterns (looks like email but might be incomplete)
  // Pattern: word@domain (where domain looks like a real domain)
  const atDomainPattern = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  const atDomainMatches = html.match(atDomainPattern) || [];
  for (const raw of atDomainMatches) {
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
      confidence: confidence * 0.9 // Slightly lower confidence for @domain patterns
    });
  }

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

  // STEP 3: Extract phones (Greek + international)
  const phoneSet = new Set<string>();

  // Extract from tel: links first (highest confidence)
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const raw = href.replace(/^tel:/i, '').split('?')[0].trim();
    if (!raw) return;
    const normalizedPhone = normalizePhone(raw);
    if (!normalizedPhone) return;
    
    const normalized = normalizedPhone.normalized;
    if (phoneSet.has(normalized)) return;
    phoneSet.add(normalized);

    items.push({
      type: 'phone',
      value: normalized,
      sourceUrl: url,
      confidence: 0.95 // High confidence from tel: links
    });
  });

  // Greek phone patterns: +30, 0030, 69X, 210, etc.
  const phoneRegex =
    /(?:\+30|0030|30)?[\s.-]?(?:\(?\d{2,4}\)?[\s.-]?)?(?:(?:69[03457]\d{7})|(?:\d{2,3}[\s.-]?\d{3,4}[\s.-]?\d{4}))/g;
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

