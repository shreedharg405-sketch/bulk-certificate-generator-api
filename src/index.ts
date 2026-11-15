import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { config } from './config/index.js';
import certificateRoutes from './routes/certificate.routes.js';
import { queueManager } from './queues/queue.service.js';
import { getDatabase } from './db/index.js';
import { certificateRendererService } from './services/renderer.service.js';
import { storageService } from './services/storage.service.js';

const app = express();

// Initialize local directories & database
storageService.ensureDirectories();
getDatabase();

// Middlewares
app.use(helmet({
  contentSecurityPolicy: false // Allow fonts & Google fonts in templates
}));
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static frontend dashboard
const publicDir = path.resolve(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Serve sample CSV file directly
app.get('/sample_recipients.csv', (_req: Request, res: Response) => {
  const samplePath = path.resolve(process.cwd(), 'sample_recipients.csv');
  if (fs.existsSync(samplePath)) {
    res.download(samplePath, 'sample_recipients.csv');
  } else {
    res.status(404).send('Sample CSV not found');
  }
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  const queueStatus = await queueManager.getStatus();
  res.status(200).json({
    status: 'HEALTHY',
    service: 'bulk-certificate-generator-api',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    queue: queueStatus,
    storage: {
      storage_dir: config.storageDir,
      max_concurrency: config.maxConcurrency,
      chunk_size: config.chunkSize
    },
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
    }
  });
});

// API Documentation summary endpoint
app.get('/api-docs', (_req: Request, res: Response) => {
  res.status(200).json({
    title: 'Bulk Certificate Generator API Specification',
    version: '1.0.0',
    base_url: `${config.appUrl}/api/v1/certificates`,
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/certificates/jobs',
        description: 'Ingest recipient CSV/Excel file or JSON array, returns 202 Accepted with job_id immediately',
        content_types: ['multipart/form-data', 'application/json'],
        parameters: {
          file: 'CSV or Excel file (multipart/form-data)',
          template: 'Custom HTML template (file or string)',
          job_name: 'Optional job cohort title',
          output_format: 'pdf | png (default: pdf)',
          recipients: 'JSON array of recipients (when using application/json)'
        }
      },
      {
        method: 'GET',
        path: '/api/v1/certificates/jobs/:jobId',
        description: 'Get real-time job generation progress, processed count, failed count, and download status'
      },
      {
        method: 'GET',
        path: '/api/v1/certificates/jobs/:jobId/download',
        description: 'Download packaged .ZIP archive containing all generated certificates'
      },
      {
        method: 'GET',
        path: '/api/v1/certificates/verify/:certId',
        description: 'Verify authenticity of a certificate ID (returns JSON or HTML verification card)'
      },
      {
        method: 'GET',
        path: '/api/v1/certificates/:certId/preview',
        description: 'Preview or view individual rendered certificate (PDF or PNG)'
      },
      {
        method: 'GET',
        path: '/api/v1/certificates/jobs',
        description: 'List recent certificate generation jobs'
      }
    ]
  });
});

// Mount Certificate routes
app.use('/api/v1/certificates', certificateRoutes);

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Error]:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Start server
const server = app.listen(config.port, config.host, async () => {
  console.log(`====================================================`);
  console.log(`🚀 Bulk Certificate Generator API running at:`);
  console.log(`   Local URL:    ${config.appUrl}`);
  console.log(`   Healthcheck:  ${config.appUrl}/health`);
  console.log(`   API Endpoint: ${config.appUrl}/api/v1/certificates/jobs`);
  console.log(`====================================================`);

  // Auto-start worker in background
  try {
    console.log('[System] Initializing asynchronous worker queue engine...');
    await queueManager.startWorker();
  } catch (workerErr: any) {
    console.error('[System] Worker failed to initialize:', workerErr.message);
  }
});

// Graceful shutdown
const handleShutdown = async (signal: string) => {
  console.log(`\n[System] Received ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    await queueManager.close();
    await certificateRendererService.closeBrowser();
    console.log('[System] Server and workers closed cleanly.');
    process.exit(0);
  });
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export { app, server };
