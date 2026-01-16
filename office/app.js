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
  listRequestHistory,
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
  getSupabaseClient,
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
};

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

async function handleImportCsv(event, fields, createHandler) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const [headerRow, ...rows] = text.split(/\r?\n/).filter(Boolean);
  const headers = headerRow.split(',');
  for (const row of rows) {
    const values = row.split(',').map((value) => value.replace(/^\"|\"$/g, ''));
    const payload = {};
    headers.forEach((header, index) => {
      if (fields.find((field) => field.key === header)) {
        payload[header] = values[index];
      }
    });
    try {
      await createHandler(payload);
    } catch (error) {
      showToast(`Import error: ${error.message}`);
      break;
    }
  }
  showToast('Import complete. Refreshing list.');
  event.target.value = '';
  await setView(state.currentView);
}

async function handleInventoryImportCsv(event, truck, inventoryItems) {
  const file = event.target.files?.[0];
  if (!file) return;
  const truckId = getId(truck);
  if (!truckId) return;
  const text = await file.text();
  const [headerRow, ...rows] = text.split(/\r?\n/).filter(Boolean);
  if (!headerRow) {
    showToast('Import file is empty.');
    return;
  }
  const headers = headerRow.split(',').map((header) => header.trim());
  const productBySku = new Map();
  const productByName = new Map();
  (state.boot?.products || []).forEach((product) => {
    if (product.sku) productBySku.set(product.sku.toLowerCase(), product);
    if (product.name) productByName.set(product.name.toLowerCase(), product);
  });
  const inventoryMap = new Map(inventoryItems.map((item) => [item.product_id, item]));

  for (const row of rows) {
    const values = row.split(',').map((value) => value.replace(/^\"|\"$/g, '').trim());
    const payload = {};
    headers.forEach((header, index) => {
      payload[header] = values[index];
    });
    const sku = payload.sku?.trim();
    const name = payload.name?.trim();
    const minRaw = payload.min_qty ?? payload.minimum_qty ?? payload.min;
    const parsedMin = Number(minRaw);
    let product = sku ? productBySku.get(sku.toLowerCase()) : null;
    if (!product && name) product = productByName.get(name.toLowerCase());
    if (!product) {
      if (!name) {
        showToast('Missing part name for an import row.');
        continue;
      }
      const shouldAdd = confirm(`Part "${name}" was not found. Add it to the parts table?`);
      if (!shouldAdd) continue;
      try {
        product = await createProduct({ name, sku });
        if (state.boot?.products) state.boot.products.push(product);
        productByName.set(product.name.toLowerCase(), product);
        if (product.sku) productBySku.set(product.sku.toLowerCase(), product);
      } catch (error) {
        showToast(`Unable to add part: ${error.message}`);
        continue;
      }
    }
    const existing = inventoryMap.get(product.id);
    const min_qty = Number.isNaN(parsedMin) ? (existing?.min_qty ?? 0) : parsedMin;
    const qty = existing?.qty ?? 0;
    try {
      await upsertTruckInventory({
        truck_id: truckId,
        product_id: product.id,
        qty,
        min_qty,
        origin: 'permanent',
      });
    } catch (error) {
      showToast(`Import error: ${error.message}`);
      break;
    }
  }
  showToast('Import complete. Refreshing list.');
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
  openCreateJobModal();
  });
  listPanel.appendChild(createButton);

  const filterMap = {
    open: { statuses: [JOB_STATUSES.PAUSED, JOB_STATUSES.OPEN] },
    in_progress: { statuses: [JOB_STATUSES.ON_SITE_REPAIR, JOB_STATUSES.ON_SITE_DIAGNOSTICS, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.PAUSED] },
    paused: { statuses: [JOB_STATUSES.PAUSED] },
    finished: { statuses: [JOB_STATUSES.FINISHED] },
    invoiced: { statuses: [JOB_STATUSES.INVOICED] },
    closed: { statuses: [JOB_STATUSES.INVOICED, JOB_STATUSES.CANCELED] },
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

  const sortedJobs = jobs.slice().sort((a, b) => {
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
       <div class="section-stack">
          <label for="job-office-notes">Office Notes</label>
          <textarea id="job-office-notes" placeholder="Add office notes...">${escapeHtml(officeNotes)}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="pill secondary" type="button" data-cancel>Close</button>
        <button class="action" type="button" data-save-notes>Save Notes</button>
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
    importInput.accept = '.csv';
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

  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.type = 'button';
  addBtn.textContent = 'Add Part';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'pill';
  exportBtn.textContent = 'Export CSV';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.csv';

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

  parts.forEach((part) => {
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

  if (!parts.length) {
    listCard.innerHTML += '<p>No parts yet.</p>';
  }

  viewContainer.innerHTML = '';
  viewContainer.appendChild(listCard);
}
async function renderRequests() {
  viewTitle.textContent = 'Requests';
  viewSubtitle.textContent = 'Resolve and archive tech requests.';
  viewActions.innerHTML = '';

  const [requests, history] = await Promise.all([
    listAllRequests(),
    listRequestHistory(),
  ]);
const activeRequests = requests.filter((req) => req.status !== 'approved');
  const layout = document.createElement('div');
  layout.className = 'grid-two';

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

  const historyCard = document.createElement('div');
  historyCard.className = 'card section-stack';
  historyCard.innerHTML = '<h3>Resolved History</h3>';
  history.slice(0, 8).forEach((req) => {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>
        <strong>${req.request_type}</strong>
        <div class="muted">${req.users?.full_name || 'Tech'} · ${new Date(req.resolved_at).toLocaleDateString()}</div>
        <div>${req.description}</div>
      </div>
    `;
    historyCard.appendChild(pill);
  });

  if (!history.length) {
    historyCard.innerHTML += '<p>No resolved requests yet.</p>';
  }

  layout.appendChild(activeCard);
  layout.appendChild(historyCard);
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
    pill.className = 'pill list-row';
    pill.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(receipt.receipt_type || 'Receipt')}</div>
        <div class="row-sub muted">${new Date(receipt.created_at).toLocaleString()} • Truck ${escapeHtml(receipt.trucks?.truck_identifier || receipt.truck_id || '--')}</div>
        <div class="row-sub">${escapeHtml(renderItemSummary(receipt))}</div>
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
    <div class="detail-sub muted">${[field.address, field.brand, field.power_source].filter(Boolean).join(' • ')}</div>
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
    { label: 'Address', keys: ['address'] },
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
    importInput.accept = '.csv';
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

async function renderReports() {
  viewTitle.textContent = 'Reports';
  viewSubtitle.textContent = 'Time status and inventory audit summaries.';
  viewActions.innerHTML = '';

  const receipts = await listReceipts();
  const approvedReceipts = receipts.filter((receipt) => receipt.status === 'approved');
  const deniedReceipts = receipts.filter((receipt) => receipt.status === 'denied');

  const container = document.createElement('div');
  container.className = 'section-stack';

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
  const fieldWrap = (labelText, inputEl) => {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.append(label, inputEl);
    return wrap;
  };
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

  const inventoryCard = document.createElement('div');
  inventoryCard.className = 'card section-stack';
  inventoryCard.innerHTML = '<h3>Inventory Event</h3>';
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
  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);

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
      renderReports();
    });
  });
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
   const counts = { open:0, paused:0, in_progress:0, finished:0, closed:0 };
    for (const j of jobs){
      const k = quickViewStatusKey(j);
      if (k==='paused') counts.paused++;
      else if (k==='in_progress') counts.in_progress++;
      else if (k==='finished') counts.finished++;
      else if (k==='closed', counts.closed);
      else counts.open++;
    }
    const set = (key,val)=> document.querySelectorAll(`[data-count="${key}"]`).forEach(el=> el.textContent=String(val));
    set('open', counts.open);
    set('paused', counts.paused);
    set('in_progress', counts.in_progress);
    set('finished', counts.finished);
  } catch(e) {}
  try {
    const reqs = await listRequests();
    document.querySelectorAll('[data-count="requests"]').forEach(el=> el.textContent=String(reqs.length));
  } catch(e) {}
  try {
    const oos = await listOutOfStock();
    document.querySelectorAll('[data-count="out_of_stock"]').forEach(el=> el.textContent=String(oos.length));
  } catch(e) {}
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
    openCreateJobModal();
  });
}


function bindInventoryMapShortcut() {
  const btn = document.getElementById('open-inventory-map');
  if (!btn) return;
  btn.addEventListener('click', () => {
    window.open('../inventory-app/inventory.html', '_blank', 'noopener');
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

      showToast('Job created.');
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
bindQuickViews();
bindCreateJobShortcut();
bindInventoryMapShortcut();
bindCreateJobModal();
setView('job-board');
updateQuickViewCounts();
