/**
 * Main crawler for vrisko.gr search listings
 * Handles pagination and aggregates results
 */

import pLimit from 'p-limit';
import { HttpClient } from './utils/httpClient.js';
import { VriskoParser, type VriskoBusiness } from './vriskoParser.js';
import { standardDelay } from './utils/delay.js';
import { Logger } from './utils/logger.js';

export interface VriskoCrawlerConfig {
  maxPages?: number;
  concurrency?: number;
  delayBetweenPages?: boolean;
}

export class VriskoCrawler {
  private httpClient: HttpClient;
  private parser: VriskoParser;
  private logger: Logger;
  private config: Required<VriskoCrawlerConfig>;

  constructor(config: VriskoCrawlerConfig = {}) {
    this.httpClient = new HttpClient({
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
    });
    this.parser = new VriskoParser();
    this.logger = new Logger('VriskoCrawler');
    this.config = {
      maxPages: config.maxPages || Infinity,
      concurrency: config.concurrency || 1,
      delayBetweenPages: config.delayBetweenPages !== false,
    };
  }

  /**
   * Builds the search URL for a given page
   */
  private buildSearchUrl(keyword: string, location: string, page: number): string {
    // URL encode the parameters
    const encodedKeyword = encodeURIComponent(keyword);
    const encodedLocation = encodeURIComponent(location);
    
    return `https://www.vrisko.gr/search/${encodedKeyword}/${encodedLocation}/?page=${page}`;
  }

  /**
   * Fetches and parses a single page
   */
  private async fetchPage(keyword: string, location: string, page: number): Promise<VriskoBusiness[]> {
    const url = this.buildSearchUrl(keyword, location, page);
    this.logger.info(`Fetching page ${page}: ${url}`);

    try {
      const html = await this.httpClient.fetch(url);
      const listings = this.parser.parse(html);

      if (listings.length === 0) {
        this.logger.info(`Page ${page}: No listings found (end of results)`);
      } else {
        this.logger.success(`Page ${page}: Found ${listings.length} listings`);
      }

      return listings;
    } catch (error: any) {
      this.logger.error(`Failed to fetch page ${page}:`, error.message);
      // Return empty array to continue crawling other pages
      return [];
    }
  }

  /**
   * Crawls vrisko.gr search listings with pagination
   */
  async crawl(
    searchKeyword: string,
    searchLocation: string,
    maxPages?: number
  ): Promise<VriskoBusiness[]> {
    const limit = maxPages || this.config.maxPages;
    const allListings: VriskoBusiness[] = [];
    let currentPage = 1;
    let consecutiveEmptyPages = 0;
    const maxConsecutiveEmpty = 2; // Stop after 2 consecutive empty pages

    this.logger.info(`Starting crawl for "${searchKeyword}" in "${searchLocation}"`);
    this.logger.info(`Max pages: ${limit === Infinity ? 'unlimited' : limit}`);

    const pageLimit = pLimit(this.config.concurrency);

    while (currentPage <= limit) {
      const page = currentPage;
      
      const listings = await pageLimit(async () => {
        const results = await this.fetchPage(searchKeyword, searchLocation, page);
        
        // Add delay between pages if enabled
        if (this.config.delayBetweenPages && page > 1) {
          await standardDelay();
        }
        
        return results;
      });

      if (listings.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= maxConsecutiveEmpty) {
          this.logger.info(`Stopping: ${maxConsecutiveEmpty} consecutive empty pages`);
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
        allListings.push(...listings);
        this.logger.info(`Total listings collected: ${allListings.length}`);
      }

      currentPage++;
    }

    this.logger.success(`Crawl completed: ${allListings.length} total listings from ${currentPage - 1} pages`);
    return allListings;
  }
}
