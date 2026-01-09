
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
  deleteTruckTool,
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
          await updateHandler(item.id, payload);
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
        await deleteHandler(item.id);
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

  function renderToolDetail(tool) {
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

const viewHandlers = {
  'job-board': renderJobBoard,
  customers: () => renderListView({
    title: 'Customers',
    subtitle: 'Manage customer profiles.',
    listLoader: listCustomers,
    createHandler: createCustomer,
    updateHandler: updateCustomer,
    deleteHandler: deleteCustomer,
    enableImportExport: true,
    filePrefix: 'customers',
    fields: [
      { key: 'name', label: 'Customer Name' },
      { key: 'contact_name', label: 'Contact Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  }),
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
  trucks: () => renderListView({
    title: 'Trucks',
    subtitle: 'Manage truck profiles.',
    listLoader: listTrucks,
    createHandler: createTruck,
    updateHandler: updateTruck,
    deleteHandler: deleteTruck,
    fields: [
      { key: 'truck_identifier', label: 'Truck ID' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  }),
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

bindNav();
setView('job-board');
