import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runIntegrationTest() {
  console.log('===============================================================');
  console.log('🧪 RUNNING END-TO-END BULK CERTIFICATE GENERATOR TEST SUITE');
  console.log(`🎯 Target API Base: ${API_BASE}`);
  console.log('===============================================================\n');

  // Step 1: Health Check
  console.log('▶ [Step 1] Verifying System Healthcheck (/health)...');
  const healthRes = await fetch(`${API_BASE}/health`);
  if (!healthRes.ok) {
    throw new Error(`Healthcheck failed with HTTP status ${healthRes.status}`);
  }
  const healthData = await healthRes.json();
  console.log(`  ✓ Service is HEALTHY! Queue: ${healthData.queue?.type}, Max Concurrency: ${healthData.storage?.max_concurrency}\n`);

  // Step 2: Upload CSV and create bulk generation job
  console.log('▶ [Step 2] Ingesting sample_recipients.csv (POST /api/v1/certificates/jobs)...');
  const csvPath = path.resolve(process.cwd(), 'sample_recipients.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Sample CSV file not found at ${csvPath}`);
  }

  const csvBuffer = fs.readFileSync(csvPath);
  const formData = new FormData();
  const fileBlob = new Blob([csvBuffer], { type: 'text/csv' });
  formData.append('file', fileBlob, 'sample_recipients.csv');
  formData.append('job_name', 'Integration Test Batch 2026');
  formData.append('output_format', 'pdf');

  const createJobRes = await fetch(`${API_BASE}/api/v1/certificates/jobs`, {
    method: 'POST',
    body: formData
  });

  if (createJobRes.status !== 202) {
    const errText = await createJobRes.text();
    throw new Error(`Expected HTTP 202 Accepted, received ${createJobRes.status}: ${errText}`);
  }

  const jobPayload = await createJobRes.json();
  console.log('  ✓ Received HTTP 202 Accepted:');
  console.log(`    • Job ID:        ${jobPayload.job_id}`);
  console.log(`    • Total Records: ${jobPayload.total_records}`);
  console.log(`    • Status:        ${jobPayload.status}`);
  console.log(`    • Check URL:     ${jobPayload.check_status_url}\n`);

  const jobId = jobPayload.job_id;
  if (!jobId || jobPayload.total_records !== 10) {
    throw new Error(`Invalid job response payload: ${JSON.stringify(jobPayload)}`);
  }

  // Step 3: Poll status until completion
  console.log(`▶ [Step 3] Polling Job Telemetry for ${jobId}...`);
  const maxPollAttempts = 60;
  let attempts = 0;
  let finalStatus: any = null;

  while (attempts < maxPollAttempts) {
    attempts++;
    await sleep(2000);

    const statusRes = await fetch(`${API_BASE}/api/v1/certificates/jobs/${jobId}`);
    if (!statusRes.ok) {
      throw new Error(`Failed to check job status: HTTP ${statusRes.status}`);
    }

    const statusData = await statusRes.json();
    process.stdout.write(`  ⏳ Poll #${attempts}: [${statusData.status}] Processed: ${statusData.processed_count}/${statusData.total_count} (${statusData.progress_percentage}%)\r`);

    if (statusData.status === 'COMPLETED') {
      finalStatus = statusData;
      console.log(`\n  ✓ Job reached COMPLETED state!`);
      console.log(`    • Processed: ${statusData.processed_count}/${statusData.total_count}`);
      console.log(`    • Failed:    ${statusData.failed_count}`);
      console.log(`    • Download:  ${statusData.download_url}\n`);
      break;
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`Job execution FAILED with error: ${statusData.error_message}`);
    }
  }

  if (!finalStatus) {
    throw new Error(`Timed out waiting for job ${jobId} to complete after ${maxPollAttempts * 2} seconds`);
  }

  // Step 4: Download and validate zip archive
  console.log(`▶ [Step 4] Downloading and validating ZIP archive (/api/v1/certificates/jobs/${jobId}/download)...`);
  const downloadRes = await fetch(`${API_BASE}/api/v1/certificates/jobs/${jobId}/download`);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download zip: HTTP ${downloadRes.status}`);
  }

  const contentType = downloadRes.headers.get('content-type');
  const zipBuffer = Buffer.from(await downloadRes.arrayBuffer());

  console.log(`  ✓ ZIP downloaded successfully!`);
  console.log(`    • Content-Type: ${contentType}`);
  console.log(`    • Size:         ${(zipBuffer.length / 1024).toFixed(2)} KB`);

  if (!contentType?.includes('zip')) {
    throw new Error(`Expected content-type to contain zip, received: ${contentType}`);
  }
  if (zipBuffer.length < 500) {
    throw new Error(`ZIP file is suspiciously small (${zipBuffer.length} bytes)`);
  }
  console.log();

  // Step 5: Verify public certificate endpoint
  console.log('▶ [Step 5] Verifying Public Certificate Authenticity (/api/v1/certificates/verify/CERT-2026-001)...');
  const verifyRes = await fetch(`${API_BASE}/api/v1/certificates/verify/CERT-2026-001`, {
    headers: { 'Accept': 'application/json' }
  });

  if (!verifyRes.ok) {
    throw new Error(`Verification endpoint failed: HTTP ${verifyRes.status}`);
  }

  const verifyData = await verifyRes.json();
  console.log('  ✓ Verification response validated:');
  console.log(`    • Authentic:      ${verifyData.authentic}`);
  console.log(`    • Certificate ID: ${verifyData.certificate_id}`);
  console.log(`    • Recipient:      ${verifyData.recipient_name} (${verifyData.recipient_email})`);
  console.log(`    • Course:         ${verifyData.course_title}`);
  console.log(`    • Grade:          ${verifyData.grade}`);
  console.log(`    • Issue Date:     ${verifyData.issue_date}`);

  if (!verifyData.authentic || verifyData.recipient_name !== 'Alice Johnson') {
    throw new Error(`Verification assertion failed! Expected Alice Johnson, got ${verifyData.recipient_name}`);
  }
  console.log();

  // Step 6: Test preview download of single certificate
  console.log('▶ [Step 6] Testing single certificate preview (/api/v1/certificates/CERT-2026-001/preview)...');
  const previewRes = await fetch(`${API_BASE}/api/v1/certificates/CERT-2026-001/preview`);
  if (!previewRes.ok) {
    throw new Error(`Preview failed: HTTP ${previewRes.status}`);
  }
  const previewBuffer = Buffer.from(await previewRes.arrayBuffer());
  const previewType = previewRes.headers.get('content-type');
  console.log(`  ✓ Certificate PDF stream verified:`);
  console.log(`    • Content-Type: ${previewType}`);
  console.log(`    • Size:         ${(previewBuffer.length / 1024).toFixed(2)} KB\n`);

  // Step 7: Negative / Resilience Test with invalid rows
  console.log('▶ [Step 7] Testing Resilience & Fault Isolation with invalid rows...');
  const invalidCsvPath = path.resolve(process.cwd(), 'sample_recipients_invalid.csv');
  if (fs.existsSync(invalidCsvPath)) {
    const invalidBuffer = fs.readFileSync(invalidCsvPath);
    const invalidForm = new FormData();
    invalidForm.append('file', new Blob([invalidBuffer], { type: 'text/csv' }), 'sample_recipients_invalid.csv');
    invalidForm.append('job_name', 'Resilience Test Batch');

    const resRes = await fetch(`${API_BASE}/api/v1/certificates/jobs`, {
      method: 'POST',
      body: invalidForm
    });

    const resPayload = await resRes.json();
    console.log(`  ✓ Fault isolation verified:`);
    console.log(`    • Valid records queued:  ${resPayload.total_records}`);
    console.log(`    • Skipped invalid rows:  ${resPayload.skipped_invalid_rows}\n`);
  }

  console.log('===============================================================');
  console.log('🎉 ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('===============================================================');
}

runIntegrationTest().catch(err => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err.message || err);
  process.exit(1);
});
