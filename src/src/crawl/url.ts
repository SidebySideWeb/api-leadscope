/**
 * URL normalization and validation utilities
 */

/**
 * Normalize URL: force https when missing, strip fragments, trim
 */
export function normalizeUrl(url: string): string | null {
  try {
    // Handle relative URLs
    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (url.startsWith('/')) {
      // Relative URL - cannot normalize without base
      return null;
    }

    const urlObj = new URL(url);
    
    // Force https if no protocol or http
    if (urlObj.protocol === 'http:') {
      urlObj.protocol = 'https:';
    } else if (!urlObj.protocol || urlObj.protocol === '') {
      urlObj.protocol = 'https:';
    }

    // Remove fragment
    urlObj.hash = '';

    // Trim whitespace
    const normalized = urlObj.toString().trim();

    return normalized;
  } catch {
    return null;
  }
}

/**
 * Check if two URLs are from the same registrable domain
 * Simple approach: hostname match or endsWith
 */
export function sameRegistrableDomain(urlA: string, urlB: string): boolean {
  try {
    const hostA = new URL(urlA).hostname.toLowerCase();
    const hostB = new URL(urlB).hostname.toLowerCase();

    // Exact match
    if (hostA === hostB) {
      return true;
    }

    // Remove www. prefix for comparison
    const normalizeHost = (host: string) => {
      if (host.startsWith('www.')) {
        return host.substring(4);
      }
      return host;
    };

    const normA = normalizeHost(hostA);
    const normB = normalizeHost(hostB);

    return normA === normB || normA.endsWith('.' + normB) || normB.endsWith('.' + normA);
  } catch {
    return false;
  }
}

/**
 * Check if URL is crawlable
 * - allow http/https only
 * - block mailto/tel/javascript
 * - block common file extensions
 */
export function isCrawlableUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Only allow http/https
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return false;
    }

    // Already checked protocol above, but double-check for invalid protocols
    if (!urlObj.protocol || (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:')) {
      return false;
    }

    // Block common file extensions
    const blockedExtensions = [
      'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
      'mp4', 'mp3', 'wav', 'avi', 'mov',
      'zip', 'rar', '7z', 'tar', 'gz',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'exe', 'dmg', 'deb', 'rpm'
    ];

    const pathname = urlObj.pathname.toLowerCase();
    const extension = pathname.split('.').pop() || '';

    if (blockedExtensions.includes(extension)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Canonicalize URL: lowercase hostname, remove trailing slash except root
 */
export function canonicalize(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Lowercase hostname
    urlObj.hostname = urlObj.hostname.toLowerCase();

    // Remove trailing slash except for root path
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove query and fragment for canonicalization
    urlObj.search = '';
    urlObj.hash = '';

    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Resolve relative URL against base URL
 */
export function resolveUrl(baseUrl: string, relativeUrl: string): string | null {
  try {
    // Already absolute
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
      return normalizeUrl(relativeUrl);
    }

    const base = new URL(baseUrl);
    const resolved = new URL(relativeUrl, base);
    
    return normalizeUrl(resolved.toString());
  } catch {
    return null;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}
