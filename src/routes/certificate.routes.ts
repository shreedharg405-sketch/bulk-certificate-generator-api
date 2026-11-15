import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { certificateController } from '../controllers/certificate.controller.js';
import { config } from '../config/index.js';
import { storageService } from '../services/storage.service.js';

const router = Router();

// Ensure upload directory exists
storageService.ensureDirectories();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  }
});

const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'template', maxCount: 1 }
]);

// 1. Ingest job: POST /api/v1/certificates/jobs
router.post('/jobs', uploadFields, (req, res) => {
  certificateController.createJob(req, res);
});

// 2. Job progress: GET /api/v1/certificates/jobs/:jobId
router.get('/jobs/:jobId', (req, res) => {
  certificateController.getJobStatus(req, res);
});

// 3. Download zip: GET /api/v1/certificates/jobs/:jobId/download
router.get('/jobs/:jobId/download', (req, res) => {
  certificateController.downloadJobZip(req, res);
});

// 4. Verify certificate: GET /api/v1/certificates/verify/:certId
router.get('/verify/:certId', (req, res) => {
  certificateController.verifyCertificate(req, res);
});

// 5. Preview single certificate: GET /api/v1/certificates/:certId/preview
router.get('/:certId/preview', (req, res) => {
  certificateController.previewCertificate(req, res);
});

// 6. List recent jobs: GET /api/v1/certificates/jobs
router.get('/jobs', (req, res) => {
  certificateController.listJobs(req, res);
});

// 7. List job certificates: GET /api/v1/certificates/jobs/:jobId/certificates
router.get('/jobs/:jobId/certificates', (req, res) => {
  certificateController.listJobCertificates(req, res);
});

export default router;
