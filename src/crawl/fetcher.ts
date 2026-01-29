/**
 * Fetcher - Native fetch with limits and safety
 */

const USER_AGENT = 'LeadCrawler/1.0 (+https://example.com)';
const DEFAULT_TIMEOUT = 12000; // 12 seconds
const MAX_RESPONSE_SIZE = 1.5 * 1024 * 1024; // 1.5MB

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  content: string;
  error?: string;
}

/**
 * Fetch URL with timeout and size limits
 */
export async function fetchUrl(
  url: string,
  options: {
    timeout?: number;
    maxSize?: number;
  } = {}
): Promise<FetchResult> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const maxSize = options.maxSize || MAX_RESPONSE_SIZE;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,text/plain,*/*;q=0.1',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9,el;q=0.8'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    // Check content length header if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > maxSize) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    // Read response with size limit
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let content = '';
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSize) {
        reader.cancel();
        throw new Error(`Response exceeded size limit: ${totalSize} bytes`);
      }

      // Decode chunk (assuming UTF-8)
      content += new TextDecoder('utf-8').decode(value, { stream: true });
    }

    return {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType,
      content
    };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
    
    throw new Error('Unknown fetch error');
  }
}

/**
 * Check if URL is accessible (HEAD request)
 */
export async function checkUrlAccessible(url: string, timeout = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}
