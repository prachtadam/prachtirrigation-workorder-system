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
  deleteTruckInventory,
  listAllRequests,
  resolveRequest,
  listRequestHistory,
  listOutOfStock,
  deleteOutOfStock,
  listReceipts,
  deleteReceipt,
  markJobInvoiced,
  cancelJob,
} from '../shared/db.js';
import { saveConfig } from '../shared/config.js';
import { JOB_STATUSES } from '../shared/types.js';

const viewTitle = document.getElementById('view-title');
const viewSubtitle = document.getElementById('view-subtitle');
const viewContainer = document.getElementById('view-container');
const viewActions = document.getElementById('view-actions');
const toast = document.getElementById('toast');

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

async function refreshBoot() {
  state.boot = await getBootData();
}

async function renderJobBoard() {
  viewTitle.textContent = 'Job Board';
  viewSubtitle.textContent = 'Filter by status and review job cards.';
  viewActions.innerHTML = '';

  const filterButtons = document.createElement('div');
  filterButtons.className = 'toolbar-actions';
  const filters = [
    { id: 'open', label: 'Open Jobs' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'paused', label: 'Paused' },
    { id: 'finished', label: 'Finished' },
    { id: 'invoiced', label: 'Closed/Invoiced' },
  ];
  filters.forEach((filter) => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.textContent = filter.label;
    btn.addEventListener('click', () => renderJobBoardList(filter.id));
    filterButtons.appendChild(btn);
  });
  viewActions.appendChild(filterButtons);

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
  mapPanel.className = 'map-placeholder';
  mapPanel.textContent = 'Map view placeholder (connect to mapping provider).';

  const listPanel = document.createElement('div');
  listPanel.className = 'card list';
  const detailPanel = document.createElement('div');
  detailPanel.className = 'card section-stack';
  detailPanel.innerHTML = '<p>Select a job to view details.</p>';

  const createButton = document.createElement('button');
  createButton.className = 'pill';
  createButton.textContent = '+ Create Job';
  createButton.addEventListener('click', () => {
    detailPanel.innerHTML = `
      <h3>Create Job</h3>
      <form id="create-job-form" class="section-stack">
        <label>Customer</label>
        <select name="customer_id">
          ${state.boot.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join('')}
        </select>
        <label>Field</label>
        <select name="field_id">
          ${state.boot.fields.map((field) => `<option value="${field.id}">${field.name}</option>`).join('')}
        </select>
        <label>Job Type</label>
        <select name="job_type_id">
          ${state.boot.jobTypes.map((jobType) => `<option value="${jobType.id}">${jobType.name}</option>`).join('')}
        </select>
        <label>Truck</label>
        <select name="truck_id">
          <option value="">Unassigned</option>
          ${state.boot.trucks.map((truck) => `<option value="${truck.id}">${truck.truck_identifier}</option>`).join('')}
        </select>
        <label>Tech</label>
        <select name="tech_id">
          <option value="">Unassigned</option>
          ${state.boot.users.map((user) => `<option value="${user.id}">${user.full_name}</option>`).join('')}
        </select>
        <label>Description</label>
        <textarea name="description"></textarea>
        <label>Office Notes</label>
        <textarea name="office_notes"></textarea>
        <button class="action" type="submit">Create Job</button>
      </form>
    `;
    detailPanel.querySelector('#create-job-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = {
        customer_id: form.customer_id.value,
        field_id: form.field_id.value,
        job_type_id: form.job_type_id.value,
        truck_id: form.truck_id.value || null,
        tech_id: form.tech_id.value || null,
        description: form.description.value,
        office_notes: form.office_notes.value,
        status: JOB_STATUSES.OPEN,
      };
      try {
        await createJob(payload);
        showToast('Job created.');
        await renderJobBoardList(filterId);
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  listPanel.appendChild(createButton);

  const filterMap = {
    open: { statuses: [JOB_STATUSES.PAUSED, JOB_STATUSES.OPEN] },
    in_progress: { statuses: [JOB_STATUSES.ON_SITE_REPAIR, JOB_STATUSES.ON_SITE_DIAGNOSTICS, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.PAUSED] },
    paused: { statuses: [JOB_STATUSES.PAUSED] },
    finished: { statuses: [JOB_STATUSES.FINISHED] },
    invoiced: { statuses: [JOB_STATUSES.INVOICED] },
  };

  const filter = { ...filterMap[filterId] };
  if (state.jobDateFilter && filterId === 'finished') {
    filter.finishedAfter = new Date(state.jobDateFilter).toISOString();
  }
  if (state.jobDateFilter && filterId === 'invoiced') {
    filter.invoicedAfter = new Date(state.jobDateFilter).toISOString();
  }
  const jobs = await listJobs(filter);
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
    btn.className = 'pill';
    btn.innerHTML = `
      <div>
        <strong>${job.customers?.name || 'Customer'}</strong>
        <div class="muted">${job.fields?.name || 'Field'} · ${job.job_types?.name || ''}</div>
      </div>
      <span class="badge">${statusLabel(job.status)}</span>
    `;
    btn.addEventListener('click', async () => {
      const durations = await getJobStatusDurations(job.id);
      detailPanel.innerHTML = `
        <div>
          <h3>${job.customers?.name || ''} - ${job.fields?.name || ''}</h3>
          <p><strong>Status:</strong> ${statusLabel(job.status)}</p>
          <p><strong>Tech:</strong> ${job.users?.full_name || 'Unassigned'}</p>
          <p><strong>Age:</strong> ${formatDuration((Date.now() - new Date(job.created_at)) / 1000)}</p>
          <p><strong>Job Type:</strong> ${job.job_types?.name || ''}</p>
          <p><strong>Description:</strong> ${job.description || ''}</p>
          <p><strong>Office Notes:</strong> ${job.office_notes || 'None'}</p>
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
          ${job.attachments?.length ? job.attachments.map((att) => `<a href="${att.file_url}" target="_blank">${att.attachment_type}</a>`).join('<br/>') : '<p>No reports yet.</p>'}
        </div>
        <div class="form-grid">
          ${job.status !== JOB_STATUSES.INVOICED && job.status !== JOB_STATUSES.CANCELED ? '<button class="action" data-action="invoice">Mark Invoiced</button>' : ''}
          ${job.status !== JOB_STATUSES.CANCELED ? '<button class="action danger" data-action="cancel">Cancel Job</button>' : ''}
        </div>
      `;

      const invoiceBtn = detailPanel.querySelector('[data-action="invoice"]');
      if (invoiceBtn) {
        invoiceBtn.addEventListener('click', async () => {
          try {
            await markJobInvoiced(job.id);
            showToast('Job marked invoiced.');
            await renderJobBoardList(filterId);
          } catch (error) {
            showToast(error.message);
          }
        });
      }
      const cancelBtn = detailPanel.querySelector('[data-action="cancel"]');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          const reason = prompt('Enter cancel reason');
          if (!reason) return;
          try {
            await cancelJob(job.id, reason);
            showToast('Job canceled.');
            await renderJobBoardList(filterId);
          } catch (error) {
            showToast(error.message);
          }
        });
      }
    });
    listPanel.appendChild(btn);
  });

  if (!sortedJobs.length) {
    listPanel.innerHTML += '<p>No jobs found for this filter.</p>';
  }

  const grid = document.createElement('div');
  grid.className = 'grid-two';
  grid.appendChild(listPanel);
  grid.appendChild(detailPanel);

  listWrapper.appendChild(mapPanel);
  listWrapper.appendChild(grid);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(listWrapper);
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

async function renderRequests() {
  viewTitle.textContent = 'Requests';
  viewSubtitle.textContent = 'Resolve and archive tech requests.';
  viewActions.innerHTML = '';

  const [requests, history] = await Promise.all([
    listAllRequests(),
    listRequestHistory(),
  ]);

  const layout = document.createElement('div');
  layout.className = 'grid-two';

  const activeCard = document.createElement('div');
  activeCard.className = 'card section-stack';
  activeCard.innerHTML = '<h3>Active Requests</h3>';

  requests.forEach((req) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>
        <strong>${req.request_type}</strong>
        <div class="muted">${req.users?.full_name || 'Tech'}</div>
        <div>${req.description}</div>
      </div>
      <span class="badge">Resolve</span>
    `;
    pill.addEventListener('click', async () => {
      try {
        await resolveRequest(req.id);
        showToast('Request resolved and archived.');
        await renderRequests();
      } catch (error) {
        showToast(error.message);
      }
    });
    activeCard.appendChild(pill);
  });

  if (!requests.length) {
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
  viewSubtitle.textContent = 'Archived receipts and 2-step removal.';
  viewActions.innerHTML = '';

  const receipts = await listReceipts();
  const container = document.createElement('div');
  container.className = 'card section-stack';

  receipts.forEach((receipt) => {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>
        <strong>${receipt.receipt_type}</strong>
        <div class="muted">${new Date(receipt.created_at).toLocaleString()}</div>
        <div>${receipt.description || ''}</div>
      </div>
      <button class="action danger" data-step="1">Remove</button>
    `;
    const removeBtn = pill.querySelector('button');
    removeBtn.addEventListener('click', async () => {
      if (removeBtn.dataset.step === '1') {
        removeBtn.textContent = 'Confirm Remove';
        removeBtn.dataset.step = '2';
        return;
      }
      try {
        await deleteReceipt(receipt.id);
        showToast('Receipt removed.');
        await renderReceipts();
      } catch (error) {
        showToast(error.message);
      }
    });
    container.appendChild(pill);
  });

  if (!receipts.length) {
    container.innerHTML += '<p>No receipts archived.</p>';
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
      </div>
      <button class="action" type="submit">Save Settings</button>
    </form>
  `;
  card.querySelector('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    saveConfig({
      supabaseUrl: data.get('supabaseUrl'),
      supabaseAnonKey: data.get('supabaseAnonKey'),
      orgId: data.get('orgId'),
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

    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = k; // supabase column key (debug/clarity)

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

    wrap.append(labelEl, hint, input);
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
      ['name','Customer Name'],
      ['phone','Phone'],
      ['email','Email'],
      ['address','Address'],
    ];
    const inputs = {};
    fields.forEach((k)=>{
      const label = prettyLabel(k);
      const wrap = document.createElement('div');
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input'); inp.name = k; inp.placeholder = label;
      inputs[k]=inp;
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
      fields.forEach(([k])=> payload[k] = inputs[k].value.trim());
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
      ['name','Field Name'], ['brand','Brand'], ['power_source','Power Source'],
      ['serial_number','Serial Number'], ['tower_count','Tower Count'],
      ['address','Address'], ['lat','Latitude'], ['lng','Longitude'],
      ['sprinkler_package','Sprinkler Package #'], ['telemetry_make','Telemetry Make'], ['telemetry_serial','Telemetry Serial'],
    ];
    const inputs={};
    fieldsDef.forEach((k)=>{
      const label = prettyLabel(k);
      const wrap=document.createElement('div');
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.placeholder=label;
      inputs[k]=inp; wrap.append(lab, inp); form.appendChild(wrap);
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
      fieldsDef.forEach((k)=>{ if(inputs[k]) payload[k]=inputs[k].value.trim(); });
      if(!payload.name) return showToast('Field name is required.');
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

  // Customer info (simple: name / phone / email / address)
  const infoCard = document.createElement('div');
  infoCard.className = 'card info-card';
  infoCard.appendChild(renderInfoGrid(field, { hideKeys: [] }));

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
    btn.addEventListener('click', ()=>{
      // For now: hand off to existing job board detail rendering by switching job-board and filtering not required.
      // You can extend to show report or job card in-place later without touching Supabase.
      showToast(status === 'finished' ? 'Finished job: open reports view from Job Board.' : 'Open job: view details from Job Board.');
    });
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

  const draft = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
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
  viewActions.append(saveBtn, addBtn, backBtn);

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
          <div class="row-sub muted">Qty: ${item.qty || 0}</div>
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
      qtyLabel.textContent = 'Quantity';
      qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '0';
      const qtyWrap = document.createElement('div');
      qtyWrap.append(qtyLabel, qtyInput);
      form.append(wrap, qtyWrap);
      body.append(form, foot);
      const { close } = openModalSimple({ title: 'Add Part', bodyEl: body });
      cancel.addEventListener('click', () => close());
      save.addEventListener('click', () => {
        const labelText = primaryInput.value.trim();
        const product = productMap.get(labelText);
        if (!product) return showToast('Select a valid product.');
        const qty = Number(qtyInput.value || 0);
        if (!qty) return showToast('Quantity is required.');
        const existing = draft.find((item) => item.product_id === product.id);
        if (existing) {
          existing.qty += qty;
        } else {
          draft.push({ product_id: product.id, name: product.name, qty });
        }
        close();
        renderDraft();
      });
      return;
    }

    const label = document.createElement('label');
    label.textContent = 'Tool Name';
    primaryInput = document.createElement('input');
    primaryInput.placeholder = 'Tool name';
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
      const name = primaryInput.value.trim();
      const qty = Number(qtyInput.value || 0);
      if (!name) return showToast('Tool name is required.');
      if (!qty) return showToast('Quantity is required.');
      const existing = draft.find((item) => item.tool_name === name);
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
        await Promise.all([
          ...Array.from(deletedIds).map((id) => deleteTruckTool(id)),
          ...draft.map((item) => {
            if (item.id) {
              return updateTruckTool(item.id, { tool_name: item.tool_name, qty: item.qty, truck_id: truckId });
            }
            return addTruckTool({ truck_id: truckId, tool_name: item.tool_name, qty: item.qty });
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

  renderDraft();
  container.append(infoCard, listCard);
  viewContainer.innerHTML = '';
  viewContainer.appendChild(container);
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
  users: () => renderListView({
    title: 'Users',
    subtitle: 'Manage tech and helper users.',
    listLoader: listUsers,
    createHandler: createUser,
    updateHandler: updateUser,
    deleteHandler: deleteUser,
    fields: [
      { key: 'full_name', label: 'Full Name' },
      { key: 'role', label: 'Role' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
    ],
  }),
  'job-types': () => renderListView({
    title: 'Job Types',
    subtitle: 'Define job categories.',
    listLoader: listJobTypes,
    createHandler: createJobType,
    updateHandler: updateJobType,
    deleteHandler: deleteJobType,
    fields: [
      { key: 'name', label: 'Job Type Name' },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  }),
  products: () => renderListView({
    title: 'Parts',
    subtitle: 'Master product list and minimums.',
    listLoader: listProducts,
    createHandler: createProduct,
    updateHandler: updateProduct,
    deleteHandler: deleteProduct,
    enableImportExport: true,
    filePrefix: 'parts',
    fields: [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Part Name' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'minimum_qty', label: 'Minimum Qty', type: 'number' },
    ],
  }),
  tools: renderToolsView,
  requests: renderRequests,
  'out-of-stock': renderOutOfStock,
  receipts: renderReceipts,
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
    const counts = { open:0, paused:0, in_progress:0, finished:0 };
    for (const j of jobs){
      const k = jobStatusKey(j);
      if (k==='paused') counts.paused++;
      else if (k==='in_progress') counts.in_progress++;
      else if (k==='finished') counts.finished++;
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
  btn.addEventListener('click', async () => {
    await setView('job-board');
    await new Promise((r)=>setTimeout(r,0));
    const b = Array.from(viewContainer.querySelectorAll('button.pill')).find(x=> (x.textContent||'').toLowerCase().includes('create job'));
    if (b) b.click();
  });
}

bindNav();
bindHamburgerMenuUI();
bindQuickViews();
bindCreateJobShortcut();
setView('job-board');
updateQuickViewCounts();
