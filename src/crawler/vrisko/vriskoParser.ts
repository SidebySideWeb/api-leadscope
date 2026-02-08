/**
 * Parser for vrisko.gr search listing pages
 * Extracts structured business data from HTML
 */

import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from './utils/logger.js';

export interface VriskoBusiness {
  id: string;
  name: string;
  category: string;
  address: {
    street: string;
    city: string;
    postal_code: string;
    region: string;
    country: string;
  };
  phones: string[];
  email: string | null;
  website: string | null;
  location: {
    latitude: number | null;
    longitude: number | null;
  };
  source: 'vrisko';
  listing_url: string;
  scraped_at: string;
}

export class VriskoParser {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('VriskoParser');
  }

  /**
   * Parses a single listing from .AdvItemBox
   */
  private parseListing($: cheerio.CheerioAPI, $listing: cheerio.Cheerio<any>, baseUrl: string): VriskoBusiness | null {
    try {
      // Business Name
      const nameElement = $listing.find('h2.CompanyName a.nav-company');
      const name = nameElement.text().trim() || nameElement.attr('title')?.trim() || '';

      if (!name) {
        this.logger.warn('Skipping listing: no business name found');
        return null;
      }

      // Category
      const category = $listing.find('.AdvCategory').text().trim() || '';

      // Address components from meta tags
      const streetAddress = $listing.find('meta[itemprop="streetAddress"]').attr('content')?.trim() || '';
      const addressLocality = $listing.find('meta[itemprop="addressLocality"]').attr('content')?.trim() || '';
      const postalCode = $listing.find('meta[itemprop="postalCode"]').attr('content')?.trim() || '';
      const addressRegion = $listing.find('meta[itemprop="addressRegion"]').attr('content')?.trim() || '';
      const addressCountry = $listing.find('meta[itemprop="addressCountry"]').attr('content')?.trim() || 'Greece';

      // Phone numbers
      const phones: string[] = [];
      $listing.find('[itemprop="telephone"]').each((_, el) => {
        const phone = $(el).text().trim() || $(el).attr('content')?.trim();
        if (phone) {
          phones.push(phone);
        }
      });

      // Email
      const emailMeta = $listing.find('meta[itemprop="email"]').attr('content')?.trim();
      const emailLink = $listing.find('a[href^="mailto:"]').attr('href')?.replace('mailto:', '').trim();
      const email = emailMeta || emailLink || null;

      // Website
      const websiteElement = $listing.find('a[itemprop="url"]');
      const website = websiteElement.attr('href')?.trim() || null;

      // Coordinates
      const latitudeMeta = $listing.find('meta[itemprop="latitude"]').attr('content');
      const longitudeMeta = $listing.find('meta[itemprop="longitude"]').attr('content');
      const latitude = latitudeMeta ? parseFloat(latitudeMeta) : null;
      const longitude = longitudeMeta ? parseFloat(longitudeMeta) : null;

      // Listing URL
      const listingLink = nameElement.attr('href');
      const listingUrl = listingLink 
        ? (listingLink.startsWith('http') ? listingLink : `${baseUrl}${listingLink}`)
        : '';

      return {
        id: uuidv4(),
        name,
        category,
        address: {
          street: streetAddress,
          city: addressLocality,
          postal_code: postalCode,
          region: addressRegion,
          country: addressCountry,
        },
        phones,
        email,
        website,
        location: {
          latitude,
          longitude,
        },
        source: 'vrisko',
        listing_url: listingUrl,
        scraped_at: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Error parsing listing:', error);
      return null;
    }
  }

  /**
   * Parses HTML and extracts all business listings
   */
  parse(html: string, baseUrl: string = 'https://www.vrisko.gr'): VriskoBusiness[] {
    try {
      const $ = cheerio.load(html);
      const listings: VriskoBusiness[] = [];

      // Find all listing boxes
      $('.AdvItemBox').each((_, element) => {
        const $listing = $(element);
        const parsed = this.parseListing($, $listing, baseUrl);
        
        if (parsed) {
          listings.push(parsed);
        }
      });

      this.logger.info(`Parsed ${listings.length} listings from page`);
      return listings;
    } catch (error: any) {
      this.logger.error('Error parsing HTML:', error);
      return [];
    }
  }
}
