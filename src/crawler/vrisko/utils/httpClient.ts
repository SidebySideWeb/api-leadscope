/**
 * HTTP client with anti-blocking features for vrisko.gr
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import randomUseragent from 'random-useragent';
import { Logger } from './logger.js';

export interface HttpClientConfig {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export class HttpClient {
  private client: AxiosInstance;
  private logger: Logger;
  private retries: number;
  private retryDelay: number;

  constructor(config: HttpClientConfig = {}) {
    this.retries = config.retries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.logger = new Logger('HttpClient');

    this.client = axios.create({
      timeout: config.timeout || 30000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });
  }

  /**
   * Gets a random user agent
   */
  private getRandomUserAgent(): string {
    return randomUseragent.getRandom() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetches a URL with retry logic and random user agent
   */
  async fetch(url: string, config: AxiosRequestConfig = {}): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const userAgent = this.getRandomUserAgent();
        
        const response = await this.client.get(url, {
          ...config,
          headers: {
            ...config.headers,
            'User-Agent': userAgent,
          },
        });

        if (response.status === 200 && response.data) {
          return response.data;
        }

        throw new Error(`Unexpected status code: ${response.status}`);
      } catch (error: any) {
        lastError = error;
        
        if (attempt < this.retries) {
          const delay = this.retryDelay * attempt;
          this.logger.warn(
            `Request failed (attempt ${attempt}/${this.retries}), retrying in ${delay}ms...`,
            error.message
          );
          await this.sleep(delay);
        } else {
          this.logger.error(`Request failed after ${this.retries} attempts:`, error.message);
        }
      }
    }

    throw lastError || new Error('Request failed');
  }
}
