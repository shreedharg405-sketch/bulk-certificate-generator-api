import fs from 'fs';
import csv from 'csv-parser';
import * as xlsx from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { ParseResult, RecipientRecord, RecipientSchema } from '../types/index.js';

export class ParserService {
  /**
   * Normalize raw row object keys (e.g., 'Full Name', 'Name', 'EMAIL', 'cert_id')
   */
  private normalizeRowKeys(rawRow: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};

    for (const [key, val] of Object.entries(rawRow)) {
      if (val === undefined || val === null) continue;
      const cleanKey = key.trim().toLowerCase().replace(/[\s_-]+/g, '_');
      const cleanVal = typeof val === 'string' ? val.trim() : String(val);

      if (['name', 'recipient_name', 'full_name', 'student_name', 'candidate_name'].includes(cleanKey)) {
        normalized.name = cleanVal;
      } else if (['email', 'recipient_email', 'mail', 'email_address'].includes(cleanKey)) {
        normalized.email = cleanVal;
      } else if (['issue_date', 'date', 'issued_at', 'awarded_date', 'date_of_issue'].includes(cleanKey)) {
        normalized.issue_date = cleanVal;
      } else if (['certificate_id', 'cert_id', 'id', 'serial_number', 'credential_id'].includes(cleanKey)) {
        normalized.certificate_id = cleanVal;
      } else if (['course', 'course_title', 'program', 'degree', 'training'].includes(cleanKey)) {
        normalized.course_title = cleanVal;
      } else if (['grade', 'score', 'classification', 'marks'].includes(cleanKey)) {
        normalized.grade = cleanVal;
      } else if (['organization', 'org', 'institution', 'issuer', 'company'].includes(cleanKey)) {
        normalized.organization = cleanVal;
      } else {
        normalized[cleanKey] = cleanVal;
      }
    }

    // Default issue_date to today's date if missing
    if (!normalized.issue_date || normalized.issue_date === '') {
      normalized.issue_date = new Date().toISOString().split('T')[0];
    }

    // Auto-generate certificate_id if missing or blank
    if (!normalized.certificate_id || normalized.certificate_id === '') {
      normalized.certificate_id = `CERT-${Date.now().toString(36).toUpperCase()}-${uuidv4().substring(0, 6).toUpperCase()}`;
    }

    return normalized;
  }

  /**
   * Parse CSV stream / file
   */
  public async parseCsvFile(filePath: string): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
      const results: RecipientRecord[] = [];
      const invalidRecords: ParseResult['invalidRecords'] = [];
      let rowNumber = 1;

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (rawRow) => {
          rowNumber++;
          const normalized = this.normalizeRowKeys(rawRow);
          const validation = RecipientSchema.safeParse(normalized);

          if (validation.success) {
            results.push(validation.data);
          } else {
            invalidRecords.push({
              rowNumber,
              data: rawRow,
              errors: validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
            });
          }
        })
        .on('end', () => {
          resolve({
            validRecords: results,
            invalidRecords,
            totalParsed: results.length + invalidRecords.length
          });
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

  /**
   * Parse Excel file (.xlsx, .xls)
   */
  public async parseExcelFile(filePath: string): Promise<ParseResult> {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Excel workbook contains no sheets');
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json<Record<string, any>>(worksheet);

    const validRecords: RecipientRecord[] = [];
    const invalidRecords: ParseResult['invalidRecords'] = [];

    rawRows.forEach((rawRow, idx) => {
      const normalized = this.normalizeRowKeys(rawRow);
      const validation = RecipientSchema.safeParse(normalized);

      if (validation.success) {
        validRecords.push(validation.data);
      } else {
        invalidRecords.push({
          rowNumber: idx + 2, // Excel 1-based header is row 1
          data: rawRow,
          errors: validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        });
      }
    });

    return {
      validRecords,
      invalidRecords,
      totalParsed: validRecords.length + invalidRecords.length
    };
  }

  /**
   * Parse direct JSON array
   */
  public parseJsonArray(items: any[]): ParseResult {
    const validRecords: RecipientRecord[] = [];
    const invalidRecords: ParseResult['invalidRecords'] = [];

    items.forEach((item, idx) => {
      const normalized = this.normalizeRowKeys(item);
      const validation = RecipientSchema.safeParse(normalized);

      if (validation.success) {
        validRecords.push(validation.data);
      } else {
        invalidRecords.push({
          rowNumber: idx + 1,
          data: item,
          errors: validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        });
      }
    });

    return {
      validRecords,
      invalidRecords,
      totalParsed: validRecords.length + invalidRecords.length
    };
  }
}

export const parserService = new ParserService();
