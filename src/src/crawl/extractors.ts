/**
 * Contact extraction utilities
 * Extracts emails, phones, and social links from HTML/text
 */

import * as cheerio from 'cheerio';

export interface ExtractedEmail {
  value: string;
  source_url: string;
  context?: string;
}

export interface ExtractedPhone {
  value: string;
  source_url: string;
}

export interface ExtractedSocial {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
}

/**
 * Email regex patterns (including obfuscations)
 */
const EMAIL_PATTERNS = [
  // Standard email
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  // Obfuscated: name [at] domain [dot] com
  /\b[a-zA-Z0-9._%+-]+\s*\[?\s*at\s*\]?\s*[a-zA-Z0-9.-]+\s*\[?\s*dot\s*\]?\s*[a-zA-Z]{2,}\b/gi,
  // Obfuscated: name(at)domain(dot)com
  /\b[a-zA-Z0-9._%+-]+\(at\)[a-zA-Z0-9.-]+\(dot\)[a-zA-Z]{2,}\b/gi,
  // Obfuscated: name @ domain . com (with spaces)
  /\b[a-zA-Z0-9._%+-]+\s+@\s+[a-zA-Z0-9.-]+\s+\.\s+[a-zA-Z]{2,}\b/gi
];

/**
 * Normalize email address
 */
function normalizeEmail(email: string): string {
  // Handle obfuscated emails
  let normalized = email
    .replace(/\s*\[?\s*at\s*\]?\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[?\s*dot\s*\]?\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.')
    .replace(/\s+@\s+/g, '@')
    .replace(/\s+\.\s+/g, '.')
    .toLowerCase()
    .trim();

  // Remove common invalid characters
  normalized = normalized.replace(/[<>\[\]()]/g, '');

  // Basic validation
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

/**
 * Extract emails from HTML
 */
export function extractEmails(html: string, url: string, text?: string): ExtractedEmail[] {
  const emails = new Map<string, ExtractedEmail>();
  const $ = cheerio.load(html);

  // Extract from mailto links
  $('a[href^="mailto:"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const emailMatch = href.match(/mailto:([^\?&]+)/i);
    if (emailMatch) {
      const email = normalizeEmail(emailMatch[1]);
      if (email && !emails.has(email)) {
        const anchorText = $(element).text().trim();
        emails.set(email, {
          value: email,
          source_url: url,
          context: anchorText || undefined
        });
      }
    }
  });

  // Extract from text using regex patterns
  const content = text || $('body').text();
  
  for (const pattern of EMAIL_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const email = normalizeEmail(match[0]);
      if (email && !emails.has(email)) {
        // Extract context (surrounding text)
        const context = extractContext(content, match[0], 30);
        emails.set(email, {
          value: email,
          source_url: url,
          context: context || undefined
        });
      }
    }
  }

  return Array.from(emails.values());
}

/**
 * Greek phone patterns
 */
const PHONE_PATTERNS = [
  // E.164: +30XXXXXXXXX
  /\b\+30\s*\d{10}\b/g,
  // Greek landlines: 210, 211, 212, etc. (10 digits total)
  /\b(?:210|211|212|213|214|215|216|217|218|219)\s*\d{7}\b/g,
  // Greek mobiles: 69XXXXXXXX (10 digits)
  /\b69\d{8}\b/g,
  // With spaces/dashes
  /\b(?:\+30|0030)?\s*(\d{2,3})\s*[-.\s]?\s*(\d{3,4})\s*[-.\s]?\s*(\d{4})\b/g
];

/**
 * Normalize phone number to E.164 format (Greek)
 */
function normalizePhone(phone: string): string {
  // Remove all non-digit characters except +
  let normalized = phone.replace(/[^\d+]/g, '');

  // Handle Greek numbers
  if (normalized.startsWith('0030')) {
    normalized = '+' + normalized.substring(2);
  } else if (normalized.startsWith('30') && !normalized.startsWith('+')) {
    normalized = '+' + normalized;
  } else if (!normalized.startsWith('+') && normalized.length === 10) {
    // Assume Greek number
    normalized = '+30' + normalized;
  } else if (!normalized.startsWith('+')) {
    // Try to add +30 prefix
    if (normalized.length >= 9) {
      normalized = '+30' + normalized;
    }
  }

  // Validate: should be +30 followed by 10 digits
  if (!/^\+30\d{10}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

/**
 * Extract phones from HTML
 */
export function extractPhones(html: string, url: string): ExtractedPhone[] {
  const phones = new Map<string, ExtractedPhone>();
  const $ = cheerio.load(html);

  // Extract from tel links
  $('a[href^="tel:"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const phoneMatch = href.match(/tel:([^\?&]+)/i);
    if (phoneMatch) {
      const phone = normalizePhone(phoneMatch[1]);
      if (phone && !phones.has(phone)) {
        phones.set(phone, {
          value: phone,
          source_url: url
        });
      }
    }
  });

  // Extract from text using regex patterns
  const text = $('body').text();
  
  for (const pattern of PHONE_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const phone = normalizePhone(match[0]);
      if (phone && !phones.has(phone)) {
        phones.set(phone, {
          value: phone,
          source_url: url
        });
      }
    }
  }

  return Array.from(phones.values());
}

/**
 * Extract social links from HTML
 */
export function extractSocial(html: string, baseUrl: string): ExtractedSocial {
  const social: ExtractedSocial = {};
  const $ = cheerio.load(html);

  // Extract all links
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const url = new URL(href, baseUrl);
    const hostname = url.hostname.toLowerCase();

    // Facebook
    if (hostname.includes('facebook.com') && !social.facebook) {
      // Canonicalize to main profile URL
      const path = url.pathname.split('/').filter(p => p);
      if (path.length > 0) {
        social.facebook = `https://www.facebook.com/${path[0]}`;
      }
    }

    // Instagram
    if (hostname.includes('instagram.com') && !social.instagram) {
      const path = url.pathname.split('/').filter(p => p);
      if (path.length > 0) {
        social.instagram = `https://www.instagram.com/${path[0]}`;
      }
    }

    // LinkedIn
    if (hostname.includes('linkedin.com') && !social.linkedin) {
      // Keep full URL for LinkedIn (can be company or profile)
      social.linkedin = url.toString().split('?')[0]; // Remove query params
    }

    // Twitter/X
    if ((hostname.includes('twitter.com') || hostname.includes('x.com')) && !social.twitter) {
      const path = url.pathname.split('/').filter(p => p);
      if (path.length > 0) {
        social.twitter = `https://twitter.com/${path[0]}`;
      }
    }

    // YouTube
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      if (hostname.includes('youtube.com')) {
        const channelMatch = url.pathname.match(/\/channel\/([^\/]+)/);
        const userMatch = url.pathname.match(/\/user\/([^\/]+)/);
        if (channelMatch && !social.youtube) {
          social.youtube = `https://www.youtube.com/channel/${channelMatch[1]}`;
        } else if (userMatch && !social.youtube) {
          social.youtube = `https://www.youtube.com/user/${userMatch[1]}`;
        }
      } else if (hostname.includes('youtu.be')) {
        const videoId = url.pathname.substring(1);
        if (videoId && !social.youtube) {
          social.youtube = `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
    }
  });

  return social;
}

/**
 * Extract context around a keyword in text
 */
function extractContext(text: string, keyword: string, contextLength = 50): string {
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (index === -1) return '';

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + keyword.length + contextLength);
  
  return text.substring(start, end).trim();
}
