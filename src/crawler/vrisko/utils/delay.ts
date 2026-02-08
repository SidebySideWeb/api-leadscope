/**
 * Utility for adding delays between requests to prevent blocking
 */

/**
 * Creates a random delay between min and max milliseconds
 * @param min - Minimum delay in milliseconds
 * @param max - Maximum delay in milliseconds
 * @returns Promise that resolves after the delay
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Standard delay for vrisko.gr requests (500ms - 2000ms)
 */
export function standardDelay(): Promise<void> {
  return randomDelay(500, 2000);
}
