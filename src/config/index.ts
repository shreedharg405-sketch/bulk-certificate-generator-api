import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const ROOT_DIR = process.cwd();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || '3000'}`,
  
  // Storage
  storageDir: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage'),
  certificatesDir: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'certificates'),
  zipsDir: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'zips'),
  uploadsDir: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'uploads'),
  templatesDir: path.resolve(ROOT_DIR, 'src', 'templates'),

  // Database
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH || 'storage/database.sqlite'),

  // Queue & Worker Configuration
  queueDriver: (process.env.QUEUE_DRIVER || 'auto') as 'auto' | 'bullmq' | 'local',
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  },
  queueName: process.env.QUEUE_NAME || 'certificate-generation-queue',
  chunkSize: parseInt(process.env.CHUNK_SIZE || '50', 10),
  maxConcurrency: parseInt(process.env.MAX_CONCURRENT_RENDERS || '5', 10),

  // Rendering
  chromePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  defaultTemplatePath: path.resolve(ROOT_DIR, 'src', 'templates', 'default.html')
};
