document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const jobForm = document.getElementById('jobForm');
  const fileInput = document.getElementById('recipientFileInput');
  const fileDropZone = document.getElementById('fileDropZone');
  const fileDropText = document.getElementById('fileDropText');
  const fileSelectedBadge = document.getElementById('fileSelectedBadge');
  const submitJobBtn = document.getElementById('submitJobBtn');
  const submitSpinner = document.getElementById('submitSpinner');
  const submitBtnText = document.getElementById('submitBtnText');
  const customTemplateInput = document.getElementById('customTemplateInput');

  // Monitor elements
  const noJobActiveView = document.getElementById('noJobActiveView');
  const activeJobView = document.getElementById('activeJobView');
  const monitorJobId = document.getElementById('monitorJobId');
  const monitorJobName = document.getElementById('monitorJobName');
  const monitorStatusBadge = document.getElementById('monitorStatusBadge');
  const monitorProgressPercent = document.getElementById('monitorProgressPercent');
  const monitorProgressBar = document.getElementById('monitorProgressBar');
  const monitorTotalCount = document.getElementById('monitorTotalCount');
  const monitorProcessedCount = document.getElementById('monitorProcessedCount');
  const monitorFailedCount = document.getElementById('monitorFailedCount');
  const downloadContainer = document.getElementById('downloadContainer');
  const downloadZipLink = document.getElementById('downloadZipLink');
  const workerEventLog = document.getElementById('workerEventLog');

  // Verification elements
  const verifyCertIdInput = document.getElementById('verifyCertIdInput');
  const verifyBtn = document.getElementById('verifyBtn');
  const verifyResultContainer = document.getElementById('verifyResultContainer');

  // Audit elements
  const refreshJobsBtn = document.getElementById('refreshJobsBtn');
  const recentJobsTableBody = document.getElementById('recentJobsTableBody');
  const engineStatusText = document.getElementById('engineStatusText');

  let activePollingInterval = null;
  let currentActiveJobId = null;

  // File drag & drop setup
  ['dragenter', 'dragover'].forEach(name => {
    fileDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      fileDropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    fileDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      fileDropZone.classList.remove('dragover');
    });
  });

  fileDropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected(fileInput.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  function handleFileSelected(file) {
    fileSelectedBadge.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    fileSelectedBadge.classList.remove('hidden');
    fileDropText.innerHTML = `<strong>${file.name}</strong> selected. Click to change.`;
  }

  // Check health and engine status
  async function checkEngineHealth() {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        const queueType = data.queue?.type || 'Active';
        engineStatusText.textContent = `Queue Worker: ${queueType}`;
      }
    } catch {
      engineStatusText.textContent = 'Queue Worker: Standby';
    }
  }

  // Append log line
  function appendLog(msg, type = 'info') {
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = new Date().toTimeString().split(' ')[0];
    line.textContent = `[${time}] ${msg}`;
    if (type === 'error') line.style.color = '#f43f5e';
    if (type === 'success') line.style.color = '#34d399';
    workerEventLog.appendChild(line);
    workerEventLog.scrollTop = workerEventLog.scrollHeight;
  }

  // Handle Form Submission
  jobForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!fileInput.files || fileInput.files.length === 0) {
      alert('Please select or drop a CSV or Excel file containing recipient records.');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const jobName = document.getElementById('jobNameInput').value.trim();
    if (jobName) formData.append('job_name', jobName);

    const outputFormat = document.querySelector('input[name="output_format"]:checked').value;
    formData.append('output_format', outputFormat);

    const customTemplate = customTemplateInput.value.trim();
    if (customTemplate) {
      formData.append('template', customTemplate);
    }

    // Set UI to loading state
    submitJobBtn.disabled = true;
    submitSpinner.classList.remove('hidden');
    submitBtnText.textContent = 'Ingesting & Enqueueing...';

    try {
      const res = await fetch('/api/v1/certificates/jobs', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch generation job');
      }

      appendLog(`Job ${data.job_id} queued with ${data.total_records} records`, 'success');
      activateMonitoring(data.job_id, jobName || 'Bulk Certificate Job');
      loadRecentJobs();
    } catch (err) {
      alert(`Submission Error: ${err.message}`);
      appendLog(`Submission failed: ${err.message}`, 'error');
    } finally {
      submitJobBtn.disabled = false;
      submitSpinner.classList.add('hidden');
      submitBtnText.textContent = 'Dispatch Batch Generation Job';
    }
  });

  // Activate Monitoring
  function activateMonitoring(jobId, jobName) {
    currentActiveJobId = jobId;
    noJobActiveView.classList.add('hidden');
    activeJobView.classList.remove('hidden');
    downloadContainer.classList.add('hidden');

    monitorJobId.textContent = jobId;
    monitorJobName.textContent = jobName || jobId;

    if (activePollingInterval) {
      clearInterval(activePollingInterval);
    }

    appendLog(`Attached real-time polling to ${jobId}...`);
    pollJobProgress(jobId);
    activePollingInterval = setInterval(() => pollJobProgress(jobId), 1200);
  }

  // Poll Job Progress
  async function pollJobProgress(jobId) {
    try {
      const res = await fetch(`/api/v1/certificates/jobs/${jobId}`);
      if (!res.ok) return;

      const data = await res.json();

      monitorProgressPercent.textContent = `${data.progress_percentage}%`;
      monitorProgressBar.style.width = `${data.progress_percentage}%`;
      monitorTotalCount.textContent = data.total_count;
      monitorProcessedCount.textContent = data.processed_count;
      monitorFailedCount.textContent = data.failed_count;

      // Status badge styling
      monitorStatusBadge.textContent = data.status;
      monitorStatusBadge.className = 'status-badge';
      if (data.status === 'QUEUED') monitorStatusBadge.classList.add('status-queued');
      else if (data.status === 'PROCESSING') monitorStatusBadge.classList.add('status-processing');
      else if (data.status === 'COMPLETED') monitorStatusBadge.classList.add('status-completed');
      else if (data.status === 'FAILED') monitorStatusBadge.classList.add('status-failed');

      if (data.status === 'PROCESSING') {
        appendLog(`Progress: ${data.processed_count}/${data.total_count} certificates generated`);
      }

      if (data.status === 'COMPLETED') {
        clearInterval(activePollingInterval);
        activePollingInterval = null;
        appendLog(`✓ Job ${jobId} finished! All certificates generated and packaged.`, 'success');

        downloadContainer.classList.remove('hidden');
        downloadZipLink.href = `/api/v1/certificates/jobs/${jobId}/download`;
        loadRecentJobs();
      } else if (data.status === 'FAILED') {
        clearInterval(activePollingInterval);
        activePollingInterval = null;
        appendLog(`✖ Job ${jobId} failed: ${data.error_message || 'Rendering error'}`, 'error');
        loadRecentJobs();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }

  // Handle Certificate Verification
  verifyBtn.addEventListener('click', async () => {
    const certId = verifyCertIdInput.value.trim();
    if (!certId) {
      alert('Please enter a certificate ID to verify');
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';

    try {
      const res = await fetch(`/api/v1/certificates/verify/${encodeURIComponent(certId)}`, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();

      verifyResultContainer.classList.remove('hidden');

      if (res.ok && data.authentic) {
        verifyResultContainer.className = 'verify-result verify-success';
        verifyResultContainer.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="font-weight: 700; color: #34d399; font-size: 16px;">✓ VERIFIED AUTHENTIC CREDENTIAL</div>
            <span class="cert-id-code" style="font-family: monospace; background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px;">${data.certificate_id}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
            <div><span class="text-muted">Recipient Name:</span> <strong>${data.recipient_name}</strong></div>
            <div><span class="text-muted">Email:</span> <strong>${data.recipient_email}</strong></div>
            <div><span class="text-muted">Program / Course:</span> <strong>${data.course_title || 'N/A'}</strong></div>
            <div><span class="text-muted">Grade:</span> <strong>${data.grade || 'Passed'}</strong></div>
            <div><span class="text-muted">Organization:</span> <strong>${data.organization || 'Global Tech Academy'}</strong></div>
            <div><span class="text-muted">Issue Date:</span> <strong>${data.issue_date}</strong></div>
          </div>
          <div style="margin-top: 18px; display: flex; gap: 12px;">
            <a href="${data.document_url}" target="_blank" class="btn btn-primary btn-sm">Preview / Download Certificate Document</a>
          </div>
        `;
      } else {
        verifyResultContainer.className = 'verify-result verify-error';
        verifyResultContainer.innerHTML = `
          <div style="color: #f43f5e; font-weight: 700; margin-bottom: 8px;">✖ INVALID OR UNVERIFIED CREDENTIAL</div>
          <p style="color: #cbd5e1; font-size: 13px;">No record was found in the authenticity registry matching Certificate ID <code>${certId}</code>.</p>
        `;
      }
    } catch (err) {
      verifyResultContainer.classList.remove('hidden');
      verifyResultContainer.className = 'verify-result verify-error';
      verifyResultContainer.innerHTML = `<div style="color: #f43f5e;">Verification lookup failed: ${err.message}</div>`;
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify Authenticity';
    }
  });

  // Load Recent Jobs
  async function loadRecentJobs() {
    try {
      const res = await fetch('/api/v1/certificates/jobs');
      if (!res.ok) return;

      const data = await res.json();
      recentJobsTableBody.innerHTML = '';

      if (data.jobs.length === 0) {
        recentJobsTableBody.innerHTML = `
          <tr><td colspan="6" class="text-center text-muted">No jobs submitted yet.</td></tr>
        `;
        return;
      }

      data.jobs.forEach(job => {
        const tr = document.createElement('tr');
        const badgeClass = job.status === 'COMPLETED' ? 'status-completed' : (job.status === 'PROCESSING' ? 'status-processing' : (job.status === 'FAILED' ? 'status-failed' : 'status-queued'));
        const dateStr = new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        tr.innerHTML = `
          <td><code style="color: #38bdf8;">${job.id}</code></td>
          <td><strong>${job.job_name}</strong></td>
          <td><span class="status-badge ${badgeClass}">${job.status}</span></td>
          <td>${job.processed_count}/${job.total_count} (${job.progress_percentage}%)</td>
          <td>${dateStr}</td>
          <td>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-sm btn-outline select-job-btn" data-id="${job.id}" data-name="${job.job_name}">Monitor</button>
              ${job.status === 'COMPLETED' ? `<a href="/api/v1/certificates/jobs/${job.id}/download" class="btn btn-sm btn-success" download>ZIP</a>` : ''}
            </div>
          </td>
        `;

        recentJobsTableBody.appendChild(tr);
      });

      // Attach monitor listeners
      document.querySelectorAll('.select-job-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          activateMonitoring(id, name);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (err) {
      console.error('Failed to load recent jobs:', err);
    }
  }

  refreshJobsBtn.addEventListener('click', loadRecentJobs);

  // Initialize
  checkEngineHealth();
  loadRecentJobs();
});
