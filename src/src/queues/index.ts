import PQueue from 'p-queue';
import dotenv from 'dotenv';

dotenv.config();

const DISCOVERY_CONCURRENCY = parseInt(process.env.DISCOVERY_QUEUE_CONCURRENCY || '2', 10);
const CRAWLER_CONCURRENCY = parseInt(process.env.CRAWLER_QUEUE_CONCURRENCY || '5', 10);
const EXTRACTOR_CONCURRENCY = parseInt(process.env.EXTRACTOR_QUEUE_CONCURRENCY || '5', 10);
const RETRY_ATTEMPTS = parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '3', 10);

export interface QueueTask<T> {
  id: string;
  data: T;
  retries?: number;
}

export interface QueueOptions {
  concurrency: number;
  retryAttempts: number;
}

class RetryQueue<T> {
  private queue: PQueue;
  private retryAttempts: number;

  constructor(options: QueueOptions) {
    this.retryAttempts = options.retryAttempts;
    this.queue = new PQueue({
      concurrency: options.concurrency
    });
  }

  async add(
    task: QueueTask<T>,
    handler: (data: T) => Promise<void>
  ): Promise<void> {
    let attempts = 0;
    const maxAttempts = task.retries !== undefined ? task.retries : this.retryAttempts;

    await this.queue.add(async () => {
      while (attempts < maxAttempts) {
        try {
          await handler(task.data);
          return; // Success
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            console.error(`Task ${task.id} failed after ${maxAttempts} attempts:`, error);
            throw error;
          }
          console.warn(`Task ${task.id} failed (attempt ${attempts}/${maxAttempts}), retrying...`);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
        }
      }
    });
  }

  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  get size(): number {
    return this.queue.size;
  }

  get pending(): number {
    return this.queue.pending;
  }

  async pause(): Promise<void> {
    this.queue.pause();
  }

  async start(): Promise<void> {
    this.queue.start();
  }

  async clear(): Promise<void> {
    this.queue.clear();
  }
}

// Discovery queue
export const discoveryQueue = new RetryQueue<any>({
  concurrency: DISCOVERY_CONCURRENCY,
  retryAttempts: RETRY_ATTEMPTS
});

// Crawler queue
export const crawlerQueue = new RetryQueue<any>({
  concurrency: CRAWLER_CONCURRENCY,
  retryAttempts: RETRY_ATTEMPTS
});

// Extractor queue
export const extractorQueue = new RetryQueue<any>({
  concurrency: EXTRACTOR_CONCURRENCY,
  retryAttempts: RETRY_ATTEMPTS
});
