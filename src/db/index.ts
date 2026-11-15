import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/index.js';
import { CertificateJob, CertificateRecord, JobStatus } from '../types/index.js';

let dbInstance: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (!dbInstance) {
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new DatabaseSync(config.dbPath);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA synchronous = NORMAL;');
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      template_html TEXT NOT NULL,
      output_format TEXT NOT NULL DEFAULT 'pdf',
      download_url TEXT,
      zip_path TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      certificate_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      course_title TEXT,
      grade TEXT,
      organization TEXT,
      status TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_certificates_cert_id ON certificates(certificate_id);
    CREATE INDEX IF NOT EXISTS idx_certificates_job_id ON certificates(job_id);
  `);
}

export const JobRepository = {
  create(job: CertificateJob): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO jobs (
        id, job_name, status, total_count, processed_count, failed_count,
        template_html, output_format, download_url, zip_path, error_message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.job_name,
      job.status,
      job.total_count,
      job.processed_count,
      job.failed_count,
      job.template_html,
      job.output_format,
      job.download_url,
      job.zip_path,
      job.error_message,
      job.created_at,
      job.updated_at
    );
  },

  findById(id: string): CertificateJob | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      job_name: row.job_name,
      status: row.status as JobStatus,
      total_count: row.total_count,
      processed_count: row.processed_count,
      failed_count: row.failed_count,
      template_html: row.template_html,
      output_format: row.output_format,
      download_url: row.download_url,
      zip_path: row.zip_path,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  },

  listRecent(limit: number = 20): CertificateJob[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      job_name: row.job_name,
      status: row.status as JobStatus,
      total_count: row.total_count,
      processed_count: row.processed_count,
      failed_count: row.failed_count,
      template_html: row.template_html,
      output_format: row.output_format,
      download_url: row.download_url,
      zip_path: row.zip_path,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  },

  updateStatus(id: string, status: JobStatus, errorMessage?: string | null): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    if (errorMessage !== undefined) {
      const stmt = db.prepare('UPDATE jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?');
      stmt.run(status, errorMessage, now, id);
    } else {
      const stmt = db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?');
      stmt.run(status, now, id);
    }
  },

  incrementProgress(id: string, isSuccess: boolean): CertificateJob | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    if (isSuccess) {
      const stmt = db.prepare(`
        UPDATE jobs
        SET processed_count = processed_count + 1,
            status = CASE WHEN status = 'QUEUED' THEN 'PROCESSING' ELSE status END,
            updated_at = ?
        WHERE id = ?
      `);
      stmt.run(now, id);
    } else {
      const stmt = db.prepare(`
        UPDATE jobs
        SET processed_count = processed_count + 1,
            failed_count = failed_count + 1,
            status = CASE WHEN status = 'QUEUED' THEN 'PROCESSING' ELSE status END,
            updated_at = ?
        WHERE id = ?
      `);
      stmt.run(now, id);
    }
    return this.findById(id);
  },

  markCompleted(id: string, downloadUrl: string, zipPath: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE jobs
      SET status = 'COMPLETED',
          download_url = ?,
          zip_path = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(downloadUrl, zipPath, now, id);
  }
};

export const CertificateRepository = {
  create(cert: CertificateRecord): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO certificates (
        id, certificate_id, job_id, recipient_name, recipient_email,
        issue_date, course_title, grade, organization, status,
        file_path, file_name, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      cert.id,
      cert.certificate_id,
      cert.job_id,
      cert.recipient_name,
      cert.recipient_email,
      cert.issue_date,
      cert.course_title || null,
      cert.grade || null,
      cert.organization || null,
      cert.status,
      cert.file_path,
      cert.file_name,
      cert.error_message,
      cert.created_at
    );
  },

  findByCertId(certId: string): CertificateRecord | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM certificates WHERE certificate_id = ?');
    const row = stmt.get(certId) as any;
    if (!row) return null;
    return {
      id: row.id,
      certificate_id: row.certificate_id,
      job_id: row.job_id,
      recipient_name: row.recipient_name,
      recipient_email: row.recipient_email,
      issue_date: row.issue_date,
      course_title: row.course_title,
      grade: row.grade,
      organization: row.organization,
      status: row.status,
      file_path: row.file_path,
      file_name: row.file_name,
      error_message: row.error_message,
      created_at: row.created_at
    };
  },

  listByJobId(jobId: string): CertificateRecord[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM certificates WHERE job_id = ?');
    const rows = stmt.all(jobId) as any[];
    return rows.map(row => ({
      id: row.id,
      certificate_id: row.certificate_id,
      job_id: row.job_id,
      recipient_name: row.recipient_name,
      recipient_email: row.recipient_email,
      issue_date: row.issue_date,
      course_title: row.course_title,
      grade: row.grade,
      organization: row.organization,
      status: row.status,
      file_path: row.file_path,
      file_name: row.file_name,
      error_message: row.error_message,
      created_at: row.created_at
    }));
  }
};
