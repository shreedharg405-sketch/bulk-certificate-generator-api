import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

export class StorageService {
  constructor() {
    this.ensureDirectories();
  }

  public ensureDirectories(): void {
    const dirs = [
      config.storageDir,
      config.certificatesDir,
      config.zipsDir,
      config.uploadsDir
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  public getJobCertificatesDir(jobId: string): string {
    const jobDir = path.join(config.certificatesDir, jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    return jobDir;
  }

  public getZipFilePath(jobId: string): string {
    return path.join(config.zipsDir, `${jobId}.zip`);
  }

  public saveCertificateFile(jobId: string, certId: string, format: 'pdf' | 'png', buffer: Buffer): { filePath: string; fileName: string } {
    const jobDir = this.getJobCertificatesDir(jobId);
    // Sanitize certId for file name
    const sanitizedCertId = certId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${sanitizedCertId}.${format}`;
    const filePath = path.join(jobDir, fileName);

    fs.writeFileSync(filePath, buffer);
    return { filePath, fileName };
  }

  public fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  public deleteFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`Failed to delete file ${filePath}:`, err);
      }
    }
  }
}

export const storageService = new StorageService();
