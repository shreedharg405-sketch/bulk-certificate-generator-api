# TASK: Build a Production-Grade Bulk Certificate Generator API & Worker System

You are the Lead Senior Backend Architect and Engineer. Build a robust, scalable, asynchronous Bulk Certificate Generator API service from scratch in this workspace.

---

## 1. System Goals & Requirements
- **Asynchronous Decoupled Processing**: Never generate PDFs synchronously inside HTTP request handlers. HTTP routes must return `202 Accepted` immediately with a `job_id`.
- **Bulk Ingestion**: Parse incoming multipart CSV/Excel data or JSON batches containing recipient records (`name`, `email`, `issue_date`, `certificate_id`, etc.).
- **Dynamic Certificate Rendering**: Render customizable certificates (PDF/PNG) based on an HTML/CSS template with dynamic variables and a verifiable QR code pointing to an authenticity URL.
- **Queue & Worker Engine**: Use an asynchronous worker queue (e.g., BullMQ with Redis if Node/TypeScript, or Celery/RQ with Redis if Python) to process records in chunks (50–100 per chunk).
- **Storage & Packaging**: Store completed certificates in local disk storage (or mock S3/minio bucket) and bundle all certificates of a completed job into a single `.zip` file for download.
- **Resilience & Fault Isolation**: Validate input rows before queueing. Single row rendering errors must not fail the entire job; track failed items with clear error logs.

---

## 2. Recommended Tech Stack
(Choose based on workspace environment, default to **Node.js / TypeScript** if uninitialized):
- **Runtime & Framework**: Node.js (v20+) + TypeScript + Express or Fastify
- **Task Queue**: BullMQ + Redis (`ioredis`)
- **Rendering**: Puppeteer (or PDFKit / Canvas) + Handlebars for template hydration
- **Utility Libraries**: `multer` (file upload), `csv-parser` or `xlsx` (sheet parsing), `qrcode` (QR code generation), `archiver` (ZIP packaging), `zod` (validation)
- **Database/Persistence**: SQLite / PostgreSQL (Prisma or Drizzle ORM) or in-memory state store for tracking job states and recipient records

*(If Python workspace exists: use FastAPI + Celery/Redis + WeasyPrint/ReportLab + Pydantic + SQLite/SQLAlchemy)*.

---

## 3. Core API Endpoints to Implement

1. `POST /api/v1/certificates/jobs`
   - Accepts multipart/form-data:
     - `file`: CSV or Excel file containing recipient records
     - `template`: HTML file or template string with placeholders (e.g., `{{name}}`, `{{issue_date}}`, `{{qr_code}}`)
     - `job_name` (optional string)
   - Performs schema validation via Zod/Pydantic.
   - Saves job to DB with status `PENDING`, pushes chunks to queue.
   - Returns HTTP 202:
     ```json
     {
       "success": true,
       "job_id": "job_12345",
       "total_records": 250,
       "status": "QUEUED",
       "check_status_url": "/api/v1/certificates/jobs/job_12345"
     }
     ```

2. `GET /api/v1/certificates/jobs/:jobId`
   - Returns real-time progress:
     ```json
     {
       "job_id": "job_12345",
       "status": "PROCESSING",
       "progress_percentage": 68,
       "processed_count": 170,
       "total_count": 250,
       "failed_count": 2,
       "download_url": null
     }
     ```

3. `GET /api/v1/certificates/jobs/:jobId/download`
   - Returns 400/404 if incomplete.
   - Returns the streamed `.zip` archive containing all generated certificates if `status === "COMPLETED"`.

4. `GET /api/v1/certificates/verify/:certId`
   - Public route returning metadata verifying whether the certificate is authentic.

---

## 4. Execution Plan & Agent Deliverables

Please execute following these exact steps:
1. **Scaffold Directory Structure**:
   - `src/controllers/`
   - `src/routes/`
   - `src/services/` (parsing, rendering, archiving, storage)
   - `src/queues/` (queue connection, producers, worker processors)
   - `src/templates/` (sample responsive certificate HTML/CSS template)
   - `src/types/` (TypeScript interfaces or Pydantic schemas)
2. **Implement Core Engine**:
   - Build CSV parser with missing-field validation.
   - Build certificate renderer with dynamic QR code generation embedded as base64 data URI.
   - Configure queue worker with concurrency controls (e.g., 5 concurrent renders).
   - Implement ZIP archiver stream.
3. **Add Sample Data & Scripts**:
   - Provide a sample `sample_recipients.csv` (10 rows).
   - Provide a default, beautiful HTML/CSS certificate template in `src/templates/default.html`.
4. **Testing & Verification**:
   - Create an automated end-to-end integration test or script (`test_flow.ts` / `test_flow.py`) that uploads the sample CSV, waits for worker completion, checks status, and validates the output zip file.
   - Create a clean `README.md` with setup instructions, Docker / Redis commands, and API documentation.
