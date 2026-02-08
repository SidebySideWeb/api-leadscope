/**
 * Simple logger utility for crawler operations
 */

export class Logger {
  private prefix: string;

  constructor(prefix: string = 'VriskoCrawler') {
    this.prefix = prefix;
  }

  info(message: string, ...args: any[]): void {
    console.log(`[${this.prefix}] ${message}`, ...args);
  }

  error(message: string, error?: any): void {
    console.error(`[${this.prefix}] ERROR: ${message}`, error || '');
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[${this.prefix}] WARN: ${message}`, ...args);
  }

  success(message: string, ...args: any[]): void {
    console.log(`[${this.prefix}] ✅ ${message}`, ...args);
  }
}
