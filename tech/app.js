
import {
  getBootData,
  listJobs,
  listActiveJobEvents,
  createJob,
  updateJob,
  updateField,
  setJobStatus,
  getJob,
  listJobDiagnostics,
  addJobDiagnostic,
  deleteJobDiagnostic,
  getJobStatusDurations,
  listJobParts,
  addJobPart,
  removeJobPart,
  listJobRepairs,
  addJobRepair,
  listTruckInventory,
  upsertTruckInventory,
  getRestockList,
  commitRestock,
  createOutOfStock,
  listTruckTools,
  listRequests,
  createRequest,
  createReceipt,
  signIn,
  signOut,
  getSession,
} from '../shared/db.js';
import { enqueueAction, processOutbox, saveLastScreen, getLastScreen, clearLastScreen } from '../shared/offline.js';
import { JOB_STATUSES } from '../shared/types.js';
import { generateAndUploadReports } from '../shared/reports.js';

const app = document.getElementById('app');
const toast = document.getElementById('toast');

const state = {
  boot: null,
  tech: null,
  truckId: localStorage.getItem('TECH_TRUCK_ID') || '',
  helpers: JSON.parse(localStorage.getItem('TECH_HELPERS') || '[]'),
  currentJob: null,
  offlineQueueHandlers: {},
};

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function setHelpers(helpers) {
  state.helpers = helpers;
  localStorage.setItem('TECH_HELPERS', JSON.stringify(helpers));
}

function setTruck(truckId) {
  state.truckId = truckId;
  localStorage.setItem('TECH_TRUCK_ID', truckId);
}

async function loadBoot() {
  state.boot = await getBootData();
}

function isOffline() {
  return !navigator.onLine;
}

async function executeOrQueue(action, payload, handler) {
  if (isOffline()) {
    await enqueueAction(action, payload);
    showToast('Saved offline. Will sync when online.');
    return null;
  }
  return handler(payload);
}

async function syncOutbox() {
  await processOutbox(state.offlineQueueHandlers, showToast);
}

function screenContainer(content) {
  app.innerHTML = '';
  app.appendChild(content);
}

function renderHeader() {
  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <button class="pill" id="menu-btn">☰</button>
    <div>
      <div class="muted">Truck</div>
      <select id="truck-select"></select>
    </div>
    <div>
      <div class="muted">Tech</div>
      <div>${state.tech?.full_name || 'Unassigned'}</div>
    </div>
  `;

  const select = header.querySelector('#truck-select');
  state.boot.trucks.forEach((truck) => {
    const option = document.createElement('option');
    option.value = truck.id;
    option.textContent = truck.truck_identifier;
    select.appendChild(option);
  });
  select.value = state.truckId || state.boot.trucks[0]?.id || '';
  if (!state.truckId && select.value) setTruck(select.value);
  select.addEventListener('change', () => setTruck(select.value));

  header.querySelector('#menu-btn').addEventListener('click', () => toggleDrawer(true));
  return header;
}

function renderDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', () => toggleDrawer(false));

  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <h3>Truck Lists</h3>
    <button class="pill" data-action="current">Current Inventory</button>
    <button class="pill" data-action="master">Master Truck Inventory</button>
    <button class="pill" data-action="tools">Truck Tool List</button>
    <h3>Helpers</h3>
    <div class="list" id="helpers-list"></div>
    <button class="pill" data-action="logout">Log Out</button>
  `;

  const helpersList = drawer.querySelector('#helpers-list');
  state.boot.users.filter((user) => user.is_helper).forEach((helper) => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.textContent = helper.full_name;
    btn.addEventListener('click', () => {
      const next = state.helpers.includes(helper.full_name)
        ? state.helpers.filter((name) => name !== helper.full_name)
        : [...state.helpers, helper.full_name];
      setHelpers(next);
      btn.classList.toggle('active');
    });
    if (state.helpers.includes(helper.full_name)) btn.classList.add('active');
    helpersList.appendChild(btn);
  });

  drawer.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      toggleDrawer(false);
      if (action === 'current') return renderInventory();
      if (action === 'master') return renderMasterInventory();
      if (action === 'tools') return renderToolList();
      if (action === 'logout') return handleLogout();
    });
  });

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  state.drawer = { overlay, drawer };
}

function toggleDrawer(show) {
  if (!state.drawer) renderDrawer();
  state.drawer.drawer.classList.toggle('open', show);
  state.drawer.overlay.classList.toggle('show', show);
}

function renderHome() {
  clearLastScreen();
  const container = document.createElement('div');
  container.className = 'app';
  container.appendChild(renderHeader());

  const main = document.createElement('div');
  main.className = 'main list';
  main.innerHTML = `
    <button class="pill large" data-action="create-job">Create Job</button>
    <button class="pill large" data-action="open-jobs">Open Jobs <span class="badge" id="open-count">0</span></button>
    <button class="pill large" data-action="restock">Restock <span class="badge" id="restock-count">0</span></button>
    <button class="pill large" data-action="refuel">Re-fuel</button>
    <button class="pill large" data-action="requests">Requests</button>
    <button class="pill large" data-action="receipts">Receipts</button>
  `;
  container.appendChild(main);
  screenContainer(container);

  main.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'create-job') return renderCreateJob();
      if (action === 'open-jobs') return renderOpenJobs();
      if (action === 'restock') return renderRestock();
      if (action === 'refuel') return renderRefuel();
      if (action === 'requests') return renderRequests();
      if (action === 'receipts') return renderReceipts();
    });
  });

  updateBadgeCounts();
}

async function updateBadgeCounts() {
  const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED] });
  const restock = await getRestockList(state.truckId);
  const openCount = document.getElementById('open-count');
  const restockCount = document.getElementById('restock-count');
  if (openCount) openCount.textContent = jobs.length;
  if (restockCount) restockCount.textContent = restock.length;
}

function renderLogin() {
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h2>Tech Login</h2>
      <label>Email</label>
      <input id="login-email" type="email" placeholder="tech@example.com" />
      <label>Password</label>
      <input id="login-password" type="password" placeholder="Password" />
      <button class="action" id="login-btn">Sign In</button>
      <button class="action secondary" id="offline-btn">Continue Offline</button>
    </div>
  `;
  screenContainer(container);

  container.querySelector('#login-btn').addEventListener('click', async () => {
    const email = container.querySelector('#login-email').value.trim();
    const password = container.querySelector('#login-password').value.trim();
    if (!email || !password) {
      showToast('Enter email and password.');
      return;
    }
    try {
      await signIn(email, password);
      await initializeApp();
    } catch (error) {
      showToast(error.message);
    }
  });

  container.querySelector('#offline-btn').addEventListener('click', async () => {
    if (!state.boot) await loadBoot();
    const lastTech = localStorage.getItem('TECH_USER_EMAIL');
    if (lastTech) {
      state.tech = state.boot.users.find((user) => user.email === lastTech) || null;
    }
    if (!state.tech) {
      showToast('Offline requires a previous login.');
      return;
    }
    renderHome();
  });
}

async function handleLogout() {
  try {
    await signOut();
  } catch (error) {
    console.warn('Sign out failed', error);
  }
  state.tech = null;
  renderLogin();
}

async function initializeApp() {
  await loadBoot();
  const session = await getSession();
  if (session?.user?.email) {
    state.tech = state.boot.users.find((user) => user.email === session.user.email) || null;
    localStorage.setItem('TECH_USER_EMAIL', session.user.email);
  }
  if (!state.tech) {
    showToast('User not found in tech list. Ask office to add your user.');
  }

  const last = getLastScreen();
  if (last.screen && last.jobId) {
    state.currentJob = await getJob(last.jobId);
    return resumeJob(last.screen);
  }

  renderHome();
  await syncOutbox();
}

async function renderInventory() {
  const items = await listTruckInventory(state.truckId);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = '<div class="card"><h3>Current Inventory</h3></div>';
  const card = container.querySelector('.card');
  items.forEach((item) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `<div>${item.products?.name}</div><span class="badge">${item.qty}</span>`;
    card.appendChild(pill);
  });
  if (!items.length) card.innerHTML += '<p>No inventory for this truck.</p>';
  const addCard = document.createElement('div');
  addCard.className = 'card';
  const productOptions = state.boot.products.map((product) => `<option value="${product.id}">${product.name}</option>`).join('');
  addCard.innerHTML = `
    <h4>Add Part to Current Inventory</h4>
    <select id="inv-product">${productOptions}</select>
    <input id="inv-qty" type="number" min="1" value="1" />
    <button class="action" id="inv-add">Add Part</button>
  `;
  addCard.querySelector('#inv-add').addEventListener('click', async () => {
    const qty = parseInt(addCard.querySelector('#inv-qty').value, 10);
    const productId = addCard.querySelector('#inv-product').value;
    if (!qty || !productId) {
      showToast('Select part and qty.');
      return;
    }
    await executeOrQueue('upsertInventory', {
      truck_id: state.truckId,
      product_id: productId,
      qty,
    }, upsertTruckInventory);
    renderInventory();
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  container.appendChild(backBtn);
  container.appendChild(addCard);
  screenContainer(container);
}

async function renderMasterInventory() {
  const restock = await getRestockList(state.truckId);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = '<div class="card"><h3>Master Truck Inventory</h3></div>';
  const card = container.querySelector('.card');
  restock.forEach((item) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>${item.product.name}</div>
      <span class="badge warning">Min ${item.product.minimum_qty}</span>
    `;
    card.appendChild(pill);
  });
  if (!restock.length) card.innerHTML += '<p>No minimums set.</p>';
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  container.appendChild(backBtn);
  screenContainer(container);
}

async function renderToolList() {
  const tools = await listTruckTools(state.truckId);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = '<div class="card"><h3>Truck Tools</h3></div>';
  const card = container.querySelector('.card');
  tools.forEach((tool) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `<div>${tool.tools?.name}</div>`;
    card.appendChild(pill);
  });
  if (!tools.length) card.innerHTML += '<p>No tools assigned.</p>';
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  container.appendChild(backBtn);
  screenContainer(container);
}

function renderCreateJob() {
  const container = document.createElement('div');
  container.className = 'main';
  const customerOptions = state.boot.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join('');
  const fieldOptions = state.boot.fields.map((field) => `<option value="${field.id}">${field.name}</option>`).join('');
  const typeOptions = state.boot.jobTypes.map((type) => `<option value="${type.id}">${type.name}</option>`).join('');

  container.innerHTML = `
    <div class="card">
      <h3>Create Job</h3>
      <label>Customer</label>
      <select id="job-customer">${customerOptions}</select>
      <label>Field</label>
      <select id="job-field">${fieldOptions}</select>
      <label>Job Type</label>
      <select id="job-type">${typeOptions}</select>
      <label>Description</label>
      <textarea id="job-description"></textarea>
      <button class="action" id="job-save">Create Job</button>
      <button class="action secondary" id="job-cancel">Back</button>
    </div>
  `;
  container.querySelector('#job-save').addEventListener('click', async () => {
    const payload = {
      customer_id: container.querySelector('#job-customer').value,
      field_id: container.querySelector('#job-field').value,
      job_type_id: container.querySelector('#job-type').value,
      description: container.querySelector('#job-description').value,
      truck_id: state.truckId,
      tech_id: state.tech?.id,
      helpers: state.helpers.join(', '),
    };
    try {
      await executeOrQueue('createJob', payload, createJob);
      showToast('Job created.');
      renderHome();
    } catch (error) {
      showToast(error.message);
    }
  });
  container.querySelector('#job-cancel').addEventListener('click', renderHome);
  screenContainer(container);
}

async function renderOpenJobs() {
  const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED] });
  const activeEvents = await listActiveJobEvents(jobs.map((job) => job.id));
  const container = document.createElement('div');
  container.className = 'main';
  const map = document.createElement('div');
  map.className = 'card';
  map.textContent = 'Map view placeholder for open + paused jobs.';
  const card = document.createElement('div');
  card.className = 'card list';
  card.innerHTML = '<h3>Open Jobs</h3>';

  jobs
    .sort((a, b) => {
      if (a.status === JOB_STATUSES.PAUSED && b.status !== JOB_STATUSES.PAUSED) return -1;
      if (a.status !== JOB_STATUSES.PAUSED && b.status === JOB_STATUSES.PAUSED) return 1;
      const getEventStart = (job) => {
        const event = activeEvents.find((evt) => evt.job_id === job.id);
        return event ? new Date(event.started_at) : new Date(job.created_at);
      };
      return getEventStart(a) - getEventStart(b);
    })
    .forEach((job) => {
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.innerHTML = `
        <div>
          <strong>${job.customers?.name}</strong>
          <div class="muted">${job.fields?.name} · ${job.job_types?.name}</div>
        </div>
        <span class="badge">${job.status}</span>
      `;
      pill.addEventListener('click', () => renderJobCard(job));
      card.appendChild(pill);
    });

  if (!jobs.length) card.innerHTML += '<p>No open jobs.</p>';

  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);

  container.appendChild(card);
  container.appendChild(map);
  container.appendChild(backBtn);
  screenContainer(container);
}

function renderJobCard(job) {
  state.currentJob = job;
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>${job.customers?.name}</h3>
      <p><strong>Field:</strong> ${job.fields?.name}</p>
      <p><strong>Brand:</strong> ${job.fields?.brand || ''}</p>
      <p><strong>Tower Count:</strong> ${job.fields?.tower_count || ''}</p>
      <p><strong>Serial:</strong> ${job.fields?.serial_number || ''}</p>
      <p><strong>Telemetry:</strong> ${job.fields?.telemetry ? 'Yes' : 'No'}</p>
      <p><strong>Job Type:</strong> ${job.job_types?.name}</p>
      <p>${job.description || ''}</p>
      <div class="actions">
        <button class="action" id="take-job">Take Job</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', renderOpenJobs);
  container.querySelector('#take-job').addEventListener('click', () => renderRoutePrompt(job));
  screenContainer(container);
}

function renderRoutePrompt(job) {
  saveLastScreen('route', job.id);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>Route to Job?</h3>
      <button class="action" id="route">Route Me</button>
      <button class="action secondary" id="skip">Skip</button>
    </div>
  `;
  const routeBtn = container.querySelector('#route');
  if (isOffline()) {
    routeBtn.disabled = true;
    routeBtn.textContent = 'Route unavailable offline';
  } else {
    routeBtn.addEventListener('click', async () => {
      await takeJob(job);
      if (job.fields?.lat && job.fields?.lon) {
        window.open(`https://maps.google.com/?q=${job.fields.lat},${job.fields.lon}`);
      } else {
        showToast('No coordinates set for this field.');
      }
      renderArrived(job);
    });
  }
  container.querySelector('#skip').addEventListener('click', async () => {
    await takeJob(job);
    renderArrived(job);
  });
  screenContainer(container);
}

async function takeJob(job) {
  await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.ON_THE_WAY }, ({ jobId, status }) =>
    setJobStatus(jobId, status)
  );
}

function renderArrived(job) {
  saveLastScreen('arrived', job.id);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>Arrived?</h3>
      <p>${job.customers?.name} · ${job.fields?.name}</p>
      <div class="actions">
        <button class="action" id="arrived">Arrived</button>
        <button class="action danger" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  container.querySelector('#arrived').addEventListener('click', async () => {
    const nextStatus = job.last_active_status || JOB_STATUSES.ON_SITE_DIAGNOSTICS;
    await executeOrQueue('setJobStatus', { jobId: job.id, status: nextStatus }, ({ jobId, status }) =>
      setJobStatus(jobId, status)
    );
    if (nextStatus === JOB_STATUSES.ON_SITE_REPAIR) {
      renderRepair(job);
    } else {
      renderJobIntake(job);
    }
  });
  container.querySelector('#cancel').addEventListener('click', async () => {
    await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.OPEN }, ({ jobId, status }) =>
      setJobStatus(jobId, status)
    );
    renderOpenJobs();
  });
  screenContainer(container);
}

function renderJobIntake(job) {
  saveLastScreen('intake', job.id);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>Job Intake</h3>
      <p>${job.customers?.name} · ${job.fields?.name}</p>
      <label>Field Latitude</label>
      <input id="field-lat" value="${job.fields?.lat || ''}" />
      <label>Field Longitude</label>
      <input id="field-lon" value="${job.fields?.lon || ''}" />
      <label>Serial (Reinke)</label>
      <input id="field-serial" value="${job.fields?.serial_number || ''}" />
      <label>Current Hours</label>
      <input id="field-hours" value="${job.fields?.last_known_hours || ''}" />
      <div class="actions">
        <button class="action" id="start-diagnostics">Start Diagnostics</button>
        <button class="action secondary" id="skip-repair">Skip to Repair</button>
      </div>
    </div>
  `;
  const updateFieldInfo = async () => {
    const payload = {
      lat: container.querySelector('#field-lat').value || null,
      lon: container.querySelector('#field-lon').value || null,
      serial_number: container.querySelector('#field-serial').value || null,
      last_known_hours: container.querySelector('#field-hours').value || null,
    };
    await executeOrQueue('updateField', { fieldId: job.field_id, payload }, ({ fieldId, payload }) => updateField(fieldId, payload));
  };
  container.querySelector('#start-diagnostics').addEventListener('click', async () => {
    await updateFieldInfo();
    renderDiagnostics(job);
  });
  container.querySelector('#skip-repair').addEventListener('click', async () => {
    await updateFieldInfo();
    await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.ON_SITE_REPAIR }, ({ jobId, status }) =>
      setJobStatus(jobId, status)
    );
    renderRepair(job);
  });
  screenContainer(container);
}

async function renderDiagnostics(job) {
  saveLastScreen('diagnostics', job.id);
  const diagnostics = await listJobDiagnostics(job.id);
  const container = document.createElement('div');
  container.className = 'main';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>Diagnostics</h3>
    <div class="card">
      <strong>${job.customers?.name}</strong>
      <div class="muted">${job.fields?.name}</div>
      <div>${job.job_types?.name}</div>
    </div>
    <label>Component Checked</label>
    <input id="component" />
    <label>Check Results</label>
    <textarea id="results"></textarea>
    <button class="action" id="save">Save Entry</button>
    <div class="list" id="diag-list"></div>
    <div class="actions">
      <button class="action" id="found-problem">Found Problem</button>
      <button class="action secondary" id="pause">Pause Job</button>
      <button class="action secondary" id="back">Back</button>
    </div>
  `;
  const list = card.querySelector('#diag-list');
  diagnostics.forEach((entry) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>${entry.component_checked}: ${entry.check_results}</div>
      <span class="badge">Remove</span>
    `;
    pill.addEventListener('click', async () => {
      await executeOrQueue('deleteDiagnostic', { id: entry.id }, ({ id }) => deleteJobDiagnostic(id));
      renderDiagnostics(job);
    });
    list.appendChild(pill);
  });

  card.querySelector('#save').addEventListener('click', async () => {
    const payload = {
      job_id: job.id,
      component_checked: card.querySelector('#component').value,
      check_results: card.querySelector('#results').value,
    };
    if (!payload.component_checked || !payload.check_results) {
      showToast('Enter component and results.');
      return;
    }
    await executeOrQueue('addDiagnostic', payload, addJobDiagnostic);
    renderDiagnostics(job);
  });
  card.querySelector('#found-problem').addEventListener('click', () => renderFoundProblem(job));
  card.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_DIAGNOSTICS));
  card.querySelector('#back').addEventListener('click', renderJobIntake.bind(null, job));

  container.appendChild(card);
  screenContainer(container);
}

function renderFoundProblem(job) {
  saveLastScreen('found-problem', job.id);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>Found Problem</h3>
      <div class="card">
        <strong>${job.customers?.name}</strong>
        <div class="muted">${job.fields?.name}</div>
        <div>${job.job_types?.name}</div>
      </div>
      <label>Description</label>
      <textarea id="problem"></textarea>
      <div class="actions">
        <button class="action" id="continue" disabled>Continue to Repair</button>
        <button class="action secondary" id="pause">Pause Job</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;
  const input = container.querySelector('#problem');
  const continueBtn = container.querySelector('#continue');
  input.addEventListener('input', () => {
    continueBtn.disabled = !input.value.trim();
  });
  continueBtn.addEventListener('click', async () => {
    await executeOrQueue('updateJob', { jobId: job.id, payload: { problem_description: input.value.trim() } }, ({ jobId, payload }) =>
      updateJob(jobId, payload)
    );
    await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.ON_SITE_REPAIR }, ({ jobId, status }) =>
      setJobStatus(jobId, status)
    );
    renderRepair(job);
  });
  container.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_DIAGNOSTICS));
  container.querySelector('#back').addEventListener('click', () => renderDiagnostics(job));
  screenContainer(container);
}

async function renderRepair(job) {
  saveLastScreen('repair', job.id);
  const parts = await listJobParts(job.id);
  const inventory = await listTruckInventory(state.truckId);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>Repair</h3>
      <div class="card">
        <strong>${job.customers?.name}</strong>
        <div class="muted">${job.fields?.name}</div>
        <div>${job.job_types?.name}</div>
      </div>
      <label>Repair Description</label>
      <textarea id="repair-desc">${job.repair_description || ''}</textarea>
      <h4>Add Parts</h4>
      <select id="part-select"></select>
      <input id="part-qty" type="number" value="1" min="1" />
      <button class="action success" id="add-part">Add Part</button>
      <div class="list" id="parts-list"></div>
      <div class="actions">
        <button class="action" id="complete">Complete Job</button>
        <button class="action secondary" id="pause">Pause Job</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;

  const select = container.querySelector('#part-select');
  inventory.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.product_id;
    option.textContent = `${item.products?.name} (${item.qty})`;
    select.appendChild(option);
  });

  const list = container.querySelector('#parts-list');
  parts.forEach((part) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `
      <div>${part.products?.name} (x${part.qty})</div>
      <span class="badge">Remove</span>
    `;
    pill.addEventListener('click', async () => {
      await executeOrQueue('removeJobPart', { job_part_id: part.id, truck_id: state.truckId }, removeJobPart);
      renderRepair(job);
    });
    list.appendChild(pill);
  });

  container.querySelector('#add-part').addEventListener('click', async () => {
    const qty = parseInt(container.querySelector('#part-qty').value, 10);
    if (!select.value || !qty) {
      showToast('Select part and quantity.');
      return;
    }
    await executeOrQueue('addJobPart', {
      job_id: job.id,
      product_id: select.value,
      truck_id: state.truckId,
      qty,
    }, addJobPart);
    container.querySelector('#part-qty').value = 1;
    renderRepair(job);
  });

  container.querySelector('#complete').addEventListener('click', async () => {
    const desc = container.querySelector('#repair-desc').value.trim();
    if (!desc) {
      showToast('Repair description required.');
      return;
    }
    await executeOrQueue('updateJob', { jobId: job.id, payload: { repair_description: desc } }, ({ jobId, payload }) =>
      updateJob(jobId, payload)
    );
    await executeOrQueue('addRepair', { job_id: job.id, description: desc }, addJobRepair);
    renderChecklist(job);
  });
  container.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_REPAIR));
  container.querySelector('#back').addEventListener('click', () => renderFoundProblem(job));
  screenContainer(container);
}

function renderChecklist(job) {
  saveLastScreen('checklist', job.id);
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card checklist">
      <h3>Final Checklist</h3>
      <label><input type="checkbox" /> Verify all repair parts are tight, affixed, and in original appearance</label>
      <label><input type="checkbox" /> Verify all parts are accounted for and trash is picked up</label>
      <label><input type="checkbox" /> Adjust timer in MCP to 80% and select a direction if water is required to verify repair</label>
      <label><input type="checkbox" /> Start system and verify all towers are moving (if unable to see all towers, verify 1st tower moves at least 3 times)</label>
      <label><input type="checkbox" /> If water running verify end gun turns off and on</label>
      <label><input type="checkbox" /> Contact supervisor or customer if system is desired to be left running</label>
      <label><input type="checkbox" /> If desired to be left running make changes and finish; if no confirmation turn off system and main power disconnect</label>
      <label><input type="checkbox" /> Verify all panel doors are closed</label>
      <textarea id="unable-reason" placeholder="Unable to perform reason (if needed)"></textarea>
      <div class="actions">
        <button class="action" id="complete">Complete</button>
        <button class="action secondary" id="unable">Unable to Perform</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;
  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];
  const completeBtn = container.querySelector('#complete');
  const unableBtn = container.querySelector('#unable');

  completeBtn.addEventListener('click', () => finalizeJob(job, checkboxes, false));
  unableBtn.addEventListener('click', () => finalizeJob(job, checkboxes, true));
  container.querySelector('#back').addEventListener('click', () => renderRepair(job));
  screenContainer(container);
}

async function finalizeJob(job, checkboxes, allowIncomplete) {
  const allChecked = checkboxes.every((cb) => cb.checked);
  const reason = document.getElementById('unable-reason').value.trim();
  if (!allChecked && !allowIncomplete) {
    showToast('Complete all checklist items or use Unable to Perform.');
    return;
  }
  if (allowIncomplete && !reason) {
    showToast('Provide a reason to complete with Unable to Perform.');
    return;
  }
  await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.FINISHED }, ({ jobId, status }) =>
    setJobStatus(jobId, status)
  );
  if (!isOffline()) {
    const [diagnostics, repairs, parts] = await Promise.all([
      listJobDiagnostics(job.id),
      listJobRepairs(job.id),
      listJobParts(job.id),
    ]);
    const durations = await getJobStatusDurations(job.id);
    await generateAndUploadReports({ job, diagnostics, repairs, parts, durations });
  } else {
    await enqueueAction('generateReports', { jobId: job.id });
  }
  clearLastScreen();
  showToast('Job completed.');
  renderHome();
}

async function pauseJob(job, lastStatus) {
  const reason = prompt('Enter pause reason');
  if (!reason) return;
  await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.PAUSED, options: { notes: reason, lastActiveStatus: lastStatus } }, ({ jobId, status, options }) =>
    setJobStatus(jobId, status, options)
  );
  renderHome();
}

async function resumeJob(screen) {
  if (!state.currentJob) return renderHome();
  if (screen === 'diagnostics') return renderDiagnostics(state.currentJob);
  if (screen === 'repair') return renderRepair(state.currentJob);
  if (screen === 'checklist') return renderChecklist(state.currentJob);
  return renderHome();
}

async function renderRestock() {
  const restockItems = await getRestockList(state.truckId);
  const container = document.createElement('div');
  container.className = 'main';
  const card = document.createElement('div');
  card.className = 'card list';
  card.innerHTML = '<h3>Restock</h3>';

  restockItems.forEach((item) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    if (item.acquiredQty && item.acquiredQty >= item.neededQty) {
      pill.classList.add('success');
    }
    pill.innerHTML = `
      <div>${item.product.name}</div>
      <span class="badge warning">${item.currentQty}</span>
      <span class="badge danger">Need ${item.neededQty}</span>
    `;
    pill.addEventListener('click', () => renderRestockItem(item, restockItems));
    card.appendChild(pill);
  });

  if (!restockItems.length) card.innerHTML += '<p>No restock needed.</p>';

  const commitBtn = document.createElement('button');
  commitBtn.className = 'action';
  commitBtn.textContent = 'Commit Restock';
  commitBtn.addEventListener('click', async () => {
    await executeOrQueue('commitRestock', { truckId: state.truckId, restockItems }, ({ truckId, restockItems }) =>
      commitRestock(truckId, restockItems)
    );
    renderHome();
  });

  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);

  container.appendChild(card);
  container.appendChild(commitBtn);
  container.appendChild(backBtn);
  screenContainer(container);
}

function renderRestockItem(item, restockItems) {
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>${item.product.name}</h3>
      <label>Acquired Qty</label>
      <input id="acquired" type="number" min="0" value="${item.acquiredQty || 0}" />
      <div class="actions">
        <button class="action" id="save">Save</button>
        <button class="action danger" id="out">Out of Stock</button>
        <button class="action secondary" id="close">Close</button>
      </div>
    </div>
  `;
  container.querySelector('#save').addEventListener('click', () => {
    const qty = parseInt(container.querySelector('#acquired').value, 10) || 0;
    item.acquiredQty = qty;
    renderRestock();
  });
  container.querySelector('#out').addEventListener('click', async () => {
    await executeOrQueue('outOfStock', {
      product_id: item.product.id,
      truck_id: state.truckId,
      notes: 'Marked out of stock from tech restock flow.',
    }, createOutOfStock);
    renderRestock();
  });
  container.querySelector('#close').addEventListener('click', renderRestock);
  screenContainer(container);
}

function renderRefuel() {
  const container = document.createElement('div');
  container.className = 'main';
  container.innerHTML = `
    <div class="card">
      <h3>Re-fuel</h3>
      <label>Current Odometer</label>
      <input id="odometer" type="number" />
      <label>Gallons</label>
      <input id="gallons" type="number" />
      <label>Price / Gallon</label>
      <input id="price" type="number" />
      <label>Total Cost</label>
      <input id="total" type="number" />
      <div class="actions">
        <button class="action" id="save">Save</button>
        <button class="action secondary" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  container.querySelector('#save').addEventListener('click', async () => {
    const payload = {
      receipt_type: 'Re-fuel',
      truck_id: state.truckId,
      tech_id: state.tech?.id,
      odometer: container.querySelector('#odometer').value,
      gallons: container.querySelector('#gallons').value,
      price_per_gallon: container.querySelector('#price').value,
      total_cost: container.querySelector('#total').value,
    };
    if (!payload.odometer || !payload.gallons || !payload.price_per_gallon || !payload.total_cost) {
      showToast('All fields required.');
      return;
    }
    await executeOrQueue('createReceipt', payload, createReceipt);
    showToast('Refuel receipt saved.');
    renderHome();
  });
  container.querySelector('#cancel').addEventListener('click', renderHome);
  screenContainer(container);
}

async function renderRequests() {
  const requests = await listRequests(state.truckId);
  const container = document.createElement('div');
  container.className = 'main';
  const card = document.createElement('div');
  card.className = 'card list';
  card.innerHTML = '<h3>Requests</h3>';
  requests.forEach((req) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = `<div>${req.request_type}</div><span class="badge">${req.description}</span>`;
    card.appendChild(pill);
  });
  if (!requests.length) card.innerHTML += '<p>No pending requests.</p>';
  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.textContent = 'Add Request';
  addBtn.addEventListener('click', renderRequestForm);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  container.appendChild(card);
  container.appendChild(addBtn);
  container.appendChild(backBtn);
  screenContainer(container);
}

async function renderRequestForm() {
  const container = document.createElement('div');
  container.className = 'main';
  const helperOptions = state.boot.users.map((user) => `<option value="${user.id}">${user.full_name}</option>`).join('');
  const truckTools = await listTruckTools(state.truckId);
  const toolOptions = truckTools.map((tool) => `<option value="${tool.tools?.name}">${tool.tools?.name}</option>`).join('');
  const requestTypeOptions = state.boot.requestTypes.map((type) => `<option value="${type.name}">${type.name}</option>`).join('');
  container.innerHTML = `
    <div class="card">
      <h3>New Request</h3>
      <label>Request Type</label>
      <select id="req-type">${requestTypeOptions}</select>
      <div id="req-timeoff" class="section">
        <label>Person</label>
        <select id="req-person">${helperOptions}</select>
        <label>Date/Time</label>
        <input id="req-date" type="datetime-local" />
      </div>
      <div id="req-tool" class="section">
        <label>Tool Request Type</label>
        <select id="tool-type">
          <option value="new">New Tool</option>
          <option value="replacement">Replacement</option>
        </select>
        <label>Replacement Tool</label>
        <select id="req-tool-name">${toolOptions}</select>
        <label>Reason / Description</label>
        <textarea id="req-tool-desc"></textarea>
      </div>
      <div id="req-maintenance" class="section">
        <label>Odometer</label>
        <input id="req-odometer" type="number" />
        <label>Description</label>
        <textarea id="req-maintenance-desc"></textarea>
      </div>
      <div id="req-purchase" class="section">
        <label>Description</label>
        <textarea id="req-purchase-desc"></textarea>
      </div>
      <div class="actions">
        <button class="action" id="save">Save</button>
        <button class="action secondary" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  const reqTypeSelect = container.querySelector('#req-type');
  const sections = {
    'Time off': container.querySelector('#req-timeoff'),
    Tool: container.querySelector('#req-tool'),
    'Truck maintenance': container.querySelector('#req-maintenance'),
    Purchase: container.querySelector('#req-purchase'),
  };
  const updateSections = () => {
    Object.values(sections).forEach((section) => { section.style.display = 'none'; });
    const selected = reqTypeSelect.value;
    if (sections[selected]) sections[selected].style.display = 'grid';
  };
  updateSections();
  reqTypeSelect.addEventListener('change', updateSections);

  container.querySelector('#save').addEventListener('click', async () => {
    const type = container.querySelector('#req-type').value;
    let desc = '';
    const metadata = {};
    if (type === 'Time off') {
      metadata.person_id = container.querySelector('#req-person').value;
      metadata.date = container.querySelector('#req-date').value;
      desc = `Time off requested for ${metadata.date || 'unspecified date'}.`;
    } else if (type === 'Tool') {
      metadata.tool_type = container.querySelector('#tool-type').value;
      metadata.tool_name = container.querySelector('#req-tool-name').value;
      desc = container.querySelector('#req-tool-desc').value.trim();
      if (metadata.tool_type === 'replacement' && !metadata.tool_name) {
        showToast('Select replacement tool.');
        return;
      }
    } else if (type === 'Truck maintenance') {
      metadata.odometer = container.querySelector('#req-odometer').value;
      desc = container.querySelector('#req-maintenance-desc').value.trim();
      if (!metadata.odometer) {
        showToast('Odometer required.');
        return;
      }
    } else if (type === 'Purchase') {
      desc = container.querySelector('#req-purchase-desc').value.trim();
    }
    if (!desc) {
      showToast('Description required.');
      return;
    }
    const payload = {
      truck_id: state.truckId,
      user_id: state.tech?.id,
      request_type: type,
      description: desc,
      metadata,
    };
    await executeOrQueue('createRequest', payload, createRequest);
    renderRequests();
  });
  container.querySelector('#cancel').addEventListener('click', renderRequests);
  screenContainer(container);
}

function renderReceipts() {
  const container = document.createElement('div');
  container.className = 'main';
  const receiptOptions = state.boot.receiptTypes.map((type) => `<option value="${type.name}">${type.name}</option>`).join('');
  container.innerHTML = `
    <div class="card">
      <h3>Add Receipt</h3>
      <label>Receipt Type</label>
      <select id="receipt-type">${receiptOptions}</select>
      <label>Qty</label>
      <input id="receipt-qty" type="number" />
      <label>Description</label>
      <textarea id="receipt-desc"></textarea>
      <div class="actions">
        <button class="action" id="save">Save</button>
        <button class="action secondary" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  container.querySelector('#save').addEventListener('click', async () => {
    const payload = {
      receipt_type: container.querySelector('#receipt-type').value,
      qty: container.querySelector('#receipt-qty').value,
      description: container.querySelector('#receipt-desc').value,
      truck_id: state.truckId,
      tech_id: state.tech?.id,
    };
    await executeOrQueue('createReceipt', payload, createReceipt);
    showToast('Receipt saved.');
    renderHome();
  });
  container.querySelector('#cancel').addEventListener('click', renderHome);
  screenContainer(container);
}

state.offlineQueueHandlers = {
  createJob: (payload) => createJob(payload),
  setJobStatus: ({ jobId, status, options }) => setJobStatus(jobId, status, options),
  updateJob: ({ jobId, payload }) => updateJob(jobId, payload),
  updateField: ({ fieldId, payload }) => updateField(fieldId, payload),
  addDiagnostic: (payload) => addJobDiagnostic(payload),
  deleteDiagnostic: ({ id }) => deleteJobDiagnostic(id),
  addJobPart: (payload) => addJobPart(payload),
  removeJobPart: (payload) => removeJobPart(payload),
  addRepair: (payload) => addJobRepair(payload),
  commitRestock: ({ truckId, restockItems }) => commitRestock(truckId, restockItems),
  outOfStock: (payload) => createOutOfStock(payload),
  createRequest: (payload) => createRequest(payload),
  createReceipt: (payload) => createReceipt(payload),
  upsertInventory: (payload) => upsertTruckInventory(payload),
  generateReports: async ({ jobId }) => {
    const job = await getJob(jobId);
    const [diagnostics, repairs, parts] = await Promise.all([
      listJobDiagnostics(jobId),
      listJobRepairs(jobId),
      listJobParts(jobId),
    ]);
    const durations = await getJobStatusDurations(jobId);
    await generateAndUploadReports({ job, diagnostics, repairs, parts, durations });
  },
};

window.addEventListener('online', syncOutbox);

renderLogin();
