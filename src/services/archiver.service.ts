import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { storageService } from './storage.service.js';

export interface ArchiveResult {
  zipPath: string;
  totalFiles: number;
  totalBytes: number;
}

export class ArchiverService {
  /**
   * Create a ZIP archive of all certificates generated for a job
   */
  public async createJobZip(jobId: string, certificateFiles: Array<{ filePath: string; fileName: string }>): Promise<ArchiveResult> {
    const zipPath = storageService.getZipFilePath(jobId);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    return new Promise((resolve, reject) => {
      let totalBytes = 0;

      output.on('close', () => {
        totalBytes = archive.pointer();
        resolve({
          zipPath,
          totalFiles: certificateFiles.length,
          totalBytes
        });
      });

      output.on('error', (err) => {
        reject(err);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      for (const item of certificateFiles) {
        if (fs.existsSync(item.filePath)) {
          archive.file(item.filePath, { name: item.fileName });
        }
      }

      archive.finalize();
    });
  }

  /**
   * Zip an entire directory (useful when archiving the job certificates folder directly)
   */
  public async zipDirectory(sourceDir: string, zipPath: string): Promise<number> {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve(archive.pointer());
      });

      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }
}

export const archiverService = new ArchiverService();
