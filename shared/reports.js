
import { jsPDF } from 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm';
import {
  getSupabaseClient,
  addAttachment,
  listDiagnosticWorkflowRuns,
  listDiagnosticRunEvents,
  getJobStatusDurations,
} from './db.js';
import { getConfig } from './config.js';

function addSection(doc, title, lines, y) {
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, y);
  doc.setFont('helvetica', 'normal');
  let cursor = y + 6;
  lines.forEach((line) => {
    doc.text(line, 16, cursor);
    cursor += 5;
  });
   doc.setDrawColor(220);
  doc.line(14, cursor + 1, 196, cursor + 1);
  return cursor + 6;
}

function formatDuration(seconds) {
  if (!seconds) return '0m';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours) return `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
}

function buildReport(doc, job, diagnostics, repairs, parts, durations, typeLabel) {
  doc.setFontSize(16);
  doc.text(`Work Order Report - ${typeLabel}`, 14, 16);
  doc.setFontSize(11);

  let y = 26;
  y = addSection(doc, 'Customer & Field', [
    `Customer: ${job.customers?.name || ''}`,
    `Field: ${job.fields?.name || ''}`,
    `Brand: ${job.fields?.brand || ''}`,
  ], y);

  y = addSection(doc, 'Job Details', [
    `Tech: ${job.users?.full_name || ''}`,
    `Helpers: ${job.helpers || 'None'}`,
    `Truck: ${job.trucks?.truck_identifier || ''}`,
    `Job Type: ${job.job_types?.name || ''}`,
    `Description: ${job.description || ''}`,
  ], y);

  y = addSection(doc, 'Problem & Repair Summary', [
    `Problem: ${job.problem_description || 'N/A'}`,
    `Repair: ${job.repair_description || repairs[repairs.length - 1]?.description || 'N/A'}`,
  ], y);

  y = addSection(doc, 'Diagnostics', diagnostics.length
    ? diagnostics.map((entry) => `${entry.component_checked}: ${entry.check_results}`)
    : ['None recorded'], y);
    
  y = addSection(doc, 'Parts Used', parts.length
    ? parts.map((part) => `${part.products?.name || 'Part'} (x${part.qty})`)
    : ['None'], y);

  y = addSection(doc, 'Time in Status', [
    `Open: ${formatDuration(durations.open)}`,
    `On The Way: ${formatDuration(durations.on_the_way)}`,
    `Diagnostics: ${formatDuration(durations.on_site_diagnostics)}`,
    `Repair: ${formatDuration(durations.on_site_repair)}`,
    `Paused: ${formatDuration(durations.paused)}`,
  ], y);

  addSection(doc, 'Timestamps', [
    `Created: ${new Date(job.created_at).toLocaleString()}`,
    `Finished: ${job.finished_at ? new Date(job.finished_at).toLocaleString() : 'Pending'}`,
  ], y);
}

function buildDiagnosticsReport(doc, job, runs, runEventsMap) {
  doc.setFontSize(16);
  doc.text('Diagnostics Workflow Report', 14, 16);
  doc.setFontSize(11);

  let y = 26;
  y = addSection(doc, 'Job', [
    `Customer: ${job.customers?.name || ''}`,
    `Field: ${job.fields?.name || ''}`,
    `Job Type: ${job.job_types?.name || ''}`,
  ], y);

  const runLines = [];
  runs.forEach((run, index) => {
    runLines.push(`Run ${index + 1}: ${run.workflow_title || 'Workflow'} • ${run.brand_name || 'Brand'}`);
    const events = runEventsMap.get(run.id) || [];
    events.forEach((event) => {
      const label = event.event_type?.replace(/_/g, ' ') || 'event';
      const payload = event.payload ? JSON.stringify(event.payload) : '';
      runLines.push(`  - ${label}${payload ? `: ${payload}` : ''}`);
    });
  });

  y = addSection(doc, 'Workflow Runs', runLines.length ? runLines : ['No diagnostics workflow runs recorded.'], y);
  y = addSection(doc, 'Totals', [
    `Diagnostics: ${formatDuration(job.durations?.on_site_diagnostics)}`,
    `Repair: ${formatDuration(job.durations?.on_site_repair)}`,
  ], y);
  addSection(doc, 'Generated', [
    `Generated: ${new Date().toLocaleString()}`,
  ], y);
}

async function uploadPdf(jobId, fileName, pdfBlob) {
  const client = getSupabaseClient();
  const { orgId } = getConfig();
  const path = `${orgId}/${jobId}/${fileName}`;
  const { error } = await client.storage.from('job_reports').upload(path, pdfBlob, {
    upsert: true,
    contentType: 'application/pdf',
  });
  if (error) {
    console.error('PDF upload error', error);
    throw new Error('Unable to upload report PDF.');
  }
  const { data } = client.storage.from('job_reports').getPublicUrl(path);
  return data.publicUrl;
}

export async function generateAndUploadReports({ job, diagnostics, repairs, parts, durations }) {
  const customerDoc = new jsPDF();
  buildReport(customerDoc, job, diagnostics, repairs, parts, durations, 'Customer');
  const techDoc = new jsPDF();
  buildReport(techDoc, job, diagnostics, repairs, parts, durations, 'Tech');

  const customerBlob = customerDoc.output('blob');
  const techBlob = techDoc.output('blob');

  const customerUrl = await uploadPdf(job.id, 'customer-report.pdf', customerBlob);
  const techUrl = await uploadPdf(job.id, 'tech-report.pdf', techBlob);

  await addAttachment({ job_id: job.id, attachment_type: 'customer_report', file_url: customerUrl });
  await addAttachment({ job_id: job.id, attachment_type: 'tech_report', file_url: techUrl });

  return { customerUrl, techUrl };
}

export async function generateAndUploadDiagnosticsReport(job) {
  const runs = await listDiagnosticWorkflowRuns(job.id);
  const runEventsMap = new Map();
  for (const run of runs) {
    const events = await listDiagnosticRunEvents(run.id);
    runEventsMap.set(run.id, events);
  }

  const durations = await getJobStatusDurations(job.id);
  const jobWithDurations = { ...job, durations };

  const diagnosticsDoc = new jsPDF();
  buildDiagnosticsReport(diagnosticsDoc, jobWithDurations, runs, runEventsMap);
  const diagnosticsBlob = diagnosticsDoc.output('blob');
  const diagnosticsUrl = await uploadPdf(job.id, 'diagnostics-report.pdf', diagnosticsBlob);
  await addAttachment({ job_id: job.id, attachment_type: 'diagnostics_report', file_url: diagnosticsUrl });
  return diagnosticsUrl;
}
