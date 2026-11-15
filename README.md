# CertiFlow — Production Bulk Certificate Generator & Worker System

A high-performance, resilient, asynchronous Bulk Certificate Generator API and Worker system built with **Node.js, TypeScript, Express, BullMQ, Puppeteer, Handlebars, and SQLite**.

Designed to ingest thousands of recipient records via CSV or Excel, decouple generation via chunked queue workers, render print-ready vector PDFs/PNGs with cryptographic authenticity QR codes, and package them into streaming `.zip` archives.

---

## 🌟 Architecture & Highlights

```
 ┌──────────────────────┐       HTTP 202        ┌─────────────────────────┐
 │   HTTP Client / UI   │ ────────────────────> │ Express API Controller  │
 └──────────────────────┘  (Returns Job ID)     └────────────┬────────────┘
            │                                                │
            │ Polls /jobs/:id                                │ Parses CSV/Excel &
            ▼                                                │ Slices into Chunks
 ┌──────────────────────┐                                    ▼
 │ Progress & Telemetry │                       ┌─────────────────────────┐
 └──────────────────────┘                       │ SQLite Job DB & Ledger  │
            │                                   └────────────┬────────────┘
            │                                                │
            │ Download                                       ▼
            ▼                                   ┌─────────────────────────┐
 ┌──────────────────────┐                       │  Queue Broker (BullMQ   │
 │   Completed .ZIP     │                       │     or Local Queue)     │
 └──────────────────────┘                       └────────────┬────────────┘
            ▲                                                │
            │ Packages ZIP                                   ▼
 ┌──────────────────────┐                       ┌─────────────────────────┐
 │ Archiver Stream Svc  │ ◀──────────────────── │ Puppeteer Worker Engine │
 └──────────────────────┘   (When 100% Done)    │ (5 Concurrent Renders)  │
                                                └─────────────────────────┘
```

- **Asynchronous Decoupled Ingestion**: HTTP routes respond with `202 Accepted` and a `job_id` within milliseconds. Heavy PDF rendering is isolated to asynchronous workers.
- **Batch Chunking & Concurrency Controls**: Records are automatically sliced into batches (default: 50 records per chunk) and rendered with configurable concurrency limits (default: 5 concurrent browser tabs) to prevent memory saturation.
- **Dynamic Verifiable QR Codes**: Every certificate embeds an authentic base64-encoded QR code pointing to a verification URL (`/api/v1/certificates/verify/:certId`).
- **Resilience & Fault Isolation**: Individual record validation or rendering errors are recorded in the audit ledger without terminating the batch.
- **Dual Queue Engine Architecture**: Supports **BullMQ with Redis** for production clustering, and **Local Async Queue** for zero-dependency local dev/testing.
- **Interactive Glassmorphic UI**: Includes an embedded dashboard (`http://localhost:3000`) with drag-and-drop file upload, live progress bar, instant ZIP download, and verification lookup portal.

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js (v20+ or v22+)
- Chrome, Chromium, or Microsoft Edge installed on your machine

### 1. Clone & Install
```bash
git clone <repo-url>
cd "Bulk Certificate Generator API"
npm install
```

### 2. Configure Environment
A `.env` file with defaults is provided:
```ini
PORT=3000
HOST=0.0.0.0
APP_URL=http://localhost:3000
QUEUE_DRIVER=auto          # 'auto', 'bullmq', or 'local'
MAX_CONCURRENT_RENDERS=5
CHUNK_SIZE=50
```

### 3. Launch the Server
```bash
# Starts Express API and background worker engine
npm run dev
```

Open your browser at **[http://localhost:3000](http://localhost:3000)** to view the interactive web dashboard!

---

## 🧪 Automated End-to-End Integration Test

Run the full end-to-end integration test suite:
```bash
npm run test:flow
```

The test validates:
1. Healthcheck availability (`/health`)
2. Ingestion of `sample_recipients.csv` (10 rows) via `POST /api/v1/certificates/jobs` returning `202 Accepted`
3. Real-time polling through `QUEUED`, `PROCESSING`, and `COMPLETED`
4. Validation and size verification of the downloaded `.zip` archive
5. Authenticity verification of individual certificate records via `/api/v1/certificates/verify/:certId`
6. Single PDF document preview streaming
7. Fault isolation on invalid records

---

## 🐳 Docker & Production Deployment

Run the complete multi-container production stack with Redis, API, and dedicated BullMQ Worker:

```bash
docker compose up --build -d
```

To scale worker processes:
```bash
docker compose up -d --scale worker=3
```

---

## 📚 API Reference

### 1. Create Bulk Generation Job
`POST /api/v1/certificates/jobs`

**Request (multipart/form-data):**
- `file` (File, required): CSV or Excel file containing recipient records.
- `template` (File or String, optional): Custom Handlebars HTML template.
- `job_name` (String, optional): Cohort or event title.
- `output_format` (String, optional): `'pdf'` (default) or `'png'`.

**Also supports direct JSON (`application/json`):**
```json
{
  "job_name": "Cloud Cohort 2026",
  "recipients": [
    {
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "issue_date": "2026-10-01",
      "certificate_id": "CERT-2026-001",
      "course_title": "Cloud Architecture",
      "grade": "Distinction"
    }
  ]
}
```

**Response (`202 Accepted`):**
```json
{
  "success": true,
  "job_id": "job_a1b2c3d4e5f6",
  "total_records": 250,
  "status": "QUEUED",
  "check_status_url": "/api/v1/certificates/jobs/job_a1b2c3d4e5f6",
  "skipped_invalid_rows": 0
}
```

---

### 2. Check Job Progress
`GET /api/v1/certificates/jobs/:jobId`

**Response (`200 OK`):**
```json
{
  "job_id": "job_a1b2c3d4e5f6",
  "status": "PROCESSING",
  "progress_percentage": 68,
  "processed_count": 170,
  "total_count": 250,
  "failed_count": 2,
  "download_url": null,
  "job_name": "Cloud Cohort 2026"
}
```

---

### 3. Download Certificates ZIP
`GET /api/v1/certificates/jobs/:jobId/download`

Streams the `.zip` archive once `status === "COMPLETED"`.
- Returns `400 Bad Request` if job is still in progress.
- Content-Type: `application/zip`.

---

### 4. Verify Certificate Authenticity
`GET /api/v1/certificates/verify/:certId`

- **Public Endpoint**: Scanned from the printed QR code or searched by Certificate ID.
- If requested by a web browser (`Accept: text/html`), serves a verified credential page.
- If requested by an API client (`Accept: application/json`):
```json
{
  "authentic": true,
  "status": "SUCCESS",
  "certificate_id": "CERT-2026-001",
  "job_id": "job_a1b2c3d4e5f6",
  "recipient_name": "Alice Johnson",
  "recipient_email": "alice@example.com",
  "course_title": "Cloud Architecture",
  "grade": "Distinction",
  "organization": "TechAcademy Global",
  "issue_date": "2026-10-01",
  "document_url": "/api/v1/certificates/CERT-2026-001/preview"
}
```

---

### 5. Preview Certificate Document
`GET /api/v1/certificates/:certId/preview`

Directly streams the rendered single PDF or PNG certificate inline.

---

### 6. List Recent Jobs
`GET /api/v1/certificates/jobs?limit=20`

Returns recent jobs with progress statistics.

---

### 7. Health & Telemetry
`GET /health`

Returns uptime, queue engine metrics, memory usage, and concurrency parameters.

---

## 🎨 Custom Certificate Templates

Certificates are rendered using standard HTML5, CSS3, and Handlebars variables. The following template variables are hydrated:

| Variable | Description |
|---|---|
| `{{name}}` | Recipient full name |
| `{{email}}` | Recipient email address |
| `{{certificate_id}}` | Unique certificate identifier |
| `{{issue_date}}` | Date of issuance (YYYY-MM-DD) |
| `{{qr_code}}` | Base64 Data URI containing verifiable QR code image |
| `{{verification_url}}`| URL pointing to public verification page |
| `{{course_title}}` | Course, degree, or event title |
| `{{grade}}` | Performance grade or distinction |
| `{{organization}}` | Issuing organization or institution |

See `src/templates/default.html` for a responsive luxury gold template example.

---

## 📄 License
MIT License. Built for production-grade certificate generation.
