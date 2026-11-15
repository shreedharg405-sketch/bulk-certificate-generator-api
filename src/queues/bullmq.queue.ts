import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { IQueueService } from './queue.interface.js';
import { QueueChunkPayload } from '../types/index.js';
import { processQueueChunk } from './job.processor.js';
import { config } from '../config/index.js';

export class BullMQQueueService implements IQueueService {
  public name = 'BullMQ (Redis)';
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private redisConnection: Redis | null = null;
  private isConnected = false;

  private getRedisConnection(): Redis {
    if (!this.redisConnection) {
      this.redisConnection = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => Math.min(times * 100, 3000)
      });

      this.redisConnection.on('connect', () => {
        this.isConnected = true;
        console.log('[BullMQ] Connected to Redis successfully');
      });

      this.redisConnection.on('error', (err) => {
        this.isConnected = false;
        console.error('[BullMQ] Redis connection error:', err.message);
      });
    }
    return this.redisConnection;
  }

  public async initQueue(): Promise<Queue> {
    if (!this.queue) {
      const connection = this.getRedisConnection();
      this.queue = new Queue(config.queueName, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 }
        }
      });
    }
    return this.queue;
  }

  public async enqueueChunk(payload: QueueChunkPayload): Promise<void> {
    const queue = await this.initQueue();
    await queue.add(`chunk-${payload.job_id}-${payload.chunk_index}`, payload, {
      jobId: `${payload.job_id}-chunk-${payload.chunk_index}`
    });
    console.log(`[BullMQ] Enqueued chunk ${payload.chunk_index + 1}/${payload.total_chunks} for job ${payload.job_id}`);
  }

  public async startWorker(): Promise<void> {
    if (this.worker) return;

    const connection = this.getRedisConnection();
    this.worker = new Worker(
      config.queueName,
      async (job: Job<QueueChunkPayload>) => {
        return processQueueChunk(job.data);
      },
      {
        connection,
        concurrency: config.maxConcurrency
      }
    );

    this.worker.on('completed', (job) => {
      console.log(`[BullMQ Worker] Completed job chunk ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[BullMQ Worker] Job chunk ${job?.id} failed:`, err.message);
    });

    console.log(`[BullMQ Worker] Started listening on queue "${config.queueName}" with concurrency ${config.maxConcurrency}`);
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    if (this.redisConnection) {
      await this.redisConnection.quit();
      this.redisConnection = null;
    }
    this.isConnected = false;
  }

  public async getStatus(): Promise<{
    type: string;
    isConnected: boolean;
    waiting?: number;
    active?: number;
    completed?: number;
    failed?: number;
  }> {
    try {
      if (!this.queue) {
        await this.initQueue();
      }
      const counts = await this.queue!.getJobCounts('waiting', 'active', 'completed', 'failed');
      return {
        type: this.name,
        isConnected: this.isConnected,
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed
      };
    } catch {
      return {
        type: this.name,
        isConnected: this.isConnected
      };
    }
  }
}
