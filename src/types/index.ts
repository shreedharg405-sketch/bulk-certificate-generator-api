import { z } from 'zod';

export type JobStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export const RecipientSchema = z.object({
  name: z.string().trim().min(1, 'Recipient name is required'),
  email: z.string().trim().email('Invalid email address'),
  issue_date: z.string().trim().min(1, 'Issue date is required'),
  certificate_id: z.string().trim().min(1, 'Certificate ID is required'),
  course_title: z.string().trim().optional(),
  grade: z.string().trim().optional(),
  organization: z.string().trim().optional(),
  metadata: z.record(z.any()).optional()
});

export type RecipientRecord = z.infer<typeof RecipientSchema>;

export interface RawRecipientRow {
  name?: string;
  email?: string;
  issue_date?: string;
  certificate_id?: string;
  course_title?: string;
  grade?: string;
  organization?: string;
  [key: string]: any;
}

export interface ParseResult {
  validRecords: RecipientRecord[];
  invalidRecords: Array<{
    rowNumber: number;
    data: any;
    errors: string[];
  }>;
  totalParsed: number;
}

export interface CertificateJob {
  id: string;
  job_name: string;
  status: JobStatus;
  total_count: number;
  processed_count: number;
  failed_count: number;
  template_html: string;
  output_format: 'pdf' | 'png';
  download_url: string | null;
  zip_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateRecord {
  id: string;
  certificate_id: string;
  job_id: string;
  recipient_name: string;
  recipient_email: string;
  issue_date: string;
  course_title?: string | null;
  grade?: string | null;
  organization?: string | null;
  status: 'SUCCESS' | 'FAILED';
  file_path: string | null;
  file_name: string | null;
  error_message: string | null;
  created_at: string;
}

export interface JobProgressResponse {
  job_id: string;
  status: JobStatus;
  progress_percentage: number;
  processed_count: number;
  total_count: number;
  failed_count: number;
  download_url: string | null;
  job_name?: string;
  created_at?: string;
  updated_at?: string;
  error_message?: string | null;
}

export interface QueueChunkPayload {
  job_id: string;
  chunk_index: number;
  total_chunks: number;
  records: RecipientRecord[];
}

export interface RenderResult {
  success: boolean;
  certificate_id: string;
  file_path?: string;
  file_name?: string;
  error?: string;
}
