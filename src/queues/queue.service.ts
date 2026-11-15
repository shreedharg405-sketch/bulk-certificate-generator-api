import Redis from 'ioredis';
import { IQueueService } from './queue.interface.js';
import { BullMQQueueService } from './bullmq.queue.js';
import { LocalAsyncQueueService } from './local.queue.js';
import { RecipientRecord, QueueChunkPayload } from '../types/index.js';
import { config } from '../config/index.js';

export class QueueManager {
  private activeQueue: IQueueService | null = null;
  private initializingPromise: Promise<IQueueService> | null = null;

  public async getQueue(): Promise<IQueueService> {
    if (this.activeQueue) {
      return this.activeQueue;
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = this.resolveQueueEngine();
    this.activeQueue = await this.initializingPromise;
    return this.activeQueue;
  }

  private async resolveQueueEngine(): Promise<IQueueService> {
    if (config.queueDriver === 'bullmq') {
      console.log('[QueueManager] Configured for BullMQ (Redis)');
      const bullQueue = new BullMQQueueService();
      await bullQueue.initQueue();
      return bullQueue;
    }

    if (config.queueDriver === 'local') {
      console.log('[QueueManager] Configured for Local Async Resilient Worker Queue');
      const localQueue = new LocalAsyncQueueService();
      await localQueue.startWorker();
      return localQueue;
    }

    // Auto-detect mode: test Redis connectivity with 1s timeout
    const canConnectToRedis = await this.testRedisConnection();
    if (canConnectToRedis) {
      console.log('[QueueManager] Redis detected. Using BullMQ queue engine.');
      const bullQueue = new BullMQQueueService();
      await bullQueue.initQueue();
      return bullQueue;
    } else {
      console.log(
        `[QueueManager] Notice: Redis not reachable at ${config.redis.host}:${config.redis.port}. ` +
        `Using Local Async Resilient Worker Queue (in-memory + sqlite persisted, concurrency: ${config.maxConcurrency}).`
      );
      const localQueue = new LocalAsyncQueueService();
      await localQueue.startWorker();
      return localQueue;
    }
  }

  private async testRedisConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      let isSettled = false;
      const testClient = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        connectTimeout: 1000,
        maxRetriesPerRequest: 0,
        enableReadyCheck: false,
        retryStrategy: () => null // don't retry
      });

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try { testClient.disconnect(); } catch {}
          resolve(false);
        }
      }, 1200);

      testClient.ping((err, res) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          try { testClient.disconnect(); } catch {}
          if (!err && res === 'PONG') {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      });

      testClient.on('error', () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          try { testClient.disconnect(); } catch {}
          resolve(false);
        }
      });
    });
  }

  /**
   * Chunks records into batch sizes (e.g., 50 items) and enqueues each chunk
   */
  public async enqueueJobChunks(jobId: string, records: RecipientRecord[]): Promise<number> {
    const queue = await this.getQueue();
    const chunkSize = Math.max(1, config.chunkSize);
    const totalChunks = Math.ceil(records.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const chunkRecords = records.slice(i * chunkSize, (i + 1) * chunkSize);
      const payload: QueueChunkPayload = {
        job_id: jobId,
        chunk_index: i,
        total_chunks: totalChunks,
        records: chunkRecords
      };
      await queue.enqueueChunk(payload);
    }

    return totalChunks;
  }

  public async startWorker(): Promise<void> {
    const queue = await this.getQueue();
    await queue.startWorker();
  }

  public async close(): Promise<void> {
    if (this.activeQueue) {
      await this.activeQueue.close();
      this.activeQueue = null;
    }
  }

  public async getStatus() {
    const queue = await this.getQueue();
    return queue.getStatus();
  }
}

export const queueManager = new QueueManager();
