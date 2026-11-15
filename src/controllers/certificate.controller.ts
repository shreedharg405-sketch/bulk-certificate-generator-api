import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { JobRepository, CertificateRepository } from '../db/index.js';
import { parserService } from '../services/parser.service.js';
import { certificateRendererService } from '../services/renderer.service.js';
import { queueManager } from '../queues/queue.service.js';
import { storageService } from '../services/storage.service.js';
import { CertificateJob, ParseResult } from '../types/index.js';

export class CertificateController {
  /**
   * POST /api/v1/certificates/jobs
   * Ingest recipient records and queue certificate generation
   */
  public async createJob(req: Request, res: Response): Promise<void> {
    try {
      let parseResult: ParseResult;
      let templateHtml: string;
      const jobName = (req.body.job_name as string) || `Bulk Job ${new Date().toISOString().replace(/T/, ' ').slice(0, 19)}`;
      const outputFormat = (req.body.output_format === 'png' ? 'png' : 'pdf') as 'pdf' | 'png';

      // 1. Template handling
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const templateFile = files?.['template']?.[0];
      const dataFile = files?.['file']?.[0];

      if (templateFile) {
        templateHtml = fs.readFileSync(templateFile.path, 'utf-8');
      } else if (typeof req.body.template === 'string' && req.body.template.trim().length > 0) {
        templateHtml = req.body.template;
      } else {
        templateHtml = certificateRendererService.getDefaultTemplate();
      }

      // 2. Data parsing (File upload vs JSON payload)
      if (dataFile) {
        const ext = path.extname(dataFile.originalname).toLowerCase();
        if (ext === '.csv') {
          parseResult = await parserService.parseCsvFile(dataFile.path);
        } else if (['.xlsx', '.xls'].includes(ext)) {
          parseResult = await parserService.parseExcelFile(dataFile.path);
        } else {
          res.status(400).json({
            success: false,
            error: 'Unsupported file format. Please upload CSV (.csv) or Excel (.xlsx, .xls) file.'
          });
          return;
        }

        // Clean up temp upload file
        storageService.deleteFile(dataFile.path);
      } else if (Array.isArray(req.body.recipients)) {
        parseResult = parserService.parseJsonArray(req.body.recipients);
      } else if (typeof req.body.recipients === 'string') {
        try {
          const parsedJson = JSON.parse(req.body.recipients);
          if (!Array.isArray(parsedJson)) throw new Error('recipients must be an array');
          parseResult = parserService.parseJsonArray(parsedJson);
        } catch (e: any) {
          res.status(400).json({
            success: false,
            error: 'Invalid recipients JSON array format'
          });
          return;
        }
      } else {
        res.status(400).json({
          success: false,
          error: 'Missing input data. Please upload a file (CSV/Excel) or provide a recipients array.'
        });
        return;
      }

      // If template was uploaded as file, clean it up
      if (templateFile) {
        storageService.deleteFile(templateFile.path);
      }

      if (parseResult.validRecords.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No valid recipient records found in provided data',
          invalid_records_count: parseResult.invalidRecords.length,
          validation_errors: parseResult.invalidRecords.slice(0, 10)
        });
        return;
      }

      const jobId = `job_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
      const now = new Date().toISOString();

      const newJob: CertificateJob = {
        id: jobId,
        job_name: jobName,
        status: 'QUEUED',
        total_count: parseResult.validRecords.length,
        processed_count: 0,
        failed_count: 0,
        template_html: templateHtml,
        output_format: outputFormat,
        download_url: null,
        zip_path: null,
        error_message: null,
        created_at: now,
        updated_at: now
      };

      // Persist job to SQLite DB
      JobRepository.create(newJob);

      // Decoupled asynchronous enqueueing in chunks
      await queueManager.enqueueJobChunks(jobId, parseResult.validRecords);

      // HTTP 202 Accepted returned immediately
      res.status(202).json({
        success: true,
        job_id: jobId,
        total_records: parseResult.validRecords.length,
        status: 'QUEUED',
        check_status_url: `/api/v1/certificates/jobs/${jobId}`,
        skipped_invalid_rows: parseResult.invalidRecords.length
      });
    } catch (err: any) {
      console.error('[CertificateController] createJob error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Internal server error while creating certificate job'
      });
    }
  }

  /**
   * GET /api/v1/certificates/jobs/:jobId
   * Return real-time progress and status
   */
  public async getJobStatus(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    const job = JobRepository.findById(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        error: `Job with ID "${jobId}" not found`
      });
      return;
    }

    const progressPercentage = job.total_count > 0
      ? Math.min(100, Math.round((job.processed_count / job.total_count) * 100))
      : 0;

    res.status(200).json({
      job_id: job.id,
      status: job.status,
      progress_percentage: progressPercentage,
      processed_count: job.processed_count,
      total_count: job.total_count,
      failed_count: job.failed_count,
      download_url: job.download_url,
      job_name: job.job_name,
      created_at: job.created_at,
      updated_at: job.updated_at,
      error_message: job.error_message
    });
  }

  /**
   * GET /api/v1/certificates/jobs/:jobId/download
   * Stream completed zip archive
   */
  public async downloadJobZip(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    const job = JobRepository.findById(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        error: `Job with ID "${jobId}" not found`
      });
      return;
    }

    if (job.status !== 'COMPLETED' || !job.zip_path) {
      res.status(400).json({
        success: false,
        error: `Job is not completed yet. Current status: ${job.status}`,
        progress_percentage: job.total_count > 0 ? Math.round((job.processed_count / job.total_count) * 100) : 0,
        status: job.status
      });
      return;
    }

    if (!fs.existsSync(job.zip_path)) {
      res.status(404).json({
        success: false,
        error: 'Generated zip file not found on server storage'
      });
      return;
    }

    const fileName = `${job.job_name.replace(/[^a-zA-Z0-9_-]/g, '_')}_certificates.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const stream = fs.createReadStream(job.zip_path);
    stream.pipe(res);
  }

  /**
   * GET /api/v1/certificates/verify/:certId
   * Public route returning metadata verifying whether the certificate is authentic
   */
  public async verifyCertificate(req: Request, res: Response): Promise<void> {
    const { certId } = req.params;
    const cert = CertificateRepository.findByCertId(certId);

    if (!cert) {
      if (req.accepts('html')) {
        res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Certificate Not Found</title>
            <style>
              body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 40px; border-radius: 12px; border: 1px solid #ef4444; text-align: center; max-width: 450px; }
              h1 { color: #ef4444; margin-bottom: 12px; }
              p { color: #94a3b8; line-height: 1.6; }
              code { background: #334155; padding: 2px 8px; border-radius: 4px; font-family: monospace; color: #f1f5f9; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Certificate Not Found</h1>
              <p>No verified record exists with Certificate ID: <code>${certId}</code></p>
            </div>
          </body>
          </html>
        `);
        return;
      }

      res.status(404).json({
        authentic: false,
        certificate_id: certId,
        error: 'Certificate ID not found or invalid'
      });
      return;
    }

    if (req.accepts('html') && !req.accepts('json')) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Certificate Verified - ${cert.certificate_id}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Inter', system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
            .card { background: #1e293b; padding: 36px; border-radius: 16px; border: 1px solid #10b981; max-width: 520px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
            .badge { display: inline-flex; align-items: center; gap: 8px; background: #064e3b; color: #34d399; font-weight: 700; padding: 6px 16px; border-radius: 9999px; font-size: 13px; text-transform: uppercase; margin-bottom: 20px; }
            h1 { font-size: 24px; color: #ffffff; margin-bottom: 24px; }
            .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #334155; font-size: 14px; }
            .label { color: #94a3b8; font-weight: 500; }
            .value { color: #f1f5f9; font-weight: 600; text-align: right; }
            .actions { margin-top: 24px; text-align: center; }
            .btn { display: inline-block; background: #3b82f6; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">✓ Authentic Credential</div>
            <h1>Verified Certificate Record</h1>
            <div class="row"><span class="label">Certificate ID:</span><span class="value">${cert.certificate_id}</span></div>
            <div class="row"><span class="label">Recipient Name:</span><span class="value">${cert.recipient_name}</span></div>
            <div class="row"><span class="label">Email:</span><span class="value">${cert.recipient_email}</span></div>
            <div class="row"><span class="label">Course / Program:</span><span class="value">${cert.course_title || 'N/A'}</span></div>
            <div class="row"><span class="label">Grade / Distinction:</span><span class="value">${cert.grade || 'N/A'}</span></div>
            <div class="row"><span class="label">Issuing Organization:</span><span class="value">${cert.organization || 'Global Tech Academy'}</span></div>
            <div class="row"><span class="label">Issue Date:</span><span class="value">${cert.issue_date}</span></div>
            <div class="row"><span class="label">Verification Status:</span><span class="value" style="color: #34d399;">VERIFIED & ACTIVE</span></div>
            <div class="actions">
              <a href="/api/v1/certificates/${encodeURIComponent(cert.certificate_id)}/preview" class="btn" target="_blank">View Certificate Document</a>
            </div>
          </div>
        </body>
        </html>
      `);
      return;
    }

    res.status(200).json({
      authentic: true,
      status: cert.status,
      certificate_id: cert.certificate_id,
      job_id: cert.job_id,
      recipient_name: cert.recipient_name,
      recipient_email: cert.recipient_email,
      course_title: cert.course_title,
      grade: cert.grade,
      organization: cert.organization,
      issue_date: cert.issue_date,
      issued_at: cert.created_at,
      document_url: `/api/v1/certificates/${encodeURIComponent(cert.certificate_id)}/preview`
    });
  }

  /**
   * GET /api/v1/certificates/:certId/preview
   * View or download an individual generated certificate
   */
  public async previewCertificate(req: Request, res: Response): Promise<void> {
    const { certId } = req.params;
    const cert = CertificateRepository.findByCertId(certId);

    if (!cert || !cert.file_path || !fs.existsSync(cert.file_path)) {
      res.status(404).json({
        success: false,
        error: `Certificate file for ID "${certId}" not found or still generating`
      });
      return;
    }

    const ext = path.extname(cert.file_path).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'application/pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${cert.file_name || certId + ext}"`);

    const stream = fs.createReadStream(cert.file_path);
    stream.pipe(res);
  }

  /**
   * GET /api/v1/certificates/jobs
   * List recent jobs
   */
  public async listJobs(req: Request, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string || '20', 10);
    const jobs = JobRepository.listRecent(limit);
    res.status(200).json({
      success: true,
      count: jobs.length,
      jobs: jobs.map(j => ({
        ...j,
        progress_percentage: j.total_count > 0 ? Math.round((j.processed_count / j.total_count) * 100) : 0
      }))
    });
  }

  /**
   * GET /api/v1/certificates/jobs/:jobId/certificates
   * List generated certificates for a specific job
   */
  public async listJobCertificates(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    const certificates = CertificateRepository.listByJobId(jobId);
    res.status(200).json({
      success: true,
      job_id: jobId,
      count: certificates.length,
      certificates
    });
  }
}

export const certificateController = new CertificateController();
