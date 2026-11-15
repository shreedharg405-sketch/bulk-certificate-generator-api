import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import Handlebars from 'handlebars';
import puppeteer, { Browser } from 'puppeteer';
import { config } from '../config/index.js';
import { storageService } from './storage.service.js';
import { RecipientRecord, RenderResult } from '../types/index.js';

export class CertificateRendererService {
  private browser: Browser | null = null;
  private defaultTemplateContent: string | null = null;
  private isInitializing = false;

  constructor() {
    this.loadDefaultTemplate();
  }

  private loadDefaultTemplate(): void {
    try {
      if (fs.existsSync(config.defaultTemplatePath)) {
        this.defaultTemplateContent = fs.readFileSync(config.defaultTemplatePath, 'utf-8');
      }
    } catch (err) {
      console.warn('Could not load default template at startup:', err);
    }
  }

  public getDefaultTemplate(): string {
    if (!this.defaultTemplateContent) {
      if (fs.existsSync(config.defaultTemplatePath)) {
        this.defaultTemplateContent = fs.readFileSync(config.defaultTemplatePath, 'utf-8');
      } else {
        throw new Error('Default template file not found');
      }
    }
    return this.defaultTemplateContent;
  }

  /**
   * Find available Chrome/Edge executable path if needed
   */
  private findBrowserExecutable(): string | undefined {
    if (config.chromePath && fs.existsSync(config.chromePath)) {
      return config.chromePath;
    }

    const candidatePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return undefined; // Puppeteer will use its downloaded browser
  }

  /**
   * Get or launch singleton Puppeteer browser instance
   */
  public async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    if (this.isInitializing) {
      // wait until initialized
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (this.browser && this.browser.connected) {
        return this.browser;
      }
    }

    this.isInitializing = true;
    try {
      const execPath = this.findBrowserExecutable();
      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
          '--no-first-run'
        ]
      };

      if (execPath) {
        launchOptions.executablePath = execPath;
      }

      this.browser = await puppeteer.launch(launchOptions);
      this.browser.on('disconnected', () => {
        this.browser = null;
      });
      return this.browser;
    } catch (err) {
      // Fallback: try launch without explicit executablePath
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        return this.browser;
      } catch (innerErr) {
        console.error('Failed to launch Puppeteer browser:', innerErr);
        throw innerErr;
      }
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generate QR Code as Base64 Data URI
   */
  public async generateQRCodeDataUri(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 256,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
  }

  /**
   * Hydrate Handlebars HTML template with dynamic data
   */
  public async compileTemplate(
    templateHtml: string,
    recipient: RecipientRecord,
    verificationUrl: string,
    qrCodeDataUri: string
  ): Promise<string> {
    const template = Handlebars.compile(templateHtml);
    const context = {
      ...recipient,
      qr_code: qrCodeDataUri,
      verification_url: verificationUrl
    };
    return template(context);
  }

  /**
   * Render a single certificate to PDF or PNG
   */
  public async renderCertificate(
    jobId: string,
    recipient: RecipientRecord,
    templateHtml: string,
    outputFormat: 'pdf' | 'png' = 'pdf'
  ): Promise<RenderResult> {
    let page: any = null;
    try {
      const verificationUrl = `${config.appUrl}/api/v1/certificates/verify/${encodeURIComponent(recipient.certificate_id)}`;
      const qrCodeDataUri = await this.generateQRCodeDataUri(verificationUrl);
      const htmlContent = await this.compileTemplate(templateHtml, recipient, verificationUrl, qrCodeDataUri);

      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Configure viewport for A4 Landscape (1123 x 794 standard 96dpi or 1200 x 850)
      await page.setViewport({
        width: 1200,
        height: 850,
        deviceScaleFactor: 2
      });

      await page.setContent(htmlContent, {
        waitUntil: ['load', 'networkidle0'],
        timeout: 30000
      });

      let buffer: Buffer;

      if (outputFormat === 'png') {
        const screenshotResult = await page.screenshot({
          type: 'png',
          fullPage: true
        });
        buffer = Buffer.from(screenshotResult);
      } else {
        const pdfResult = await page.pdf({
          format: 'A4',
          landscape: true,
          printBackground: true,
          preferCSSPageSize: true,
          margin: {
            top: '0px',
            right: '0px',
            bottom: '0px',
            left: '0px'
          }
        });
        buffer = Buffer.from(pdfResult);
      }

      const { filePath, fileName } = storageService.saveCertificateFile(
        jobId,
        recipient.certificate_id,
        outputFormat,
        buffer
      );

      return {
        success: true,
        certificate_id: recipient.certificate_id,
        file_path: filePath,
        file_name: fileName
      };
    } catch (err: any) {
      console.error(`[Renderer] Failed to render cert ${recipient.certificate_id}:`, err?.message || err);
      return {
        success: false,
        certificate_id: recipient.certificate_id,
        error: err?.message || String(err)
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {}
      }
    }
  }

  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
  }
}

export const certificateRendererService = new CertificateRendererService();
