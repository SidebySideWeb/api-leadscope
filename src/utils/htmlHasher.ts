import crypto from 'crypto';

/**
 * Generates SHA256 hash of HTML content
 */
export function hashHtml(html: string): string {
  return crypto.createHash('sha256').update(html, 'utf8').digest('hex');
}
