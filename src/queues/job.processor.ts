import { v4 as uuidv4 } from 'uuid';
import { QueueChunkPayload, RecipientRecord } from '../types/index.js';
import { JobRepository, CertificateRepository } from '../db/index.js';
import { certificateRendererService } from '../services/renderer.service.js';
import { archiverService } from '../services/archiver.service.js';
import { config } from '../config/index.js';

export async function processQueueChunk(payload: QueueChunkPayload): Promise<{
  processed: number;
  failed: number;
  jobCompleted: boolean;
}> {
  const { job_id, chunk_index, total_chunks, records } = payload;
  console.log(`[Worker] Processing chunk ${chunk_index + 1}/${total_chunks} for job ${job_id} (${records.length} records)...`);

  const job = JobRepository.findById(job_id);
  if (!job) {
    throw new Error(`Job ${job_id} not found in database`);
  }

  // Update job status to PROCESSING if still QUEUED or PENDING
  if (job.status === 'QUEUED' || job.status === 'PENDING') {
    JobRepository.updateStatus(job_id, 'PROCESSING');
  }

  let chunkProcessed = 0;
  let chunkFailed = 0;

  // Process items in the chunk using micro-concurrency
  const concurrency = Math.min(config.maxConcurrency, 5);
  const queue = [...records];
  const templateHtml = job.template_html;
  const outputFormat = job.output_format;

  async function workerLoop(): Promise<void> {
    while (queue.length > 0) {
      const recipient = queue.shift();
      if (!recipient) break;

      try {
        const renderResult = await certificateRendererService.renderCertificate(
          job_id,
          recipient,
          templateHtml,
          outputFormat
        );

        if (renderResult.success && renderResult.file_path && renderResult.file_name) {
          CertificateRepository.create({
            id: uuidv4(),
            certificate_id: recipient.certificate_id,
            job_id,
            recipient_name: recipient.name,
            recipient_email: recipient.email,
            issue_date: recipient.issue_date,
            course_title: recipient.course_title,
            grade: recipient.grade,
            organization: recipient.organization,
            status: 'SUCCESS',
            file_path: renderResult.file_path,
            file_name: renderResult.file_name,
            error_message: null,
            created_at: new Date().toISOString()
          });

          JobRepository.incrementProgress(job_id, true);
          chunkProcessed++;
        } else {
          // Individual failure isolation
          CertificateRepository.create({
            id: uuidv4(),
            certificate_id: recipient.certificate_id,
            job_id,
            recipient_name: recipient.name,
            recipient_email: recipient.email,
            issue_date: recipient.issue_date,
            course_title: recipient.course_title,
            grade: recipient.grade,
            organization: recipient.organization,
            status: 'FAILED',
            file_path: null,
            file_name: null,
            error_message: renderResult.error || 'Failed to render certificate',
            created_at: new Date().toISOString()
          });

          JobRepository.incrementProgress(job_id, false);
          chunkFailed++;
        }
      } catch (err: any) {
        console.error(`[Worker] Error rendering certificate ${recipient.certificate_id}:`, err);
        CertificateRepository.create({
          id: uuidv4(),
          certificate_id: recipient.certificate_id,
          job_id,
          recipient_name: recipient.name,
          recipient_email: recipient.email,
          issue_date: recipient.issue_date,
          course_title: recipient.course_title,
          grade: recipient.grade,
          organization: recipient.organization,
          status: 'FAILED',
          file_path: null,
          file_name: null,
          error_message: err?.message || String(err),
          created_at: new Date().toISOString()
        });

        JobRepository.incrementProgress(job_id, false);
        chunkFailed++;
      }
    }
  }

  // Run concurrency workers
  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workerPromises.push(workerLoop());
  }
  await Promise.all(workerPromises);

  // Check if job is completed across all chunks
  const updatedJob = JobRepository.findById(job_id);
  let jobCompleted = false;

  if (updatedJob && updatedJob.processed_count >= updatedJob.total_count) {
    jobCompleted = true;
    console.log(`[Worker] Job ${job_id} reached 100% (${updatedJob.processed_count}/${updatedJob.total_count}). Finalizing archive...`);

    const certRecords = CertificateRepository.listByJobId(job_id);
    const successfulFiles = certRecords
      .filter(c => c.status === 'SUCCESS' && c.file_path && c.file_name)
      .map(c => ({ filePath: c.file_path!, fileName: c.file_name! }));

    if (successfulFiles.length > 0) {
      try {
        const archiveResult = await archiverService.createJobZip(job_id, successfulFiles);
        const downloadUrl = `/api/v1/certificates/jobs/${job_id}/download`;
        JobRepository.markCompleted(job_id, downloadUrl, archiveResult.zipPath);
        console.log(`[Worker] Job ${job_id} COMPLETED. Archive created: ${archiveResult.zipPath} (${archiveResult.totalFiles} files, ${archiveResult.totalBytes} bytes)`);
      } catch (zipErr: any) {
        console.error(`[Worker] Failed to create zip for job ${job_id}:`, zipErr);
        JobRepository.updateStatus(job_id, 'FAILED', `Failed to create zip package: ${zipErr.message}`);
      }
    } else {
      console.warn(`[Worker] Job ${job_id} had 0 successful renders out of ${updatedJob.total_count}`);
      JobRepository.updateStatus(job_id, 'FAILED', 'All certificate renderings failed');
    }
  }

  return {
    processed: chunkProcessed,
    failed: chunkFailed,
    jobCompleted
  };
}
