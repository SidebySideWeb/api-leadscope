import cron from 'node-cron';
import { runRefreshJob } from '../services/refreshService.js';
import type { RefreshJobInput } from '../types/jobs.js';

/**
 * Refresh Job Scheduler
 * Runs monthly refresh jobs automatically
 */
class RefreshScheduler {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;

  /**
   * Start the scheduler
   * Runs on the 1st of every month at 2 AM
   */
  start(options: RefreshJobInput = {}) {
    if (this.task) {
      console.log('Refresh scheduler already running');
      return;
    }

    // Schedule: 1st of every month at 2:00 AM
    this.task = cron.schedule('0 2 1 * *', async () => {
      if (this.isRunning) {
        console.log('Refresh job already running, skipping...');
        return;
      }

      this.isRunning = true;
      console.log('\n⏰ Scheduled refresh job triggered');

      try {
        await runRefreshJob(options);
      } catch (error) {
        console.error('Scheduled refresh job failed:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✅ Refresh scheduler started (runs 1st of every month at 2:00 AM)');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('Refresh scheduler stopped');
    }
  }

  /**
   * Run refresh job immediately (for testing)
   */
  async runNow(options: RefreshJobInput = {}) {
    if (this.isRunning) {
      throw new Error('Refresh job already running');
    }

    this.isRunning = true;
    try {
      return await runRefreshJob(options);
    } finally {
      this.isRunning = false;
    }
  }
}

export const refreshScheduler = new RefreshScheduler();
