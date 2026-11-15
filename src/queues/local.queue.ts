import { IQueueService } from './queue.interface.js';
import { QueueChunkPayload } from '../types/index.js';
import { processQueueChunk } from './job.processor.js';
import { config } from '../config/index.js';

export class LocalAsyncQueueService implements IQueueService {
  public name = 'Local Async Resilient Worker Queue';
  private queue: QueueChunkPayload[] = [];
  private activeJobs = 0;
  private completedJobs = 0;
  private failedJobs = 0;
  private isRunning = false;
  private maxConcurrency: number;

  constructor(maxConcurrency: number = config.maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
  }

  public async enqueueChunk(payload: QueueChunkPayload): Promise<void> {
    this.queue.push(payload);
    console.log(`[Local Queue] Enqueued chunk ${payload.chunk_index + 1}/${payload.total_chunks} for job ${payload.job_id}. Queue size: ${this.queue.length}`);
    this.processNext();
  }

  public async startWorker(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Local Queue Worker] Started worker engine with concurrency limit ${this.maxConcurrency}`);
    this.processNext();
  }

  private processNext(): void {
    if (!this.isRunning) return;

    while (this.activeJobs < this.maxConcurrency && this.queue.length > 0) {
      const payload = this.queue.shift();
      if (!payload) break;

      this.activeJobs++;
      // Asynchronously process chunk without blocking the event loop
      (async () => {
        try {
          await processQueueChunk(payload);
          this.completedJobs++;
        } catch (err: any) {
          console.error(`[Local Queue Worker] Error processing chunk for job ${payload.job_id}:`, err);
          this.failedJobs++;
        } finally {
          this.activeJobs--;
          // Trigger next in queue
          this.processNext();
        }
      })();
    }
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    this.queue = [];
  }

  public async getStatus(): Promise<{
    type: string;
    isConnected: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    return {
      type: this.name,
      isConnected: true,
      waiting: this.queue.length,
      active: this.activeJobs,
      completed: this.completedJobs,
      failed: this.failedJobs
    };
  }
}
