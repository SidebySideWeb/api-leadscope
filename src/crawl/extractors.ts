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
 * Checks specific sections: top bar, header, nav, body, footer
 */
export function extractEmails(html: string, url: string, text?: string): ExtractedEmail[] {
  const emails = new Map<string, ExtractedEmail>();
  const $ = cheerio.load(html);

  // Extract from mailto links (check all sections)
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

  // Extract from specific HTML sections (top bar, header, nav, body, footer)
  const sections = [
    { selector: 'header, .header, #header, [role="banner"]', name: 'header' },
    { selector: 'nav, .nav, .navbar, .navigation, [role="navigation"]', name: 'nav' },
    { selector: '.top-bar, .topbar, #topbar, .top-bar, [class*="top"]', name: 'top-bar' },
    { selector: 'body', name: 'body' },
    { selector: 'footer, .footer, #footer, [role="contentinfo"]', name: 'footer' },
    { selector: '.contact-form, form[action*="contact"], form[action*="mail"]', name: 'contact-form' },
  ];

  for (const section of sections) {
    const sectionHtml = $(section.selector).html() || '';
    const sectionText = $(section.selector).text() || '';
    
    // Extract from mailto links in this section
    $(section.selector).find('a[href^="mailto:"]').each((_, element) => {
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
            context: `${section.name}: ${anchorText || 'mailto link'}`
          });
        }
      }
    });

    // Extract from text in this section using regex patterns
    for (const pattern of EMAIL_PATTERNS) {
      const matches = sectionText.matchAll(pattern);
      for (const match of matches) {
        const email = normalizeEmail(match[0]);
        if (email && !emails.has(email)) {
          const context = extractContext(sectionText, match[0], 30);
          emails.set(email, {
            value: email,
            source_url: url,
            context: `${section.name}: ${context || match[0]}`
          });
        }
      }
    }
  }

  // Also check form action URLs, hidden inputs, and data attributes for emails
  $('form').each((_, form) => {
    const action = $(form).attr('action') || '';
    const method = $(form).attr('method') || 'get';
    
    // Check form action URL for email patterns
    for (const pattern of EMAIL_PATTERNS) {
      const matches = action.matchAll(pattern);
      for (const match of matches) {
        const email = normalizeEmail(match[0]);
        if (email && !emails.has(email)) {
          emails.set(email, {
            value: email,
            source_url: url,
            context: `form action: ${action}`
          });
        }
      }
    }

    // Check hidden inputs for email values
    $(form).find('input[type="hidden"]').each((_, input) => {
      const value = $(input).attr('value') || '';
      const dataEmail = $(input).attr('data-email') || '';
      const name = $(input).attr('name') || '';
      
      // Check value attribute
      for (const pattern of EMAIL_PATTERNS) {
        const matches = value.matchAll(pattern);
        for (const match of matches) {
          const email = normalizeEmail(match[0]);
          if (email && !emails.has(email)) {
            emails.set(email, {
              value: email,
              source_url: url,
              context: `hidden form input${name ? ` (${name})` : ''}`
            });
          }
        }
      }

      // Check data-email attribute
      for (const pattern of EMAIL_PATTERNS) {
        const matches = dataEmail.matchAll(pattern);
        for (const match of matches) {
          const email = normalizeEmail(match[0]);
          if (email && !emails.has(email)) {
            emails.set(email, {
              value: email,
              source_url: url,
              context: `form data-email attribute${name ? ` (${name})` : ''}`
            });
          }
        }
      }
    });

    // Check all form inputs (including text, email types) for email patterns
    $(form).find('input[type="email"], input[name*="email" i], input[id*="email" i]').each((_, input) => {
      const value = $(input).attr('value') || '';
      const placeholder = $(input).attr('placeholder') || '';
      const name = $(input).attr('name') || '';
      
      // Check value and placeholder
      for (const pattern of EMAIL_PATTERNS) {
        const valueMatches = value.matchAll(pattern);
        for (const match of valueMatches) {
          const email = normalizeEmail(match[0]);
          if (email && !emails.has(email)) {
            emails.set(email, {
              value: email,
              source_url: url,
              context: `form input value${name ? ` (${name})` : ''}`
            });
          }
        }

        const placeholderMatches = placeholder.matchAll(pattern);
        for (const match of placeholderMatches) {
          const email = normalizeEmail(match[0]);
          if (email && !emails.has(email)) {
            emails.set(email, {
              value: email,
              source_url: url,
              context: `form input placeholder${name ? ` (${name})` : ''}`
            });
          }
        }
      }
    });
  });

  // Check meta tags for emails (some sites put contact email in meta)
  $('meta[name*="contact" i], meta[property*="contact" i], meta[name*="email" i]').each((_, meta) => {
    const content = $(meta).attr('content') || '';
    for (const pattern of EMAIL_PATTERNS) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const email = normalizeEmail(match[0]);
        if (email && !emails.has(email)) {
          emails.set(email, {
            value: email,
            source_url: url,
            context: 'meta tag'
          });
        }
      }
    }
  });

  // Check data attributes on common contact elements
  $('[data-email], [data-contact-email], [data-contact]').each((_, element) => {
    const dataEmail = $(element).attr('data-email') || '';
    const dataContactEmail = $(element).attr('data-contact-email') || '';
    const dataContact = $(element).attr('data-contact') || '';
    
    for (const pattern of EMAIL_PATTERNS) {
      const email1 = dataEmail.match(pattern)?.[0];
      const email2 = dataContactEmail.match(pattern)?.[0];
      const email3 = dataContact.match(pattern)?.[0];
      
      for (const emailStr of [email1, email2, email3].filter(Boolean)) {
        const email = normalizeEmail(emailStr!);
        if (email && !emails.has(email)) {
          emails.set(email, {
            value: email,
            source_url: url,
            context: 'data attribute'
          });
        }
      }
    }
  });

  // Fallback: Extract from full body text if provided (for backwards compatibility)
  if (text) {
    for (const pattern of EMAIL_PATTERNS) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const email = normalizeEmail(match[0]);
        if (email && !emails.has(email)) {
          const context = extractContext(text, match[0], 30);
          emails.set(email, {
            value: email,
            source_url: url,
            context: context || undefined
          });
        }
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
 * Checks specific sections: top bar, header, nav, body, footer
 */
export function extractPhones(html: string, url: string): ExtractedPhone[] {
  const phones = new Map<string, ExtractedPhone>();
  const $ = cheerio.load(html);

  // Extract from tel links (check all sections)
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

  // Extract from specific HTML sections (top bar, header, nav, body, footer)
  const sections = [
    { selector: 'header, .header, #header, [role="banner"]', name: 'header' },
    { selector: 'nav, .nav, .navbar, .navigation, [role="navigation"]', name: 'nav' },
    { selector: '.top-bar, .topbar, #topbar, .top-bar, [class*="top"]', name: 'top-bar' },
    { selector: 'body', name: 'body' },
    { selector: 'footer, .footer, #footer, [role="contentinfo"]', name: 'footer' },
    { selector: '.contact-form, form[action*="contact"]', name: 'contact-form' },
  ];

  for (const section of sections) {
    const sectionText = $(section.selector).text() || '';
    
    // Extract from tel links in this section
    $(section.selector).find('a[href^="tel:"]').each((_, element) => {
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

    // Extract from text in this section using regex patterns
    for (const pattern of PHONE_PATTERNS) {
      const matches = sectionText.matchAll(pattern);
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
  }

  // Check meta tags for phones (some sites put contact phone in meta)
  $('meta[name*="contact" i], meta[property*="contact" i], meta[name*="phone" i], meta[name*="tel" i]').each((_, meta) => {
    const content = $(meta).attr('content') || '';
    for (const pattern of PHONE_PATTERNS) {
      const matches = content.matchAll(pattern);
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
  });

  // Check data attributes on common contact elements
  $('[data-phone], [data-tel], [data-contact-phone], [data-contact]').each((_, element) => {
    const dataPhone = $(element).attr('data-phone') || '';
    const dataTel = $(element).attr('data-tel') || '';
    const dataContactPhone = $(element).attr('data-contact-phone') || '';
    const dataContact = $(element).attr('data-contact') || '';
    
    const allData = [dataPhone, dataTel, dataContactPhone, dataContact].join(' ');
    for (const pattern of PHONE_PATTERNS) {
      const matches = allData.matchAll(pattern);
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
  });

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
