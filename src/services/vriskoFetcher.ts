/**
 * Best-effort, rate-limited HTML fetcher for vrisko.gr
 * 
 * Features:
 * - One request at a time (no concurrency)
 * - Minimum 1200ms delay between requests
 * - Retry only for 502/503/504 with exponential backoff
 * - Graceful failure (returns null, never throws)
 * - Fixed request fingerprint headers
 */

import axios, { AxiosError } from 'axios';
import { Logger } from '../crawler/vrisko/utils/logger.js';

const logger = new Logger('VriskoFetcher');

/**
 * Fixed headers for request fingerprinting
 */
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'el-GR,el;q=0.9',
  'Referer': 'https://www.vrisko.gr/',
  'Connection': 'keep-alive',
} as const;

/**
 * Minimum delay between requests (ms)
 */
const MIN_DELAY_MS = 1200;

/**
 * Retry backoff delays (ms)
 * attempt 2 → +2s
 * attempt 3 → +5s
 * attempt 4 → abort
 */
const RETRY_DELAYS = [0, 2000, 5000]; // Index 0 unused, index 1 = attempt 2, index 2 = attempt 3

/**
 * HTTP status codes that should trigger retry
 */
const RETRYABLE_STATUS_CODES = [502, 503, 504];

/**
 * Rate limiter: ensures only one request at a time with minimum delay
 */
class RateLimiter {
  private lastRequestTime: number = 0;
  private pendingRequest: Promise<void> | null = null;

  /**
   * Waits for the minimum delay to pass since last request
   */
  async waitForDelay(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const delayNeeded = Math.max(0, MIN_DELAY_MS - timeSinceLastRequest);

    if (delayNeeded > 0) {
      await this.sleep(delayNeeded);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Ensures requests are serialized (one at a time)
   */
  async acquire(): Promise<void> {
    // Wait for any pending request to complete
    if (this.pendingRequest) {
      await this.pendingRequest;
    }

    // Create new pending request
    this.pendingRequest = this.waitForDelay();
    await this.pendingRequest;
    this.pendingRequest = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const rateLimiter = new RateLimiter();

/**
 * Checks if response indicates a captcha page
 */
function isCaptchaPage(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  return (
    lowerHtml.includes('captcha') ||
    lowerHtml.includes('recaptcha') ||
    lowerHtml.includes('cloudflare') ||
    lowerHtml.includes('challenge')
  );
}

/**
 * Builds the search URL for vrisko.gr
 */
function buildSearchUrl(keyword: string, city: string, page: number = 1): string {
  const encodedKeyword = encodeURIComponent(keyword);
  const encodedCity = encodeURIComponent(city);
  return `https://www.vrisko.gr/search/${encodedKeyword}/${encodedCity}/?page=${page}`;
}

/**
 * Fetches a single page with retry logic
 */
async function fetchWithRetry(url: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: REQUEST_HEADERS,
        timeout: 30000,
        validateStatus: (status) => status < 500, // Don't throw on 4xx/5xx, handle manually
      });

      // Success
      if (response.status === 200 && response.data) {
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        
        // Check for captcha pages
        if (isCaptchaPage(html)) {
          logger.warn(`Captcha page detected for ${url}`);
          return null;
        }

        return html;
      }

      // Handle non-200 status codes
      if (response.status === 403) {
        logger.warn(`403 Forbidden for ${url} - not retrying`);
        return null;
      }

      if (RETRYABLE_STATUS_CODES.includes(response.status)) {
        // Retryable error - will retry below
        throw new Error(`HTTP ${response.status}`);
      }

      // Other non-200 status codes - don't retry
      logger.warn(`Unexpected status ${response.status} for ${url}`);
      return null;

    } catch (error) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;

      // Network errors or retryable status codes
      if (
        !statusCode || // Network error
        RETRYABLE_STATUS_CODES.includes(statusCode)
      ) {
        if (attempt < 4) {
          const backoffDelay = RETRY_DELAYS[attempt - 1] || 0;
          logger.warn(
            `Request failed (attempt ${attempt}/4) for ${url}, retrying in ${backoffDelay}ms...`,
            statusCode ? `Status: ${statusCode}` : 'Network error'
          );
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          continue;
        } else {
          logger.warn(`Request failed after 4 attempts for ${url}`);
          return null;
        }
      }

      // Non-retryable errors (403, etc.)
      if (statusCode === 403) {
        logger.warn(`403 Forbidden for ${url} - not retrying`);
        return null;
      }

      // Other errors - don't retry
      logger.warn(`Request failed for ${url}:`, axiosError.message);
      return null;
    }
  }

  return null;
}

/**
 * Fetches a vrisko.gr search page
 * 
 * @param params - Search parameters
 * @param params.keyword - Search keyword
 * @param params.city - City name
 * @param params.page - Page number (default: 1)
 * @returns Raw HTML string on success, null on failure
 */
export async function fetchVriskoPage(params: {
  keyword: string;
  city: string;
  page?: number;
}): Promise<string | null> {
  const { keyword, city, page = 1 } = params;
  const url = buildSearchUrl(keyword, city, page);

  try {
    // Acquire rate limiter lock (ensures one request at a time with delay)
    await rateLimiter.acquire();

    // Fetch with retry logic
    const html = await fetchWithRetry(url);

    if (html) {
      logger.info(`Successfully fetched page ${page} for "${keyword}" in "${city}"`);
    } else {
      logger.warn(`Failed to fetch page ${page} for "${keyword}" in "${city}"`);
    }

    return html;
  } catch (error: any) {
    // Never throw - always return null on unexpected errors
    logger.warn(`Unexpected error fetching ${url}:`, error.message);
    return null;
  }
}
