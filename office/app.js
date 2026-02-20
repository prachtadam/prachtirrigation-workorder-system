import {
  getBootData,
  listJobs,
  createJob,
  listActiveJobEvents,
  getJobStatusDurations,
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  listFields,
  createField,
  updateField,
  deleteField,
  listTrucks,
  createTruck,
  updateTruck,
  deleteTruck,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listJobTypes,
  createJobType,
  updateJobType,
  deleteJobType,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listTools,
  createTool,
  updateTool,
  deleteTool,
  listTruckTools,
  addTruckTool,
  updateTruckTool,
  deleteTruckTool,
  listTruckInventory,
  upsertTruckInventory,
  updateTruckInventory,
  deleteTruckInventory,
  listAllRequests,
  listOutOfStock,
  deleteOutOfStock,
  listReceipts,
  updateReceipt,
  deleteReceipt,
  updateRequest,
  deleteRequest,
  markJobInvoiced,
  cancelJob,
  updateJob,
  addAttachment,
  listDiagnosticWorkflows,
  createDiagnosticWorkflow,
  updateDiagnosticWorkflow,
  deleteDiagnosticWorkflow,
  listDiagnosticWorkflowBrands,
  createDiagnosticWorkflowBrand,
  updateDiagnosticWorkflowBrand,
  deleteDiagnosticWorkflowBrand,
  listDiagnosticNodes,
  createDiagnosticNode,
  updateDiagnosticNode,
  deleteDiagnosticNode,
  listDiagnosticEdges,
  createDiagnosticEdge,
  updateDiagnosticEdge,
  deleteDiagnosticEdge,
  listDiagnosticNodeLayouts,
  upsertDiagnosticNodeLayout,
  uploadDiagnosticWorkflowAttachment,
  getSupabaseClient,
  listJobParts,
} from '../shared/db.js';
import { getConfig, saveConfig } from '../shared/config.js';
import { JOB_STATUSES } from '../shared/types.js';

const viewTitle = document.getElementById('view-title');
const viewSubtitle = document.getElementById('view-subtitle');
const viewContainer = document.getElementById('view-container');
const viewActions = document.getElementById('view-actions');
const toast = document.getElementById('toast');

const STORAGE_KEYS = {
  timeStatus: 'time_status_events',
  inventoryEvents: 'inventory_event_reports',
  inventoryResolved: 'inventory_resolved_reports',
};

const state = {
  boot: null,
  currentView: 'job-board',
  jobDateFilter: '',
  customerId: null,
  fieldId: null,
  truckId: null,
  diagnosticsBuilder: {
    workflowId: null,
    brandId: null,
    nodeId: null,
  },
  createJobMode: 'job',
};
function isInquiryJob(job) {
  const typeName = job?.job_types?.name || '';
  return typeName.trim().toLowerCase() === 'inquiry';
}

function extractInquiryDecision(notes) {
  if (!notes) return '';
  const lines = `${notes}`.split('\n').map((line) => line.trim()).filter(Boolean);
  const match = [...lines].reverse().find((line) => line.toLowerCase().startsWith('inquiry accepted') || line.toLowerCase().startsWith('inquiry rejected'));
  return match || '';
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function setActiveNav(viewId) {
  document.querySelectorAll('.nav .pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
}

function formatDuration(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours) return `${hours}h ${remainder}m`;
  return `${remainder}m`;
}
function formatAgeDaysHours(dateValue) {
  const createdAt = new Date(dateValue);
  if (!dateValue || Number.isNaN(createdAt.getTime())) return '--:--';
  const diffMs = Math.max(0, Date.now() - createdAt.getTime());
  const totalHours = Math.floor(diffMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
 return `${days}D ${hours}H`;
}
function statusLabel(status) {
  return status.replace(/_/g, ' ').toUpperCase();
}

function exportCsv(items, filePrefix, fields) {
  if (!items.length) {
    showToast('No data to export.');
    return;
  }
  const headers = fields.map((field) => field.key);
  const rows = items.map((item) => headers.map((key) => JSON.stringify(item[key] ?? '')).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filePrefix || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportCsvTemplate(filePrefix, fields) {
  const headers = fields.map((field) => field.key).join(',');
  const csv = `${headers}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filePrefix || 'template'}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseCsvText(text) {
  if (!text) return null;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!window.Papa) {
    showToast('Import failed: CSV parser not available.');
    return null;
  }
   // The previous hand-rolled parser dropped literal quote characters by treating them as
  // CSV delimiters. Papa Parse preserves exact cell text, including quotes and commas.
  const result = window.Papa.parse(normalized, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  if (result.errors?.length) {
    console.warn('CSV parse warnings', result.errors);
  }
const rows = result.data || [];
  const nonEmptyRows = rows.filter((row) => row.some((cell) => `${cell ?? ''}` !== ''));
   if (!nonEmptyRows.length) return null;
  const [headerRow, ...dataRows] = nonEmptyRows;
  const headers = headerRow.map((header) => `${header ?? ''}`);
  const parsedRows = dataRows.map((row) => row.map((value) => `${value ?? ''}`));
  console.info('Import parse preview', {headers, rows: parsedRows.slice(0, 10) });
  return { headers, rows: parsedRows };
}

async function parseFile(file) {
  const extension = file?.name?.split('.').pop()?.toLowerCase();
  if (!extension) return null;

  if (extension === 'csv') {
    const text = await file.text();
    return parseCsvText(text);
  }

  if (extension === 'xlsx' || extension === 'xls') {
    if (!window.XLSX) {
      showToast('Import failed: Excel parser not available.');
      return null;
    }
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: 'array', raw: true });
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) return null;
    const sheet = workbook.Sheets[sheetName];
   const sheetRows = window.XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      raw: true,
      defval: '',
    });
    const [headerRow, ...rows] = sheetRows.filter((row) =>
      Array.isArray(row) && row.some((cell) => `${cell ?? ''}` !==''),
    );
    if (!headerRow) return null;
    const headers = headerRow.map((cell) => `${cell ?? ''}`);
    const parsedRows = rows.map((row) => row.map((value) => `${value ?? ''}`));
    console.info('Import parse preview', { headers, rows: parsedRows.slice(0, 10) });
    return { headers, rows: parsedRows };
  }

  showToast('Unsupported file type. Please upload a CSV or Excel file.');
  return null;
}

function validateRow(row, index, headers = []) {
  if (!Array.isArray(row)) {
    return { ok: false, cleanedRow: [], error: `Row ${index} is not a list.` };
  }
  const cleaned = row.map((value) => `${value ?? ''}`.replace(/\r/g, ''));
  if (!cleaned.some((value) => value)) {
    return { ok: false, cleanedRow: cleaned, error: 'Empty row.' };
  }
  if (headers.length && cleaned.length < headers.length) {
    const padding = Array(headers.length - cleaned.length).fill('');
    return { ok: true, cleanedRow: [...cleaned, ...padding], error: null };
  }
  if (headers.length && cleaned.length > headers.length) {
    return { ok: true, cleanedRow: cleaned.slice(0, headers.length), error: null };
  }
  return { ok: true, cleanedRow: cleaned, error: null };
}

function getMemoryUsageMb() {
  const memory = window?.performance?.memory?.usedJSHeapSize;
  if (!memory) return null;
  return Math.round((memory / (1024 * 1024)) * 10) / 10;
}

function ensureImportStatus(anchor, message = '') {
  const container = anchor?.parentElement || viewActions;
  let status = container.querySelector('.import-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'import-status muted';
    container.appendChild(status);
  }
  if (message) status.textContent = message;
  return status;
}

function downloadErrorReport(failedRows, format = 'json') {
  if (!failedRows.length) return;
  let blob;
  if (format === 'csv') {
    const headers = ['lineNumber', 'reason', 'values'];
    const csvLines = [
      headers.join(','),
      ...failedRows.map((row) => [
        row.lineNumber,
        JSON.stringify(row.reason || ''),
        JSON.stringify((row.values || []).join(' | ')),
      ].join(',')),
    ];
    blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
  } else {
    blob = new Blob([JSON.stringify(failedRows, null, 2)], { type: 'application/json' });
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `import-errors-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function recordFailedImportLine(failedRows, lineNumber, values, reason) {
  failedRows.push({
    lineNumber,
    values: Array.isArray(values) ? [...values] : [],
    reason: reason || null,
  });
}

function getHeaderIndex(headers, key) {
  const target = key?.toLowerCase();
  if (!target) return -1;
  return headers.findIndex((header) => `${header}`.toLowerCase() === target);
}

async function showImportPreview(headers, rows) {
  const nameIndex = getHeaderIndex(headers, 'name');
  const previewRows = rows.slice(0, 10);
  const body = document.createElement('div');
  body.className = 'modal-body section-stack';

  const note = document.createElement('div');
  note.className = 'muted';
  note.textContent = 'Import preview (first 10 rows). Confirm the name field matches the file exactly.';
  body.appendChild(note);

  const list = document.createElement('ul');
  list.className = 'section-stack';
  previewRows.forEach((row, index) => {
    const item = document.createElement('li');
    const value = nameIndex >= 0 ? row[nameIndex] : row[0];
    item.textContent = `Row ${index + 1}: ${value ?? ''}`;
    list.appendChild(item);
  });
  body.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'form-grid';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'pill tiny secondary';
  cancelBtn.textContent = 'Cancel Import';
  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'pill tiny';
  continueBtn.textContent = 'Continue Import';
  actions.append(cancelBtn, continueBtn);
  body.appendChild(actions);

  return new Promise((resolve) => {
    const { close } = openModalSimple({
      title: 'Import Preview',
      bodyEl: body,
      onClose: () => resolve(false),
    });
    cancelBtn.addEventListener('click', () => {
      close();
      resolve(false);
    });
    continueBtn.addEventListener('click', () => {
      close();
      resolve(true);
    });
  });
}

async function importRows(rows, options = {}) {
  const {
    headers = [],
    batchSize = 100,
    batchDelayMs = 50,
    startLineNumber = 2,
    transformRow,
    insertBatch,
    statusEl,
    summaryTitle = 'Import report',
  } = options;
  const summary = {
    title: summaryTitle,
    totalRows: rows.length,
    inserted: 0,
    skipped: 0,
    failedRows: [],
  };
  let lastSuccessfulLine = null;

  const updateStatus = () => {
    if (!statusEl) return;
    statusEl.textContent = `Imported ${summary.inserted} / ${summary.totalRows}`;
  };

  const insertWithSplit = async (payloads, meta) => {
    if (!payloads.length) return;
    try {
      console.info('Import insert payloads', {
        count: payloads.length,
        sample: payloads.slice(0, 10),
      });
      await insertBatch(payloads);
      summary.inserted += payloads.length;
      lastSuccessfulLine = meta[meta.length - 1]?.lineNumber ?? lastSuccessfulLine;
      updateStatus();
    } catch (error) {
      if (payloads.length === 1) {
        recordFailedImportLine(
          summary.failedRows,
          meta[0]?.lineNumber ?? startLineNumber,
          meta[0]?.values ?? [],
          error?.message || 'Insert failed',
        );
        console.warn('Import row failed insert', {
          lineNumber: meta[0]?.lineNumber ?? startLineNumber,
          reason: error?.message || 'Insert failed',
        });
        summary.skipped += 1;
        updateStatus();
        return;
      }
      const mid = Math.floor(payloads.length / 2);
      await insertWithSplit(payloads.slice(0, mid), meta.slice(0, mid));
      await insertWithSplit(payloads.slice(mid), meta.slice(mid));
    }
  };

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batchStart = performance.now();
    const batchRows = rows.slice(offset, offset + batchSize);
    const payloads = [];
    const meta = [];
    for (let idx = 0; idx < batchRows.length; idx += 1) {
      const lineNumber = startLineNumber + offset + idx;
      const validation = validateRow(batchRows[idx], lineNumber, headers);
      if (!validation.ok) {
        recordFailedImportLine(summary.failedRows, lineNumber, validation.cleanedRow, validation.error);
        console.warn('Import row skipped', { lineNumber, reason: validation.error });
        summary.skipped += 1;
        continue;
      }
      try {
        const result = await transformRow(validation.cleanedRow, lineNumber);
        if (!result?.ok) {
          recordFailedImportLine(summary.failedRows, lineNumber, validation.cleanedRow, result?.error || 'Invalid row');
          console.warn('Import row skipped', { lineNumber, reason: result?.error || 'Invalid row' });
          summary.skipped += 1;
          continue;
        }
        payloads.push(result.payload);
        meta.push({ lineNumber, values: validation.cleanedRow });
      } catch (error) {
        recordFailedImportLine(
          summary.failedRows,
          lineNumber,
          validation.cleanedRow,
          error?.message || 'Row processing failed',
        );
        console.warn('Import row skipped', { lineNumber, reason: error?.message || 'Row processing failed' });
        summary.skipped += 1;
      }
    }

    const memoryMb = getMemoryUsageMb();
    console.info('Import batch starting', {
      batchStart: offset + 1,
      batchSize: batchRows.length,
      memoryMb,
      lastSuccessfulLine,
    });

    await insertWithSplit(payloads, meta);

    const batchEnd = performance.now();
    console.info('Import batch complete', {
      batchStart: offset + 1,
      batchSize: batchRows.length,
      durationMs: Math.round(batchEnd - batchStart),
      lastSuccessfulLine,
    });
    if (batchDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    } else {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  updateStatus();
  return summary;
}

function showImportReport({ title, totalRows, inserted, skipped, failedRows }) {
  const body = document.createElement('div');
  body.className = 'modal-body section-stack';

  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'section-stack';
   const totalLine = document.createElement('div');
  totalLine.textContent = `Total rows read: ${totalRows}`;
  const successLine = document.createElement('div');
   successLine.textContent = `Total inserted: ${inserted}`;
  const failedLine = document.createElement('div');
  failedLine.textContent = `Total skipped: ${skipped}`;
  summaryPanel.append(totalLine, successLine, failedLine);

  const failedPanel = document.createElement('div');
  failedPanel.className = 'section-stack';
  if (!failedRows.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No failed lines.';
    failedPanel.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'section-stack';
    failedRows.forEach((row) => {
      const item = document.createElement('li');
     const lineParts = [`Line ${row.lineNumber}: ${row.values.map((value) => `${value}`).join(' | ')}`];
      if (row.reason) lineParts.push(`Reason: ${row.reason}`);
      item.textContent = lineParts.join(' — ');
      list.appendChild(item);
    });
    failedPanel.appendChild(list);
  }

  const tabRow = document.createElement('div');
  tabRow.className = 'modal-foot';
  const summaryBtn = document.createElement('button');
  summaryBtn.type = 'button';
  summaryBtn.className = 'pill tiny';
  summaryBtn.textContent = 'Summary';
  const failedBtn = document.createElement('button');
  failedBtn.type = 'button';
  failedBtn.className = 'pill tiny secondary';
  failedBtn.textContent = `Failed lines (${failedRows.length})`;
  failedBtn.disabled = failedRows.length === 0;
  tabRow.append(summaryBtn, failedBtn);

  const downloadRow = document.createElement('div');
  downloadRow.className = 'form-grid';
  if (failedRows.length) {
    const downloadJson = document.createElement('button');
    downloadJson.type = 'button';
    downloadJson.className = 'pill tiny';
    downloadJson.textContent = 'Download errors (JSON)';
    downloadJson.addEventListener('click', () => downloadErrorReport(failedRows, 'json'));
    const downloadCsv = document.createElement('button');
    downloadCsv.type = 'button';
    downloadCsv.className = 'pill tiny secondary';
    downloadCsv.textContent = 'Download errors (CSV)';
    downloadCsv.addEventListener('click', () => downloadErrorReport(failedRows, 'csv'));
    downloadRow.append(downloadJson, downloadCsv);
  }

  function showPanel(panel) {
    summaryPanel.hidden = panel !== summaryPanel;
    failedPanel.hidden = panel !== failedPanel;
    summaryBtn.classList.toggle('secondary', panel !== summaryPanel);
    failedBtn.classList.toggle('secondary', panel !== failedPanel);
  }

  summaryBtn.addEventListener('click', () => showPanel(summaryPanel));
  failedBtn.addEventListener('click', () => showPanel(failedPanel));

  body.append(tabRow, downloadRow, summaryPanel, failedPanel);
  openModalSimple({ title: title || 'Import report', bodyEl: body });
  showPanel(summaryPanel);
}

async function simulateImport() {
  const headers = ['name', 'sku'];
  const lines = ['name,sku'];
  for (let i = 1; i <= 2000; i += 1) {
    if (i % 333 === 0) {
      lines.push(`"Bad Row ${i}",`);
    } else if (i % 555 === 0) {
      lines.push(`"FAIL Row ${i}","sku-${i}"`);
    } else {
      lines.push(`"Part ${i}","sku-${i}"`);
    }
  }
  const parsed = parseCsvText(lines.join('\n'));
  if (!parsed) return null;
  const { rows } = parsed;
  const summary = await importRows(rows, {
    headers,
    batchSize: 100,
    summaryTitle: 'Simulated import report',
    transformRow: async (cleanedRow) => {
      if (!cleanedRow[0] || cleanedRow[0].startsWith('Bad Row')) {
        return { ok: false, error: 'Simulated malformed row.' };
      }
      return { ok: true, payload: { name: cleanedRow[0], sku: cleanedRow[1] } };
    },
    insertBatch: async (payloads) => {
      if (payloads.some((payload) => payload.name?.includes('FAIL'))) {
        throw new Error('Simulated batch failure');
      }
    },
  });
  console.info('Simulated import summary', summary);
  return summary;
}

window.simulateImport = simulateImport;

async function handleImportCsv(event, fields, createHandler) {
  const file = event.target.files?.[0];
  if (!file) return;
  const statusEl = ensureImportStatus(event.target, 'Preparing import…');
  const parsed = await parseFile(file);
  if (!parsed) return;
  const { headers, rows } = parsed;
  if (!headers.length) {
    showToast('Import file is empty.');
    return;
  }
 const shouldContinue = await showImportPreview(headers, rows);
  if (!shouldContinue) {
    event.target.value = '';
    return;
  }
  const fieldKeys = new Set(fields.map((field) => field.key));
  const tableMap = new Map([
    [createCustomer, 'customers'],
    [createField, 'fields'],
    [createTruck, 'trucks'],
    [createUser, 'users'],
    [createJobType, 'job_types'],
    [createProduct, 'products'],
    [createTool, 'tools'],
  ]);
  const tableName = tableMap.get(createHandler);
  const client = getSupabaseClient();
  const { orgId } = getConfig();

  const insertBatch = async (payloads) => {
    if (!payloads.length) return;
    if (!tableName) {
      for (const payload of payloads) {
        await createHandler(payload);
      }
    return;
    }
 if (!orgId) throw new Error('ORG_ID missing. Please set ORG_ID in localStorage or window.SUPABASE_ORG_ID.');
    const payloadWithOrg = payloads.map((payload) => ({ ...payload, org_id: orgId }));
    const { error } = await client.from(tableName).insert(payloadWithOrg);
    if (error) throw new Error(`Create ${tableName}: ${error.message || 'Import failed'}`);
  };

  const summary = await importRows(rows, {
    headers,
    batchSize: 100,
    summaryTitle: 'Import report',
    statusEl,
    transformRow: async (cleanedRow) => {
      const payload = {};
      headers.forEach((header, index) => {
        if (fieldKeys.has(header)) {
          payload[header] = cleanedRow[index] ?? '';
        }
      });
      const hasValue = Object.values(payload).some((value) => `${value}` !== '');
      if (!hasValue) {
        return { ok: false, error: 'Empty row.' };
      }
      return { ok: true, payload };
    },
    insertBatch,
  });

  showImportReport({
    title: summary.title,
    totalRows: summary.totalRows,
    inserted: summary.inserted,
    skipped: summary.skipped,
    failedRows: summary.failedRows,
  });

   const nameIndex = getHeaderIndex(headers, 'name');
  if (tableName && nameIndex >= 0 && orgId) {
    const previewNames = rows
      .slice(0, 10)
      .map((row) => row[nameIndex])
      .filter((value) => `${value ?? ''}` !== '');
    if (previewNames.length) {
      const { data, error } = await client
        .from(tableName)
        .select('name')
        .eq('org_id', orgId)
        .in('name', previewNames);
      if (error) {
        console.warn('Import readback failed', error);
      } else {
        console.info('Import readback preview', data);
      }
    }
  }
  event.target.value = '';
  await setView(state.currentView);
}

async function handleInventoryImportCsv(event, truck, inventoryItems) {
  const file = event.target.files?.[0];
  if (!file) return;
  const truckId = getId(truck);
  if (!truckId) return;
   const statusEl = ensureImportStatus(event.target, 'Preparing inventory import…');
  const parsed = await parseFile(file);
  if (!parsed) return;
  const { headers, rows } = parsed;
  if (!headers.length) {
    showToast('Import file is empty.');
    return;
  }
  const shouldContinue = await showImportPreview(headers, rows);
  if (!shouldContinue) {
    event.target.value = '';
    return;
  }
  const productBySku = new Map();
  const productByName = new Map();
  (state.boot?.products || []).forEach((product) => {
    if (product.sku) productBySku.set(product.sku.toLowerCase(), product);
    if (product.name) productByName.set(product.name.toLowerCase(), product);
  });
  const inventoryMap = new Map(inventoryItems.map((item) => [item.product_id, item]));

   const client = getSupabaseClient();
  const { orgId } = getConfig();
  const insertBatch = async (payloads) => {
    if (!payloads.length) return;
    if (!orgId) throw new Error('ORG_ID missing. Please set ORG_ID in localStorage or window.SUPABASE_ORG_ID.');
    const payloadWithOrg = payloads.map((payload) => ({ ...payload, org_id: orgId }));
    const { error } = await client
      .from('truck_inventory')
      .upsert(payloadWithOrg, { onConflict: 'truck_id,product_id' });
    if (error) throw new Error(`Update truck inventory: ${error.message || 'Import failed'}`);
  };

  const summary = await importRows(rows, {
    headers,
    batchSize: 100,
    summaryTitle: 'Inventory import report',
    statusEl,
    transformRow: async (cleanedRow, lineNumber) => {
      const payload = {};
      headers.forEach((header, index) => {
        payload[header] = cleanedRow[index] ?? '';
      });
     const hasValue = Object.values(payload).some((value) => `${value}` !== '');
      if (!hasValue) {
        return { ok: false, error: 'Empty row.' };
      }
    const sku = payload.sku ?? '';
      const name = payload.name ?? '';
      const minRaw = payload.min_qty ?? payload.minimum_qty ?? payload.min;
      const parsedMin = Number(minRaw);
      let product = sku ? productBySku.get(sku.toLowerCase()) : null;
      if (!product && name) product = productByName.get(name.toLowerCase());
      if (!product) {
        if (!name) {
          showToast('Missing part name for an import row.');
          return { ok: false, error: 'Missing part name.' };
        }
        const shouldAdd = confirm(`Part "${name}" was not found. Add it to the parts table?`);
        if (!shouldAdd) {
          return { ok: false, error: 'Skipped by user' };
        }
        try {
          product = await createProduct({ name, sku });
          if (state.boot?.products) state.boot.products.push(product);
          productByName.set(product.name.toLowerCase(), product);
          if (product.sku) productBySku.set(product.sku.toLowerCase(), product);
        } catch (error) {
          showToast(`Unable to add part: ${error.message}`);
          return { ok: false, error: error?.message || 'Unable to add part' };
        }
      }
  const existing = inventoryMap.get(product.id);
      const min_qty = Number.isNaN(parsedMin) ? (existing?.min_qty ?? 0) : parsedMin;
      const qty = existing?.qty ?? 0;
      return {
        ok: true,
        payload: {
          truck_id: truckId,
          product_id: product.id,
          qty,
          min_qty,
          origin: 'permanent',
        },
      };
    },
    insertBatch,
  });

  showImportReport({
    title: summary.title,
    totalRows: summary.totalRows,
    inserted: summary.inserted,
    skipped: summary.skipped,
    failedRows: summary.failedRows,
  });
  event.target.value = '';
  await renderTruckListView(truck, 'inventory');
}

async function refreshBoot() {
  state.boot = await getBootData();
}

async function renderJobBoard() {
  viewTitle.textContent = 'Job Board';
  viewSubtitle.textContent = 'Filter by status and review job cards.';
  viewActions.innerHTML = '';

 

  await renderJobBoardList('open');
}

async function renderJobBoardList(filterId) {
  viewActions.querySelectorAll('.date-filter').forEach((node) => node.remove());
  if (filterId === 'finished' || filterId === 'invoiced') {
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'date-filter';
    dateInput.value = state.jobDateFilter;
    dateInput.addEventListener('change', () => {
      state.jobDateFilter = dateInput.value;
      renderJobBoardList(filterId);
    });
    viewActions.appendChild(dateInput);
  }
  const listWrapper = document.createElement('div');
  listWrapper.className = 'section-stack';

  const mapPanel = document.createElement('div');
  mapPanel.className = 'map-preview';
  mapPanel.innerHTML = `
    <div class="map-head">
      <div>
        <div class="map-title">Map Preview</div>
        <div class="muted small">Satellite view for job locations</div>
      </div>
      <div class="map-legend">
        <span><span class="legend-dot legend-open"></span>Open</span>
        <span><span class="legend-dot legend-progress"></span>In Progress</span>
        <span><span class="legend-dot legend-paused"></span>Paused</span>
      </div>
    </div>
    <div class="map-frame">
      <div class="map-canvas" role="img" aria-label="Job map preview"></div>
      <div class="map-overlay">Loading map preview…</div>
    </div>
  `;

  const listPanel = document.createElement('div');
  listPanel.className = 'card list';
 

  const createButton = document.createElement('button');
  createButton.className = 'pill';
  createButton.textContent = '+ Create Job';
  createButton.addEventListener('click', () => {
   state.createJobMode = 'job';
    openCreateJobModal();
  });
  listPanel.appendChild(createButton);

const createInquiryButton = document.createElement('button');
  createInquiryButton.className = 'pill secondary';
  createInquiryButton.textContent = '+ Create Inquiry';
  createInquiryButton.addEventListener('click', () => {
    state.createJobMode = 'inquiry';
    openCreateJobModal();
  });
  listPanel.appendChild(createInquiryButton);

  const filterMap = {
    open: { statuses: [JOB_STATUSES.PAUSED, JOB_STATUSES.OPEN] },
    in_progress: { statuses: [JOB_STATUSES.ON_SITE_REPAIR, JOB_STATUSES.ON_SITE_DIAGNOSTICS, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.PAUSED] },
    paused: { statuses: [JOB_STATUSES.PAUSED] },
    finished: { statuses: [JOB_STATUSES.FINISHED] },
    invoiced: { statuses: [JOB_STATUSES.INVOICED] },
    closed: { statuses: [JOB_STATUSES.INVOICED, JOB_STATUSES.CANCELED] },
     inquiries: { statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.ON_SITE_DIAGNOSTICS, JOB_STATUSES.ON_SITE_REPAIR, JOB_STATUSES.PAUSED, JOB_STATUSES.FINISHED] },
  };

  const filter = { ...filterMap[filterId] };
  if (state.jobDateFilter && filterId === 'finished') {
    filter.finishedAfter = new Date(state.jobDateFilter).toISOString();
  }
  if (state.jobDateFilter && filterId === 'invoiced') {
    filter.invoicedAfter = new Date(state.jobDateFilter).toISOString();
  }
   const mapStatuses = [
    JOB_STATUSES.OPEN,
    JOB_STATUSES.PAUSED,
    JOB_STATUSES.ON_THE_WAY,
    JOB_STATUSES.ON_SITE_DIAGNOSTICS,
    JOB_STATUSES.ON_SITE_REPAIR,
  ];
  const [jobs, mapJobs] = await Promise.all([
    listJobs(filter),
    listJobs({ statuses: mapStatuses }),
  ]);
  const activeEvents = await listActiveJobEvents(jobs.map((job) => job.id));

  const visibleJobs = filterId === 'inquiries'
    ? jobs.filter((job) => isInquiryJob(job))
    : jobs.filter((job) => !isInquiryJob(job));

  const sortedJobs = visibleJobs.slice().sort((a, b) => {
    if (filterId === 'open') {
      if (a.status === JOB_STATUSES.PAUSED && b.status !== JOB_STATUSES.PAUSED) return -1;
      if (a.status !== JOB_STATUSES.PAUSED && b.status === JOB_STATUSES.PAUSED) return 1;
    }
    if (filterId === 'invoiced') {
      return new Date(b.invoiced_at || 0) - new Date(a.invoiced_at || 0);
    }
    const getEventStart = (job) => {
      const event = activeEvents.find((evt) => evt.job_id === job.id);
      return event ? new Date(event.started_at) : new Date(job.created_at);
    };
    return getEventStart(a) - getEventStart(b);
  });

  sortedJobs.forEach((job) => {
    const btn = document.createElement('button');
    btn.className = 'pill job-pill';
    const descriptionText = job.description?.trim() || 'No description';
    const ageStamp = formatAgeDaysHours(job.created_at);
    btn.innerHTML = `
       <div class="job-pill-row job-pill-top">
        <div class="job-pill-title">
           <strong class="job-pill-customer">${escapeHtml(job.customers?.name || 'Customer')}</strong>
          <span class="job-pill-sep">-</span>
          <span class="job-pill-field">${escapeHtml(job.fields?.name || 'Field')}</span>
        </div>
        <div class="job-pill-duration">${ageStamp}</div>
        <div class="job-pill-status">
          <span class="badge status-pill" data-status="${job.status}">${statusLabel(job.status)}</span>
        </div>
        
      </div>
       <div class="job-pill-row job-pill-sub">
        <span class="job-pill-type">${escapeHtml(job.job_types?.name || 'Job')}</span>
        ${isInquiryJob(job) ? '<span class="badge">Inquiry</span>' : ''}
        <span class="job-pill-sep">-</span>
        <span class="job-pill-description" title="${escapeHtml(descriptionText)}">${escapeHtml(descriptionText)}</span>
        
      </div>
    `;
    btn.addEventListener('click', () => openJobDetailModal(job, filterId));
    listPanel.appendChild(btn);
  });

  if (!sortedJobs.length) {
    listPanel.innerHTML += '<p>No jobs found for this filter.</p>';
  }

  listWrapper.appendChild(mapPanel);
  listWrapper.appendChild(listPanel);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(listWrapper);
   await renderJobMap(mapPanel, mapJobs, filterId);
}

const mapState = {
 map: null,
 markersLayer: null,
};



function mapStatusColor(status = '') {
  const normalized = status.toLowerCase();
  if (normalized.includes('paused')) return '#f97316';
  if (normalized.includes('on_the_way') || normalized.includes('on_site') || normalized.includes('progress')) return '#3b82f6';
  if (normalized.includes('open')) return '#22c55e';
  return '#94a3b8';
}

function getJobCoords(job) {
  const lat = Number.parseFloat(job.fields?.lat);
  const lon = Number.parseFloat(job.fields?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lng: lon };
}

function buildLeafletMarkerIcon(color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44" fill="none">
      <path d="M17 1C9.28 1 3 7.28 3 15c0 9.5 14 27.5 14 27.5S31 24.5 31 15C31 7.28 24.72 1 17 1Z" fill="${color}" stroke="#0f172a" stroke-width="1.2"/>
      <circle cx="17" cy="15" r="6.4" fill="rgba(15,23,42,0.18)"/>
      <path d="M17 10.1l1.2.4 1.1-.8 1.5 1.5-.8 1.1.4 1.2 1.2.4v2.1l-1.2.4-.4 1.2.8 1.1-1.5 1.5-1.1-.8-1.2.4-.4 1.2h-2.1l-.4-1.2-1.2-.4-1.1.8-1.5-1.5.8-1.1-.4-1.2-1.2-.4v-2.1l1.2-.4.4-1.2-.8-1.1 1.5-1.5 1.1.8 1.2-.4.4-1.2h2.1Z" fill="#0f172a"/>
      <circle cx="17" cy="15" r="2.6" fill="#e2e8f0"/>
    </svg>
  `;
  return window.L.divIcon({
    className: 'job-pin',
    html: svg,
    iconSize: [34, 44],
    iconAnchor: [17, 44],
    popupAnchor: [0, -40],
  })
}


async function renderJobMap(mapPanel, jobs, filterId) {
  const mapCanvas = mapPanel.querySelector('.map-canvas');
  const mapOverlay = mapPanel.querySelector('.map-overlay');
  if (!mapCanvas || !mapOverlay) return;

  const coordsJobs = jobs
    .filter((job) => ![JOB_STATUSES.FINISHED, JOB_STATUSES.INVOICED, JOB_STATUSES.CANCELED].includes(job.status))
    .map((job) => ({ job, coords: getJobCoords(job) }))
    .filter(({ coords }) => coords);

  
  if (!coordsJobs.length) {
    mapOverlay.textContent = 'No active jobs with field coordinates to display.';
    return;
  }
    if (!window.L){
    mapOverlay.textContent = 'Map preview required Leaflet to load.';
    return;
  }

  mapOverlay.hidden = true;

  if (mapState.map) {
    mapState.map.remove();
    mapState.map = null;
  }
  const map = window.L.map(mapCanvas, {
      zoomControl: true,
      attributionControl: true,
  });
      mapState.map = map;

      window.L.tileLayer(
         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles @ Esri',
          maxZoom: 19,
        },
      ).addTo(map);

      const bounds = window.L.latLngBounds(coordsJobs.map(({ coords }) => coords));
      map.fitBounds(bounds.pad(0.2));
      

const markersLayer = window.L.layerGroup().addTo(map);
  mapState.markersLayer = markersLayer;
     coordsJobs.forEach(({ job, coords }) => {
        const marker = window.L.marker(coords, {
          title: job.customers?.name || 'Job',
           icon: buildLeafletMarkerIcon(mapStatusColor(job.status)),
    });

    marker.addTo(markersLayer);

    const content = document.createElement('div');
    content.className = 'map-info';
    content.innerHTML = `
      <div class="map-info-title">${escapeHtml(job.customers?.name || 'Customer')}</div>
      <div class="map-info-sub">${escapeHtml(job.fields?.name || 'Field')}</div>
      <div class="map-info-sub">${escapeHtml(job.job_types?.name || 'Job Type')}</div>
    `;
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'map-open-job';
    openBtn.textContent = 'Open Job';
    openBtn.addEventListener('click', (event) => {
      event.preventDefault();
      map.closePopup();
      openJobDetailModal(job, filterId);
    });
     content.appendChild(openBtn);
    marker.bindPopup(content, { closeButton: true, autoPan: true });
  });
}

async function openJobDetailModal(job, filterId, options = {}) {
  const durations = await getJobStatusDurations(job.id);
  const techAssigned = job.status === JOB_STATUSES.OPEN ? '' : (job.users?.full_name || '');
  const truckAssigned = job.status === JOB_STATUSES.OPEN ? '' : (job.trucks?.truck_identifier || job.trucks?.name || '');
  const description = job.description || '';
  const officeNotes = job.office_notes || '';
   const { onRefresh } = options;
  const refreshAfterUpdate = async () => {
    if (typeof onRefresh === 'function') {
      await onRefresh();
      return;
    }
    if (filterId) {
      await renderJobBoardList(filterId);
    }
  };
  const reportsMarkup = job.attachments?.length
    ? job.attachments
      .map((att) => `<a href="${att.file_url}" target="_blank">${escapeHtml(att.attachment_type)}</a>`)
      .join('<br/>')
    : '<p>No reports yet.</p>';

     const nonInquiryTypes = (state.boot?.jobTypes || []).filter((type) => `${type?.name || ''}`.trim().toLowerCase() !== 'inquiry');
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Job details">
      <div class="modal-head">
        <div class="modal-title">${escapeHtml(job.customers?.name || 'Job Details')}</div>
        <button class="pill tiny" type="button" data-close>Close</button>
      </div>
      <div class="modal-body section-stack">
        <div class="section-stack">
          <h3>${escapeHtml(job.customers?.name || '')} - ${escapeHtml(job.fields?.name || '')}</h3>
          <p><strong>Status:</strong> <span class="badge status-pill" data-status="${job.status}">${statusLabel(job.status)}</span></p>
          <p><strong>Tech Assigned:</strong> ${escapeHtml(techAssigned)}</p>
          <p><strong>Truck ID:</strong> ${escapeHtml(truckAssigned)}</p>
          <p><strong>Age:</strong> ${formatDuration((Date.now() - new Date(job.created_at)) / 1000)}</p>
          <p><strong>Job Type:</strong> ${escapeHtml(job.job_types?.name || '')}</p>
          <p><strong>Description:</strong> ${escapeHtml(description)}</p>
           ${isInquiryJob(job) ? `<p><strong>Inquiry Status:</strong> ${job.status === JOB_STATUSES.ON_THE_WAY ? 'On the way' : (job.status === JOB_STATUSES.ON_SITE_DIAGNOSTICS || job.status === JOB_STATUSES.ON_SITE_REPAIR || job.status === JOB_STATUSES.FINISHED ? 'Arrived' : 'Open')}</p><p><strong>On the way at:</strong> ${job.on_the_way_at ? new Date(job.on_the_way_at).toLocaleString() : '--'}</p><p><strong>Arrived at:</strong> ${job.arrived_at ? new Date(job.arrived_at).toLocaleString() : '--'}</p>` : ''}
        </div>
        <div>
          <h4>Time in Status</h4>
          <ul>
            <li>Open: ${formatDuration(durations.open)}</li>
            <li>On The Way: ${formatDuration(durations.on_the_way)}</li>
            <li>Diagnostics: ${formatDuration(durations.on_site_diagnostics)}</li>
            <li>Repair: ${formatDuration(durations.on_site_repair)}</li>
            <li>Paused: ${formatDuration(durations.paused)}</li>
          </ul>
        </div>
        <div>
          <h4>Reports</h4>
          ${reportsMarkup}
        </div>
          <div id="inquiry-details"></div>
       <div class="section-stack">
          <label for="job-office-notes">Office Notes</label>
          <textarea id="job-office-notes" placeholder="Add office notes...">${escapeHtml(officeNotes)}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="pill secondary" type="button" data-cancel>Close</button>
        <button class="action" type="button" data-save-notes>Save Notes</button>
        ${isInquiryJob(job) ? '<button class="action" type="button" data-action="accept-inquiry">Accept Inquiry</button><button class="action danger" type="button" data-action="reject-inquiry">Reject Inquiry</button>' : ''}
        ${job.status !== JOB_STATUSES.INVOICED && job.status !== JOB_STATUSES.CANCELED ? '<button class="action" data-action="invoice">Mark Invoiced</button>' : ''}
        ${job.status !== JOB_STATUSES.CANCELED ? '<button class="action danger" data-action="cancel">Cancel Job</button>' : ''}
      </div>
    </div>
    <button class="modal-scrim" aria-label="Close"></button>
  `;
  document.body.appendChild(modal);

      const close = () => { modal.remove(); };
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.querySelector('[data-cancel]').addEventListener('click', close);
  modal.querySelector('.modal-scrim').addEventListener('click', close);


if (isInquiryJob(job)) {
    const inquiryNode = modal.querySelector('#inquiry-details');
    if (inquiryNode) {
      const parts = await listJobParts(job.id);
      const photos = (job.attachments || []).filter((att) => (att.attachment_type || '').startsWith('inquiry_photo'));
      const drawing = (job.attachments || []).find((att) => att.attachment_type === 'inquiry_drawing');
      inquiryNode.innerHTML = `
        <h4>Inquiry Capture</h4>
        <p><strong>Decision:</strong> ${escapeHtml(extractInquiryDecision(job.office_notes || '') || 'Pending')}</p>
        <p><strong>Parts:</strong> ${parts.length ? parts.map((part) => `${escapeHtml(part.products?.name || 'Part')} (x${part.qty})`).join(', ') : 'None yet'}</p>
        <p><strong>Photos:</strong></p>
        <div class="list">${photos.length ? photos.map((photo) => `<a class="pill" href="${photo.file_url}" target="_blank" rel="noreferrer">Open photo</a>`).join('') : '<span class="muted">No photos uploaded.</span>'}</div>
        <p><strong>Drawing:</strong> ${drawing ? `<a href="${drawing.file_url}" target="_blank" rel="noreferrer">Open drawing</a>` : 'No drawing uploaded.'}</p>
      `;
    }
  }

  const notesButton = modal.querySelector('[data-save-notes]');
  const notesInput = modal.querySelector('#job-office-notes');
  notesButton.addEventListener('click', async () => {
    try {
      await updateJob(job.id, { office_notes: notesInput.value.trim() });
      showToast('Office notes saved.');
    } catch (error) {
      showToast(error.message);
    }
  });

  const acceptInquiryBtn = modal.querySelector('[data-action="accept-inquiry"]');
  if (acceptInquiryBtn) {
    acceptInquiryBtn.addEventListener('click', async () => {
      if (!nonInquiryTypes.length) {
        showToast('Create at least one non-inquiry job type before accepting.');
        return;
      }
      const options = nonInquiryTypes.map((type) => `${type.id}:${type.name}`).join('\n');
      const selectedType = prompt(`Enter the job type id to convert this inquiry into a job:\n${options}`, nonInquiryTypes[0].id);
      if (!selectedType) return;
      const jobType = nonInquiryTypes.find((type) => type.id === selectedType.trim());
      if (!jobType) {
        showToast('Invalid job type selected.');
        return;
      }
      try {
        const existingNotes = notesInput.value.trim();
        const decisionNote = `Inquiry accepted at ${new Date().toISOString()} as ${jobType.name}.`;
        const office_notes = [existingNotes, decisionNote].filter(Boolean).join('\n');
        await updateJob(job.id, {
          job_type_id: jobType.id,
          status: JOB_STATUSES.OPEN,
          office_notes,
        });
        showToast('Inquiry accepted and converted to job.');
        close();
        await refreshAfterUpdate();
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  const rejectInquiryBtn = modal.querySelector('[data-action="reject-inquiry"]');
  if (rejectInquiryBtn) {
    rejectInquiryBtn.addEventListener('click', async () => {
      const reason = prompt('Reason for rejecting this inquiry:');
      if (!reason?.trim()) return;
      try {
        const existingNotes = notesInput.value.trim();
        const decisionNote = `Inquiry rejected at ${new Date().toISOString()}: ${reason.trim()}`;
        const office_notes = [existingNotes, decisionNote].filter(Boolean).join('\n');
        await updateJob(job.id, {
          office_notes,
          status: JOB_STATUSES.CANCELED,
        });
        showToast('Inquiry rejected.');
        close();
        await refreshAfterUpdate();
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  const invoiceBtn = modal.querySelector('[data-action="invoice"]');
  if (invoiceBtn) {
    invoiceBtn.addEventListener('click', async () => {
      try {
        await markJobInvoiced(job.id);
        showToast('Job marked invoiced.');
        close();
        await refreshAfterUpdate();
      } catch (error) {
        showToast(error.message);
      }
     });
  }
  const cancelBtn = modal.querySelector('[data-action="cancel"]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      const reason = prompt('Enter cancel reason');
      if (!reason) return;
      try {
        await cancelJob(job.id, reason);
        showToast('Job canceled.');
        close();
        await refreshAfterUpdate();

      } catch (error) {
        showToast(error.message);
      }
    });
    
  }

  
}
function buildDatalistOptions(listNode, items = [], key = 'name') {
  listNode.innerHTML = items
    .map((item) => `<option value="${item[key]}"></option>`)
    .join('');
}

function getItemByName(items, name) {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return null;
  return items.find((item) => item.name?.toLowerCase() === normalized) || null;
}

async function uploadJobAttachment(jobId, file) {
  if (!file) return null;
  const client = getSupabaseClient();
  const { orgId } = getConfig();
  const sanitizedName = file.name.replace(/\s+/g, '_');
  const path = `${orgId}/${jobId}/attachments/${Date.now()}-${sanitizedName}`;
  const { error } = await client.storage.from('job_reports').upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) {
    console.error('Attachment upload error', error);
    throw new Error('Unable to upload attachment.');
  }
  const { data } = client.storage.from('job_reports').getPublicUrl(path);
  return data.publicUrl;
}

async function openCreateJobModal() {
  const modal = document.getElementById('create-job-modal');
  const form = document.getElementById('create-job-form');
  const customerInput = form?.querySelector('input[name="customer_name"]');
  const customerIdInput = form?.querySelector('input[name="customer_id"]');
  const fieldInput = form?.querySelector('input[name="field_name"]');
  const fieldIdInput = form?.querySelector('input[name="field_id"]');
  const customerList = document.getElementById('customer-options');
  const fieldList = document.getElementById('field-options');
  const jobTypeSelect = form?.querySelector('select[name="job_type_id"]');
   const modalTitle = modal?.querySelector('.modal-title');

  if (!modal || !form || !customerInput || !fieldInput || !jobTypeSelect || !customerList || !fieldList) return;
  if (!state.boot) await refreshBoot();

  form.reset();
  customerIdInput.value = '';
  fieldIdInput.value = '';
  fieldInput.value = '';
  fieldInput.disabled = true;

  buildDatalistOptions(customerList, state.boot.customers);
  jobTypeSelect.innerHTML = state.boot.jobTypes
    .map((jobType) => `<option value="${jobType.id}">${jobType.name}</option>`)
    .join('');
if (modalTitle) modalTitle.textContent = state.createJobMode === 'inquiry' ? 'Create Inquiry' : 'Create Job';
  if (state.createJobMode === 'inquiry') {
    const inquiryType = state.boot.jobTypes.find((type) => `${type.name || ''}`.trim().toLowerCase() === 'inquiry');
    if (inquiryType) jobTypeSelect.value = inquiryType.id;
  }

  const updateFieldOptions = () => {
    const selectedCustomer = getItemByName(state.boot.customers, customerInput.value);
    if (!selectedCustomer) {
      fieldInput.disabled = true;
      fieldInput.value = '';
      fieldIdInput.value = '';
      fieldList.innerHTML = '';
      return;
    }
    customerIdInput.value = selectedCustomer.id;
    fieldInput.value = '';
    fieldIdInput.value = '';
    const fields = state.boot.fields.filter((field) => field.customer_id === selectedCustomer.id);
    buildDatalistOptions(fieldList, fields);
    fieldInput.disabled = fields.length === 0;
    fieldInput.placeholder = fields.length ? 'Select field' : 'No fields for customer';
  };

  const syncFieldId = () => {
    const selectedCustomer = getItemByName(state.boot.customers, customerInput.value);
    if (!selectedCustomer) {
      fieldIdInput.value = '';
      return;
    }
    const fields = state.boot.fields.filter((field) => field.customer_id === selectedCustomer.id);
    const selectedField = getItemByName(fields, fieldInput.value);
    fieldIdInput.value = selectedField?.id || '';
  };

  customerInput.oninput = updateFieldOptions;
  customerInput.onchange = updateFieldOptions;
  fieldInput.oninput = syncFieldId;
  fieldInput.onchange = syncFieldId;

  modal.hidden = false;
}

async function closeCreateJobModal({ returnHome = false } = {}) {
  const modal = document.getElementById('create-job-modal');
  if (modal) {
    const form = modal.querySelector('form');
    if (form) form.reset();
    modal.hidden = true;
  }
  if (returnHome) {
    await setView('job-board');
  }
}

async function renderListView({
  title,
  subtitle,
  listLoader,
  createHandler,
  updateHandler,
  deleteHandler,
  fields,
  enableImportExport,
  filePrefix,
}) {
  viewTitle.textContent = title;
  viewSubtitle.textContent = subtitle;
  viewActions.innerHTML = '';

  const items = await listLoader();

  if (enableImportExport) {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'pill';
    exportBtn.textContent = 'Export CSV';
    exportBtn.addEventListener('click', () => exportCsv(items, filePrefix, fields));
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.csv,.xlsx,.xls';
    importInput.addEventListener('change', (event) => handleImportCsv(event, fields, createHandler));
    viewActions.appendChild(exportBtn);
    viewActions.appendChild(importInput);
  }

  const layout = document.createElement('div');
  layout.className = 'grid-two';

  const listPanel = document.createElement('div');
  listPanel.className = 'card list';
  const detailPanel = document.createElement('div');
  detailPanel.className = 'card';

  function renderDetail(item) {
    detailPanel.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'section-stack';
    const formGrid = document.createElement('div');
    formGrid.className = 'form-grid';

    fields.forEach((field) => {
      const wrapper = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = field.label;
      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
      } else if (field.type === 'select') {
        input = document.createElement('select');
        const options = typeof field.options === 'function' ? field.options() : field.options || [];
        options.forEach((option) => {
          const opt = document.createElement('option');
          opt.value = option.value;
          opt.textContent = option.label;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement('input');
        if (field.type === 'number') input.type = 'number';
      }
      input.name = field.key;
      input.value = item?.[field.key] || '';
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      formGrid.appendChild(wrapper);
    });

    form.appendChild(formGrid);

    const actions = document.createElement('div');
    actions.className = 'form-grid';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'action';
    saveBtn.type = 'submit';
    saveBtn.textContent = item ? 'Save Changes' : 'Create';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action danger';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.disabled = !item;

    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {};
      fields.forEach((field) => {
        payload[field.key] = form.elements[field.key].value.trim();
      });
      try {
        if (item) {
          const itemId = getId(item);
          if (!itemId) throw new Error('Missing Supabase ID for update.');
          await updateHandler(itemId, payload);
          showToast('Updated successfully.');
        } else {
          await createHandler(payload);
          showToast('Created successfully.');
        }
        await renderListView({ title, subtitle, listLoader, createHandler, updateHandler, deleteHandler, fields });
      } catch (error) {
        showToast(error.message);
      }
    });

    deleteBtn.addEventListener('click', async () => {
      if (!item) return;
      if (!confirm('Delete this item? This cannot be undone.')) return;
      try {
        const itemId = getId(item);
        if (!itemId) throw new Error('Missing Supabase ID for delete.');
        await deleteHandler(itemId);
        showToast('Deleted.');
        await renderListView({ title, subtitle, listLoader, createHandler, updateHandler, deleteHandler, fields });
      } catch (error) {
        showToast(error.message);
      }
    });

    detailPanel.appendChild(form);
  }

  const newButton = document.createElement('button');
  newButton.className = 'pill';
  newButton.textContent = '+ New';
  newButton.addEventListener('click', () => renderDetail(null));
  listPanel.appendChild(newButton);

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.innerHTML = `
      <div>
        <strong>${item[fields[0].key] || 'Item'}</strong>
        <div class="muted">${fields[1] ? item[fields[1].key] || '' : ''}</div>
      </div>
    `;
    btn.addEventListener('click', () => renderDetail(item));
    listPanel.appendChild(btn);
  });

  if (!items.length) {
    listPanel.innerHTML += '<p>No items yet.</p>';
  }

  renderDetail(null);
  layout.appendChild(listPanel);
  layout.appendChild(detailPanel);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(layout);
}
async function renderUsersView() {
  viewTitle.textContent = 'Users';
  viewSubtitle.textContent = 'Manage tech and helper users.';
  viewActions.innerHTML = '';

  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.type = 'button';
  addBtn.textContent = 'Add User';
  viewActions.appendChild(addBtn);

  const users = await listUsers();

  const listCard = document.createElement('div');
  listCard.className = 'card list';

  const roleOptions = [
    { value: 'admin', label: 'Admin' },
    { value: 'helper', label: 'Helper' },
    { value: 'tech', label: 'Tech' },
  ];

  const openUserModal = ({ user } = {}) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(user ? 'Edit User' : 'Add User')}">
        <div class="modal-head">
          <div class="modal-title">${user ? 'Edit User' : 'Add User'}</div>
          <div class="modal-actions">
            ${user ? '<button class="pill tiny danger" type="button" data-delete>Delete</button>' : ''}
            <button class="pill tiny" type="button" data-close>Close</button>
          </div>
        </div>
        <div class="modal-body">
          <form class="form-grid" id="user-form"></form>
        </div>
        <div class="modal-foot">
          <button class="secondary" type="button" data-cancel>Cancel</button>
          <button class="action" type="button" data-save>Save</button>
        </div>
      </div>
      <button class="modal-scrim" aria-label="Close"></button>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.remove();
    };

    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.querySelector('.modal-scrim').addEventListener('click', close);

    const form = modal.querySelector('#user-form');
    const fields = [
      { key: 'full_name', label: 'Name' },
      { key: 'role', label: 'Role', type: 'select' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
    ];

    const inputs = {};
    fields.forEach((field) => {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = field.label;
      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        roleOptions.forEach((option) => {
          const opt = document.createElement('option');
          opt.value = option.value;
          opt.textContent = option.label;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement('input');
      }
      input.name = field.key;
      input.value = user?.[field.key] || '';
      inputs[field.key] = input;
      wrap.append(label, input);
      form.appendChild(wrap);
    });

    modal.querySelector('[data-cancel]').addEventListener('click', () => {
      form.reset();
      close();
    });

    modal.querySelector('[data-save]').addEventListener('click', async () => {
      const payload = {};
      fields.forEach((field) => {
        payload[field.key] = inputs[field.key].value.trim();
      });
      if (!payload.full_name) {
        showToast('Name is required.');
        return;
      }
      try {
        if (user) {
          const userId = getId(user);
          if (!userId) throw new Error('Missing Supabase ID for update.');
          await updateUser(userId, payload);
          showToast('User updated.');
        } else {
          await createUser(payload);
          showToast('User added.');
        }
        await refreshBoot();
        close();
        await renderUsersView();
      } catch (error) {
        showToast(error.message);
      }
    });

    const deleteBtn = modal.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!user) return;
        if (!confirm('Delete this user? This cannot be undone.')) return;
        try {
          const userId = getId(user);
          if (!userId) throw new Error('Missing Supabase ID for delete.');
          await deleteUser(userId);
          showToast('User deleted.');
          await refreshBoot();
          close();
          await renderUsersView();
        } catch (error) {
          showToast(error.message);
        }
      });
    }
  };

  addBtn.addEventListener('click', () => openUserModal());

  users.forEach((user) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.type = 'button';
    const roleLabel = roleOptions.find((option) => option.value === user.role)?.label || user.role || '';
    pill.innerHTML = `
      <div>
        <strong>${escapeHtml(user.full_name || 'User')}</strong>
        <div class="muted">${[roleLabel, user.email, user.phone].filter(Boolean).join(' • ')}</div>
      </div>
    `;
    pill.addEventListener('click', () => openUserModal({ user }));
    listCard.appendChild(pill);
  });

  if (!users.length) {
    listCard.innerHTML += '<p>No users yet.</p>';
  }

  viewContainer.innerHTML = '';
  viewContainer.appendChild(listCard);
}
async function renderJobTypesView() {
  viewTitle.textContent = 'Job Types';
  viewSubtitle.textContent = 'Define job categories.';
  viewActions.innerHTML = '';

  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.type = 'button';
  addBtn.textContent = 'Add Job Type';
  viewActions.appendChild(addBtn);

  const jobTypes = await listJobTypes();

  const listCard = document.createElement('div');
  listCard.className = 'card list';

  const openJobTypeModal = ({ jobType } = {}) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(jobType ? 'Edit Job Type' : 'Add Job Type')}">
        <div class="modal-head">
          <div class="modal-title">${jobType ? 'Edit Job Type' : 'Add Job Type'}</div>
          <div class="modal-actions">
            ${jobType ? '<button class="pill tiny danger" type="button" data-delete>Delete</button>' : ''}
            <button class="pill tiny" type="button" data-close>Close</button>
          </div>
        </div>
        <div class="modal-body">
          <form class="form-grid" id="job-type-form"></form>
        </div>
        <div class="modal-foot">
          <button class="secondary" type="button" data-cancel>Cancel</button>
          <button class="action" type="button" data-save>Save</button>
        </div>
      </div>
      <button class="modal-scrim" aria-label="Close"></button>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.remove();
    };

    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.querySelector('.modal-scrim').addEventListener('click', close);

    const form = modal.querySelector('#job-type-form');
    const fields = [
      { key: 'name', label: 'Job Type Name' },
      { key: 'description', label: 'Description', type: 'textarea' },
    ];

    const inputs = {};
    fields.forEach((field) => {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = field.label;
      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
      } else {
        input = document.createElement('input');
      }
      input.name = field.key;
      input.value = jobType?.[field.key] || '';
      inputs[field.key] = input;
      wrap.append(label, input);
      form.appendChild(wrap);
    });

    modal.querySelector('[data-cancel]').addEventListener('click', () => {
      form.reset();
      close();
    });

    modal.querySelector('[data-save]').addEventListener('click', async () => {
      const payload = {};
      fields.forEach((field) => {
        payload[field.key] = inputs[field.key].value.trim();
      });
      if (!payload.name) {
        showToast('Job type name is required.');
        return;
      }
      try {
        if (jobType) {
          const jobTypeId = getId(jobType);
          if (!jobTypeId) throw new Error('Missing Supabase ID for update.');
          await updateJobType(jobTypeId, payload);
          showToast('Job type updated.');
        } else {
          await createJobType(payload);
          showToast('Job type added.');
        }
        await refreshBoot();
        close();
        await renderJobTypesView();
      } catch (error) {
        showToast(error.message);
      }
    });

    const deleteBtn = modal.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!jobType) return;
        if (!confirm('Delete this job type? This cannot be undone.')) return;
        try {
          const jobTypeId = getId(jobType);
          if (!jobTypeId) throw new Error('Missing Supabase ID for delete.');
          await deleteJobType(jobTypeId);
          showToast('Job type deleted.');
          await refreshBoot();
          close();
          await renderJobTypesView();
        } catch (error) {
          showToast(error.message);
        }
      });
    }
  };

  addBtn.addEventListener('click', () => openJobTypeModal());

  jobTypes.forEach((jobType) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.type = 'button';
    pill.innerHTML = `
      <div>
        <strong>${escapeHtml(jobType.name || 'Job Type')}</strong>
        <div class="muted">${escapeHtml(jobType.description || '')}</div>
      </div>
    `;
    pill.addEventListener('click', () => openJobTypeModal({ jobType }));
    listCard.appendChild(pill);
  });

  if (!jobTypes.length) {
    listCard.innerHTML += '<p>No job types yet.</p>';
  }

  viewContainer.innerHTML = '';
  viewContainer.appendChild(listCard);
}

async function renderPartsView() {
  viewTitle.textContent = 'Parts';
  viewSubtitle.textContent = 'Master product list and shelf quantities.';
  viewActions.innerHTML = '';

   const searchInput = document.createElement('input');
  searchInput.className = 'search';
  searchInput.type = 'search';
  searchInput.placeholder = 'Search parts by name / SKU / description / shelf…';
  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.type = 'button';
  addBtn.textContent = 'Add Part';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'pill';
  exportBtn.textContent = 'Export CSV';
  const importInput = document.createElement('input');
  importInput.type = 'file';
 importInput.accept = '.csv,.xlsx,.xls';

  viewActions.append(addBtn, exportBtn, importInput);

  const fields = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Part Name' },
    { key: 'description', label: 'Description', type: 'textarea' },
    {key: 'shelf', label: 'Shelf'},
    { key: 'quantity_on_hand', label: 'Quantity On Hand', type: 'number' },
  ];

  const loadInventory = async () => {
    const client = getSupabaseClient();
    const { orgId } = getConfig();
    let query = client.from('truck_inventory').select('truck_id, product_id, qty, trucks(truck_identifier)');
    if (orgId) query = query.eq('org_id', orgId);
    const { data, error } = await query;
    if (error) throw new Error('Unable to load truck inventory.');
    return data || [];
  };

  const [parts, inventory] = await Promise.all([listProducts(), loadInventory()]);

  exportBtn.addEventListener('click', () => exportCsv(parts, 'parts', fields));
  importInput.addEventListener('change', (event) => handleImportCsv(event, fields, createProduct));

  const truckPalette = [
    { bg: 'rgba(34,197,94,.18)', border: 'rgba(34,197,94,.45)', text: '#86efac' },
    { bg: 'rgba(96,165,250,.18)', border: 'rgba(96,165,250,.45)', text: '#bfdbfe' },
    { bg: 'rgba(167,139,250,.18)', border: 'rgba(167,139,250,.45)', text: '#ddd6fe' },
    { bg: 'rgba(245,158,11,.18)', border: 'rgba(245,158,11,.45)', text: '#fde68a' },
    { bg: 'rgba(249,115,22,.18)', border: 'rgba(249,115,22,.45)', text: '#fdba74' },
    { bg: 'rgba(236,72,153,.18)', border: 'rgba(236,72,153,.45)', text: '#fbcfe8' },
  ];

  const trucks = (state.boot?.trucks || []).slice().sort((a, b) => {
    return (a.truck_identifier || '').localeCompare(b.truck_identifier || '');
  });
  const inventoryMap = new Map();
  inventory.forEach((item) => {
    if (!inventoryMap.has(item.product_id)) {
      inventoryMap.set(item.product_id, new Map());
    }
    inventoryMap.get(item.product_id).set(item.truck_id, Number(item.qty || 0));
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'section-stack';

  const topControls = document.createElement('div');
  topControls.className = 'top-controls';
  topControls.append(searchInput);
  const listCard = document.createElement('div');
  listCard.className = 'card list';

  const openPartModal = ({ part } = {}) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(part ? 'Edit Part' : 'Add Part')}">
        <div class="modal-head">
          <div class="modal-title">${part ? 'Edit Part' : 'Add Part'}</div>
          <div class="modal-actions">
            ${part ? '<button class="pill tiny danger" type="button" data-delete>Delete</button>' : ''}
            <button class="pill tiny" type="button" data-close>Close</button>
          </div>
        </div>
        <div class="modal-body">
          <form class="form-grid" id="part-form"></form>
        </div>
        <div class="modal-foot">
          <button class="secondary" type="button" data-cancel>Cancel</button>
          <button class="action" type="button" data-save>Save</button>
        </div>
      </div>
      <button class="modal-scrim" aria-label="Close"></button>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.remove();
    };

    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.querySelector('.modal-scrim').addEventListener('click', close);

    const form = modal.querySelector('#part-form');
    const inputs = {};
    fields.forEach((field) => {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = field.label;
      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
      } else {
        input = document.createElement('input');
        if (field.type === 'number') input.type = 'number';
      }
      input.name = field.key;
      if (field.key === 'quantity_on_hand') {
        input.value = part?.quantity_on_hand ?? part?.minimum_qty ?? '';
      } else {
        input.value = part?.[field.key] ?? '';
      }
      inputs[field.key] = input;
      wrap.append(label, input);
      form.appendChild(wrap);
    });

    modal.querySelector('[data-cancel]').addEventListener('click', () => {
      form.reset();
      close();
    });

    modal.querySelector('[data-save]').addEventListener('click', async () => {
      const payload = {};
      fields.forEach((field) => {
        payload[field.key] = inputs[field.key].value.trim();
      });
      if (!payload.name) {
        showToast('Part name is required.');
        return;
      }
      try {
        if (part) {
          const partId = getId(part);
          if (!partId) throw new Error('Missing Supabase ID for update.');
          await updateProduct(partId, payload);
          showToast('Part updated.');
        } else {
          await createProduct(payload);
          showToast('Part added.');
        }
        await refreshBoot();
        close();
        await renderPartsView();
      } catch (error) {
        showToast(error.message);
      }
    });

    const deleteBtn = modal.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!part) return;
        if (!confirm('Delete this part? This cannot be undone.')) return;
        try {
          const partId = getId(part);
          if (!partId) throw new Error('Missing Supabase ID for delete.');
          await deleteProduct(partId);
          showToast('Part deleted.');
          await refreshBoot();
          close();
          await renderPartsView();
        } catch (error) {
          showToast(error.message);
        }
      });
    }
  };

  addBtn.addEventListener('click', () => openPartModal());

  

  const renderList = () => {
    const q = searchInput.value.trim().toLowerCase();
    listCard.innerHTML = '';

      const filtered = parts.filter((part) => {
      if (!q) return true;
      const haystack = [part.name, part.sku, part.description, part.shelf]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

      if (!filtered.length) {
      listCard.innerHTML = parts.length ? '<p>No matching parts found.</p>' : '<p>No parts yet.</p>';
      return;
    }

     filtered.forEach((part) => {
      const row = document.createElement('button');
      row.className = 'pill parts-row';
      row.type = 'button';

      const nameWrap = document.createElement('div');
      nameWrap.className = 'parts-name';
      nameWrap.innerHTML = `
        <strong>${escapeHtml(part.name || 'Part')}</strong>
        <div class="parts-sku">${escapeHtml(part.sku || 'SKU N/A')}</div>
      `;
       const desc = document.createElement('div');
      desc.className = 'parts-desc';
      desc.textContent = part.description || 'No description provided.';

   
  const qtyWrap = document.createElement('div');
      qtyWrap.className = 'parts-qty';

      trucks.forEach((truck, index) => {
        const qty = inventoryMap.get(part.id)?.get(truck.id) || 0;
        const pill = document.createElement('span');
        pill.className = 'qty-pill';
        pill.innerHTML = `
          <span class="pill-label">${escapeHtml(truck.truck_identifier || `Truck ${index + 1}`)}</span>
          <span class="pill-num">${qty}</span>
        `;
        const palette = truckPalette[index % truckPalette.length];
        pill.style.background = palette.bg;
        pill.style.borderColor = palette.border;
        pill.style.color = palette.text;
        qtyWrap.appendChild(pill);
      });

  const shelfWrap = document.createElement('div');
      shelfWrap.className = 'parts-shelf';
      const shelfPill = document.createElement('span');
      shelfPill.className = 'qty-pill';
      shelfPill.innerHTML = `
        <span class="pill-label">Shelf</span>
        <span class="pill-num">${escapeHtml(part.shelf || 'Unassigned')}</span>
      `;
      const onHand = part.quantity_on_hand ?? part.minimum_qty ?? 0;
      const onHandPill = document.createElement('span');
      onHandPill.className = 'qty-pill';
      onHandPill.innerHTML = `
        <span class="pill-label">Qty on Hand</span>
        <span class="pill-num">${onHand}</span>
      `;
      shelfWrap.append(shelfPill, onHandPill)

      row.append(nameWrap, desc, qtyWrap, shelfWrap);
      row.addEventListener('click', () => openPartModal({ part }));
      listCard.appendChild(row);
    });
  };

  searchInput.addEventListener('input', renderList);
  renderList();

  wrapper.append(topControls, listCard);

  viewContainer.innerHTML = '';
  viewContainer.appendChild(wrapper);
}
async function renderRequests() {
  viewTitle.textContent = 'Requests';
  viewSubtitle.textContent = 'Resolve and archive tech requests.';
  viewActions.innerHTML = '';

  const requests = await listAllRequests();
  const activeRequests = requests.filter((req) => req.status !== 'approved');
  const layout = document.createElement('div');
  layout.className = 'section-stack';

  const activeCard = document.createElement('div');
  activeCard.className = 'card section-stack';
  activeCard.innerHTML = '<h3>Active Requests</h3>';

 
   const formatMetadataRows = (metadata = {}) => {
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const entries = Object.entries(safeMetadata).filter(([, value]) => value !== '' && value !== null && value !== undefined);
    if (!entries.length) return '<div class="muted">No additional details.</div>';
    return entries.map(([key, value]) => `
      <div class="pill">
        <div>
          <strong>${escapeHtml(prettyLabel(key))}</strong>
          <div class="muted">${escapeHtml(String(value))}</div>
        </div>
      </div>
    `).join('');
  };

  activeRequests.forEach((req) => {
    const pill = document.createElement('button');
    pill.className = 'pill list-row';
    pill.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(req.request_type)}</div>
        <div class="row-sub muted">${escapeHtml(req.users?.full_name || 'Tech')} • Truck ${escapeHtml(req.truck_id || '--')}</div>
        <div class="row-sub">${escapeHtml(req.description)}</div>
      </div>
      <div class="row-meta">
        <span class="badge">Review</span>
      </div>
    `;
    pill.addEventListener('click', async () => {
     const body = document.createElement('div');
      body.className = 'section-stack';
      body.innerHTML = `
        <div class="pill">
          <div>
            <strong>${escapeHtml(req.request_type)}</strong>
            <div class="muted">${escapeHtml(req.users?.full_name || 'Tech')}</div>
            <div class="muted">Truck: ${escapeHtml(req.truck_id || '--')}</div>
          </div>
          <span class="badge">${escapeHtml(req.status || 'Pending')}</span>
        </div>
        <div class="card">
          <strong>Description</strong>
          <div class="muted">${escapeHtml(req.description || '')}</div>
        </div>
        <div class="card">
          <strong>Details</strong>
          <div class="section-stack">${formatMetadataRows(req.metadata)}</div>
        </div>
      `;
      const actions = document.createElement('div');
      actions.className = 'modal-foot';
      const denyBtn = document.createElement('button');
      denyBtn.className = 'danger';
      denyBtn.type = 'button';
      denyBtn.textContent = 'Deny';
      const approveBtn = document.createElement('button');
      approveBtn.className = 'action';
      approveBtn.type = 'button';
      approveBtn.textContent = 'Approve';
      actions.append(denyBtn, approveBtn);
      body.appendChild(actions);
      const { close } = openModalSimple({ title: 'Request Review', bodyEl: body });
      approveBtn.addEventListener('click', async () => {
        try {
          await updateRequest(req.id, { status: 'approved' });
          showToast('Request approved.');
          close();
          await renderRequests();
        } catch (error) {
          showToast(error.message);
        }
      });
      denyBtn.addEventListener('click', async () => {
        if (!confirm('Deny and delete this request?')) return;
        try {
          await deleteRequest(req.id);
          showToast('Request denied and removed.');
          close();
          await renderRequests();
        } catch (error) {
          showToast(error.message);
        }
      });
    });
    activeCard.appendChild(pill);
  });

  if (!activeRequests.length) {
    activeCard.innerHTML += '<p>No active requests.</p>';
  }

  layout.appendChild(activeCard);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(layout);
}

async function renderOutOfStock() {
  viewTitle.textContent = 'Out of Stock Flags';
  viewSubtitle.textContent = 'Resolve parts flagged by tech.';
  viewActions.innerHTML = '';

  const flags = await listOutOfStock();
  const container = document.createElement('div');
  container.className = 'card list';

  flags.forEach((flag) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>
        <strong>${flag.products?.sku || ''} - ${flag.products?.name || 'Part'}</strong>
        <div class="muted">${flag.products?.description || ''}</div>
        <div class="muted">Truck: ${flag.trucks?.truck_identifier || flag.truck_id}</div>
        <div>Current Qty: ${flag.current_qty ?? 0}</div>
      </div>
      <span class="badge danger">Resolve</span>
    `;
    pill.addEventListener('click', async () => {
      if (!confirm('Resolve out-of-stock flag?')) return;
      try {
        await deleteOutOfStock(flag.id);
        showToast('Out-of-stock resolved.');
        await renderOutOfStock();
      } catch (error) {
        showToast(error.message);
      }
    });
    container.appendChild(pill);
  });

  if (!flags.length) {
    container.innerHTML += '<p>No out-of-stock flags.</p>';
  }

  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);
}

async function renderReceipts() {
  viewTitle.textContent = 'Receipts';
  viewSubtitle.textContent = 'Review and approve tech receipts.';
  viewActions.innerHTML = '';

  const receipts = await listReceipts();
  const pendingReceipts = receipts.filter((receipt) => !receipt.status || receipt.status === 'pending');
  const container = document.createElement('div');
  container.className = 'card list';

 const renderItemSummary = (receipt) => {
    if (Array.isArray(receipt.items) && receipt.items.length) {
      return receipt.items
        .map((item) => `${item.description} (x${item.qty || 0})`)
        .join(' • ');
    }
    return receipt.description || '';
  };

  pendingReceipts.forEach((receipt) => {
    const pill = document.createElement('button');
    pill.className = 'pill list-row receipt-row';
    pill.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(receipt.receipt_type || 'Receipt')}</div>
        <div class="row-sub muted">${new Date(receipt.created_at).toLocaleString()}</div>
        <div class="row-sub muted">Truck ${escapeHtml(receipt.trucks?.truck_identifier || receipt.truck_id || '--')}</div>
      </div>
      <div class="row-meta">
        <span class="badge">${receipt.total_cost ? `$${Number(receipt.total_cost).toFixed(2)}` : 'Review'}</span>
      </div>
    `;
      pill.addEventListener('click', () => {
      const body = document.createElement('div');
      body.className = 'section-stack';
      const items = Array.isArray(receipt.items) ? receipt.items : [];
      const itemList = items.length
        ? items.map((item) => `
            <div class="pill">
              <div>
                <strong>${escapeHtml(item.description || 'Item')}</strong>
                <div class="muted">Qty: ${item.qty ?? 0} • Price: $${Number(item.price || 0).toFixed(2)}</div>
              </div>
              <span class="badge">$${Number(item.total || 0).toFixed(2)}</span>
            </div>
          `).join('')
        : `<div class="muted">${escapeHtml(receipt.description || 'No line items provided.')}</div>`;
      body.innerHTML = `
        <div class="pill">
          <div>
            <strong>${escapeHtml(receipt.receipt_type || 'Receipt')}</strong>
            <div class="muted">Tech: ${escapeHtml(receipt.users?.full_name || receipt.tech_id || 'Tech')}</div>
            <div class="muted">Truck: ${escapeHtml(receipt.trucks?.truck_identifier || receipt.truck_id || '--')}</div>
          </div>
          <span class="badge">${receipt.total_cost ? `$${Number(receipt.total_cost).toFixed(2)}` : 'Total N/A'}</span>
        </div>
        <div class="card section-stack">
          <strong>Items</strong>
          ${itemList}
        </div>
      `;
      const actions = document.createElement('div');
      actions.className = 'modal-foot';
      const denyBtn = document.createElement('button');
      denyBtn.className = 'danger';
      denyBtn.type = 'button';
      denyBtn.textContent = 'Deny';
      const approveBtn = document.createElement('button');
      approveBtn.className = 'action';
      approveBtn.type = 'button';
      approveBtn.textContent = 'Approve';
      actions.append(denyBtn, approveBtn);
      body.appendChild(actions);
      const { close } = openModalSimple({ title: 'Receipt Review', bodyEl: body });
      approveBtn.addEventListener('click', async () => {
        try {
          await updateReceipt(receipt.id, { status: 'approved' });
          showToast('Receipt approved.');
          close();
          await renderReceipts();
        } catch (error) {
          showToast(error.message);
        }
      });
      denyBtn.addEventListener('click', async () => {
        if (!confirm('Deny this receipt?')) return;
        try {
          await updateReceipt(receipt.id, { status: 'denied' });
          showToast('Receipt denied.');
          close();
          await renderReceipts();
        } catch (error) {
          showToast(error.message);
        }
      });
    });
    container.appendChild(pill);
  });

 if (!pendingReceipts.length) {
    container.innerHTML += '<p>No receipts awaiting review.</p>';
  }

  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);
}

async function renderToolsView() {
  viewTitle.textContent = 'Tools';
  viewSubtitle.textContent = 'Manage tool list and truck assignments.';
  viewActions.innerHTML = '';

  const tools = await listTools();
  const trucks = await listTrucks();

  const layout = document.createElement('div');
  layout.className = 'grid-two';

  const toolsCard = document.createElement('div');
  toolsCard.className = 'card section-stack';
  toolsCard.innerHTML = '<h3>Tool List</h3>';

  tools.forEach((tool) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `<div><strong>${tool.name}</strong><div class="muted">${tool.description || ''}</div></div>`;
    pill.addEventListener('click', () => renderToolDetail(tool));
    toolsCard.appendChild(pill);
  });

  if (!tools.length) toolsCard.innerHTML += '<p>No tools yet.</p>';

  const detailCard = document.createElement('div');
  detailCard.className = 'card section-stack';

  async function renderToolDetail(tool) {
    detailCard.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'section-stack';
    form.innerHTML = `
      <div>
        <label>Tool Name</label>
        <input name="name" value="${tool?.name || ''}" />
      </div>
      <div>
        <label>Description</label>
        <textarea name="description">${tool?.description || ''}</textarea>
      </div>
      <div class="form-grid">
        <button class="action" type="submit">${tool ? 'Save' : 'Create'}</button>
        <button class="action danger" type="button" ${tool ? '' : 'disabled'}>Delete</button>
      </div>
    `;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        name: form.elements.name.value.trim(),
        description: form.elements.description.value.trim(),
      };
      try {
        if (tool) {
          await updateTool(tool.id, payload);
          showToast('Tool updated.');
        } else {
          await createTool(payload);
          showToast('Tool created.');
        }
        await renderToolsView();
      } catch (error) {
        showToast(error.message);
      }
    });
    form.querySelector('button.danger').addEventListener('click', async () => {
      if (!tool) return;
      if (!confirm('Delete tool?')) return;
      try {
        await deleteTool(tool.id);
        showToast('Tool deleted.');
        await renderToolsView();
      } catch (error) {
        showToast(error.message);
      }
    });
    detailCard.appendChild(form);

    if (tool) {
      const assignCard = document.createElement('div');
      assignCard.className = 'section-stack';
      assignCard.innerHTML = '<h4>Assign Tool to Truck</h4>';
      const assignForm = document.createElement('form');
      assignForm.className = 'form-grid';
      const truckSelect = document.createElement('select');
      trucks.forEach((truck) => {
        const option = document.createElement('option');
        option.value = truck.id;
        option.textContent = truck.truck_identifier;
        truckSelect.appendChild(option);
      });
      const assignBtn = document.createElement('button');
      assignBtn.className = 'action';
      assignBtn.textContent = 'Assign';
      assignForm.appendChild(truckSelect);
      assignForm.appendChild(assignBtn);
      assignForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await addTruckTool({ truck_id: truckSelect.value, tool_id: tool.id });
          showToast('Tool assigned.');
          await renderToolsView();
        } catch (error) {
          showToast(error.message);
        }
      });
      assignCard.appendChild(assignForm);

      const assignments = document.createElement('div');
      assignments.className = 'section-stack';
      assignments.innerHTML = '<h4>Assigned Trucks</h4>';
      const truckAssignments = await Promise.all(trucks.map(async (truck) => {
        const toolLinks = await listTruckTools(truck.id);
        return { truck, toolLinks };
      }));
      truckAssignments.forEach(({ truck, toolLinks }) => {
        toolLinks.filter((link) => link.tool_id === tool.id).forEach((link) => {
          const pill = document.createElement('button');
          pill.className = 'pill';
          pill.innerHTML = `<div><strong>${truck.truck_identifier}</strong></div><span class="badge">Remove</span>`;
          pill.addEventListener('click', async () => {
            try {
              await deleteTruckTool(link.id);
              showToast('Assignment removed.');
              await renderToolsView();
            } catch (error) {
              showToast(error.message);
            }
          });
          assignments.appendChild(pill);
        });
      });
      if (!assignments.querySelector('.pill')) {
        assignments.innerHTML += '<p>No assignments yet.</p>';
      }
      detailCard.appendChild(assignCard);
      detailCard.appendChild(assignments);
    }
  }

  renderToolDetail(null);
  layout.appendChild(toolsCard);
  layout.appendChild(detailCard);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(layout);
}

function renderSettings() {
  viewTitle.textContent = 'Settings';
  viewSubtitle.textContent = 'Configure Supabase connection for this device.';
  viewActions.innerHTML = '';
  const config = getConfig();

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <form id="settings-form" class="section-stack">
      <div class="form-grid">
        <div>
          <label>Supabase URL</label>
          <input name="supabaseUrl" required />
        </div>
        <div>
          <label>Supabase Anon Key</label>
          <input name="supabaseAnonKey" required />
        </div>
        <div>
          <label>Org ID</label>
          <input name="orgId" required />
        </div>
         <div>
          <label>Google Maps API Key</label>
          <input name="googleMapsApiKey" placeholder="Paste browser API key" />
        </div>
      </div>
      <button class="action" type="submit">Save Settings</button>
      <div class="card settings-help">
        <h4>Get a free Google Maps API key</h4>
        <ol class="muted">
          <li>Go to the Google Cloud Console and create/select a project.</li>
          <li>Enable the <strong>Maps JavaScript API</strong> for the project.</li>
          <li>Create an API key under <strong>APIs & Services → Credentials</strong>.</li>
          <li>Optionally restrict the key to your site domain for security.</li>
          <li>Paste the key above and save.</li>
        </ol>
        <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener">
          Open Google Maps credentials
        </a>
        <div class="muted small">Google provides a $200 monthly credit, which typically covers light usage.</div>
      </div>
    </form>
  `;
 const form = card.querySelector('#settings-form');
  form.elements.supabaseUrl.value = config.supabaseUrl || '';
  form.elements.supabaseAnonKey.value = config.supabaseAnonKey || '';
  form.elements.orgId.value = config.orgId || '';
  form.elements.googleMapsApiKey.value = config.googleMapsApiKey || '';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    saveConfig({
      supabaseUrl: data.get('supabaseUrl'),
      supabaseAnonKey: data.get('supabaseAnonKey'),
      orgId: data.get('orgId'),
      googleMapsApiKey: data.get('googleMapsApiKey'),
    });
    showToast('Settings saved. Reload to refresh data.');
  });

  viewContainer.innerHTML = '';
  viewContainer.appendChild(card);
}

/* ============================
   UI HELPERS (premium modals)
   - no Supabase changes
============================ */
function getId(obj) {
  return obj?.customer_id ?? obj?.field_id ?? obj?.job_id ?? obj?.id ?? obj?.uuid ?? null;
}
function getCustomerId(obj){ return obj?.customer_id ?? obj?.id ?? null; }
function getFieldId(obj){ return obj?.field_id ?? obj?.id ?? null; }

function openRowEditModal(title, row, type, onSave){
  // Supabase is king: row keys define what exists. For editing, we show only human-facing fields
  // with clear labels, and hide backend keys (id/org/customer_id etc).
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="pill tiny" type="button" data-close>Close</button>
      </div>
      <div class="modal-body">
        <form class="form-grid form-grid-2" id="edit-form"></form>
      </div>
      <div class="modal-foot">
        <button class="pill secondary" type="button" data-cancel>Cancel</button>
        <button class="action" type="button" data-save>Save</button>
      </div>
    </div>
    <button class="modal-scrim" aria-label="Close"></button>
  `;
  document.body.appendChild(modal);

  const form = modal.querySelector('#edit-form');

  const HIDE_KEYS_COMMON = new Set([
    'id','org_id','customer_id','field_id','job_id',
    'created_at','updated_at',
  ]);

  // Prefer these keys + labels when present (customer/field forms)
  const CUSTOMER_FIELDS = [
    { label: 'Name / Company', keys: ['name'] },
    { label: 'Contact Name',  keys: ['contact_name'] },
    { label: 'Phone',         keys: ['phone'] },
    { label: 'Email',         keys: ['email'] },
    { label: 'Notes',         keys: ['notes'], textarea: true },
  ];

  const FIELD_FIELDS = [
    { label: 'Field Name',        keys: ['name','field_name'] },
    { label: 'Address / Location',keys: ['address','location','field_address'], textarea: true },
    { label: 'Lat',              keys: ['lat','latitude'] },
    { label: 'Lon',              keys: ['lon','lng','longitude'] },
    { label: 'Brand',            keys: ['brand','pivot_brand'] },
    { label: 'Tower Count',      keys: ['tower_count','towers','towerCount'] },
    { label: 'Serial Number',    keys: ['serial_number','serial','reinke_serial'] },
    { label: 'Telemetry',        keys: ['has_telemetry','telemetry','hasTelemetry'] , boolean: true },
    { label: 'Telemetry Make',   keys: ['telemetry_make'] },
    { label: 'Telemetry Serial', keys: ['telemetry_serial'] },
    { label: 'Last Known Hours', keys: ['last_known_hours','current_hours','hours'] },
    { label: 'Notes',            keys: ['additional_info','notes','note'], textarea: true },
  ];

  function pickExistingKey(keys){
    for (const k of keys){
      if (row && Object.prototype.hasOwnProperty.call(row, k)) return k;
    }
    return null;
  }

  // Build field list to show in modal
  let fieldSpecs = [];
  if (type === 'customer') fieldSpecs = CUSTOMER_FIELDS;
  else if (type === 'field') fieldSpecs = FIELD_FIELDS;

  // If we don't have a spec (or row is odd), fall back to all keys minus hidden.
  if (!fieldSpecs.length){
    fieldSpecs = Object.keys(row || {})
      .filter(k => !HIDE_KEYS_COMMON.has(k))
      .map(k => ({ label: prettyLabel(k), keys: [k] }));
  }

  const inputs = {}; // key -> element
  fieldSpecs.forEach(spec => {
    const k = pickExistingKey(spec.keys);
    if (!k) return; // if this column doesn't exist in Supabase row, don't show it
    if (HIDE_KEYS_COMMON.has(k)) return;

    const wrap = document.createElement('div');
    wrap.className = 'form-item';

    const labelEl = document.createElement('label');
    labelEl.textContent = spec.label || prettyLabel(k);
    labelEl.htmlFor = 'f_' + k;

   

    const v = row?.[k];

    let input;
    if (spec.boolean || typeof v === 'boolean'){
      input = document.createElement('select');
      input.innerHTML = `<option value="">(blank)</option><option value="true">Yes</option><option value="false">No</option>`;
      input.value = (v === true) ? 'true' : (v === false) ? 'false' : '';
    } else if (spec.textarea || (typeof v === 'string' && v.length > 80)){
      input = document.createElement('textarea');
      input.value = v ?? '';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = (v ?? '');
    }

    input.id = 'f_' + k;
    input.dataset.key = k;

    wrap.append(labelEl, input);
    form.appendChild(wrap);
    inputs[k] = input;
  });

  const close = () => { modal.remove(); };
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.querySelector('[data-cancel]').addEventListener('click', close);
  modal.querySelector('.modal-scrim').addEventListener('click', close);

  modal.querySelector('[data-save]').addEventListener('click', async () => {
    const changes = {};
    for (const [k, el] of Object.entries(inputs)){
      if (el.tagName === 'SELECT'){
        if (el.value === '') continue;
        changes[k] = (el.value === 'true');
        continue;
      }
      const val = el.value;
      // allow clearing by setting empty string
      changes[k] = val;
    }

    try{
      await onSave(mergeForUpdate(row, changes, type));
      close();
    }catch(e){
      showToast(e?.message || String(e));
    }
  });
}

function openModalSimple({ title, bodyEl, onClose }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  const scrim = document.createElement('button');
  scrim.className = 'modal-scrim';
  scrim.type = 'button';
  scrim.addEventListener('click', () => close());
  const card = document.createElement('div');
  card.className = 'modal-card';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const t = document.createElement('div');
  t.className = 'modal-title';
  t.textContent = title || '';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pill tiny';
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => close());
  head.append(t, closeBtn);
  card.append(head, bodyEl);
  modal.append(card, scrim);
  document.body.appendChild(modal);

  const onKey = (e)=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown', onKey);

  function close(){
    document.removeEventListener('keydown', onKey);
    modal.remove();
    onClose && onClose();
  }
  return { close };
}

/* === DATA CONTRACT (Supabase is king) ===
   Rules:
   - Never guess IDs; always use what Supabase row contains.
   - Updates send merged payloads (existing row + changes), never partials.
   - Strip undefined so we don't accidentally wipe columns.
*/
const ID_KEYS = {
  customer: ['customer_id','id'],
  field: ['field_id','id'],
  job: ['job_id','id'],
};

function getIdFromRow(row, type){
  const keys = ID_KEYS[type] || ['id'];
  for (const k of keys){
    if (row && row[k] !== undefined && row[k] !== null && String(row[k]).length) return row[k];
  }
  return null;
}

function stripUndefined(obj){
  return Object.fromEntries(Object.entries(obj || {}).filter(([,v]) => v !== undefined));
}

function mergeForUpdate(existingRow, changes, type){
  const id = getIdFromRow(existingRow, type) || getIdFromRow(changes, type);
  const merged = stripUndefined({ ...(existingRow || {}), ...(changes || {}) });
  // enforce ID keys present exactly as Supabase expects
  if (type === 'customer'){
    if (existingRow?.customer_id || changes?.customer_id) merged.customer_id = id;
    if (existingRow?.id || changes?.id) merged.id = id;
  } else if (type === 'field'){
    if (existingRow?.field_id || changes?.field_id) merged.field_id = id;
    if (existingRow?.id || changes?.id) merged.id = id;
  } else if (type === 'job'){
    if (existingRow?.job_id || changes?.job_id) merged.job_id = id;
    if (existingRow?.id || changes?.id) merged.id = id;
  }
  return merged;
}

function prettyLabel(key){
  const s = String(key || '').replaceAll('_',' ').replaceAll('-',' ');
  return s.replace(/\b\w/g, (m)=>m.toUpperCase());
}

function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function prettyKey(k){
  return String(k)
    .replaceAll('_',' ')
    .replace(/\bid\b/i,'ID')
    .replace(/\borg\b/i,'Org')
    .replace(/\bat\b/i,'At')
    .replace(/\bno\b/i,'No')
    .replace(/\bqty\b/i,'Qty')
    .replace(/\bzip\b/i,'ZIP')
    .replace(/\blng\b/i,'Lng')
    .replace(/\blat\b/i,'Lat')
    .replace(/\burl\b/i,'URL')
    .replace(/\bsku\b/i,'SKU')
    .replace(/\bdb\b/i,'DB')
    .replace(/\bapi\b/i,'API')
    .replace(/(^|\s)\S/g, (m)=>m.toUpperCase());
}

function renderInfoGrid(obj, { hideKeys = [] } = {}){
  const entries = Object.entries(obj || {}).filter(([k,v]) => !hideKeys.includes(k));
  const grid = document.createElement('div');
  grid.className = 'info-grid';
  for (const [k,v] of entries){
    const item = document.createElement('div');
    item.className = 'info-item';
    const label = document.createElement('div');
    label.className = 'info-label';
    label.textContent = prettyKey(k);
    const val = document.createElement('div');
    val.className = 'info-val';
    val.textContent = (v === null || v === undefined) ? '' : String(v);
    item.append(label, val);
    grid.appendChild(item);
  }
  return grid;
}
function elTag(tag, attrs={}, children=[]) {
  const n = document.createElement(tag);
  Object.entries(attrs||{}).forEach(([k,v])=>{
    if (k === 'className') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  });
  (children||[]).forEach(c=> n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
}

/* ============================
   PREMIUM CUSTOMER -> FIELD FLOW
============================ */
async function fetchAllJobsSafe() {
  try { return await listJobs({}); } catch(e) {
    try { return await listJobs(); } catch(e2) { return []; }
  }
}

function jobStatusKey(job){
  const s = (job.status || job.job_status || job.state || '').toLowerCase();
  if (s.includes('paused')) return 'paused';
  if (s.includes('progress') || s.includes('on_site') || s.includes('on the way') || s.includes('on_the_way')) return 'in_progress';
  if (s.includes('finish') || s.includes('invoic') || s.includes('close')) return 'finished';
  return 'open';
}
function quickViewStatusKey(job) {
  const s = (job.status || job.job_status || job.state || '').toLowerCase();
  if (s.includes('invoic') || s.includes('cancel') || s.includes('close')) return 'closed';
  if (s.includes('finish')) return 'finished';
  if (s.includes('paused')) return 'paused';
  if (s.includes('progress') || s.includes('on_site') || s.includes('on the way') || s.includes('on_the_way')) return 'in_progress';
  return 'open';
}


async function renderCustomersPremium() {
  viewTitle.textContent = 'Customers';
  viewSubtitle.textContent = 'Select a customer to open their file (fields + jobs).';
  viewActions.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'section-stack';

  const top = document.createElement('div');
  top.className = 'top-controls';

  const search = document.createElement('input');
  search.className = 'search';
  search.type = 'search';
  search.placeholder = 'Search customers by name / phone / email / address…';

  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.type = 'button';
  addBtn.textContent = '+ Add Customer';

  top.append(search, addBtn);

  const listCard = document.createElement('div');
  listCard.className = 'card customer-list';
  wrapper.append(top, listCard);

  viewContainer.innerHTML = '';
  viewContainer.appendChild(wrapper);

  const [customers, jobs] = await Promise.all([listCustomers(), fetchAllJobsSafe()]);

  const jobsByCustomer = new Map();
  for (const j of jobs) {
    const cid = j.customer_id || j.customerId || j.customer || j.customer?.id;
    if (!cid) continue;
    if (!jobsByCustomer.has(cid)) jobsByCustomer.set(cid, []);
    jobsByCustomer.get(cid).push(j);
  }

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    listCard.innerHTML = '';

    const filtered = customers.filter((c) => {
      if (!q) return true;
      const hay = [
        c.name, c.contact_name, c.phone, c.email, c.address,
        c.billing_name, c.billing_phone, c.billing_email, c.billing_address
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    if (!filtered.length) {
      listCard.appendChild(elTag('div', { className: 'muted', text: 'No customers found.' }));
      return;
    }

    for (const c of filtered) {
      const cid = getCustomerId(c);
      const related = jobsByCustomer.get(cid) || [];
      const counts = { open:0, paused:0, finished:0 };
      for (const j of related) {
        const k = jobStatusKey(j);
        if (k === 'paused') counts.paused++;
        else if (k === 'finished') counts.finished++;
        else counts.open++;
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pill customer-row compact-row';
      row.innerHTML = `
        <div class="cust-left">
          <div class="cust-name">${(c.name || 'Customer')}</div>
          <div class="cust-phone muted">${(c.phone || '')}</div>
        </div>
        <div class="row-chips">
          <div class="kpi-circle kpi-open" title="Open jobs">${counts.open}</div>
          <div class="kpi-circle kpi-paused" title="Paused jobs">${counts.paused}</div>
          <div class="kpi-circle kpi-finished" title="Finished jobs">${counts.finished}</div>
        </div>
      `;

      row.addEventListener('click', async () => {
        state.customerId = cid;
        state.fieldId = null;
        await renderCustomerFilePremium();
      });

      listCard.appendChild(row);
    }
  };

  search.addEventListener('input', renderList);
  addBtn.addEventListener('click', async () => {
    const body = document.createElement('div');
    body.className = 'section-stack';
    const form = document.createElement('div');
    form.className = 'form-grid';

    const fields = [
      ['name', 'Customer Name'],
      ['phone', 'Phone'],
      ['email', 'Email'],
      ['address', 'Address'],
     
    ];
    const inputs = {};
    const formatPhone = (value) => {
      const digits = value.replace(/\D/g, '').slice(0, 10);
      const area = digits.slice(0, 3);
      const mid = digits.slice(3, 6);
      const tail = digits.slice(6, 10);

      if (digits.length <= 3) return area;
      if (digits.length <= 6) return `(${area}) ${mid}`;
      return `(${area}) ${mid}-${tail}`;
    };
    fields.forEach(([key, label]) => {
      const wrap = document.createElement('div');
     const lab = document.createElement('label');
      lab.textContent = label;
      const inp = document.createElement('input');
      inp.name = key;
      if (key === 'phone') {
        inp.inputMode = 'tel';
        inp.maxLength = 14;
        inp.pattern = '\\(\\d{3}\\) \\d{3}-\\d{4}';
        inp.placeholder = '(###) ###-####';
        inp.addEventListener('input', () => {
          inp.value = formatPhone(inp.value);
        });
      }
      inputs[key] = inp;
      wrap.append(lab, inp);
      form.appendChild(wrap);
    });

    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const cancel = document.createElement('button'); cancel.className='secondary'; cancel.type='button'; cancel.textContent='Cancel';
    const save = document.createElement('button'); save.className='action'; save.type='button'; save.textContent='Save';
    foot.append(cancel, save);

    body.append(form, foot);
    const { close } = openModalSimple({ title:'Add Customer', bodyEl: body });

    cancel.addEventListener('click', () => close());
    save.addEventListener('click', async () => {
      const payload = {};
      fields.forEach(([key])=> payload[key] = inputs[key].value.trim());
      if (!payload.name) return showToast('Customer name is required.');
      try{
        await createCustomer(payload);
        await refreshBoot();
        close();
        await renderCustomersPremium();
      }catch(e){ showToast(e.message); }
    });
  });

  renderList();
}

async function renderCustomerFilePremium() {
  const customerId = state.customerId;
  if (!customerId) return renderCustomersPremium();

  const customers = await listCustomers();
  const customer = customers.find((c)=> getCustomerId(c) === customerId);
  if (!customer) { state.customerId=null; return renderCustomersPremium(); }

  const [fields, jobs] = await Promise.all([listFields(), fetchAllJobsSafe()]);
  const custFields = fields.filter((f)=> (f.customer_id || f.customerId) === customerId);

  const jobsForCustomer = jobs.filter((j)=> (j.customer_id || j.customerId) === customerId);
  const kpis = { open:0, paused:0, in_progress:0, finished:0 };
  for (const j of jobsForCustomer){
    const k = jobStatusKey(j);
    if (k==='paused') kpis.paused++;
    else if (k==='in_progress') kpis.in_progress++;
    else if (k==='finished') kpis.finished++;
    else kpis.open++;
  }

  viewTitle.textContent = customer.name || 'Customer';
  viewSubtitle.textContent = `Customer File • ${custFields.length} field(s)`;
  viewActions.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'card section-stack';

  const headRow = document.createElement('div');
  headRow.className = 'detail-head';

  const left = document.createElement('div');
  left.className = 'detail-left';
  left.innerHTML = `
    <div class="detail-title">${customer.name || 'Customer'}</div>
    <div class="detail-sub muted">${[customer.phone, customer.email, customer.address].filter(Boolean).join(' • ')}</div>
     ${customer.notes ? `<div class="detail-sub muted">${escapeHtml(customer.notes)}</div>` : ''}
  `;

  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const back = document.createElement('button');
  back.className = 'secondary'; back.type='button'; back.textContent='Back';
  back.addEventListener('click', async()=>{ state.customerId=null; state.fieldId=null; await renderCustomersPremium(); });

  const edit = document.createElement('button');
  edit.className = 'secondary'; edit.type='button'; edit.textContent='Edit';

  const del = document.createElement('button');
  del.className = 'danger'; del.type='button'; del.textContent='Delete';

  const addField = document.createElement('button');
  addField.className = 'action'; addField.type='button'; addField.textContent='+ Add Field';

  actions.append(edit, addField, del, back);
  headRow.append(left, actions);

  header.append(headRow);

  // Customer info (human fields only)
  const infoCard = document.createElement('div');
  infoCard.className = 'card info-card';
  const infoGrid = document.createElement('div');
  infoGrid.className = 'info-grid';

  const CUSTOMER_INFO_FIELDS = [
    ['name', 'Name / Company'],
    ['contact_name', 'Contact Name'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['notes', 'Notes'],
  ];

  CUSTOMER_INFO_FIELDS.forEach(([k,label])=>{
    if (!Object.prototype.hasOwnProperty.call(customer||{}, k)) return;
    const item = document.createElement('div');
    item.className = 'info-item' + (k==='notes' ? ' info-span-2' : '');
    const lab = document.createElement('div');
    lab.className = 'info-label';
    lab.textContent = label;
    const val = document.createElement('div');
    val.className = 'info-val';
    val.textContent = (customer && customer[k] != null) ? String(customer[k]) : '';
    item.append(lab, val);
    infoGrid.appendChild(item);
  });

  infoCard.appendChild(infoGrid);

  const fieldsCard = document.createElement('div');
  fieldsCard.className = 'card section-stack';
  const fieldsHead = document.createElement('div');
  fieldsHead.className = 'section-title';
  fieldsHead.textContent = 'Fields';
  const fieldSearch = document.createElement('input');
  fieldSearch.className='search';
  fieldSearch.type='search';
  fieldSearch.placeholder='Search fields for this customer…';

  const list = document.createElement('div');
  list.className = 'list field-list';

  fieldsCard.append(fieldsHead, fieldSearch, list);

  const jobsByField = new Map();
  for (const j of jobsForCustomer){
    const fid = j.field_id || j.fieldId;
    if (!fid) continue;
    if (!jobsByField.has(fid)) jobsByField.set(fid, []);
    jobsByField.get(fid).push(j);
  }

  const renderFields = ()=>{
    const q = fieldSearch.value.trim().toLowerCase();
    list.innerHTML = '';
    const filtered = custFields.filter(f=>{
      if(!q) return true;
      const hay = [f.name, f.address, f.brand, f.power_source].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    if(!filtered.length){
      list.appendChild(elTag('div',{className:'muted', text:'No fields found for this customer.'}));
      return;
    }

    for (const f of filtered){
      const fid = getFieldId(f);
      const related = jobsByField.get(fid) || [];
      const openPaused = related.filter(j=> {
        const k = jobStatusKey(j);
        return k==='open' || k==='paused' || k==='in_progress';
      }).length;

      const btn = document.createElement('button');
      btn.type='button';
      btn.className='pill field-row';
      btn.innerHTML = `
        <div class="row-main">
          <div class="row-title">${f.name || 'Field'}</div>
          <div class="row-sub muted">${[f.address, f.brand].filter(Boolean).join(' • ')}</div>
        </div>
        <div class="row-meta">
          <span class="badge info">${openPaused} jobs</span>
        </div>
      `;
      btn.addEventListener('click', async ()=>{
        state.fieldId = fid;
        await renderFieldFilePremium();
      });
      list.appendChild(btn);
    }
  };

  fieldSearch.addEventListener('input', renderFields);

  // Edit customer modal
  edit.addEventListener('click', ()=>{
    const body = document.createElement('div');
    body.className='section-stack';
    const form = document.createElement('div'); form.className='form-grid';
    const fieldsDef = Object.keys(customer || {}).filter((k) => ![
      'created_at',
      'updated_at',
      'id',
      'org_id',
      'customer_id',
    ].includes(k));
    const inputs = {};
    fieldsDef.forEach((k)=>{
      const label = prettyLabel(k);
      const wrap=document.createElement('div');
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.value = (customer[k]||''); inp.placeholder=label;
      inputs[k]=inp; wrap.append(lab, inp); form.appendChild(wrap);
    });
    const foot=document.createElement('div'); foot.className='modal-foot';
    const cancel=document.createElement('button'); cancel.className='secondary'; cancel.type='button'; cancel.textContent='Cancel';
    const save=document.createElement('button'); save.className='action'; save.type='button'; save.textContent='Save';
    foot.append(cancel, save);
    body.append(form, foot);
    const {close}=openModalSimple({title:'Edit Customer', bodyEl: body});
    cancel.addEventListener('click', ()=>close());
    save.addEventListener('click', async ()=>{
      const payload = {};
      fieldsDef.forEach((k)=>{ if(inputs[k]) payload[k]=inputs[k].value.trim(); });
      if(!payload.name) return showToast('Customer name is required.');
      try{
        await updateCustomer(customerId, payload);
        await refreshBoot();
        close();
        await renderCustomerFilePremium();
      }catch(e){ showToast(e.message); }
    });
  });

  // Delete customer
  del.addEventListener('click', ()=>{
    const body = document.createElement('div');
    body.className='section-stack';
    body.appendChild(elTag('div',{className:'muted', text:'Delete this customer? This cannot be undone.'}));
    const foot=document.createElement('div'); foot.className='modal-foot';
    const cancel=document.createElement('button'); cancel.className='secondary'; cancel.type='button'; cancel.textContent='Cancel';
    const confirm=document.createElement('button'); confirm.className='danger'; confirm.type='button'; confirm.textContent='Delete';
    foot.append(cancel, confirm);
    body.appendChild(foot);
    const {close}=openModalSimple({title:'Delete Customer', bodyEl: body});
    cancel.addEventListener('click', ()=>close());
    confirm.addEventListener('click', async ()=>{
      try{
        await deleteCustomer(customerId);
        await refreshBoot();
        close();
        state.customerId=null; state.fieldId=null;
        await renderCustomersPremium();
      }catch(e){ showToast(e.message); }
    });
  });

  // Add Field modal
  addField.addEventListener('click', ()=>{
    const body=document.createElement('div'); body.className='section-stack';
    const form=document.createElement('div'); form.className='form-grid';
    const fieldsDef = [
     ['name', 'Field Name'],
      ['brand', 'Brand'],
      ['power_source', 'Power Source'],
      ['serial_number', 'Serial Number'],
      ['tower_count', 'Tower Count'],
      ['address', 'Address'],
      ['lat', 'Latitude'],
      ['lon', 'Longitude'],
      ['sprinkler_package', 'Sprinkler Package #'],
      ['telemetry_make', 'Telemetry Make'],
      ['telemetry_serial', 'Telemetry Serial'],
    ];
    const inputs={};
   fieldsDef.forEach(([key, label])=>{
      const wrap=document.createElement('div');
       const lab=document.createElement('label');
      lab.textContent=label;
      const inp=document.createElement('input');
      inp.name = key;
      inputs[key]=inp;
      wrap.append(lab, inp);
      form.appendChild(wrap);
    });
    const foot=document.createElement('div'); foot.className='modal-foot';
    const cancel=document.createElement('button'); cancel.className='secondary'; cancel.type='button'; cancel.textContent='Cancel';
    const save=document.createElement('button'); save.className='action'; save.type='button'; save.textContent='Save';
    foot.append(cancel, save);
    body.append(form, foot);
    const {close}=openModalSimple({title:'Add Field', bodyEl: body});
    cancel.addEventListener('click', ()=>close());
    save.addEventListener('click', async ()=>{
      const payload = { customer_id: customerId };
      fieldsDef.forEach(([key])=>{ if(inputs[key]) payload[key]=inputs[key].value.trim(); });
    const fieldName = payload.name || payload.field_name;
      if(!fieldName) return showToast('Field name is required.');
      try{
        await createField(payload);
        await refreshBoot();
        close();
        await renderCustomerFilePremium();
      }catch(e){ showToast(e.message); }
    });
  });

  // Render
  viewContainer.innerHTML = '';
  const stack = document.createElement('div');
  stack.className = 'section-stack';
  stack.append(header, fieldsCard);
  viewContainer.appendChild(stack);
  renderFields();
}

async function renderFieldFilePremium() {
  const fieldId = state.fieldId;
  if (!fieldId) return renderCustomerFilePremium();

  const fields = await listFields();
  const field = fields.find((f)=> getFieldId(f) === fieldId);
  if (!field) { state.fieldId=null; return renderCustomerFilePremium(); }

  const customers = await listCustomers();
  const customer = customers.find(c=> getCustomerId(c) === (field.customer_id || field.customerId));

  const jobs = await fetchAllJobsSafe();
  const jobsForField = jobs.filter((j)=> (j.field_id || j.fieldId) === fieldId);

  // Sort: open-like first, finished last, newest -> oldest inside groups
  const rank = (j)=>{
    const k = jobStatusKey(j);
    if (k==='open') return 0;
    if (k==='in_progress') return 1;
    if (k==='paused') return 2;
    return 3;
  };
  jobsForField.sort((a,b)=>{
    const ra=rank(a), rb=rank(b);
    if (ra!==rb) return ra-rb;
    const ta = new Date(a.created_at || a.createdAt || a.inserted_at || 0).getTime();
    const tb = new Date(b.created_at || b.createdAt || b.inserted_at || 0).getTime();
    return tb-ta;
  });

  viewTitle.textContent = field.name || 'Field';
  viewSubtitle.textContent = customer ? `Customer: ${customer.name}` : 'Field file';
  viewActions.innerHTML = '';

  const header = document.createElement('div');
  header.className='card section-stack';

  const headRow = document.createElement('div');
  headRow.className='detail-head';

  const left = document.createElement('div');
  left.className='detail-left';
  left.innerHTML = `
    <div class="detail-title">${field.name || 'Field'}</div>
    <div class="detail-sub muted">${[field.brand, field.power_source].filter(Boolean).join(' • ')}</div>
  `;

  const actions = document.createElement('div');
  actions.className='detail-actions';

  const back = document.createElement('button'); back.className='secondary'; back.type='button'; back.textContent='Back';
  back.addEventListener('click', async ()=>{ state.fieldId=null; await renderCustomerFilePremium(); });

  const edit = document.createElement('button'); edit.className='secondary'; edit.type='button'; edit.textContent='Edit';
  const del = document.createElement('button'); del.className='danger'; del.type='button'; del.textContent='Delete';

  actions.append(edit, del, back);
  headRow.append(left, actions);
  header.append(headRow);

 const fieldInfoGrid = document.createElement('div');
  fieldInfoGrid.className = 'info-grid';
  const FIELD_INFO = [
    { label: 'Brand', keys: ['brand'] },
    { label: 'Power Source', keys: ['power_source'] },
    { label: 'Serial Number', keys: ['serial_number', 'serial'] },
    { label: 'Tower Count', keys: ['tower_count'] },
    { label: 'Lat', keys: ['lat', 'latitude'] },
    { label: 'Lon', keys: ['lon', 'Longitude'] },
    { label: 'Sprinkler Package #', keys: ['sprinkler_package', 'sprinkler_package_number', 'sprinkler_package_no'] },
    { label: 'Telemetry Make', keys: ['telemetry_make'] },
    { label: 'Telemetry Serial', keys: ['telemetry_serial'] },
  ];

  const fieldValueFor = (keys) => {
    for (const key of keys) {
      if (field && field[key] !== undefined && field[key] !== null && String(field[key]).length) {
        return String(field[key]);
      }
    }
    return '';
  };

  FIELD_INFO.forEach(({ label, keys }) => {
    const item = document.createElement('div');
    item.className = 'info-item';
    const lab = document.createElement('div');
    lab.className = 'info-label';
    lab.textContent = label;
    const val = document.createElement('div');
    val.className = 'info-val';
    val.textContent = fieldValueFor(keys);
    item.append(lab, val);
    fieldInfoGrid.appendChild(item);
  });

  header.append(fieldInfoGrid);

  const jobsCard = document.createElement('div');
  jobsCard.className='card section-stack';
  jobsCard.appendChild(elTag('div',{className:'section-title', text:'Jobs for this Field'}));
  const list = document.createElement('div'); list.className='list';
  jobsCard.appendChild(list);

  for (const j of jobsForField){
    const status = jobStatusKey(j);
    const btn = document.createElement('button');
    btn.type='button';
    btn.className='pill job-row';
    btn.innerHTML = `
      <div class="row-main">
        <div class="row-title">${j.title || j.description || j.job_id || j.id || 'Job'}</div>
        <div class="row-sub muted">${(j.status || '').replaceAll('_',' ')}</div>
      </div>
      <div class="row-meta">
        <span class="badge" data-status="${j.status || status}">${status.replace('_',' ')}</span>
      </div>
    `;
    openJobDetailModal(j, null, { onRefresh: renderFieldFilePremium});
    list.appendChild(btn);
  }

  // Edit field modal
  edit.addEventListener('click', ()=>{
    const body=document.createElement('div'); body.className='section-stack';
    const form=document.createElement('div'); form.className='form-grid';
    const fieldsDef = Object.keys(field || {}).filter((k) => ![
      'created_at',
      'updated_at',
      'id',
      'org_id',
      'field_id',
      'customer_id',
    ].includes(k));
    const inputs={};
    fieldsDef.forEach((k)=>{
      const label = prettyLabel(k);
      const wrap=document.createElement('div');
      const lab=document.createElement('label'); lab.textContent=label;
      const inp = (k==='additional_info') ? document.createElement('textarea') : document.createElement('input');
      inp.value = (field[k]||''); inp.placeholder=label;
      inputs[k]=inp; wrap.append(lab, inp); form.appendChild(wrap);
    });
    const foot=document.createElement('div'); foot.className='modal-foot';
    const cancel=document.createElement('button'); cancel.className='secondary'; cancel.type='button'; cancel.textContent='Cancel';
    const save=document.createElement('button'); save.className='action'; save.type='button'; save.textContent='Save';
    foot.append(cancel, save);
    body.append(form, foot);
    const {close}=openModalSimple({title:'Edit Field', bodyEl: body});
    cancel.addEventListener('click', ()=>close());
    save.addEventListener('click', async ()=>{
      const payload = {};
      fieldsDef.forEach((k)=>{ if(inputs[k]) payload[k]=inputs[k].value.trim(); });
      if(!payload.name) return showToast('Field name is required.');
      try{
        await updateField(fieldId, payload);
        await refreshBoot();
        close();
        await renderFieldFilePremium();
      }catch(e){ showToast(e.message); }
    });
  });

  // Delete field
  del.addEventListener('click', ()=>{
    const body=document.createElement('div'); body.className='section-stack';
    body.appendChild(elTag('div',{className:'muted', text:'Delete this field? This cannot be undone.'}));
    const foot=document.createElement('div'); foot.className='modal-foot';
    const cancel=document.createElement('button'); cancel.className='secondary'; cancel.type='button'; cancel.textContent='Cancel';
    const confirm=document.createElement('button'); confirm.className='danger'; confirm.type='button'; confirm.textContent='Delete';
    foot.append(cancel, confirm);
    body.appendChild(foot);
    const {close}=openModalSimple({title:'Delete Field', bodyEl: body});
    cancel.addEventListener('click', ()=>close());
    confirm.addEventListener('click', async ()=>{
      try{
        await deleteField(fieldId);
        await refreshBoot();
        close();
        state.fieldId=null;
        await renderCustomerFilePremium();
      }catch(e){ showToast(e.message); }
    });
  });

  viewContainer.innerHTML='';
  const stack=document.createElement('div'); stack.className='section-stack';
  stack.append(header, jobsCard);
  viewContainer.appendChild(stack);
}

async function renderTrucksPremium() {
  state.truckId = null;
  viewTitle.textContent = 'Trucks';
  viewSubtitle.textContent = 'Manage truck profiles and lists.';
  viewActions.innerHTML = '';

  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.textContent = '+ Add Truck';
  viewActions.appendChild(addBtn);

  const trucks = await listTrucks();

  const card = document.createElement('div');
  card.className = 'card section-stack';
  const head = document.createElement('div');
  head.className = 'section-title';
  head.textContent = 'Truck List';

  const search = document.createElement('input');
  search.className = 'search';
  search.type = 'search';
  search.placeholder = 'Search trucks…';

  const list = document.createElement('div');
  list.className = 'list';

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    const filtered = trucks.filter((truck) => {
      if (!q) return true;
      const hay = [truck.truck_identifier, truck.notes, truck.odometer].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (!filtered.length) {
      list.appendChild(elTag('div', { className: 'muted', text: 'No trucks found.' }));
      return;
    }
    filtered.forEach((truck) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pill truck-row';
      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">${truck.truck_identifier || 'Truck'}</div>
          <div class="row-sub muted">${truck.notes || 'No notes'}</div>
        </div>
        <div class="row-meta">
          <span class="badge">${truck.odometer || '—'} mi</span>
        </div>
      `;
      row.addEventListener('click', async () => {
        state.truckId = getId(truck);
        await renderTruckFilePremium();
      });
      list.appendChild(row);
    });
  };

  search.addEventListener('input', renderList);

  addBtn.addEventListener('click', () => {
    const body = document.createElement('div');
    body.className = 'section-stack';
    const form = document.createElement('div');
    form.className = 'form-grid';
    const fields = [
      ['truck_identifier', 'Truck ID'],
      ['odometer', 'Current Odometer Reading'],
      ['notes', 'Notes'],
    ];
    const inputs = {};
    fields.forEach(([k, label]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = label;
      const inp = k === 'notes' ? document.createElement('textarea') : document.createElement('input');
      inp.placeholder = label;
      if (k === 'odometer') inp.type = 'number';
      inputs[k] = inp;
      wrap.append(lab, inp);
      form.appendChild(wrap);
    });
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.className = 'action';
    save.type = 'button';
    save.textContent = 'Save';
    foot.append(cancel, save);
    body.append(form, foot);
    const { close } = openModalSimple({ title: 'Add Truck', bodyEl: body });
    cancel.addEventListener('click', () => close());
    save.addEventListener('click', async () => {
      const payload = {
        truck_identifier: inputs.truck_identifier.value.trim(),
        odometer: inputs.odometer.value.trim(),
        notes: inputs.notes.value.trim(),
      };
      if (!payload.truck_identifier) return showToast('Truck ID is required.');
      try {
        await createTruck(payload);
        await refreshBoot();
        close();
        await renderTrucksPremium();
      } catch (e) {
        showToast(e.message);
      }
    });
  });

  card.append(head, search, list);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(card);
  renderList();
}

async function renderTruckFilePremium() {
  const truckId = state.truckId;
  if (!truckId) return renderTrucksPremium();

  const trucks = await listTrucks();
  const truck = trucks.find((t) => getId(t) === truckId);
  if (!truck) {
    state.truckId = null;
    return renderTrucksPremium();
  }

  const [toolList, inventoryList] = await Promise.all([
    listTruckTools(truckId),
    listTruckInventory(truckId),
  ]);

  viewTitle.textContent = truck.truck_identifier || 'Truck';
  viewSubtitle.textContent = `Truck file • ${toolList.length} tool(s) • ${inventoryList.length} part(s)`;
  viewActions.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'card section-stack';
  const headRow = document.createElement('div');
  headRow.className = 'detail-head';
  const left = document.createElement('div');
  left.className = 'detail-left';
  left.innerHTML = `
    <div class="detail-title">${truck.truck_identifier || 'Truck'}</div>
    <div class="detail-sub muted">${truck.odometer ? `${truck.odometer} mi` : 'No odometer'}${truck.notes ? ` • ${truck.notes}` : ''}</div>
  `;

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  const edit = document.createElement('button');
  edit.className = 'secondary';
  edit.type = 'button';
  edit.textContent = 'Edit';
  const back = document.createElement('button');
  back.className = 'secondary';
  back.type = 'button';
  back.textContent = 'Back';
  back.addEventListener('click', renderTrucksPremium);
  actions.append(edit, back);
  headRow.append(left, actions);
  header.appendChild(headRow);

  const infoCard = document.createElement('div');
  infoCard.className = 'card info-card';
  infoCard.appendChild(renderInfoGrid(truck, { hideKeys: ['id', 'org_id', 'created_at', 'updated_at'] }));

  const listsCard = document.createElement('div');
  listsCard.className = 'card section-stack';
  listsCard.appendChild(elTag('div', { className: 'section-title', text: 'Truck Lists' }));
  const lists = document.createElement('div');
  lists.className = 'list';

  const toolBtn = document.createElement('button');
  toolBtn.type = 'button';
  toolBtn.className = 'pill list-row';
  toolBtn.innerHTML = `
    <div class="row-main">
      <div class="row-title">Tool List</div>
      <div class="row-sub muted">Tools assigned to this truck.</div>
    </div>
    <div class="row-meta"><span class="badge">${toolList.length}</span></div>
  `;
  toolBtn.addEventListener('click', async () => {
    await renderTruckListView(truck, 'tools');
  });

  const inventoryBtn = document.createElement('button');
  inventoryBtn.type = 'button';
  inventoryBtn.className = 'pill list-row';
  inventoryBtn.innerHTML = `
    <div class="row-main">
      <div class="row-title">Truck Inventory</div>
      <div class="row-sub muted">Parts stocked on this truck.</div>
    </div>
    <div class="row-meta"><span class="badge">${inventoryList.length}</span></div>
  `;
  inventoryBtn.addEventListener('click', async () => {
    await renderTruckListView(truck, 'inventory');
  });

  lists.append(toolBtn, inventoryBtn);
  listsCard.appendChild(lists);

  if (!toolList.length || !inventoryList.length) {
    const createBtn = document.createElement('button');
    createBtn.className = 'action';
    createBtn.type = 'button';
    createBtn.textContent = 'Create List';
    createBtn.addEventListener('click', () => {
      const body = document.createElement('div');
      body.className = 'section-stack';
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.textContent = 'Choose which list you want to create for this truck.';
      const choices = document.createElement('div');
      choices.className = 'form-grid';
      const toolChoice = document.createElement('button');
      toolChoice.className = 'pill';
      toolChoice.type = 'button';
      toolChoice.textContent = 'Tool List';
      toolChoice.disabled = toolList.length > 0;
      const invChoice = document.createElement('button');
      invChoice.className = 'pill';
      invChoice.type = 'button';
      invChoice.textContent = 'Truck Inventory';
      invChoice.disabled = inventoryList.length > 0;
      choices.append(toolChoice, invChoice);
      body.append(hint, choices);
      const { close } = openModalSimple({ title: 'Create List', bodyEl: body });
      toolChoice.addEventListener('click', async () => {
        close();
        await renderTruckListView(truck, 'tools');
      });
      invChoice.addEventListener('click', async () => {
        close();
        await renderTruckListView(truck, 'inventory');
      });
    });
    listsCard.appendChild(createBtn);
  }

  edit.addEventListener('click', () => {
    const body = document.createElement('div');
    body.className = 'section-stack';
    const form = document.createElement('div');
    form.className = 'form-grid';
    const fields = [
      ['truck_identifier', 'Truck ID'],
      ['odometer', 'Current Odometer Reading'],
      ['notes', 'Notes'],
    ];
    const inputs = {};
    fields.forEach(([k, label]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = label;
      const inp = k === 'notes' ? document.createElement('textarea') : document.createElement('input');
      if (k === 'odometer') inp.type = 'number';
      inp.value = truck[k] ?? '';
      inputs[k] = inp;
      wrap.append(lab, inp);
      form.appendChild(wrap);
    });
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.className = 'action';
    save.type = 'button';
    save.textContent = 'Save';
    foot.append(cancel, save);
    body.append(form, foot);
    const { close } = openModalSimple({ title: 'Edit Truck', bodyEl: body });
    cancel.addEventListener('click', () => close());
    save.addEventListener('click', async () => {
      const payload = {
        truck_identifier: inputs.truck_identifier.value.trim(),
        odometer: inputs.odometer.value.trim(),
        notes: inputs.notes.value.trim(),
      };
      if (!payload.truck_identifier) return showToast('Truck ID is required.');
      try {
        await updateTruck(truckId, payload);
        await refreshBoot();
        close();
        await renderTruckFilePremium();
      } catch (e) {
        showToast(e.message);
      }
    });
  });

  viewContainer.innerHTML = '';
  const stack = document.createElement('div');
  stack.className = 'section-stack';
  stack.append(header, infoCard, listsCard);
  viewContainer.appendChild(stack);
}

async function renderTruckListView(truck, listType) {
  const truckId = getId(truck);
  if (!truckId) return renderTrucksPremium();

  const isInventory = listType === 'inventory';
  const listName = isInventory ? 'Truck Inventory' : 'Tool List';
  const items = isInventory ? await listTruckInventory(truckId) : await listTruckTools(truckId);

  const toolNameMap = new Map(state.boot?.tools?.map((tool) => [tool.name, tool]) || []);
  const draft = isInventory ? [] : items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    tool_id: item.tool_id || item.tools?.id || toolNameMap.get(item.tool_name)?.id,
    tool_name: item.tool_name || item.tools?.name,
    name: item.products?.name || item.tools?.name || item.tool_name || item.product_id,
    qty: Number(item.qty ?? 0),
  }));
  const deletedIds = new Set();

  viewTitle.textContent = listName;
  viewSubtitle.textContent = `Truck: ${truck.truck_identifier || ''}`;
  viewActions.innerHTML = '';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'action';
  saveBtn.textContent = 'Save List';
  const addBtn = document.createElement('button');
  addBtn.className = 'pill';
  addBtn.textContent = isInventory ? '+ Add Part' : '+ Add Tool';
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderTruckFilePremium);
 if (isInventory) {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'pill';
    exportBtn.textContent = 'Export Template';
    const importInput = document.createElement('input');
    importInput.type = 'file';
     importInput.accept = '.csv,.xlsx,.xls';
    const importFields = [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Part Name' },
      { key: 'min_qty', label: 'Minimum Qty' },
    ];
    exportBtn.addEventListener('click', () => exportCsvTemplate('truck-inventory-template', importFields));
    importInput.addEventListener('change', (event) => handleInventoryImportCsv(event, truck, items));
    viewActions.append(addBtn, exportBtn, importInput, backBtn);
  } else {
    viewActions.append(saveBtn, addBtn, backBtn);
  }

  const container = document.createElement('div');
  container.className = 'section-stack';
  const infoCard = document.createElement('div');
  infoCard.className = 'card info-card';
  infoCard.appendChild(renderInfoGrid(truck, { hideKeys: ['id', 'org_id', 'created_at', 'updated_at'] }));

  const listCard = document.createElement('div');
  listCard.className = 'card section-stack';
  listCard.appendChild(elTag('div', { className: 'section-title', text: `${listName} Items` }));
  const list = document.createElement('div');
  list.className = 'list';
  listCard.appendChild(list);

  const renderInventoryList = () => {
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(elTag('div', { className: 'muted', text: 'No parts added yet.' }));
      return;
    }
    items.forEach((item) => {
      const part = item.products || {};
      const minQty = Number(item.min_qty ?? part.minimum_qty ?? 0);
      const row = document.createElement('button');
      row.className = 'pill inventory-row';
      row.type = 'button';
      row.innerHTML = `
        <div class="inventory-main">
          <div class="inventory-name">${escapeHtml(part.name || 'Part')}</div>
          <div class="inventory-sku">${escapeHtml(part.sku || 'SKU N/A')}</div>
        </div>
        <div class="inventory-meta">
          <span class="qty-pill">
            <span class="pill-label">Min</span>
            <span class="pill-num">${minQty || 0}</span>
          </span>
          <span class="qty-pill">
            <span class="pill-label">On Truck</span>
            <span class="pill-num">${Number(item.qty ?? 0)}</span>
          </span>
        </div>
      `;
      row.addEventListener('click', () => openInventoryPartModal(item));
      list.appendChild(row);
    });
  };

  const openInventoryPartModal = (item) => {
    const part = item.products || {};
    const body = document.createElement('div');
    body.className = 'section-stack';
    const info = document.createElement('div');
    info.className = 'card';
    info.innerHTML = `
      <div class="detail-title">${escapeHtml(part.name || 'Part')}</div>
      <div class="muted">${escapeHtml(part.sku || 'SKU N/A')}</div>
      <div>${escapeHtml(part.description || 'No description provided.')}</div>
      <div class="muted">Shelf: ${escapeHtml(part.shelf || 'Unassigned')}</div>
      <div class="muted">Current on Truck: ${Number(item.qty ?? 0)}</div>
    `;
    const form = document.createElement('div');
    form.className = 'form-grid';
    const minWrap = document.createElement('div');
    const minLabel = document.createElement('label');
    minLabel.textContent = 'Minimum Qty';
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.min = '0';
    minInput.value = Number(item.min_qty ?? part.minimum_qty ?? 0);
    if ((item.origin || 'permanent') === 'tech_added') {
      minInput.disabled = true;
    }
    minWrap.append(minLabel, minInput);
    form.appendChild(minWrap);
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'secondary';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'action';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    if ((item.origin || 'permanent') === 'tech_added') {
      saveBtn.disabled = true;
    }
    foot.append(removeBtn, cancelBtn, saveBtn);
    body.append(info, form, foot);
    const { close } = openModalSimple({ title: 'Truck Inventory Part', bodyEl: body });
    cancelBtn.addEventListener('click', close);
    removeBtn.addEventListener('click', async () => {
      if (!confirm('Remove this part from the truck inventory list?')) return;
      try {
        await deleteTruckInventory(item.id);
        showToast('Part removed.');
        close();
        await renderTruckListView(truck, 'inventory');
      } catch (error) {
        showToast(error.message);
      }
    });
    saveBtn.addEventListener('click', async () => {
      const minQty = Number(minInput.value || 0);
      if (Number.isNaN(minQty) || minQty < 0) {
        showToast('Minimum quantity must be 0 or higher.');
        return;
      }
      try {
        await updateTruckInventory(item.id, { min_qty: minQty, origin: 'permanent' });
        showToast('Minimum quantity updated.');
        close();
        await renderTruckListView(truck, 'inventory');
      } catch (error) {
        showToast(error.message);
      }
    });
  };

  function renderDraft() {
    list.innerHTML = '';
    if (!draft.length) {
      list.appendChild(elTag('div', { className: 'muted', text: `No ${isInventory ? 'parts' : 'tools'} added yet.` }));
      return;
    }
    draft.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'pill list-row';
      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">${item.name || (isInventory ? 'Part' : 'Tool')}</div>
          <div class="row-sub muted">${isInventory ? 'Minimum Qty' : 'Qty'}: ${item.qty || 0}</div>
        </div>
        <div class="row-meta">
          <button class="pill-x" type="button" aria-label="Remove">✕</button>
        </div>
      `;
      row.querySelector('.pill-x').addEventListener('click', () => {
        if (item.id) deletedIds.add(item.id);
        draft.splice(index, 1);
        renderDraft();
      });
      list.appendChild(row);
    });
  }

  addBtn.addEventListener('click', () => {
    const body = document.createElement('div');
    body.className = 'section-stack';
    const form = document.createElement('div');
    form.className = 'form-grid';
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.className = 'action';
    save.type = 'button';
    save.textContent = 'Save';
    foot.append(cancel, save);

    let primaryInput;
    let qtyInput;
    if (isInventory) {
      const label = document.createElement('label');
      label.textContent = 'Product';
      primaryInput = document.createElement('input');
      primaryInput.setAttribute('list', 'product-options');
      const dataList = document.createElement('datalist');
      dataList.id = 'product-options';
      const productMap = new Map();
      state.boot.products.forEach((product) => {
        const option = document.createElement('option');
        const labelText = `${product.name}${product.sku ? ` (${product.sku})` : ''}`;
        option.value = labelText;
        dataList.appendChild(option);
        productMap.set(labelText, product);
      });
      const wrap = document.createElement('div');
      wrap.append(label, primaryInput, dataList);
      const qtyLabel = document.createElement('label');
      qtyLabel.textContent = 'Minimum Quantity';
      qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '0';
      const qtyWrap = document.createElement('div');
      qtyWrap.append(qtyLabel, qtyInput);
      form.append(wrap, qtyWrap);
      body.append(form, foot);
      const { close } = openModalSimple({ title: 'Add Part', bodyEl: body });
      cancel.addEventListener('click', () => close());
      save.addEventListener('click', async () => {
        const labelText = primaryInput.value.trim();
        const product = productMap.get(labelText);
        if (!product) return showToast('Select a valid product.');
       const minQty = Number(qtyInput.value || 0);
        if (Number.isNaN(minQty) || minQty < 0) return showToast('Minimum quantity is required.');
        const existing = items.find((item) => item.product_id === product.id);
        const qty = existing?.qty ?? 0;
        try {
          await upsertTruckInventory({
            truck_id: truckId,
            product_id: product.id,
            qty,
            min_qty: minQty,
            origin: 'permanent',
          });
          showToast('Part added.');
          close();
          await renderTruckListView(truck, 'inventory');
        } catch (error) {
          showToast(error.message);
        }
        
      });
      return;
    }

    const label = document.createElement('label');
  label.textContent = 'Tool';
    primaryInput = document.createElement('select');
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'Select a tool';
    primaryInput.appendChild(placeholderOption);
    state.boot.tools.forEach((tool) => {
      const option = document.createElement('option');
      option.value = tool.id;
      option.textContent = tool.name;
      primaryInput.appendChild(option);
    });
    const qtyLabel = document.createElement('label');
    qtyLabel.textContent = 'Quantity';
    qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '0';
    const wrap = document.createElement('div');
    wrap.append(label, primaryInput);
    const qtyWrap = document.createElement('div');
    qtyWrap.append(qtyLabel, qtyInput);
    form.append(wrap, qtyWrap);
    body.append(form, foot);
    const { close } = openModalSimple({ title: 'Add Tool', bodyEl: body });
    cancel.addEventListener('click', () => close());
    save.addEventListener('click', () => {
       const toolId = primaryInput.value;
      const tool = toolIdMap.get(toolId);
      const qty = Number(qtyInput.value || 0);
     if (!toolId) return showToast('Tool selection is required.');
      if (!tool) return showToast('Select a valid tool.');
      if (!qty) return showToast('Quantity is required.');
       draft.push({ tool_id: tool.id, tool_name: tool.name, name: tool.name, qty });
      if (existing) {
        existing.qty += qty;
      } else {
        draft.push({ tool_name: name, name, qty });
      }
      close();
      renderDraft();
    });
  });

  saveBtn.addEventListener('click', async () => {
    try {
      if (isInventory) {
        await Promise.all([
          ...Array.from(deletedIds).map((id) => deleteTruckInventory(id)),
          ...draft.map((item) =>
            upsertTruckInventory({
              truck_id: truckId,
              product_id: item.product_id,
              qty: item.qty,
            })
          ),
        ]);
      } else {
          for (const item of draft) {
          if (!item.tool_id && item.tool_name) {
            item.tool_id = toolNameMap.get(item.tool_name)?.id;
          }
          if (!item.tool_id) {
            showToast('Each tool must be selected from the tool list.');
            return;
          }
        }
        await Promise.all([
          ...Array.from(deletedIds).map((id) => deleteTruckTool(id)),
          ...draft.map((item) => {
            if (item.id) {
              return updateTruckTool(item.id, {
                tool_id: item.tool_id,
                tool_name: item.tool_name,
                qty: item.qty,
                truck_id: truckId,
              });
            }
           return addTruckTool({
              truck_id: truckId,
              tool_id: item.tool_id,
              tool_name: item.tool_name,
              qty: item.qty,
            });
          }),
        ]);
      }
      showToast('List saved.');
      await refreshBoot();
      await renderTruckListView(truck, listType);
    } catch (e) {
      showToast(e.message);
    }
  });

 if (isInventory) {
  renderInventoryList();
 }else {
  renderDraft();
 }
 
  container.append(infoCard, listCard);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);
}
function loadStoredList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Storage parse error', error);
    return [];
  }
}

function saveStoredList(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours) return `${hours}h ${remainder}m`;
  return `${remainder}m`;
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString();
}

function filterEventsByDate(events, range) {
  if (!range?.start && !range?.end) return events;
  const start = range.start ? new Date(range.start).getTime() : null;
  const end = range.end ? new Date(range.end).getTime() : null;
  return events.filter((event) => {
    const startedAt = new Date(event.startedAt).getTime();
    if (Number.isNaN(startedAt)) return false;
    if (start && startedAt < start) return false;
    if (end && startedAt > end) return false;
    return true;
  });
}

  function renderReports() {
  renderReportPicker();
}

function renderReportPicker() {
  viewTitle.textContent = 'Reports';
  viewSubtitle.textContent = 'Select a report, ten set filters to view data.';
  viewActions.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'section-stack';
 const card = document.createElement('div');
  card.className = 'card section-stack';
  card.innerHTML = '<h3>Reports</h3><div class="muted">Choose a report to open filters.</div>';
const list = document.createElement('div');
  list.className = 'list';
[
    {
      id: 'time-status',
      title: 'Time Status',
      description: 'Filter tech time status totals by tech, helper, status, and date.',
    },
    {
      id: 'inventory',
      title: 'Inventory',
      description: 'Review inventory count events and resolved items.',
    },
    {
      id: 'receipts',
      title: 'Receipt Decisions',
      description: 'See approved and denied receipt totals.',
    },
  ].forEach((report) => {
    const pill = document.createElement('button');
    pill.className = 'pill list-row';
    pill.type = 'button';
    pill.innerHTML = `
      <div class="row-main">
        <div class="row-title">${report.title}</div>
        <div class="row-sub muted">${report.description}</div>
      </div>
      <div class="row-meta">
        <span class="badge">Open</span>
      </div>
    `;
    pill.addEventListener('click', () => renderReportDetail(report.id));
    list.appendChild(pill);
  });
 card.appendChild(list);
  container.appendChild(card);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);
}
  async function renderReportDetail(reportId) {
  viewTitle.textContent = 'Reports';
  viewSubtitle.textContent = 'Adjust filters to view report data.';
  viewActions.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'pill tiny';
  backBtn.type = 'button';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderReportPicker);
  viewActions.appendChild(backBtn);

  const container = document.createElement('div');
  container.className = 'section-stack';
  
  const fieldWrap = (labelText, inputEl) => {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.append(label, inputEl);
    return wrap;
  };
  
  if (reportId === 'time-status') {
    const timeStatusCard = document.createElement('div');
    timeStatusCard.className = 'card section-stack';
    timeStatusCard.innerHTML = '<h3>Time Status</h3>';

    const events = loadStoredList(STORAGE_KEYS.timeStatus);
    const users = (state.boot?.users || []).slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    const helpers = Array.from(new Set(events.flatMap((event) => event.helpers || []))).sort();
    const statuses = Array.from(new Set(events.map((event) => event.status || '').filter(Boolean))).sort();

    const techSelect = document.createElement('select');
    techSelect.innerHTML = `<option value="">All Techs</option>${users.map((user) => `<option value="${user.id}">${escapeHtml(user.full_name || 'Tech')}</option>`).join('')}`;
    const helperSelect = document.createElement('select');
    helperSelect.innerHTML = `<option value="">All Helpers</option>${helpers.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    const statusSelect = document.createElement('select');
    statusSelect.innerHTML = `<option value="">All Statuses</option>${statuses.map((name) => `<option value="${escapeHtml(name)}">${statusLabel(name)}</option>`).join('')}`;

    const rangeSelect = document.createElement('select');
    rangeSelect.innerHTML = `
      <option value="ytd">Year-to-date</option>
      <option value="custom">Custom range</option>
    `;

    const startInput = document.createElement('input');
    startInput.type = 'date';
    const endInput = document.createElement('input');
    endInput.type = 'date';

    const now = new Date();
    startInput.value = formatDateInput(new Date(now.getFullYear(), 0, 1));
    endInput.value = formatDateInput(now);

    const timeResults = document.createElement('div');
    timeResults.className = 'section-stack';

    const updateTimeStatusResults = () => {
      const rangeType = rangeSelect.value;
      const range = rangeType === 'custom'
        ? { start: startInput.value, end: endInput.value }
        : { start: new Date(now.getFullYear(), 0, 1).toISOString(), end: now.toISOString() };

      const filtered = filterEventsByDate(events, range).filter((event) => {
        if (techSelect.value && event.techId !== techSelect.value) return false;
        if (helperSelect.value && !(event.helpers || []).includes(helperSelect.value)) return false;
        if (statusSelect.value && event.status !== statusSelect.value) return false;
        return true;
      });

      const totals = filtered.reduce((acc, event) => {
        const start = new Date(event.startedAt).getTime();
        const end = new Date(event.endedAt || Date.now()).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return acc;
        const seconds = Math.max(0, Math.floor((end - start) / 1000));
        const key = event.status || 'unknown';
        acc[key] = (acc[key] || 0) + seconds;
        return acc;
      }, {});

      const summary = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([status, totalSeconds]) => `
          <div class="pill">
            <div>
              <strong>${statusLabel(status)}</strong>
              <div class="muted">Total time</div>
            </div>
            <span class="badge">${formatElapsed(totalSeconds)}</span>
          </div>
        `)
        .join('');

      timeResults.innerHTML = summary || '<div class="muted">No time status entries for this filter.</div>';
    };

    [techSelect, helperSelect, statusSelect, rangeSelect, startInput, endInput].forEach((node) => {
      node.addEventListener('change', updateTimeStatusResults);
    });

    const filterRow = document.createElement('div');
    filterRow.className = 'form-grid';
    filterRow.append(
      fieldWrap('Tech', techSelect),
      fieldWrap('Helper', helperSelect),
      fieldWrap('Status', statusSelect),
      fieldWrap('Date Range', rangeSelect),
    );

    const rangeRow = document.createElement('div');
    rangeRow.className = 'form-grid';
    rangeRow.append(fieldWrap('Start', startInput), fieldWrap('End', endInput));

    timeStatusCard.append(filterRow, rangeRow, timeResults);
    container.appendChild(timeStatusCard);
    updateTimeStatusResults();
  }

  if (reportId === 'inventory') {
    const inventoryCard = document.createElement('div');
    inventoryCard.className = 'card section-stack';
    inventoryCard.innerHTML = '<h3>Inventory Events</h3>';
    const inventoryEvents = loadStoredList(STORAGE_KEYS.inventoryEvents);
    const inventoryResolved = loadStoredList(STORAGE_KEYS.inventoryResolved);

    const inventoryList = document.createElement('div');
    inventoryList.className = 'section-stack';

    if (!inventoryEvents.length) {
      inventoryList.innerHTML = '<div class="muted">No inventory events yet.</div>';
    } else {
      inventoryEvents.forEach((event) => {
        const eventBlock = document.createElement('div');
        eventBlock.className = 'card';
        const header = document.createElement('div');
        header.className = 'row space';
        header.innerHTML = `
          <div>
            <strong>Inventory Event</strong>
            <div class="muted">${formatDateTime(event.endedAt || event.startedAt)}</div>
          </div>
          <span class="badge">${event.counts?.length || 0} items</span>
        `;
        eventBlock.appendChild(header);
        const list = document.createElement('div');
        list.className = 'section-stack';
        (event.counts || []).forEach((count) => {
          if (count.resolvedAt) return;
          const row = document.createElement('label');
          row.className = 'pill';
          row.innerHTML = `
            <div>
              <strong>${escapeHtml(count.name || count.sku || 'Part')}</strong>
              <div class="muted">Physical: ${count.physicalQty ?? 0} • Counted ${formatDateTime(count.at)}</div>
            </div>
            <span class="badge">Resolve <input type="checkbox" data-session="${event.id}" data-bin="${count.binId}" /></span>
          `;
          list.appendChild(row);
        });
        eventBlock.appendChild(list);
        inventoryList.appendChild(eventBlock);
      });
    }

    inventoryCard.appendChild(inventoryList);
    container.appendChild(inventoryCard);

    const resolvedCard = document.createElement('div');
    resolvedCard.className = 'card section-stack';
    resolvedCard.innerHTML = '<h3>Inventory Resolved</h3>';

    const exportResolvedBtn = document.createElement('button');
    exportResolvedBtn.className = 'pill';
    exportResolvedBtn.textContent = 'Export CSV';
    exportResolvedBtn.addEventListener('click', () => {
      exportCsv(inventoryResolved, 'inventory-resolved', [
        { key: 'sku' },
        { key: 'name' },
        { key: 'physicalQty' },
        { key: 'countedAt' },
        { key: 'resolvedAt' },
      ]);
    });
    resolvedCard.appendChild(exportResolvedBtn);

    const resolvedList = document.createElement('div');
    resolvedList.className = 'section-stack';
    if (!inventoryResolved.length) {
      resolvedList.innerHTML = '<div class="muted">No resolved inventory items yet.</div>';
    } else {
      inventoryResolved.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'pill';
        row.innerHTML = `
          <div>
         <strong>${escapeHtml(item.name || item.sku || 'Part')}</strong>
            <div class="muted">Counted ${formatDateTime(item.countedAt)} • Resolved ${formatDateTime(item.resolvedAt)}</div>
          </div>
            <span class="badge">${item.physicalQty ?? 0}</span>
        `;
         resolvedList.appendChild(row);
      });
    }
    resolvedCard.appendChild(resolvedList);
    container.appendChild(resolvedCard);

    inventoryList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const target = event.target;
        if (!target.checked) return;
        const sessionId = target.dataset.session;
        const binId = target.dataset.bin;
        const eventIndex = inventoryEvents.findIndex((evt) => evt.id === sessionId);
        if (eventIndex < 0) return;
        const eventData = inventoryEvents[eventIndex];
        const item = (eventData.counts || []).find((count) => count.binId === binId);
        if (!item) return;
        item.resolvedAt = new Date().toISOString();
        const resolvedEntry = {
          id: `${sessionId}-${binId}-${Date.now()}`,
          sku: item.sku,
          name: item.name,
          physicalQty: item.physicalQty,
          countedAt: item.at,
          resolvedAt: item.resolvedAt,
          sessionId,
        };
        inventoryResolved.unshift(resolvedEntry);
        saveStoredList(STORAGE_KEYS.inventoryResolved, inventoryResolved);
        saveStoredList(STORAGE_KEYS.inventoryEvents, inventoryEvents);
        renderReportDetail('inventory');
      });
      eventBlock.appendChild(list);
      inventoryList.appendChild(eventBlock);
    });
  }

 if (reportId === 'receipts') {
    const receipts = await listReceipts();
    const approvedReceipts = receipts.filter((receipt) => receipt.status === 'approved');
    const deniedReceipts = receipts.filter((receipt) => receipt.status === 'denied');

    const receiptCard = document.createElement('div');
    receiptCard.className = 'card section-stack';
    receiptCard.innerHTML = '<h3>Receipt Decisions</h3>';
    const receiptLists = document.createElement('div');
    receiptLists.className = 'section-stack';
    const renderReceiptList = (title, items, badgeClass) => {
      const block = document.createElement('div');
      block.className = 'section-stack';
      const heading = document.createElement('div');
      heading.className = 'section-title';
      heading.textContent = title;
      block.appendChild(heading);
      if (!items.length) {
        block.innerHTML += '<div class="muted">No receipts yet.</div>';
        return block;
      }
      items.forEach((receipt) => {
        const row = document.createElement('div');
        row.className = 'pill list-row';
        const total = receipt.total_cost ? `$${Number(receipt.total_cost).toFixed(2)}` : '--';
        row.innerHTML = `
          <div class="row-main">
            <div class="row-title">${escapeHtml(receipt.receipt_type || 'Receipt')}</div>
            <div class="row-sub muted">${new Date(receipt.created_at).toLocaleString()}</div>
            <div class="row-sub">${escapeHtml(receipt.users?.full_name || receipt.tech_id || 'Tech')} • ${escapeHtml(receipt.trucks?.truck_identifier || receipt.truck_id || '--')}</div>
          </div>
          <div class="row-meta">
            <span class="badge ${badgeClass}">${total}</span>
          </div>
        `;
        block.appendChild(row);
      });
      return block;
    };

  receiptLists.append(
      renderReceiptList('Approved', approvedReceipts, 'success'),
      renderReceiptList('Denied', deniedReceipts, 'danger'),
    );
    receiptCard.appendChild(receiptLists);
    container.appendChild(receiptCard);
  }
 
  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);

}
function buildDiagnosticDefaultNode(type) {
  if (type === 'check') {
    return {
      what_to_check: '',
      how_to_check: '',
      attachments: [],
      readings: [],
      rollup_logic: 'all_good',
      rollup_custom: '',
      explanation_good: '',
      explanation_bad: '',
    };
  }
  if (type === 'repair') {
    return {
      repair_title: '',
      why_repair: '',
      attachments: [],
      recommended_tools: [],
      step_type: 'static',
      steps: [],
      sections: [],
      photos: { before: false, after: false },
    };
  }
  return {
    closure_reason: '',
    resolved: '',
    follow_up: '',
    notes_for_office: '',
  };
}

function hashWorkflowPayload(payload) {
  let hash = 0;
  const input = JSON.stringify(payload);
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `wf_${Math.abs(hash)}`;
}

async function renderDiagnosticsBuilder() {
  viewTitle.textContent = 'Diagnostics Workflow Builder';
  viewSubtitle.textContent = 'Create problem workflows, brand flows, and step-by-step diagnostics.';
  viewActions.innerHTML = '';

  const addWorkflowBtn = document.createElement('button');
  addWorkflowBtn.className = 'action';
  addWorkflowBtn.textContent = 'New Workflow';
  viewActions.appendChild(addWorkflowBtn);

  const wrapper = document.createElement('div');
  wrapper.className = 'grid-two';

  const listCard = document.createElement('div');
  listCard.className = 'card diagnostics-card';
  const builderCard = document.createElement('div');
  builderCard.className = 'card diagnostics-card';

  wrapper.append(listCard, builderCard);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(wrapper);

  const workflows = await listDiagnosticWorkflows();
  if (!state.diagnosticsBuilder.workflowId && workflows.length) {
    state.diagnosticsBuilder.workflowId = workflows[0].id;
  }

  const selectedWorkflow = workflows.find((wf) => wf.id === state.diagnosticsBuilder.workflowId) || workflows[0];

  const brands = selectedWorkflow ? await listDiagnosticWorkflowBrands(selectedWorkflow.id) : [];
  if (!state.diagnosticsBuilder.brandId && brands.length) {
    state.diagnosticsBuilder.brandId = brands[0].id;
  }
  const selectedBrand = brands.find((brand) => brand.id === state.diagnosticsBuilder.brandId) || brands[0];

  const nodes = selectedBrand ? await listDiagnosticNodes(selectedBrand.id) : [];
  const edges = selectedBrand ? await listDiagnosticEdges(selectedBrand.id) : [];
  const layouts = selectedBrand ? await listDiagnosticNodeLayouts(selectedBrand.id) : [];
  const layoutMap = new Map(layouts.map((layout) => [layout.node_id, layout]));

  const danglingNodes = new Set();
  const endNodeIds = new Set(nodes.filter((node) => node.node_type === 'end').map((node) => node.id));
  const edgesByFrom = new Map();
  edges.forEach((edge) => {
    const list = edgesByFrom.get(edge.from_node_id) || [];
    list.push(edge);
    edgesByFrom.set(edge.from_node_id, list);
  });

  const hasTerminalPath = (startId, visited = new Set()) => {
    if (endNodeIds.has(startId)) return true;
    if (visited.has(startId)) return false;
    visited.add(startId);
    const outgoing = edgesByFrom.get(startId) || [];
    if (!outgoing.length) return false;
    return outgoing.some((edge) => hasTerminalPath(edge.to_node_id, visited));
  };

  nodes.forEach((node) => {
    if (node.node_type === 'check') {
      const goodEdge = edges.find((edge) => edge.from_node_id === node.id && edge.condition === 'good');
      const badEdge = edges.find((edge) => edge.from_node_id === node.id && edge.condition === 'bad');
      if (!goodEdge || !badEdge) danglingNodes.add(node.id);
    }
    if (node.node_type === 'repair') {
      const nextEdge = edges.find((edge) => edge.from_node_id === node.id && edge.condition === 'next');
      if (!nextEdge) danglingNodes.add(node.id);
    }
    if (!hasTerminalPath(node.id)) danglingNodes.add(node.id);
  });

  const hasPostRepairVerification = edges.some((edge) => {
    if (edge.condition !== 'next') return false;
    const fromNode = nodes.find((node) => node.id === edge.from_node_id);
    const toNode = nodes.find((node) => node.id === edge.to_node_id);
    return fromNode?.node_type === 'repair' && toNode?.node_type === 'check';
  });

  const header = document.createElement('div');
  header.className = 'section-stack';
  header.innerHTML = `
    <div class="section-title">Problems</div>
    <div class="muted small">Add a problem, then add brand flows for each product line.</div>
  `;

  const workflowList = document.createElement('div');
  workflowList.className = 'list';
  workflows.forEach((workflow) => {
    const row = document.createElement('button');
    row.className = 'pill list-row';
    if (workflow.id === selectedWorkflow?.id) row.classList.add('active');
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(workflow.title || 'Untitled Problem')}</div>
        <div class="row-sub muted">Updated ${new Date(workflow.updated_at || workflow.created_at).toLocaleDateString()}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      state.diagnosticsBuilder.workflowId = workflow.id;
      state.diagnosticsBuilder.brandId = null;
      state.diagnosticsBuilder.nodeId = null;
      renderDiagnosticsBuilder();
    });
    workflowList.appendChild(row);
  });

  const workflowActions = document.createElement('div');
  workflowActions.className = 'actions';
  const editWorkflowBtn = document.createElement('button');
  editWorkflowBtn.className = 'pill';
  editWorkflowBtn.textContent = 'Edit Problem';
  editWorkflowBtn.disabled = !selectedWorkflow;
  const duplicateWorkflowBtn = document.createElement('button');
  duplicateWorkflowBtn.className = 'pill';
  duplicateWorkflowBtn.textContent = 'Duplicate';
  duplicateWorkflowBtn.disabled = !selectedWorkflow;
  const deleteWorkflowBtn = document.createElement('button');
  deleteWorkflowBtn.className = 'pill danger';
  deleteWorkflowBtn.textContent = 'Delete';
  deleteWorkflowBtn.disabled = !selectedWorkflow;
 workflowActions.append(editWorkflowBtn, duplicateWorkflowBtn, deleteWorkflowBtn);

  listCard.append(header, workflowList, workflowActions);

  const brandSection = document.createElement('div');
  brandSection.className = 'section-stack';
  brandSection.innerHTML = `
    <div class="section-title">Brands</div>
    <div class="muted small">Create brand-specific flows under the same problem.</div>
  `;

  const brandList = document.createElement('div');
  brandList.className = 'list';
  brands.forEach((brand) => {
    const row = document.createElement('button');
    row.className = 'pill list-row';
    if (brand.id === selectedBrand?.id) row.classList.add('active');
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(brand.brand_name || 'Brand')}</div>
        <div class="row-sub muted">${brand.status === 'published' ? 'Published' : 'Draft'}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      state.diagnosticsBuilder.brandId = brand.id;
      state.diagnosticsBuilder.nodeId = null;
      renderDiagnosticsBuilder();
    });
    brandList.appendChild(row);
  });

  const brandActions = document.createElement('div');
  brandActions.className = 'actions';
  const addBrandBtn = document.createElement('button');
  addBrandBtn.className = 'pill';
  addBrandBtn.textContent = 'Add Brand';
  addBrandBtn.disabled = !selectedWorkflow;
  const deleteBrandBtn = document.createElement('button');
  deleteBrandBtn.className = 'pill danger';
  deleteBrandBtn.textContent = 'Delete Brand';
  deleteBrandBtn.disabled = !selectedBrand;
  brandActions.append(addBrandBtn, deleteBrandBtn);

  listCard.append(brandSection, brandList, brandActions);

  addWorkflowBtn.addEventListener('click', () => {
    const body = document.createElement('div');
    body.className = 'section-stack';
    body.innerHTML = `
      <label>Problem Title</label>
      <input id="workflow-title" placeholder="No power in the MCP" />
      <div class="actions">
        <button class="action" id="save-workflow">Create</button>
      </div>
    `;
    const { close } = openModalSimple({ title: 'Create Workflow', bodyEl: body });
    body.querySelector('#save-workflow').addEventListener('click', async () => {
      const title = body.querySelector('#workflow-title').value.trim();
      if (!title) {
        showToast('Enter a problem title.');
        return;
      }
      const workflow = await createDiagnosticWorkflow({ title });
      state.diagnosticsBuilder.workflowId = workflow.id;
      state.diagnosticsBuilder.brandId = null;
      state.diagnosticsBuilder.nodeId = null;
      close();
      renderDiagnosticsBuilder();
    });
  });

  editWorkflowBtn.addEventListener('click', () => {
    if (!selectedWorkflow) return;
    const body = document.createElement('div');
    body.className = 'section-stack';
    body.innerHTML = `
      <label>Problem Title</label>
      <input id="workflow-title" value="${escapeHtml(selectedWorkflow.title || '')}" />
      <div class="actions">
        <button class="action" id="save-workflow">Save</button>
      </div>
    `;
    const { close } = openModalSimple({ title: 'Edit Workflow', bodyEl: body });
    body.querySelector('#save-workflow').addEventListener('click', async () => {
      const title = body.querySelector('#workflow-title').value.trim();
      if (!title) {
        showToast('Enter a problem title.');
        return;
      }
      await updateDiagnosticWorkflow(selectedWorkflow.id, { title });
      close();
      renderDiagnosticsBuilder();
    });
  });

   duplicateWorkflowBtn.addEventListener('click', async () => {
    if (!selectedWorkflow) return;
    const copyTitle = `${selectedWorkflow.title || 'Workflow'} (Copy)`;
    const created = await createDiagnosticWorkflow({ title: copyTitle });
    const sourceBrands = await listDiagnosticWorkflowBrands(selectedWorkflow.id);
    for (const brand of sourceBrands) {
      const newBrand = await createDiagnosticWorkflowBrand({
        workflow_id: created.id,
        brand_name: brand.brand_name,
        status: 'draft',
        pre_work_instructions: brand.pre_work_instructions || '',
      });
      const [sourceNodes, sourceEdges] = await Promise.all([
        listDiagnosticNodes(brand.id),
        listDiagnosticEdges(brand.id),
      ]);
      const idMap = new Map();
      for (const node of sourceNodes) {
        const inserted = await createDiagnosticNode({
          brand_id: newBrand.id,
          node_type: node.node_type,
          title: node.title,
          payload: node.payload,
        });
        idMap.set(node.id, inserted.id);
      }
      for (const edge of sourceEdges) {
        await createDiagnosticEdge({
          brand_id: newBrand.id,
          from_node_id: idMap.get(edge.from_node_id),
          to_node_id: idMap.get(edge.to_node_id),
          condition: edge.condition,
        });
      }
    }
    state.diagnosticsBuilder.workflowId = created.id;
    state.diagnosticsBuilder.brandId = null;
    state.diagnosticsBuilder.nodeId = null;
    showToast('Workflow duplicated.');
    renderDiagnosticsBuilder();
  });

  deleteWorkflowBtn.addEventListener('click', async () => {
    if (!selectedWorkflow) return;
    if (!confirm('Delete this workflow and all brand flows?')) return;
    await deleteDiagnosticWorkflow(selectedWorkflow.id);
    state.diagnosticsBuilder.workflowId = null;
    state.diagnosticsBuilder.brandId = null;
    state.diagnosticsBuilder.nodeId = null;
    renderDiagnosticsBuilder();
  });

  addBrandBtn.addEventListener('click', () => {
    if (!selectedWorkflow) return;
    const body = document.createElement('div');
    body.className = 'section-stack';
    const existingOptions = brands.map((brand) => `<option value="${brand.id}">${escapeHtml(brand.brand_name || '')}</option>`).join('');
    body.innerHTML = `
      <label>Brand Name</label>
      <input id="brand-name" placeholder="Reinke" />
      <div class="section-title">Create Flow</div>
      <label class="pill">
        <input type="radio" name="flow-source" value="new" checked />
        Build from scratch
      </label>
      <label class="pill">
        <input type="radio" name="flow-source" value="copy" />
        Copy existing brand flow
      </label>
      <div>
        <label>Copy From</label>
        <select id="brand-copy" ${brands.length ? '' : 'disabled'}>
          ${existingOptions || '<option value="">No brands available</option>'}
        </select>
      </div>
      <div class="actions">
        <button class="action" id="save-brand">Create Brand Flow</button>
      </div>
    `;
    const { close } = openModalSimple({ title: 'Add Brand Flow', bodyEl: body });
    body.querySelector('#save-brand').addEventListener('click', async () => {
      const brandName = body.querySelector('#brand-name').value.trim();
      if (!brandName) {
        showToast('Enter a brand name.');
        return;
      }
      const sourceChoice = body.querySelector('input[name="flow-source"]:checked').value;
      const brand = await createDiagnosticWorkflowBrand({
        workflow_id: selectedWorkflow.id,
        brand_name: brandName,
        status: 'draft',
        attachments: [],
      });
      if (sourceChoice === 'copy' && brands.length) {
        const sourceId = body.querySelector('#brand-copy').value;
        const sourceNodes = await listDiagnosticNodes(sourceId);
        const sourceEdges = await listDiagnosticEdges(sourceId);
        const sourceLayouts = await listDiagnosticNodeLayouts(sourceId);
        const nodeMap = new Map();
        for (const node of sourceNodes) {
          const newNode = await createDiagnosticNode({
            brand_id: brand.id,
            node_type: node.node_type,
            title: node.title,
            data: node.data,
          });
          nodeMap.set(node.id, newNode.id);
        }
        for (const edge of sourceEdges) {
          const fromId = nodeMap.get(edge.from_node_id);
          const toId = nodeMap.get(edge.to_node_id);
          if (!fromId || !toId) continue;
          await createDiagnosticEdge({
            brand_id: brand.id,
            from_node_id: fromId,
            to_node_id: toId,
            condition: edge.condition,
          });
        }
        for (const layout of sourceLayouts) {
          const nodeId = nodeMap.get(layout.node_id);
          if (!nodeId) continue;
          await upsertDiagnosticNodeLayout({
            brand_id: brand.id,
            node_id: nodeId,
            x: layout.x,
            y: layout.y,
          });
        }
      }
      state.diagnosticsBuilder.brandId = brand.id;
      state.diagnosticsBuilder.nodeId = null;
      close();
      renderDiagnosticsBuilder();
    });
  });

  deleteBrandBtn.addEventListener('click', async () => {
    if (!selectedBrand) return;
    if (!confirm('Delete this brand flow and all nodes?')) return;
    await deleteDiagnosticWorkflowBrand(selectedBrand.id);
    state.diagnosticsBuilder.brandId = null;
    state.diagnosticsBuilder.nodeId = null;
    renderDiagnosticsBuilder();
  });

  if (!selectedWorkflow) {
    builderCard.innerHTML = '<div class="muted">Create a workflow to begin building diagnostics.</div>';
    return;
  }

  const builderHeader = document.createElement('div');
  builderHeader.className = 'section-stack';
  builderHeader.innerHTML = `
    <div class="section-title">${escapeHtml(selectedWorkflow.title || 'Diagnostics Workflow')}</div>
    <div class="muted small">Manage workflow-level attachments and brand flow graphs.</div>
  `;
  builderCard.appendChild(builderHeader);

  if (!selectedBrand) {
    builderCard.innerHTML += '<div class="muted">Select or create a brand to build its flow.</div>';
    return;
  }

  const attachmentsSection = document.createElement('div');
  attachmentsSection.className = 'section-stack';
  attachmentsSection.innerHTML = `
    <div class="section-title">Workflow Attachments</div>
    <div class="muted small">Visible to techs before the first diagnostic step.</div>
  `;
  const attachmentsList = document.createElement('div');
  attachmentsList.className = 'list';
  const brandAttachments = selectedBrand.attachments || [];
  if (!brandAttachments.length) attachmentsList.innerHTML = '<div class="muted">No attachments yet.</div>';
  brandAttachments.forEach((fileUrl) => {
    const item = document.createElement('div');
    item.className = 'pill list-row';
    item.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(fileUrl.split('/').pop())}</div>
        <div class="row-sub muted">${escapeHtml(fileUrl)}</div>
      </div>
      <span class="badge danger">Remove</span>
    `;
    item.querySelector('.badge').addEventListener('click', async () => {
      const next = brandAttachments.filter((url) => url !== fileUrl);
      await updateDiagnosticWorkflowBrand(selectedBrand.id, { attachments: next });
      renderDiagnosticsBuilder();
    });
    attachmentsList.appendChild(item);
  });

  const attachmentInput = document.createElement('input');
  attachmentInput.type = 'file';
  attachmentInput.accept = 'application/pdf,image/png,image/jpeg,image/webp';
  attachmentInput.addEventListener('change', async () => {
    const file = attachmentInput.files?.[0];
    if (!file) return;
    const fileUrl = await uploadDiagnosticWorkflowAttachment(file, { prefix: `workflow/${selectedWorkflow.id}/${selectedBrand.id}` });
    const next = [...brandAttachments, fileUrl];
    await updateDiagnosticWorkflowBrand(selectedBrand.id, { attachments: next });
    renderDiagnosticsBuilder();
  });

  attachmentsSection.append(attachmentsList, attachmentInput);
  builderCard.appendChild(attachmentsSection);

  const flowGrid = document.createElement('div');
  flowGrid.className = 'diagnostics-flow-grid';

  const nodeList = document.createElement('div');
  nodeList.className = 'section-stack';
  nodeList.innerHTML = `
    <div class="section-title">Nodes</div>
    <div class="muted small">Click a node to edit its details.</div>
  `;
  const nodeListItems = document.createElement('div');
  nodeListItems.className = 'list';
  nodes.forEach((node) => {
    const row = document.createElement('button');
    row.className = 'pill list-row';
    if (node.id === state.diagnosticsBuilder.nodeId) row.classList.add('active');
    if (danglingNodes.has(node.id)) row.classList.add('danger');
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(node.title || `${node.node_type} node`)}</div>
        <div class="row-sub muted">${node.node_type.toUpperCase()}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      state.diagnosticsBuilder.nodeId = node.id;
      renderDiagnosticsBuilder();
    });
    nodeListItems.appendChild(row);
  });

  const nodeActions = document.createElement('div');
  nodeActions.className = 'actions';
  ['check', 'repair', 'end'].forEach((type) => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.textContent = `Add ${type === 'check' ? 'Check' : type === 'repair' ? 'Repair' : 'End'} Node`;
    btn.addEventListener('click', async () => {
      const title = type === 'check' ? 'New Check' : type === 'repair' ? 'New Repair' : 'End';
      const newNode = await createDiagnosticNode({
        brand_id: selectedBrand.id,
        node_type: type,
        title,
        data: buildDiagnosticDefaultNode(type),
      });
      state.diagnosticsBuilder.nodeId = newNode.id;
      renderDiagnosticsBuilder();
    });
    nodeActions.appendChild(btn);
  });
  nodeList.append(nodeListItems, nodeActions);
  flowGrid.appendChild(nodeList);

  const editor = document.createElement('div');
  editor.className = 'section-stack';
  editor.innerHTML = '<div class="section-title">Node Editor</div>';
  const selectedNode = nodes.find((node) => node.id === state.diagnosticsBuilder.nodeId) || nodes[0];
  if (selectedNode && !state.diagnosticsBuilder.nodeId) state.diagnosticsBuilder.nodeId = selectedNode.id;

  if (!selectedNode) {
    editor.innerHTML += '<div class="muted">Select a node to edit.</div>';
  } else {
    const nodeData = selectedNode.data || buildDiagnosticDefaultNode(selectedNode.node_type);
    const form = document.createElement('div');
    form.className = 'section-stack';
    const nodeTitleInput = document.createElement('input');
    nodeTitleInput.value = selectedNode.title || '';
    nodeTitleInput.placeholder = 'Node title';

    form.appendChild(labelWrap('Node Title', nodeTitleInput));

    if (selectedNode.node_type === 'check') {
      const whatInput = document.createElement('textarea');
      whatInput.value = nodeData.what_to_check || '';
      const howInput = document.createElement('textarea');
      howInput.value = nodeData.how_to_check || '';
      form.appendChild(labelWrap('What to Check', whatInput));
      form.appendChild(labelWrap('How to Check', howInput));

      const readingsWrap = document.createElement('div');
      readingsWrap.className = 'section-stack';
      readingsWrap.innerHTML = '<div class="section-title">Readings</div>';
      const readingsList = document.createElement('div');
      readingsList.className = 'list';
      (nodeData.readings || []).forEach((reading, index) => {
        const row = document.createElement('div');
        row.className = 'pill list-row';
        row.innerHTML = `
          <div class="row-main">
            <div class="row-title">${escapeHtml(reading.label || 'Reading')}</div>
            <div class="row-sub muted">${escapeHtml(reading.operator || '')} ${escapeHtml(reading.value ?? '')} ${escapeHtml(reading.unit || '')}</div>
          </div>
          <div class="row-meta">
            <span class="badge">Edit</span>
            <span class="badge danger">Remove</span>
          </div>
        `;
        const [editBtn, removeBtn] = row.querySelectorAll('.badge');
        editBtn.addEventListener('click', () => {
          openReadingModal(reading, async (updated) => {
            const next = [...(nodeData.readings || [])];
            next[index] = updated;
            nodeData.readings = next;
            await updateDiagnosticNode(selectedNode.id, { data: nodeData });
            renderDiagnosticsBuilder();
          });
        });
        removeBtn.addEventListener('click', async () => {
          const next = [...(nodeData.readings || [])];
          next.splice(index, 1);
          nodeData.readings = next;
          await updateDiagnosticNode(selectedNode.id, { data: nodeData });
          renderDiagnosticsBuilder();
        });
        readingsList.appendChild(row);
      });
      const addReadingBtn = document.createElement('button');
      addReadingBtn.className = 'pill';
      addReadingBtn.textContent = 'Add Reading';
      addReadingBtn.addEventListener('click', () => {
        const reading = {
          id: `r_${Date.now()}`,
          label: '',
          unit: '',
          operator: '>=',
          value: '',
          min: '',
          max: '',
        };
        openReadingModal(reading, async (updated) => {
          nodeData.readings = [...(nodeData.readings || []), updated];
          await updateDiagnosticNode(selectedNode.id, { data: nodeData });
          renderDiagnosticsBuilder();
        });
      });
      readingsWrap.append(readingsList, addReadingBtn);
      form.appendChild(readingsWrap);

      const rollupSelect = document.createElement('select');
      ['all_good', 'any_bad', 'all_bad', 'any_good', 'custom'].forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option.replace(/_/g, ' ');
        if (nodeData.rollup_logic === option) opt.selected = true;
        rollupSelect.appendChild(opt);
      });
      form.appendChild(labelWrap('Rollup Logic', rollupSelect));
      const customLogic = document.createElement('input');
      customLogic.value = nodeData.rollup_custom || '';
      customLogic.placeholder = 'Custom logic (ex: r1 && (r2 || r3))';
      form.appendChild(labelWrap('Custom Logic', customLogic));

      const explanationGood = document.createElement('textarea');
      explanationGood.value = nodeData.explanation_good || '';
      const explanationBad = document.createElement('textarea');
      explanationBad.value = nodeData.explanation_bad || '';
      form.appendChild(labelWrap('Explanation if Good', explanationGood));
      form.appendChild(labelWrap('Explanation if Bad', explanationBad));

      const goodSelect = buildNodeSelect(nodes, selectedNode.id, edges, 'good');
      const badSelect = buildNodeSelect(nodes, selectedNode.id, edges, 'bad');
      form.appendChild(labelWrap('Next on Good', goodSelect));
      form.appendChild(labelWrap('Next on Bad', badSelect));

      goodSelect.addEventListener('change', () => updateEdgeSelection(selectedNode.id, goodSelect.value, 'good'));
      badSelect.addEventListener('change', () => updateEdgeSelection(selectedNode.id, badSelect.value, 'bad'));

      whatInput.addEventListener('input', () => { nodeData.what_to_check = whatInput.value; });
      howInput.addEventListener('input', () => { nodeData.how_to_check = howInput.value; });
      rollupSelect.addEventListener('change', () => { nodeData.rollup_logic = rollupSelect.value; });
      customLogic.addEventListener('input', () => { nodeData.rollup_custom = customLogic.value; });
      explanationGood.addEventListener('input', () => { nodeData.explanation_good = explanationGood.value; });
      explanationBad.addEventListener('input', () => { nodeData.explanation_bad = explanationBad.value; });
    }

    if (selectedNode.node_type === 'repair') {
      const titleInput = document.createElement('input');
      titleInput.value = nodeData.repair_title || '';
      const whyInput = document.createElement('textarea');
      whyInput.value = nodeData.why_repair || '';
      form.appendChild(labelWrap('Repair Title', titleInput));
      form.appendChild(labelWrap('Why Repair Is Needed', whyInput));

      const toolsInput = document.createElement('textarea');
      toolsInput.value = (nodeData.recommended_tools || []).join('\n');
      toolsInput.placeholder = 'One tool per line';
      form.appendChild(labelWrap('Recommended Tools', toolsInput));

      const stepTypeSelect = document.createElement('select');
      ['static', 'guided', 'checkbox', 'sectioned'].forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option.replace(/_/g, ' ');
        if (nodeData.step_type === option) opt.selected = true;
        stepTypeSelect.appendChild(opt);
      });
      form.appendChild(labelWrap('Step Type', stepTypeSelect));
      const stepsInput = document.createElement('textarea');
      stepsInput.value = (nodeData.steps || []).join('\n');
      stepsInput.placeholder = 'One step per line';
      form.appendChild(labelWrap('Steps', stepsInput));

      const photosWrap = document.createElement('div');
      photosWrap.className = 'form-grid';
      const beforeToggle = document.createElement('input');
      beforeToggle.type = 'checkbox';
      beforeToggle.checked = nodeData.photos?.before || false;
      const afterToggle = document.createElement('input');
      afterToggle.type = 'checkbox';
      afterToggle.checked = nodeData.photos?.after || false;
      photosWrap.append(
        checkboxWrap('Before Photo Required', beforeToggle),
        checkboxWrap('After Photo Required', afterToggle),
      );
      form.appendChild(photosWrap);

      const nextSelect = buildNodeSelect(nodes, selectedNode.id, edges, 'next');
      form.appendChild(labelWrap('After Repair', nextSelect));
      nextSelect.addEventListener('change', () => updateEdgeSelection(selectedNode.id, nextSelect.value, 'next'));

      titleInput.addEventListener('input', () => { nodeData.repair_title = titleInput.value; });
      whyInput.addEventListener('input', () => { nodeData.why_repair = whyInput.value; });
      toolsInput.addEventListener('input', () => { nodeData.recommended_tools = toolsInput.value.split('\n').filter(Boolean); });
      stepTypeSelect.addEventListener('change', () => { nodeData.step_type = stepTypeSelect.value; });
      stepsInput.addEventListener('input', () => { nodeData.steps = stepsInput.value.split('\n').filter(Boolean); });
      beforeToggle.addEventListener('change', () => {
        nodeData.photos = { ...(nodeData.photos || {}), before: beforeToggle.checked };
      });
      afterToggle.addEventListener('change', () => {
        nodeData.photos = { ...(nodeData.photos || {}), after: afterToggle.checked };
      });
    }

    if (selectedNode.node_type === 'end') {
      const closureReason = document.createElement('textarea');
      closureReason.value = nodeData.closure_reason || '';
      form.appendChild(labelWrap('Closure Reason', closureReason));
      const resolvedSelect = document.createElement('select');
      ['','yes','no'].forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option || 'Not set';
        if (nodeData.resolved === option) opt.selected = true;
        resolvedSelect.appendChild(opt);
      });
      const followUpSelect = document.createElement('select');
      ['','yes','no'].forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option || 'Not set';
        if (nodeData.follow_up === option) opt.selected = true;
        followUpSelect.appendChild(opt);
      });
      const notes = document.createElement('textarea');
      notes.value = nodeData.notes_for_office || '';
      form.appendChild(labelWrap('Resolved?', resolvedSelect));
      form.appendChild(labelWrap('Follow-up Required?', followUpSelect));
      form.appendChild(labelWrap('Notes for Office', notes));

      closureReason.addEventListener('input', () => { nodeData.closure_reason = closureReason.value; });
      resolvedSelect.addEventListener('change', () => { nodeData.resolved = resolvedSelect.value; });
      followUpSelect.addEventListener('change', () => { nodeData.follow_up = followUpSelect.value; });
      notes.addEventListener('input', () => { nodeData.notes_for_office = notes.value; });
    }

    const attachmentsWrap = document.createElement('div');
    attachmentsWrap.className = 'section-stack';
    attachmentsWrap.innerHTML = '<div class="section-title">Node Attachments</div>';
    const nodeAttachments = nodeData.attachments || [];
    const nodeAttachList = document.createElement('div');
    nodeAttachList.className = 'list';
    if (!nodeAttachments.length) nodeAttachList.innerHTML = '<div class="muted">No attachments yet.</div>';
    nodeAttachments.forEach((url, index) => {
      const item = document.createElement('div');
      item.className = 'pill list-row';
      item.innerHTML = `
        <div class="row-main">
          <div class="row-title">${escapeHtml(url.split('/').pop())}</div>
          <div class="row-sub muted">${escapeHtml(url)}</div>
        </div>
        <span class="badge danger">Remove</span>
      `;
      item.querySelector('.badge').addEventListener('click', async () => {
        nodeData.attachments = nodeAttachments.filter((_, i) => i !== index);
        await updateDiagnosticNode(selectedNode.id, { data: nodeData });
        renderDiagnosticsBuilder();
      });
      nodeAttachList.appendChild(item);
    });
    const nodeAttachmentInput = document.createElement('input');
    nodeAttachmentInput.type = 'file';
    nodeAttachmentInput.accept = 'application/pdf,image/png,image/jpeg,image/webp';
    nodeAttachmentInput.addEventListener('change', async () => {
      const file = nodeAttachmentInput.files?.[0];
      if (!file) return;
      const fileUrl = await uploadDiagnosticWorkflowAttachment(file, { prefix: `node/${selectedWorkflow.id}/${selectedBrand.id}/${selectedNode.id}` });
      nodeData.attachments = [...nodeAttachments, fileUrl];
      await updateDiagnosticNode(selectedNode.id, { data: nodeData });
      renderDiagnosticsBuilder();
    });
    attachmentsWrap.append(nodeAttachList, nodeAttachmentInput);
    form.appendChild(attachmentsWrap);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'action';
    saveBtn.textContent = 'Save Node';
    saveBtn.addEventListener('click', async () => {
      const payload = {
        title: nodeTitleInput.value.trim() || selectedNode.title,
        data: nodeData,
      };
      await updateDiagnosticNode(selectedNode.id, payload);
      renderDiagnosticsBuilder();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pill danger';
    deleteBtn.textContent = 'Delete Node';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this node?')) return;
      await deleteDiagnosticNode(selectedNode.id);
      state.diagnosticsBuilder.nodeId = null;
      renderDiagnosticsBuilder();
    });

    const actionRow = document.createElement('div');
    actionRow.className = 'actions';
    actionRow.append(saveBtn, deleteBtn);
    form.appendChild(actionRow);

    form.querySelectorAll('textarea, input, select').forEach((input) => {
      input.addEventListener('input', () => {
        if (input === nodeTitleInput) return;
      });
    });

    editor.appendChild(form);
  }
  flowGrid.appendChild(editor);

  const diagram = document.createElement('div');
  diagram.className = 'diagnostics-diagram';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('diagram-lines');
  diagram.appendChild(svg);

  const nodeElements = new Map();
  nodes.forEach((node, index) => {
    const layout = layoutMap.get(node.id) || { x: 40 + index * 40, y: 40 + index * 30 };
    const nodeEl = document.createElement('div');
    nodeEl.className = `diagram-node ${node.node_type}`;
    if (danglingNodes.has(node.id)) nodeEl.classList.add('dangling');
    nodeEl.style.left = `${layout.x}px`;
    nodeEl.style.top = `${layout.y}px`;
    nodeEl.textContent = node.title || node.node_type.toUpperCase();
    nodeEl.addEventListener('click', () => {
      state.diagnosticsBuilder.nodeId = node.id;
      renderDiagnosticsBuilder();
    });
    nodeEl.addEventListener('pointerdown', (event) => {
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = diagram.getBoundingClientRect();
      const originX = layout.x;
      const originY = layout.y;
      function onMove(moveEvent) {
        const nextX = originX + (moveEvent.clientX - startX);
        const nextY = originY + (moveEvent.clientY - startY);
        nodeEl.style.left = `${nextX}px`;
        nodeEl.style.top = `${nextY}px`;
      }
      function onUp(upEvent) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const nextX = originX + (upEvent.clientX - startX);
        const nextY = originY + (upEvent.clientY - startY);
        upsertDiagnosticNodeLayout({
          brand_id: selectedBrand.id,
          node_id: node.id,
          x: Math.max(0, nextX),
          y: Math.max(0, nextY),
        });
        renderDiagnosticsBuilder();
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      nodeEl.setPointerCapture(event.pointerId);
    });
    diagram.appendChild(nodeEl);
    nodeElements.set(node.id, { node, element: nodeEl });
  });

  edges.forEach((edge) => {
    const fromEl = nodeElements.get(edge.from_node_id)?.element;
    const toEl = nodeElements.get(edge.to_node_id)?.element;
    if (!fromEl || !toEl) return;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const wrapperRect = diagram.getBoundingClientRect();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(fromRect.left - wrapperRect.left + fromRect.width / 2));
    line.setAttribute('y1', String(fromRect.top - wrapperRect.top + fromRect.height / 2));
    line.setAttribute('x2', String(toRect.left - wrapperRect.left + toRect.width / 2));
    line.setAttribute('y2', String(toRect.top - wrapperRect.top + toRect.height / 2));
    line.setAttribute('data-condition', edge.condition);
    svg.appendChild(line);
  });

  const publishSection = document.createElement('div');
  publishSection.className = 'section-stack';
  publishSection.innerHTML = `
    <div class="section-title">Publish</div>
    <div class="muted small">Publishing locks validation for dangling branches. Edits remain possible.</div>
  `;
  if (!hasPostRepairVerification) {
    const warning = document.createElement('div');
    warning.className = 'pill warning';
    warning.textContent = 'Warning: No post-repair verification check exists.';
    publishSection.appendChild(warning);
  }
  const publishBtn = document.createElement('button');
  publishBtn.className = 'action';
  publishBtn.textContent = selectedBrand.status === 'published' ? 'Update Published Workflow' : 'Publish Workflow';
  publishBtn.addEventListener('click', async () => {
    if (danglingNodes.size) {
      showToast('Fix dangling branches before publishing.');
      return;
    }
    const payload = {
      nodes,
      edges,
    };
    const versionHash = hashWorkflowPayload(payload);
    await updateDiagnosticWorkflowBrand(selectedBrand.id, {
      status: 'published',
      version_hash: versionHash,
    });
    showToast('Workflow published.');
    renderDiagnosticsBuilder();
  });
  publishSection.appendChild(publishBtn);

  builderCard.append(flowGrid, diagram, publishSection);

  function openReadingModal(reading, onSave) {
    const body = document.createElement('div');
    body.className = 'section-stack';
    body.innerHTML = `
      <label>Label</label>
      <input id="reading-label" value="${escapeHtml(reading.label || '')}" />
      <label>Unit</label>
      <input id="reading-unit" value="${escapeHtml(reading.unit || '')}" />
      <label>Operator</label>
      <select id="reading-operator">
        <option value="<">&lt;</option>
        <option value="<=">&lt;=</option>
        <option value=">">&gt;</option>
        <option value=">=">&gt;=</option>
        <option value="between">between</option>
      </select>
      <label>Value / Min</label>
      <input id="reading-value" value="${escapeHtml(reading.value ?? '')}" />
      <label>Max (between only)</label>
      <input id="reading-max" value="${escapeHtml(reading.max ?? '')}" />
      <div class="actions">
        <button class="action" id="save-reading">Save</button>
      </div>
    `;
    const { close } = openModalSimple({ title: 'Reading', bodyEl: body });
    const operatorSelect = body.querySelector('#reading-operator');
    operatorSelect.value = reading.operator || '>=';
    body.querySelector('#save-reading').addEventListener('click', () => {
      const updated = {
        ...reading,
        label: body.querySelector('#reading-label').value.trim(),
        unit: body.querySelector('#reading-unit').value.trim(),
        operator: operatorSelect.value,
        value: body.querySelector('#reading-value').value.trim(),
        max: body.querySelector('#reading-max').value.trim(),
      };
      onSave(updated);
      close();
    });
  }

  function labelWrap(labelText, inputEl) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.append(label, inputEl);
    return wrap;
  }

  function checkboxWrap(labelText, inputEl) {
    const wrap = document.createElement('label');
    wrap.className = 'pill';
    wrap.append(inputEl, document.createTextNode(` ${labelText}`));
    return wrap;
  }

  function buildNodeSelect(nodesList, currentId, edgeList, condition) {
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Select next node';
    select.appendChild(empty);
    nodesList.filter((node) => node.id !== currentId).forEach((node) => {
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = node.title || node.node_type;
      select.appendChild(opt);
    });
    const existing = edgeList.find((edge) => edge.from_node_id === currentId && edge.condition === condition);
    if (existing) select.value = existing.to_node_id;
    return select;
  }

  async function updateEdgeSelection(fromId, toId, condition) {
    const existing = edges.find((edge) => edge.from_node_id === fromId && edge.condition === condition);
    if (!toId) {
      if (existing) await deleteDiagnosticEdge(existing.id);
    } else if (existing) {
      await updateDiagnosticEdge(existing.id, { to_node_id: toId });
    } else {
      await createDiagnosticEdge({
        brand_id: selectedBrand.id,
        from_node_id: fromId,
        to_node_id: toId,
        condition,
      });
    }
    renderDiagnosticsBuilder();
  }
}
const viewHandlers = {
  'job-board': renderJobBoard,
  customers: renderCustomersPremium,
  fields: () => renderListView({
    title: 'Fields',
    subtitle: 'Manage service locations.',
    listLoader: listFields,
    createHandler: createField,
    updateHandler: updateField,
    deleteHandler: deleteField,
    enableImportExport: true,
    filePrefix: 'fields',
    fields: [
      { key: 'name', label: 'Field Name' },
      {
        key: 'customer_id',
        label: 'Customer',
        type: 'select',
        options: () => state.boot.customers.map((customer) => ({
          value: customer.id,
          label: customer.name,
        })),
      },
      { key: 'address', label: 'Address' },
      { key: 'brand', label: 'Brand' },
      { key: 'tower_count', label: 'Tower Count', type: 'number' },
      { key: 'serial_number', label: 'Serial Number' },
      { key: 'telemetry', label: 'Telemetry' },
      { key: 'last_known_hours', label: 'Last Known Hours' },
    ],
  }),
  trucks: renderTrucksPremium,
  users: renderUsersView,
   'job-types': renderJobTypesView,
  products: renderPartsView,
  'diagnostics-builder': renderDiagnosticsBuilder,
  tools: renderToolsView,
  requests: renderRequests,
  'out-of-stock': renderOutOfStock,
  receipts: renderReceipts,
  reports: renderReports,
  settings: renderSettings,
};

async function setView(viewId) {
  state.currentView = viewId;
  setActiveNav(viewId);
  viewContainer.innerHTML = '<div class="card"><p>Loading...</p></div>';
  try {
    if (!state.boot) await refreshBoot();
    const handler = viewHandlers[viewId];
    if (handler) await handler();
  } catch (error) {
    showToast(error.message);
    viewContainer.innerHTML = '<div class="card"><p>Unable to load. Check settings.</p></div>';
  }
}

function bindNav() {
  document.querySelectorAll('.nav .pill').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
}



function bindMenuDataTools() {
  const exportBtn = document.getElementById('menu-export');
  const importBtn = document.getElementById('menu-import');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => showToast('Export from menu is not wired yet. Use page-level exports.'));
  }
  if (importBtn) {
    importBtn.addEventListener('click', () => showToast('Import from menu is not wired yet. Use page-level imports.'));
  }
}

function bindHamburgerMenuUI() {
  const modal = document.getElementById('menu-modal');
  const openBtn = document.getElementById('open-menu');
  const closeBtn = document.getElementById('close-menu');
  const scrim = document.getElementById('menu-scrim');
  if (!modal || !openBtn || !closeBtn || !scrim) return;

  const open = () => { modal.hidden = false; };
  const close = () => { modal.hidden = true; };

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') close();
  });

  modal.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => close());
  });
}

async function updateQuickViewCounts() {
  const nodes = document.querySelectorAll('[data-count]');
  if (!nodes.length) return;

  try {
    const jobs = await fetchAllJobsSafe();
   const counts = { open:0, paused:0, in_progress:0, finished:0, closed:0, inquiries:0 };
    for (const j of jobs){
      const k = quickViewStatusKey(j);
      if (k==='paused') counts.paused++;
      else if (k==='in_progress') counts.in_progress++;
      else if (k==='finished') counts.finished++;
      else if (k==='closed') counts.closed++;
      else counts.open++;
        if (isInquiryJob(j) && ![JOB_STATUSES.INVOICED, JOB_STATUSES.CANCELED].includes(j.status)) counts.inquiries++;
    }
    const set = (key,val)=> document.querySelectorAll(`[data-count="${key}"]`).forEach(el=> el.textContent=String(val));
    set('open', counts.open);
    set('paused', counts.paused);
    set('in_progress', counts.in_progress);
    set('finished', counts.finished);
     set('closed', counts.closed);
    set('inquiries', counts.inquiries);
  } catch(e) { console.warn('Quick view job count refresh failed' , e); }
  try {
    const reqs = await listRequests();
    document.querySelectorAll('[data-count="requests"]').forEach(el=> el.textContent=String(reqs.length));
  } catch(e) {console.warn('Quick view job count refresh failed', e); }
  try {
    const oos = await listOutOfStock();
    document.querySelectorAll('[data-count="out_of_stock"]').forEach(el=> el.textContent=String(oos.length));
  } catch(e) {console.warn('Quick view job count refresh failed', e); }
}

function bindQuickViews() {
  const wrap = document.getElementById('quick-views');
  if (!wrap) return;
  wrap.querySelectorAll('button[data-qv]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const qv = btn.dataset.qv;
      if (!qv) return;
      if (qv === 'requests') return setView('requests');
      if (qv === 'out-of-stock') return setView('out-of-stock');
      await setView('job-board');
      await new Promise((r) => setTimeout(r, 0));
      await renderJobBoardList(qv);
    });
  });
}

function bindCreateJobShortcut() {
  const btn = document.getElementById('create-job-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
     state.createJobMode = 'job';
    openCreateJobModal();
  });
}


function bindCreateInquiryShortcut() {
  const btn = document.getElementById('create-inquiry-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.createJobMode = 'inquiry';
    openCreateJobModal();
  });
}

function bindInventoryMapShortcut() {
  const btn = document.getElementById('open-inventory-map');
  if (!btn) return;
  btn.addEventListener('click', () => {
  const url = new URL('../inventory-app/inventory.html', window.location.href);
    window.location.assign(url.toString());
  });
}

function bindCreateJobModal() {
  const modal = document.getElementById('create-job-modal');
  const closeBtn = document.getElementById('close-create-job');
  const cancelBtn = document.getElementById('cancel-create-job');
  const scrim = document.getElementById('create-job-scrim');
  const form = document.getElementById('create-job-form');

  if (!modal || !closeBtn || !cancelBtn || !scrim || !form) return;

  const close = () => closeCreateJobModal({ returnHome: true });
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const customerId = form.elements.customer_id.value;
    const fieldId = form.elements.field_id.value;
    const jobTypeId = form.elements.job_type_id.value;
    const description = form.elements.description.value.trim();
    const attachment = form.elements.attachment.files?.[0];

    if (!customerId || !fieldId || !jobTypeId) {
      showToast('Select a customer, field, and job type.');
      return;
    }
    if (!description) {
      showToast('Add a description before saving.');
      return;
    }

    const saveBtn = form.querySelector('button[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
       const selectedJobType = state.boot.jobTypes.find((type) => type.id === jobTypeId);
      const inquiryMode = state.createJobMode === 'inquiry' || `${selectedJobType?.name || ''}`.trim().toLowerCase() === 'inquiry';
      const payload = {
        customer_id: customerId,
        field_id: fieldId,
        job_type_id: jobTypeId,
        description,
        status: JOB_STATUSES.OPEN,
      };
      

      const job = await createJob(payload);

      if (attachment) {
        const url = await uploadJobAttachment(job.id, attachment);
        await addAttachment({
          job_id: job.id,
          attachment_type: attachment.name,
          file_url: url,
        });
      }

    showToast(inquiryMode ? 'Inquiry created.' : 'Job created.');
      await closeCreateJobModal({ returnHome: true });
      await updateQuickViewCounts();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

bindNav();
bindHamburgerMenuUI();
bindMenuDataTools();
bindQuickViews();
bindCreateJobShortcut();
bindInventoryMapShortcut();
bindCreateInquiryShortcut();
bindCreateJobModal();
setView('job-board');
updateQuickViewCounts();

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.runSupabaseHealthCheck = runSupabaseHealthCheck;
  console.info('Dev helper available: window.runSupabaseHealthCheck()');
}