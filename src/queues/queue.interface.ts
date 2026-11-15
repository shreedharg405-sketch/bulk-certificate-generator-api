import { QueueChunkPayload } from '../types/index.js';

export interface IQueueService {
  name: string;
  enqueueChunk(payload: QueueChunkPayload): Promise<void>;
  startWorker(): Promise<void>;
  close(): Promise<void>;
  getStatus(): Promise<{
    type: string;
    isConnected: boolean;
    waiting?: number;
    active?: number;
    completed?: number;
    failed?: number;
  }>;
}
