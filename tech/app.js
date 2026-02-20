import {
  getBootData,
  listJobs,
  listActiveJobEvents,
  createJob,
  updateJob,
  updateField,
  updateTruck,
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
  updateUser,
   addAttachment,
  listDiagnosticWorkflows,
  listDiagnosticWorkflowBrands,
  listDiagnosticNodes,
  listDiagnosticEdges,
  listDiagnosticNodeLayouts,
  createDiagnosticWorkflowRun,
  updateDiagnosticWorkflowRun,
  createDiagnosticRunEvent,
  listDiagnosticWorkflowRuns,
  uploadJobPhoto,
  signIn,
  signOut,
  getSession,
  runSupabaseHealthCheck,
} from '../shared/db.js';
import { enqueueAction, processOutbox, saveLastScreen, getLastScreen, clearLastScreen } from '../shared/offline.js';
import { JOB_STATUSES } from '../shared/types.js';
import { generateAndUploadDiagnosticsReport, generateAndUploadReports } from '../shared/reports.js';

const app = document.getElementById('app');
const toast = document.getElementById('toast');

const state = {
  boot: null,
  tech: null,
  truckId: localStorage.getItem('TECH_TRUCK_ID') || '',
  helpers: JSON.parse(localStorage.getItem('TECH_HELPERS') || '[]'),
  currentJob: null,
  offlineQueueHandlers: {},
  diagnosticsRun: {
    run: null,
    workflow: null,
    brand: null,
    nodes: [],
    edges: [],
    currentNodeId: null,
    stepStartedAt: null,
    repairStartedAt: null,
  },
  miscPartsByJob: {},
};
const mapState = {
  map: null,
  markersLayer: null,
  watchId: null,
  locationMarker: null,
};


const STORAGE_KEYS = {
  timeStatus: 'time_status_events',
  bootCache: 'TECH_BOOT_CACHE',
};

function loadTimeStatusEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.timeStatus);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Time status storage parse error', error);
    return [];
  }
}

function saveTimeStatusEvents(events) {
  localStorage.setItem(STORAGE_KEYS.timeStatus, JSON.stringify(events));
}

function loadBootCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.bootCache);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw);
    return cached?.boot || null;
  } catch (error) {
    console.warn('Boot cache parse error', error);
    return null;
  }
}

function saveBootCache(boot) {
  localStorage.setItem(
    STORAGE_KEYS.bootCache,
    JSON.stringify({ boot, savedAt: new Date().toISOString() })
  );
}
function getActiveInShopEvent() {
  if (!state.tech?.id) return null;
  const events = loadTimeStatusEvents();
  return events.find((event) => event.techId === state.tech.id && !event.endedAt && event.status === 'in_shop');
}

function formatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours) return `${hours}h ${remainder}m`;
  return `${remainder}m`;
}

function formatDuration(seconds) {
  if (!seconds) return '0m';
  return formatElapsed(seconds);
}

function isInquiryJob(job) {
  return `${job?.job_types?.name || ''}`.trim().toLowerCase() === 'inquiry';
}

async function updateInquiryStatus(job, status, timestampField) {
  await executeOrQueue('setJobStatus', { jobId: job.id, status }, ({ jobId, status: nextStatus }) =>
    setJobStatus(jobId, nextStatus)
  );
  if (!timestampField) return;
  try {
    await executeOrQueue('updateJob', {
      id: job.id,
      payload: { [timestampField]: new Date().toISOString() },
    }, ({ id, payload }) => updateJob(id, payload));
  } catch (error) {
    console.warn('Inquiry timestamp update skipped', error);
  }
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

function evaluateReading(reading, value) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return null;
  const operator = reading.operator || '>=';
  if (operator === 'between') {
    const min = Number(reading.value);
    const max = Number(reading.max);
    if (Number.isNaN(min) || Number.isNaN(max)) return null;
    return numericValue >= min && numericValue <= max;
  }
  const threshold = Number(reading.value);
  if (Number.isNaN(threshold)) return null;
  if (operator === '<') return numericValue < threshold;
  if (operator === '<=') return numericValue <= threshold;
  if (operator === '>') return numericValue > threshold;
  if (operator === '>=') return numericValue >= threshold;
  return null;
}

function evaluateRollup(readings, results, rollupLogic, customLogic) {
  if (!readings.length) return null;
  const values = readings.map((reading) => results[reading.id]).filter((val) => val !== null);
  if (!values.length) return null;
  if (rollupLogic === 'all_good') return values.every(Boolean);
  if (rollupLogic === 'any_bad') return values.some((val) => !val) ? false : true;
  if (rollupLogic === 'all_bad') return values.every((val) => !val) ? false : true;
  if (rollupLogic === 'any_good') return values.some(Boolean) ? true : false;
  if (rollupLogic === 'custom' && customLogic) {
    try {
      const fn = new Function('results', `return ${customLogic};`);
      return Boolean(fn(results));
    } catch (error) {
      console.warn('Custom logic error', error);
      return null;
    }
  }
  return null;
}

function updateInShopButton() {
  const button = document.querySelector('[data-action="in-shop"]');
  if (!button) return;
  const event = getActiveInShopEvent();
  const meta = button.querySelector('.menu-meta');
  if (!meta) return;
  if (!event) {
    meta.textContent = 'Off';
    return;
  }
  const startedAt = new Date(event.startedAt).getTime();
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  meta.textContent = formatElapsed(elapsed);
}

function startInShopTimer() {
  if (state.inShopTimerId) return;
  state.inShopTimerId = setInterval(updateInShopButton, 1000);
}

function stopInShopTimer() {
  if (!state.inShopTimerId) return;
  clearInterval(state.inShopTimerId);
  state.inShopTimerId = null;
}

function startInShopStatus() {
  if (!state.tech?.id) {
    showToast('Select a tech before starting in-shop.');
    return;
  }
  const events = loadTimeStatusEvents();
  const active = events.find((event) => event.techId === state.tech.id && !event.endedAt);
  if (active) {
    showToast('Tech already has an active status.');
    return;
  }
  const record = {
    id: `in-shop-${Date.now()}`,
    status: 'in_shop',
    techId: state.tech.id,
    techName: state.tech.full_name || 'Tech',
    helpers: state.helpers.slice(),
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  events.unshift(record);
  saveTimeStatusEvents(events);
  startInShopTimer();
  updateInShopButton();
  showToast('In-shop status started.');
}

function endInShopStatus(reason = 'manual') {
  if (!state.tech?.id) return;
  const events = loadTimeStatusEvents();
  const active = events.find((event) => event.techId === state.tech.id && !event.endedAt && event.status === 'in_shop');
  if (!active) return;
  active.endedAt = new Date().toISOString();
  active.endedReason = reason;
  active.helpers = state.helpers.slice();
  saveTimeStatusEvents(events);
  stopInShopTimer();
  updateInShopButton();
  showToast('In-shop status ended.');
}
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
  updateTechDisplay();
}

function setTruck(truckId) {
  state.truckId = truckId;
  localStorage.setItem('TECH_TRUCK_ID', truckId);
  updateTechDisplay();
}

async function loadBoot() {
  try {
    const boot = await getBootData();
    state.boot = boot;
    saveBootCache(boot);
  } catch (error) {
    const cached = loadBootCache();
    if (cached) {
      state.boot = cached;
      showToast('Offline mode: using cached data.');
      return;
    }
    if (isOffline()) {
      throw new Error('Offline data not available. Sign in online first.');
    }
    throw error;
  }
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
  const result = await handler(payload);
  await refreshAppState();
  return result;
}

async function logDiagnosticsEvent(runId, nodeId, eventType, payload = {}) {
  return executeOrQueue('diagnosticEvent', {
    run_id: runId,
    node_id: nodeId,
    event_type: eventType,
    payload,
  }, createDiagnosticRunEvent);
}

async function syncOutbox() {
  await processOutbox(state.offlineQueueHandlers, showToast);
}

async function refreshAppState() {
  if (isOffline()) return;
  await loadBoot();
  if (state.currentJob?.id) {
    state.currentJob = await getJob(state.currentJob.id);
  }
}

function screenContainer(content) {
  app.innerHTML = '';
  app.appendChild(content);
}
function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

function createAppLayout({ withHeader = true } = {}) {
  const container = document.createElement('div');
  container.className = 'app';

  if (withHeader) {
    container.appendChild(renderHeader());
  }

  const main = document.createElement('main');
  main.className = 'main';
  const panel = document.createElement('section');
  panel.className = 'panel';
  main.appendChild(panel);
  container.appendChild(main);

  return { container, panel, main };
}
function getHelperLabel() {
  if (!state.helpers.length) return 'Select helpers';
  return state.helpers.join(', ');
}

function getTruckLabel() {
  const truck = state.boot?.trucks?.find((item) => item.id === state.truckId);
  return truck?.truck_identifier || 'Truck';
}
function updateTechDisplay() {
 const truckLabel = document.getElementById('truck-label');
  const techName = document.getElementById('truck-tech');
  const helperNames = document.getElementById('truck-helpers');
  if (truckLabel) truckLabel.textContent = getTruckLabel();
  if (techName) techName.textContent = state.tech?.full_name || 'Unassigned';
  if (helperNames) helperNames.textContent = getHelperLabel();
}

function closeSelectionModal() {
  if (!state.selectionModal) return;
  state.selectionModal.overlay.remove();
  state.selectionModal.modal.remove();
  state.selectionModal = null;
}

function openInfoModal({ title, bodyEl }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  const modal = document.createElement('div');
  modal.className = 'info-modal';
  const card = document.createElement('div');
  card.className = 'modal-card';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'modal-title';
  headerTitle.textContent = title || '';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pill tiny';
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  const close = () => {
    overlay.remove();
    modal.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  head.append(headerTitle, closeBtn);
  card.append(head, bodyEl);
  modal.appendChild(card);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  document.addEventListener('keydown', onKey);
  return { close };
}

function formatShelfLocation(shelf) {
  if (!shelf) return 'Unassigned';
  const tokens = shelf.split(',').map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) return shelf;
  const segments = tokens.map((token) => {
    const aisleMatch = token.match(/^(\d+)([A-Za-z])$/);
    if (aisleMatch) {
      return `Aisle ${aisleMatch[1]} side ${aisleMatch[2].toUpperCase()} (${token})`;
    }
    const shelfMatch = token.match(/^S(\d+)$/i);
    if (shelfMatch) {
      return `Shelf ${shelfMatch[1]} (${token})`;
    }
    const binMatch = token.match(/^B(\d+)$/i);
    if (binMatch) {
      return `Bin ${binMatch[1]} (${token})`;
    }
    return token;
  });
  return segments.join(' • ');
}

function openSelectionModal() {
  if (!state.boot) return;
  closeSelectionModal();

  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.addEventListener('click', closeSelectionModal);

  const modal = document.createElement('div');
  modal.className = 'selection-modal';
  modal.innerHTML = `
    <div class="modal-card">
       <h3>Truck & Helpers</h3>
      <div class="modal-field">
        <label for="truck-select">Truck ID</label>
        <select id="truck-select" class="titleLink select"></select>
      </div>
      <div>
        <div class="modal-label">Helpers</div>
        <div class="modal-list" id="helper-options"></div>
      </div>
      <div class="actions">
        <button class="action secondary" type="button" id="selection-done">Done</button>
      </div>
    </div>
  `;
const select = modal.querySelector('#truck-select');
  state.boot.trucks.forEach((truck) => {
    const option = document.createElement('option');
    option.value = truck.id;
    option.textContent = truck.truck_identifier;
    select.appendChild(option);
  });
  select.value = state.truckId || state.boot.trucks[0]?.id || '';
  select.addEventListener('change', () => setTruck(select.value));

  const list = modal.querySelector('#helper-options');
  state.boot.users.filter((user) => user.is_helper).forEach((helper) => {
    const btn = document.createElement('button');
    btn.type = 'button';
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
    list.appendChild(btn);
  });

  modal.querySelector('#selection-done').addEventListener('click', closeSelectionModal);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  state.selectionModal = { overlay, modal};
}


function renderHeader() {
  const header = document.createElement('header');
  header.className = 'titleBlock';
  if (!state.truckId && state.boot?.trucks?.length) {
    setTruck(state.boot.trucks[0].id);
  }
  header.innerHTML = `
     <div class="titleRow">
      <button class="iconBtn" id="menu-btn" aria-label="Menu">
        <div class="hamburgerLines"><span></span><span></span><span></span></div>
      </button>
      <button class="iconBtn" id="home-btn" aria-label="Home">🏠</button>
      <div class="truckId">
        <button class="truck-selector" id="truck-selector" type="button">
          <div class="truck-label" id="truck-label">${getTruckLabel()}</div>
          <div class="truck-sub" id="truck-tech">${state.tech?.full_name || 'Unassigned'}</div>
          <div class="truck-sub helpers" id="truck-helpers">${getHelperLabel()}</div>
        </button>
      </div>
      
    </div>
     `;

  
  header.querySelector('#menu-btn').addEventListener('click', () => toggleDrawer(true));
 header.querySelector('#home-btn').addEventListener('click', renderHome);
  header.querySelector('#truck-selector').addEventListener('click', openSelectionModal);
  return header;
}

function renderDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', () => toggleDrawer(false));

  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <div class="drawerHeader">
      <div class="title">Information</div>
      <div class="sub">Lists • Requests • Receipts • Settings</div>
    </div>
    <div class="menu">
     <button class="menuBtn" data-action="start-inventory">
        <div class="menuLeft">
          <div class="name">Start Inventory</div>
          <div class="desc">Launch shelf map counting</div>
        </div>
        <span class="chev">›</span>
      </button>
      <button class="menuBtn" data-action="current">
        <div class="menuLeft">
          <div class="name">Current Inventory</div>
          <div class="desc">Parts on this truck</div>
        </div>
        <span class="chev">›</span>
      </button>
        <button class="menuBtn" data-action="perform-inventory">
        <div class="menuLeft">
          <div class="name">Perform Inventory</div>
          <div class="desc">Start the inventory count flow</div>
        </div>
        <span class="chev">›</span>
      </button>
      <button class="menuBtn" data-action="in-shop">
        <div class="menuLeft">
          <div class="name">In-shop</div>
          <div class="desc">Track shop time status</div>
        </div>
        <span class="menu-meta">Off</span>
      </button>
      <button class="menuBtn" data-action="master">
        <div class="menuLeft">
          <div class="name">Truck Inventory</div>
          <div class="desc">Minimum stock list</div>
        </div>
        <span class="chev">›</span>
      </button>
      <button class="menuBtn" data-action="tools">
        <div class="menuLeft">
          <div class="name">Truck Tool List</div>
          <div class="desc">Assigned tool inventory</div>
        </div>
        <span class="chev">›</span>
      </button>
      <button class="menuBtn" data-action="logout">
        <div class="menuLeft">
          <div class="name">Log Out</div>
          <div class="desc">Sign out of this device</div>
        </div>
        <span class="chev">›</span>
      </button>
    </div>
  `;


  drawer.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      toggleDrawer(false);
      if (action === 'start-inventory') return startInventoryInApp();
      if (action === 'current') return renderInventory();
      if (action === 'perform-inventory') return startInventoryInApp();
      if (action === 'in-shop') {
        const active = getActiveInShopEvent();
        if (active) {
          endInShopStatus('manual');
        } else {
          startInShopStatus();
        }
        return;
      }
      if (action === 'master') return renderMasterInventory();
      if (action === 'tools') return renderToolList();
      if (action === 'logout') return handleLogout();
    });
  });

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  state.drawer = { overlay, drawer };
  updateInShopButton();
  if (getActiveInShopEvent()) {
    startInShopTimer();
  }
}

function toggleDrawer(show) {
  if (!state.drawer) renderDrawer();
  state.drawer.drawer.classList.toggle('open', show);
  state.drawer.overlay.classList.toggle('show', show);
  if (show) updateInShopButton();
}

function startInventoryInApp() {
  const url = new URL('../inventory-app/inventory.html', window.location.href);
  url.searchParams.set('startInventory', '1');
 url.searchParams.set('route', 'inventory');
  window.open(url.toString(), '_blank', 'noopener');
}

async function setTechInshopStatus() {
  if (!state.tech?.id) {
    showToast('Assign a tech before setting status.');
    return;
  }
  try {
    await executeOrQueue(
      'updateUser',
      { userId: state.tech.id, payload: { status: 'inshop' } },
      ({ userId, payload }) => updateUser(userId, payload),
    );
    state.tech.status = 'inshop';
    showToast('Tech status set to Inshop.');
  } catch (error) {
    showToast(error.message);
  }
}

function renderHome() {
  clearLastScreen();
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <h2>Home</h2>
      <div class="screenActions">
        <button class="pill tiny map-view" data-action="map-view">Map View</button>
        <span class="badge">${getTruckLabel()}</span>
      </div>
    </div>
    <div class="sectionHint">Quick actions</div>
    <button class="pill large create-job" data-action="create-job">Create Job</button>
    <button class="pill large open-jobs" data-action="open-jobs">Open Jobs <span class="badge" id="open-count">0</span></button>
    <button class="pill large restock" data-action="restock">Restock <span class="badge" id="restock-count">0</span></button>
    <button class="pill large refuel" data-action="refuel">Re-fuel</button>
    <button class="pill large requests" data-action="requests">Requests</button>
    <button class="pill large" receipts" data-action="receipts">Receipts</button>
  `;
 
  screenContainer(container);

 panel.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'create-job') return renderCreateJob();
      if (action === 'open-jobs') return renderOpenJobs();
      if (action === 'restock') return renderRestock();
      if (action === 'refuel') return renderRefuel();
      if (action === 'requests') return renderRequests();
      if (action === 'receipts') return renderReceipts();
      if (action === 'map-view') return renderMapView();
    });
  });

  updateBadgeCounts();
}

async function updateBadgeCounts() {
  const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.ON_SITE_DIAGNOSTICS] });
  const restock = await getRestockList(state.truckId);
  const openCount = document.getElementById('open-count');
  const restockCount = document.getElementById('restock-count');
  if (openCount) openCount.textContent = jobs.length;
  if (restockCount) restockCount.textContent = restock.length;
}

function renderLogin() {
  const { container, panel } = createAppLayout({ withHeader: false });
  panel.innerHTML = `
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

  panel.querySelector('#login-btn').addEventListener('click', async () => {
    const email = panel.querySelector('#login-email').value.trim();
    const password = panel.querySelector('#login-password').value.trim();
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

 panel.querySelector('#offline-btn').addEventListener('click', async () => {
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
window.renderLogin = renderLogin;
async function handleLogout() {
  try {
    await signOut();
  } catch (error) {
    console.warn('Sign out failed', error);
  }
  stopInShopTimer();
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

  if (getActiveInShopEvent()) {
    startInShopTimer();
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
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="inventory-back">←</button>
      <h2>Current Inventory</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h3>Parts on truck</h3>';
  panel.appendChild(card);
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
     const existing = items.find((item) => item.product_id === productId);
    const payload = {
      truck_id: state.truckId,
      product_id: productId,
      qty,
    };
if (!existing) payload.origin = 'tech_added';
    await executeOrQueue('upsertInventory', payload, upsertTruckInventory);
    renderInventory();
  });
   panel.querySelector('#inventory-back').addEventListener('click', renderHome);
  panel.appendChild(addCard);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  panel.querySelector('#inventory-back').addEventListener('click', renderHome);
  panel.appendChild(addCard);
  screenContainer(container);
}

function openInventoryDetailsModal(item) {
  const product = item.products || {};
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.innerHTML = `
    <div class="modal-section">
      <div class="modal-subtitle">Description</div>
      <div>${product.description || 'No description available.'}</div>
    </div>
    <div class="modal-section">
      <div class="modal-subtitle">Shelf Location</div>
      <div>${formatShelfLocation(product.shelf)}</div>
    </div>
    <div class="modal-section">
      <div class="modal-subtitle">Current Qty</div>
      <div>${Number(item.qty ?? 0)}</div>
    </div>
  `;
  openInfoModal({ title: product.name || 'Part details', bodyEl: body });
}

function openAddInventoryModal(items) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const productLabel = document.createElement('label');
  productLabel.textContent = 'Part';
  const productInput = document.createElement('input');
  productInput.setAttribute('list', 'inventory-part-options');
  const dataList = document.createElement('datalist');
  dataList.id = 'inventory-part-options';
  const productMap = new Map();
  (state.boot?.products || []).forEach((product) => {
    const label = `${product.name}${product.sku ? ` (${product.sku})` : ''}`;
    const option = document.createElement('option');
    option.value = label;
    dataList.appendChild(option);
    productMap.set(label, product);
  });
  const qtyLabel = document.createElement('label');
  qtyLabel.textContent = 'Quantity';
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.value = '1';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'action secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'action';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  actions.append(cancelBtn, saveBtn);
  body.append(productLabel, productInput, dataList, qtyLabel, qtyInput, actions);
  const { close } = openInfoModal({ title: 'Add Part', bodyEl: body });
  cancelBtn.addEventListener('click', close);
  saveBtn.addEventListener('click', async () => {
    const label = productInput.value.trim();
    const product = productMap.get(label);
    const qty = Number(qtyInput.value || 0);
    if (!product) {
      showToast('Select a valid part.');
      return;
    }
    if (!qty || qty < 0) {
      showToast('Enter a valid quantity.');
      return;
    }
    const existing = items.find((entry) => entry.product_id === product.id);
    const payload = {
      truck_id: state.truckId,
      product_id: product.id,
      qty: (existing?.qty ?? 0) + qty,
    };
    if (!existing) payload.origin = 'tech_added';
    await executeOrQueue('upsertInventory', payload, upsertTruckInventory);
    close();
    renderMasterInventory();
  });
}

async function renderMasterInventory() {
  const items = await listTruckInventory(state.truckId);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="truck-inventory-back">←</button>
      <h2>Truck Inventory</h2>
      <div class="screenActions">
        <button class="pill tiny" id="inventory-add">Add Part</button>
        <span class="badge">${getTruckLabel()}</span>
      </div>
    </div>
  `;
  const card = document.createElement('div');
  card.className = 'card list';
  card.innerHTML = '<h3>Truck Inventory</h3>'
  panel.appendChild(card);
   items.forEach((item) => {
    const product = item.products || {};
    const minQty = Number(item.min_qty ?? product.minimum_qty ?? 0);
    const pill = document.createElement('button');
    pill.className = 'pill inventory-pill';
    pill.innerHTML = `
       <div class="inventory-pill-main">
        <div class="inventory-pill-name">${product.name || 'Part'}</div>
        <div class="inventory-pill-sku"><em>${product.sku || 'SKU N/A'}</em></div>
      </div>
      <div class="inventory-pill-meta">
        <span class="round-pill">
          <span class="round-pill-label">Min</span>
          <span class="round-pill-value">${minQty || 0}</span>
        </span>
        <span class="round-pill">
          <span class="round-pill-label">Shelf</span>
          <span class="round-pill-value">${Number(item.qty ?? 0)}</span>
        </span>
      </div>
    `;
    pill.addEventListener('click', () => openInventoryDetailsModal(item));
    card.appendChild(pill);
  });
  if (!items.length) card.innerHTML += '<p>No inventory set for this truck.</p>';
  panel.querySelector('#truck-inventory-back').addEventListener('click', renderHome);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
   panel.appendChild(backBtn);
  panel.querySelector('#inventory-add').addEventListener('click', () => openAddInventoryModal(items));
  screenContainer(container);
}

async function renderToolList() {
  const tools = await listTruckTools(state.truckId);
 const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="tools-back">←</button>
      <h2>Truck Tools</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h3>Assigned tools</h3>';
  panel.appendChild(card);
  tools.forEach((tool) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    const name = tool.tools?.name || tool.tool_name || tool.name || 'Tool';
    pill.innerHTML = `<div>${name}</div>`;
    card.appendChild(pill);
  });
  if (!tools.length) card.innerHTML += '<p>No tools assigned.</p>';
  panel.querySelector('#tools-back').addEventListener('click', renderHome);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  panel.appendChild(backBtn);
  screenContainer(container);
}

function renderCreateJob() {
 const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  const customerOptions = state.boot.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join('');
  const fieldOptions = state.boot.fields.map((field) => `<option value="${field.id}">${field.name}</option>`).join('');
  const typeOptions = state.boot.jobTypes.map((type) => `<option value="${type.id}">${type.name}</option>`).join('');

panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="job-cancel">←</button>
      <h2>Create Job</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
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
    <button class="action secondary" id="job-cancel-secondary">Back</button>
    </div>
  `;
  panel.querySelector('#job-save').addEventListener('click', async () => {
    const payload = {
     customer_id: panel.querySelector('#job-customer').value,
      field_id: panel.querySelector('#job-field').value,
      job_type_id: panel.querySelector('#job-type').value,
      description: panel.querySelector('#job-description').value,
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
 panel.querySelector('#job-cancel').addEventListener('click', renderHome);
  panel.querySelector('#job-cancel-secondary').addEventListener('click', renderHome);
  screenContainer(container);
}

async function renderOpenJobs() {
 const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.ON_SITE_DIAGNOSTICS] });
  const activeEvents = await listActiveJobEvents(jobs.map((job) => job.id));
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="open-jobs-back">←</button>
      <h2>Open Jobs</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
 
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
panel.appendChild(card);
  panel.querySelector('#open-jobs-back').addEventListener('click', renderHome);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
 panel.appendChild(backBtn);
  screenContainer(container);
}
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
      <circle cx="17" cy="15" r="2.6" fill="#e2e8f0"/>
    </svg>
  `;
  return window.L.divIcon({
    className: 'job-pin',
    html: svg,
    iconSize: [34, 44],
    iconAnchor: [17, 44],
    popupAnchor: [0, -40],
  });
}

function renderMapView() {
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="map-back">←</button>
      <h2>Map View</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card map-card">
      <div class="mapHeaderRow">
        <h3>Map Overview</h3>
      </div>
      <div class="map-canvas" id="tech-map"></div>
      <div class="map-overlay" id="tech-map-overlay">Loading map…</div>
    </div>
  `;
   panel.querySelector('#map-back').addEventListener('click', () => {
    stopMapTracking();
    renderHome();
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => {
    stopMapTracking();
    renderHome();
  });
  panel.appendChild(backBtn);
  screenContainer(container);
  renderTechMap();
}

function stopMapTracking() {
  if (mapState.watchId) {
    navigator.geolocation.clearWatch(mapState.watchId);
    mapState.watchId = null;
  }
}

async function renderTechMap() {
  const mapCanvas = document.getElementById('tech-map');
  const overlay = document.getElementById('tech-map-overlay');
  if (!mapCanvas || !overlay) return;
  if (!window.L) {
    overlay.textContent = 'Map view requires Leaflet to load.';
    return;
  }

 const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED, JOB_STATUSES.ON_THE_WAY, JOB_STATUSES.ON_SITE_DIAGNOSTICS] });
  const coordsJobs = jobs.map((job) => ({ job, coords: getJobCoords(job) })).filter(({ coords }) => coords);

  if (!coordsJobs.length && !navigator.geolocation) {
    overlay.textContent = 'No job locations or device location available.';
  } else {
    overlay.hidden = true;
  }

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
      attribution: 'Tiles © Esri',
      maxZoom: 19,
    },
  ).addTo(map);

  const markersLayer = window.L.layerGroup().addTo(map);
  mapState.markersLayer = markersLayer;

  coordsJobs.forEach(({ job, coords }) => {
    const marker = window.L.marker(coords, {
      title: job.customers?.name || 'Job',
      icon: buildLeafletMarkerIcon(mapStatusColor(job.status)),
    }).addTo(markersLayer);

    const content = document.createElement('div');
    content.innerHTML = `
      <strong>${job.customers?.name || 'Customer'}</strong>
      <div class="muted">${job.fields?.name || 'Field'} · ${job.job_types?.name || 'Job Type'}</div>
    `;
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'pill inline map-open-job';
    openBtn.textContent = 'Open Job';
    openBtn.addEventListener('click', () => {
      map.closePopup();
      renderJobCard(job);
    });
    content.appendChild(openBtn);
    marker.bindPopup(content, { closeButton: true, autoPan: true });
  });

  const bounds = coordsJobs.length
    ? window.L.latLngBounds(coordsJobs.map(({ coords }) => coords))
    : null;

  if (navigator.geolocation) {
    mapState.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const currentLatLng = { lat: latitude, lng: longitude };
        if (!mapState.locationMarker) {
          mapState.locationMarker = window.L.circleMarker(currentLatLng, {
            radius: 8,
            color: '#38bdf8',
            fillColor: '#38bdf8',
            fillOpacity: 0.9,
          }).addTo(map);
        } else {
          mapState.locationMarker.setLatLng(currentLatLng);
        }
        if (bounds) {
          bounds.extend(currentLatLng);
          map.fitBounds(bounds.pad(0.2));
        } else {
          map.setView(currentLatLng, 14);
        }
      },
      () => {
        if (bounds) map.fitBounds(bounds.pad(0.2));
        else map.setView([39.5, -98.35], 4);
      },
      { enableHighAccuracy: true },
    );
  } else if (coordsJobs.length) {
    map.fitBounds(bounds.pad(0.2));
  } else {
    map.setView([39.5, -98.35], 4);
  }
}
async function renderJobCard(job) {
  state.currentJob = job;
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="job-card-back">←</button>
      <h2>Job Details</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
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
        <button class="action" id="take-job">${isInquiryJob(job) ? 'Open Inquiry' : 'Take Job'}</button>
       <button class="action secondary" id="job-card-secondary-back">Back</button>
      </div>
    </div>
  `;
  const reportCard = document.createElement('div');
  reportCard.className = 'card';
  reportCard.innerHTML = `
    <h3>Work Order Reports</h3>
    <div class="muted">Loading latest report for this field...</div>
  `;
  panel.appendChild(reportCard);

  if (isOffline()) {
    reportCard.innerHTML = `
      <h3>Work Order Reports</h3>
      <div class="muted">Reports unavailable offline.</div>
    `;
  } else if (job.field_id) {
    try {
      const fieldJobs = await listJobs({ fieldId: job.field_id });
      const sortedJobs = [...fieldJobs].sort((a, b) => {
        const aDate = new Date(a.finished_at || a.created_at || 0).getTime();
        const bDate = new Date(b.finished_at || b.created_at || 0).getTime();
        return bDate - aDate;
      });
      let latestReport = null;
      sortedJobs.some((fieldJob) => {
        const attachments = fieldJob.attachments || [];
        const match = attachments.find((att) => att.attachment_type?.includes('report'));
        if (match) {
          latestReport = match;
          return true;
        }
        return false;
      });
      if (latestReport?.file_url) {
        reportCard.innerHTML = `
          <h3>Work Order Reports</h3>
          <a class="pill" href="${latestReport.file_url}" target="_blank" rel="noreferrer">
            Open Latest Report
          </a>
        `;
      } else {
        reportCard.innerHTML = `
          <h3>Work Order Reports</h3>
          <div class="muted">No previous reports found for this field.</div>
        `;
      }
    } catch (error) {
      reportCard.innerHTML = `
        <h3>Work Order Reports</h3>
        <div class="muted">Unable to load report.</div>
      `;
    }
  }
  panel.querySelector('#job-card-back').addEventListener('click', renderOpenJobs);
  panel.querySelector('#job-card-secondary-back').addEventListener('click', renderOpenJobs);
  panel.querySelector('#take-job').addEventListener('click', () => {
    if (isInquiryJob(job)) {
      renderInquiryCapture(job);
      return;
    }
    renderRoutePrompt(job);
  });
  screenContainer(container);
}


async function renderInquiryCapture(job) {
  saveLastScreen('inquiry', job.id);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  const parts = await listJobParts(job.id);
  const attachments = job.attachments || [];
  const photos = attachments.filter((att) => (att.attachment_type || '').startsWith('inquiry_photo'));
  const drawing = attachments.find((att) => att.attachment_type === 'inquiry_drawing');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="inquiry-back">←</button>
      <h2>Inquiry</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card">
      <h3>${job.customers?.name || ''} · ${job.fields?.name || ''}</h3>
      <div class="actions">
        <button class="action" id="inquiry-on-way">On the way</button>
        <button class="action" id="inquiry-arrived">Arrived</button>
      </div>
      <label>Description</label>
      <textarea id="inquiry-description" placeholder="Inquiry details">${job.description || ''}</textarea>
      <label>Add Part</label>
      <select id="inquiry-part-select"><option value="">Select part…</option>${state.boot.products.map((product) => `<option value="${product.id}">${product.name}</option>`).join('')}</select>
      <input id="inquiry-part-qty" type="number" min="1" value="1" />
      <button class="pill" id="inquiry-add-part">Add Part</button>
      <div class="list" id="inquiry-parts-list">${parts.map((part) => `<div class="pill">${part.products?.name || 'Part'} (x${part.qty})</div>`).join('') || '<div class="muted">No parts added.</div>'}</div>
      <label>Photos</label>
      <input id="inquiry-photos" type="file" accept="image/*" capture="environment" multiple />
      <div class="list">${photos.map((photo) => `<a class="pill" href="${photo.file_url}" target="_blank" rel="noreferrer">Photo</a>`).join('') || '<div class="muted">No photos uploaded.</div>'}</div>
      <label>Drawing (optional)</label>
      <canvas id="inquiry-canvas" width="320" height="220" style="border:1px solid var(--line,#334155); width:100%; background-size:20px 20px; background-image:linear-gradient(to right, rgba(148,163,184,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.2) 1px, transparent 1px);"></canvas>
      <div class="actions"><button class="pill" id="inquiry-pen">Pen</button><button class="pill" id="inquiry-eraser">Eraser</button><button class="pill" id="inquiry-clear">Clear</button></div>
      ${drawing ? `<a class="pill" href="${drawing.file_url}" target="_blank" rel="noreferrer">Open saved drawing</a>` : '<div class="muted">No drawing uploaded.</div>'}
      <button class="action" id="inquiry-save">Save Inquiry</button>
    </div>
  `;
  panel.querySelector('#inquiry-back').addEventListener('click', () => renderJobCard(job));
  panel.querySelector('#inquiry-on-way').addEventListener('click', async () => {
    await updateInquiryStatus(job, JOB_STATUSES.ON_THE_WAY, 'on_the_way_at');
    showToast('Inquiry marked on the way.');
  });
  panel.querySelector('#inquiry-arrived').addEventListener('click', async () => {
    await updateInquiryStatus(job, JOB_STATUSES.ON_SITE_DIAGNOSTICS, 'arrived_at');
    showToast('Inquiry marked arrived.');
  });
  panel.querySelector('#inquiry-add-part').addEventListener('click', async () => {
    const productId = panel.querySelector('#inquiry-part-select').value;
    const qty = Number(panel.querySelector('#inquiry-part-qty').value || 1);
    if (!productId || qty < 1) return;
    await addJobPart({ job_id: job.id, product_id: productId, truck_id: state.truckId, qty });
    showToast('Part added.');
    renderInquiryCapture(job);
  });
  const canvas = panel.querySelector('#inquiry-canvas');
  const ctx = canvas.getContext('2d');
  let drawingMode = 'pen';
  let drawingActive = false;
  let lastPoint = null;
  const getPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const drawTo = (point) => {
    if (!lastPoint) { lastPoint = point; return; }
    ctx.lineWidth = drawingMode === 'eraser' ? 14 : 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = drawingMode === 'eraser' ? '#ffffff' : '#0f172a';
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint = point;
  };
  canvas.addEventListener('pointerdown', (event) => { drawingActive = true; lastPoint = getPoint(event); });
  canvas.addEventListener('pointermove', (event) => { if (!drawingActive) return; drawTo(getPoint(event)); });
  window.addEventListener('pointerup', () => { drawingActive = false; lastPoint = null; });
  panel.querySelector('#inquiry-pen').addEventListener('click', () => { drawingMode = 'pen'; });
  panel.querySelector('#inquiry-eraser').addEventListener('click', () => { drawingMode = 'eraser'; });
  panel.querySelector('#inquiry-clear').addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); });
  panel.querySelector('#inquiry-save').addEventListener('click', async () => {
    const description = panel.querySelector('#inquiry-description').value.trim();
    await updateJob(job.id, { description });
    const files = Array.from(panel.querySelector('#inquiry-photos').files || []);
    for (const file of files) {
      const url = await uploadJobPhoto(file, { prefix: `job/${job.id}/inquiry` });
      await addAttachment({ job_id: job.id, attachment_type: 'inquiry_photo', file_url: url });
    }
    await new Promise((resolve) => canvas.toBlob(async (blob) => {
      if (!blob || blob.size < 1500) { resolve(); return; }
      const drawingFile = new File([blob], `inquiry-drawing-${Date.now()}.png`, { type: 'image/png' });
      const drawingUrl = await uploadJobPhoto(drawingFile, { prefix: `job/${job.id}/inquiry` });
      await addAttachment({ job_id: job.id, attachment_type: 'inquiry_drawing', file_url: drawingUrl });
      resolve();
    }, 'image/png'));
    showToast('Inquiry saved.');
    await refreshAppState();
    const refreshed = await getJob(job.id);
    renderInquiryCapture(refreshed);
  });

  screenContainer(container);
}

function renderRoutePrompt(job) {
  saveLastScreen('route', job.id);
 const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="route-back">←</button>
      <h2>Route to Job</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card">
      <h3>Route to Job?</h3>
      <button class="action" id="route">Route Me</button>
      <button class="action secondary" id="skip">Skip</button>
    </div>
  `;
  const routeBtn = panel.querySelector('#route');
  if (isOffline()) {
    routeBtn.disabled = true;
    routeBtn.textContent = 'Route unavailable offline';
  } else {
    routeBtn.addEventListener('click', async () => {
      await takeJob(job);
      if (job.fields?.lat && job.fields?.lon) {
     const mapsUrl = `https://maps.google.com/?q=${job.fields.lat},${job.fields.lon}`;
        window.location.assign(mapsUrl);
      } else {
        showToast('No coordinates set for this field.');
      }
      renderArrived(job);
    });
  }
  panel.querySelector('#skip').addEventListener('click', async () => {
    await takeJob(job);
    renderArrived(job);
  });
   panel.querySelector('#route-back').addEventListener('click', () => renderJobCard(job));
  screenContainer(container);
}

async function takeJob(job) {
  if (getActiveInShopEvent()) {
    endInShopStatus('job_taken');
  }
  
  await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.ON_THE_WAY }, ({ jobId, status }) =>
    setJobStatus(jobId, status)
  );
}

function renderArrived(job) {
  saveLastScreen('arrived', job.id);
 const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="arrived-back">←</button>
      <h2>Arrival</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card">
      <h3>Arrived?</h3>
      <p>${job.customers?.name} · ${job.fields?.name}</p>
      <div class="actions">
        <button class="action" id="arrived">Arrived</button>
        <button class="action danger" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  panel.querySelector('#arrived').addEventListener('click', async () => {
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
   panel.querySelector('#arrived-back').addEventListener('click', () => renderJobCard(job));
  screenContainer(container);
}

function renderJobIntake(job) {
  saveLastScreen('intake', job.id);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="intake-back">←</button>
      <h2>Job Intake</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
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
       
      </div>
    </div>
  `;
  const updateFieldInfo = async () => {
    const payload = {
      lat: panel.querySelector('#field-lat').value || null,
      lon: panel.querySelector('#field-lon').value || null,
      serial_number: panel.querySelector('#field-serial').value || null,
      last_known_hours: panel.querySelector('#field-hours').value || null,
    };
    await executeOrQueue('updateField', { fieldId: job.field_id, payload }, ({ fieldId, payload }) => updateField(fieldId, payload));
  };
  panel.querySelector('#start-diagnostics').addEventListener('click', async () => {
    await updateFieldInfo();
    renderWorkFlowStart(job);
  });
  screenContainer(container);
}

async function renderWorkFlowStart(job) {
  saveLastScreen('diagnostics', job.id);
   const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
       <button class="backBtn" id="workflow-back">←</button>
      <h2>Diagnostics Workflow</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
 const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>Problem Found</h3>
    <div class="pill">
      <div>
        <strong>${job.customers?.name}</strong>
        <div class="muted">${job.fields?.name}</div>
      </div>
      <span class="badge">${job.job_types?.name || ''}</span>
    </div>
    <label>Problem Title</label>
    <select id="workflow-select"></select>
    <label>Brand</label>
    <select id="brand-select"></select>
    <div id="workflow-attachments" class="list"></div>
    <div class="actions">
        <button class="action" id="start-workflow">Start Workflow</button>
      <button class="action secondary" id="pause">Pause Job</button>
    </div>
  `;

  const runs = await listDiagnosticWorkflowRuns(job.id);
  const activeRun = runs.find((run) => run.status === 'in_progress');
  let resumeCard;
  if (activeRun) {
    resumeCard = document.createElement('div');
    resumeCard.className = 'card';
    resumeCard.innerHTML = `
      <h4>Resume In-Progress Workflow</h4>
      <div class="muted">${activeRun.workflow_title || 'Workflow'} · ${activeRun.brand_name || 'Brand'}</div>
      <button class="action" id="resume-run">Resume</button>
    `;
     resumeCard.querySelector('#resume-run').addEventListener('click', async () => {
      await resumeWorkflowRun(job, activeRun);
    });
  }
  if (resumeCard) panel.appendChild(resumeCard);

  const workflows = await listDiagnosticWorkflows();
  const workflowSelect = card.querySelector('#workflow-select');
  const brandSelect = card.querySelector('#brand-select');
  const attachmentsList = card.querySelector('#workflow-attachments');

  if (!workflows.length) {
    workflowSelect.innerHTML = '<option value="">No workflows published</option>';
    brandSelect.innerHTML = '<option value="">No brands</option>';
    card.querySelector('#start-workflow').disabled = true;
  } else {
    workflows.forEach((workflow) => {
      const opt = document.createElement('option');
      opt.value = workflow.id;
      opt.textContent = workflow.title || 'Workflow';
      workflowSelect.appendChild(opt);
    });
  }

  const loadBrands = async () => {
    brandSelect.innerHTML = '';
    attachmentsList.innerHTML = '';
    const workflowId = workflowSelect.value;
    if (!workflowId) return;
    const brands = (await listDiagnosticWorkflowBrands(workflowId)).filter((brand) => brand.status === 'published');
    const startBtn = card.querySelector('#start-workflow');
    if (!brands.length) {
      brandSelect.innerHTML = '<option value="">No brands available</option>';
      attachmentsList.innerHTML = '<div class="muted">No workflow attachments.</div>';
      if (startBtn) startBtn.disabled = true;
      return;
    }
    brands.forEach((brand) => {
      const opt = document.createElement('option');
      opt.value = brand.id;
      opt.textContent = brand.brand_name || 'Brand';
      brandSelect.appendChild(opt);
    });
    const selectedBrand = brands.find((brand) => brand.id === brandSelect.value) || brands[0];
    if (startBtn) startBtn.disabled = false;
    if (selectedBrand?.attachments?.length) {
      selectedBrand.attachments.forEach((url) => {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.className = 'pill';
        link.textContent = url.split('/').pop();
        attachmentsList.appendChild(link);
      });
    } else {
      attachmentsList.innerHTML = '<div class="muted">No workflow attachments.</div>';
    }
  };

  workflowSelect.addEventListener('change', loadBrands);
  brandSelect.addEventListener('change', loadBrands);

  await loadBrands();

  card.querySelector('#start-workflow').addEventListener('click', async () => {
    const workflowId = workflowSelect.value;
    const brandId = brandSelect.value;
    if (!workflowId || !brandId) {
      showToast('Select a workflow and brand.');
      return;
    }
    await startWorkflowRun(job, workflowId, brandId);
  });
  card.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_DIAGNOSTICS));
  panel.appendChild(card);
   panel.querySelector('#workflow-back').addEventListener('click', renderJobIntake.bind(null, job));
  screenContainer(container);
}

async function startWorkflowRun(job, workflowId, brandId) {
  if (isOffline()) {
    showToast('Go online to start a workflow.');
    return;
  }
  const workflows = await listDiagnosticWorkflows();
  const workflow = workflows.find((item) => item.id === workflowId);
  const brands = await listDiagnosticWorkflowBrands(workflowId);
  const brand = brands.find((item) => item.id === brandId);
  const [nodes, edges] = await Promise.all([
    listDiagnosticNodes(brandId),
    listDiagnosticEdges(brandId),
  ]);
  if (!nodes.length) {
    showToast('This brand flow has no nodes yet.');
    return;
  }
  const previousRuns = await listDiagnosticWorkflowRuns(job.id);
  const lastRun = previousRuns[previousRuns.length - 1];
  const workflowVersionHash = hashWorkflowPayload({ nodes, edges });
  const runPayload = {
    job_id: job.id,
    workflow_id: workflowId,
    brand_id: brandId,
    workflow_title: workflow?.title || '',
    brand_name: brand?.brand_name || '',
    workflow_version_hash: workflowVersionHash,
    status: 'in_progress',
    current_node_id: nodes[0].id,
  };
  const run = await executeOrQueue('createWorkflowRun', runPayload, createDiagnosticWorkflowRun);
  if (!run) return;
  await logDiagnosticsEvent(run.id, nodes[0].id, 'workflow_started', {
    workflow_title: runPayload.workflow_title,
    brand_name: runPayload.brand_name,
    previous_run_id: lastRun?.id || null,
  });
  state.diagnosticsRun = {
    run,
    workflow,
    brand,
    nodes,
    edges,
    currentNodeId: nodes[0].id,
    stepStartedAt: Date.now(),
    repairStartedAt: null,
  };
  renderWorkflowNode(job);
}

async function resumeWorkflowRun(job, run) {
  const [nodes, edges] = await Promise.all([
    listDiagnosticNodes(run.brand_id),
    listDiagnosticEdges(run.brand_id),
  ]);
  state.diagnosticsRun = {
    run,
    workflow: { id: run.workflow_id, title: run.workflow_title },
    brand: { id: run.brand_id, brand_name: run.brand_name, attachments: run.attachments || [] },
    nodes,
    edges,
    currentNodeId: run.current_node_id || nodes[0]?.id,
    stepStartedAt: Date.now(),
    repairStartedAt: null,
  };
  renderWorkflowNode(job);
}

async function renderWorkflowNode(job) {
  saveLastScreen('diagnostics', job.id);
  const { run, nodes, edges, currentNodeId } = state.diagnosticsRun;
  const node = nodes.find((item) => item.id === currentNodeId);
  if (!node) {
    renderWorkflowStart(job);
    return;
  }
  if (node.node_type === 'repair') {
    await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.ON_SITE_REPAIR }, ({ jobId, status }) =>
      setJobStatus(jobId, status)
    );
  } else {
    await executeOrQueue('setJobStatus', { jobId: job.id, status: JOB_STATUSES.ON_SITE_DIAGNOSTICS }, ({ jobId, status }) =>
      setJobStatus(jobId, status)
    );
  }

  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
     <button class="backBtn" id="workflow-node-back">←</button>
      <h2>${node.node_type === 'repair' ? 'Repair' : node.node_type === 'end' ? 'Workflow End' : 'Diagnostics Check'}</h2>
      <span class="badge">${getTruckLabel()}</span>
  `;
 

  if (node.node_type === 'check') {
    state.diagnosticsRun.stepStartedAt = Date.now();
    logDiagnosticsEvent(run.id, node.id, 'step_started', {});
    renderCheckNode(job, node, panel);
  } else if (node.node_type === 'repair') {
    await renderRepairNode(job, node, panel);
  } else {
    renderEndNode(job, node, panel);
  }

  panel.querySelector('#workflow-node-back').addEventListener('click', renderWorkflowStart.bind(null, job));
  screenContainer(container);
}

async function renderCheckNode(job, node, panel) {
  const data = node.data || {};
  const readings = data.readings || [];
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>${node.title || 'Diagnostic Check'}</h3>
    <div class="muted">${data.what_to_check || 'No description provided.'}</div>
    <div>${data.how_to_check || ''}</div>
  `;

  if (data.attachments?.length) {
    const attachments = document.createElement('div');
    attachments.className = 'list';
    data.attachments.forEach((url) => {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.className = 'pill';
      link.textContent = url.split('/').pop();
      attachments.appendChild(link);
    });
    card.appendChild(attachments);
  }

  const readingInputs = {};
  readings.forEach((reading) => {
    const label = document.createElement('label');
    label.textContent = `${reading.label || 'Reading'} (${reading.unit || ''})`;
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.readingId = reading.id;
    card.append(label, input);
    readingInputs[reading.id] = input;
  });
  
  const resultBlock = document.createElement('div');
  resultBlock.className = 'pill';
  resultBlock.textContent = 'Awaiting readings.';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const goodBtn = document.createElement('button');
  goodBtn.className = 'action success';
  goodBtn.textContent = 'Mark Good';
  const badBtn = document.createElement('button');
  badBtn.className = 'action danger';
  badBtn.textContent = 'Mark Bad';
  const evaluateBtn = document.createElement('button');
  evaluateBtn.className = 'action';
  evaluateBtn.textContent = 'Evaluate';
  if (readings.length) {
    actions.append(evaluateBtn);
  } else {
    actions.append(goodBtn, badBtn);
  }

  card.append(resultBlock, actions);
  panel.appendChild(card);

  let lastReadingResults = {};

  const handleResult = async (isGood) => {
    resultBlock.textContent = isGood ? 'Result: Good' : 'Result: Bad';
    resultBlock.className = `pill ${isGood ? 'success' : 'danger'}`;
    const explanation = document.createElement('div');
    explanation.className = 'muted';
    explanation.textContent = isGood ? data.explanation_good || '' : data.explanation_bad || '';
    if (explanation.textContent) {
      if (!resultBlock.querySelector('.muted')) resultBlock.appendChild(explanation);
    }
    const duration = state.diagnosticsRun.stepStartedAt ? Math.floor((Date.now() - state.diagnosticsRun.stepStartedAt) / 1000) : 0;
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'step_completed', {
      result: isGood ? 'good' : 'bad',
      readings: lastReadingResults,
      duration_seconds: duration,
    });
    const nextNodeId = state.diagnosticsRun.edges.find((edge) => edge.from_node_id === node.id && edge.condition === (isGood ? 'good' : 'bad'))?.to_node_id;
    if (nextNodeId) {
      state.diagnosticsRun.currentNodeId = nextNodeId;
      await executeOrQueue('updateWorkflowRun', { id: state.diagnosticsRun.run.id, payload: { current_node_id: nextNodeId } }, ({ id, payload }) =>
        updateDiagnosticWorkflowRun(id, payload)
      );
      state.diagnosticsRun.stepStartedAt = Date.now();
      renderWorkflowNode(job);
    } else {
      const restartBtn = document.createElement('button');
      restartBtn.className = 'action';
      restartBtn.textContent = 'Start Another Workflow';
      restartBtn.addEventListener('click', () => renderWorkflowStart(job));
      actions.innerHTML = '';
      actions.appendChild(restartBtn);
    }
  };

  evaluateBtn.addEventListener('click', () => {
    const results = {};
    readings.forEach((reading) => {
      const input = readingInputs[reading.id];
      results[reading.id] = evaluateReading(reading, input.value);
    });
    lastReadingResults = results;
    const rollup = evaluateRollup(readings, results, data.rollup_logic, data.rollup_custom);
    if (rollup === null) {
      showToast('Enter valid readings to evaluate.');
      return;
    }
    logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'readings_recorded', { results });
    handleResult(rollup);
  });
 
   goodBtn.addEventListener('click', () => handleResult(true));
  badBtn.addEventListener('click', () => handleResult(false));
}

async function renderRepairNode(job, node, panel) {
  const data = node.data || {};
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>${data.repair_title || node.title || 'Repair'}</h3>
    <div class="muted">${data.why_repair || ''}</div>
  `;

  if (data.attachments?.length) {
    const attachments = document.createElement('div');
    attachments.className = 'list';
    data.attachments.forEach((url) => {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.className = 'pill';
      link.textContent = url.split('/').pop();
      attachments.appendChild(link);
    });
    card.appendChild(attachments);
  }

  if (data.recommended_tools?.length) {
    const toolsWrap = document.createElement('div');
    toolsWrap.innerHTML = '<h4>Recommended Tools</h4>';
    data.recommended_tools.forEach((tool) => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" /> ${tool}`;
      toolsWrap.appendChild(label);
    });
    card.appendChild(toolsWrap);
  }

  const stepsWrap = document.createElement('div');
  stepsWrap.innerHTML = '<h4>Repair Steps</h4>';
  const steps = data.steps || [];
  if (data.step_type === 'guided' && steps.length) {
    let stepIndex = 0;
    const stepText = document.createElement('div');
    stepText.textContent = `Step ${stepIndex + 1}: ${steps[stepIndex]}`;
    const controls = document.createElement('div');
    controls.className = 'actions';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pill';
    prevBtn.textContent = 'Back';
    prevBtn.disabled = true;
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pill';
    nextBtn.textContent = 'Next';
    controls.append(prevBtn, nextBtn);
    const updateStep = () => {
      stepText.textContent = `Step ${stepIndex + 1}: ${steps[stepIndex]}`;
      prevBtn.disabled = stepIndex === 0;
      nextBtn.disabled = stepIndex === steps.length - 1;
    };
    prevBtn.addEventListener('click', () => {
      stepIndex = Math.max(0, stepIndex - 1);
      updateStep();
    });
    nextBtn.addEventListener('click', () => {
      stepIndex = Math.min(steps.length - 1, stepIndex + 1);
      updateStep();
    });
    stepsWrap.append(stepText, controls);
  } else if (data.step_type === 'checkbox') {
    steps.forEach((step) => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" /> ${step}`;
      stepsWrap.appendChild(label);
    });
  } else if (data.step_type === 'sectioned' && data.sections?.length) {
    data.sections.forEach((section) => {
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'muted';
      sectionTitle.textContent = section.title || 'Section';
      stepsWrap.appendChild(sectionTitle);
      const list = document.createElement('ol');
      (section.steps || []).forEach((step) => {
        const item = document.createElement('li');
        item.textContent = step;
        list.appendChild(item);
      });
      stepsWrap.appendChild(list);
    });
  } else {
    const list = document.createElement('ol');
    steps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      list.appendChild(item);
    });
    stepsWrap.appendChild(list);
  }
  card.appendChild(stepsWrap);

  const photoSection = document.createElement('div');
  photoSection.innerHTML = '<h4>Photos</h4>';
  const beforeInput = document.createElement('input');
  beforeInput.type = 'file';
  const duringInput = document.createElement('input');
  duringInput.type = 'file';
  const afterInput = document.createElement('input');
  afterInput.type = 'file';
  photoSection.append(
    labelWrap('Before Repair', beforeInput),
    labelWrap('During Repair', duringInput),
    labelWrap('After Repair', afterInput),
  );

  const handlePhotoUpload = async (stage, input) => {
    const file = input.files?.[0];
    if (!file) return;
    const url = await uploadJobPhoto(file, { prefix: `job/${job.id}/diagnostics` });
    await addAttachment({ job_id: job.id, attachment_type: `diagnostic_photo_${stage}`, file_url: url });
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'photo_added', { stage, url });
    showToast('Photo saved.');
  };

  beforeInput.addEventListener('change', () => handlePhotoUpload('before', beforeInput));
  duringInput.addEventListener('change', () => handlePhotoUpload('during', duringInput));
  afterInput.addEventListener('change', () => handlePhotoUpload('after', afterInput));

  card.appendChild(photoSection);

  const partsSection = document.createElement('div');
  partsSection.innerHTML = '<h4>Add Part</h4>';
  const inventory = await listTruckInventory(state.truckId);
  const partSelect = document.createElement('select');
  inventory.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.product_id;
    opt.textContent = `${item.products?.name} (${item.qty})`;
    partSelect.appendChild(opt);
  });
  const partQty = document.createElement('input');
  partQty.type = 'number';
  partQty.value = '1';
  const addPartBtn = document.createElement('button');
  addPartBtn.className = 'action success';
  addPartBtn.textContent = 'Add Part';
  addPartBtn.addEventListener('click', async () => {
    const qty = parseInt(partQty.value, 10);
    if (!partSelect.value || !qty) {
      showToast('Select part and quantity.');
      return;
    }
    await executeOrQueue('addJobPart', {
      job_id: job.id,
      product_id: partSelect.value,
      truck_id: state.truckId,
      qty,
    }, addJobPart);
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'part_added', {
      product_id: partSelect.value,
      qty,
    });
    showToast('Part added.');
  });

  const addNonInventoryBtn = document.createElement('button');
  addNonInventoryBtn.className = 'pill';
  addNonInventoryBtn.textContent = 'Add Non-Inventory Part';
  addNonInventoryBtn.addEventListener('click', async () => {
    const description = prompt('Part description');
    if (!description) return;
    const qty = parseInt(prompt('Quantity') || '1', 10);
    const purchased = confirm('Was it purchased?');
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'non_inventory_part', { description, qty, purchased });
    showToast('Non-inventory part logged.');
  });

  partsSection.append(partSelect, partQty, addPartBtn, addNonInventoryBtn);
  card.appendChild(partsSection);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const startBtn = document.createElement('button');
  startBtn.className = 'action';
  startBtn.textContent = 'Start Repair';
  const completeBtn = document.createElement('button');
  completeBtn.className = 'action success';
  completeBtn.textContent = 'Repair Complete';
  actions.append(startBtn, completeBtn);
  card.appendChild(actions);

  startBtn.addEventListener('click', async () => {
    if (data.photos?.before && !beforeInput.files?.length) {
      showToast('Capture before-repair photo.');
      return;
    }
    state.diagnosticsRun.repairStartedAt = Date.now();
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'repair_started', {});
  });

  completeBtn.addEventListener('click', async () => {
    const duration = state.diagnosticsRun.repairStartedAt ? Math.floor((Date.now() - state.diagnosticsRun.repairStartedAt) / 1000) : 0;
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'repair_completed', { duration_seconds: duration });
    const nextNodeId = state.diagnosticsRun.edges.find((edge) => edge.from_node_id === node.id && edge.condition === 'next')?.to_node_id;
    if (nextNodeId) {
      state.diagnosticsRun.currentNodeId = nextNodeId;
      await executeOrQueue('updateWorkflowRun', { id: state.diagnosticsRun.run.id, payload: { current_node_id: nextNodeId } }, ({ id, payload }) =>
        updateDiagnosticWorkflowRun(id, payload)
      );
      state.diagnosticsRun.stepStartedAt = Date.now();
      renderWorkflowNode(job);
    } else {
      renderWorkflowStart(job);
    }
  });

  panel.appendChild(card);
}

function renderEndNode(job, node, panel) {
  const data = node.data || {};
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>${node.title || 'Workflow End'}</h3>
    <label>Closure Reason</label>
    <textarea id="closure-reason" placeholder="Required"></textarea>
    <label>Resolved?</label>
    <select id="resolved">
      <option value="">Not set</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
    <label>Follow-up Required?</label>
    <select id="follow-up">
      <option value="">Not set</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
    <label>Notes for Office</label>
    <textarea id="notes"></textarea>
    <div class="actions">
      <button class="action" id="complete-end">Complete Workflow</button>
    </div>
  `;
  const closureInput = card.querySelector('#closure-reason');
  const completeBtn = card.querySelector('#complete-end');
  completeBtn.addEventListener('click', async () => {
    if (!closureInput.value.trim()) {
      showToast('Closure reason required.');
      return;
    }
    const payload = {
      closure_reason: closureInput.value.trim(),
      resolved: card.querySelector('#resolved').value,
      follow_up: card.querySelector('#follow-up').value,
      notes_for_office: card.querySelector('#notes').value.trim(),
    };
    await logDiagnosticsEvent(state.diagnosticsRun.run.id, node.id, 'workflow_completed', payload);
    await executeOrQueue('updateWorkflowRun', {
      id: state.diagnosticsRun.run.id,
      payload: { status: 'completed', completed_at: new Date().toISOString() },
    }, ({ id, payload }) => updateDiagnosticWorkflowRun(id, payload));
    state.diagnosticsRun.run = null;
    renderChecklist(job);
  });
  panel.appendChild(card);
}

function labelWrap(labelText, inputEl) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

function renderDiagnostics(job) {
  return renderWorkflowStart(job);
}

async function renderRepair(job) {
  saveLastScreen('repair', job.id);
  const parts = await listJobParts(job.id);
  const inventory = await listTruckInventory(state.truckId);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="repair-back">←</button>
      <h2>Repair</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
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
      <h4>Misc Parts</h4>
      <div class="misc-parts">
        <input id="misc-desc" type="text" placeholder="Part description" />
        <input id="misc-qty" type="number" min="1" value="1" />
        <button class="action secondary" id="add-misc">Add Misc Part</button>
      </div>
      <div class="list" id="misc-list"></div>
      <div class="list" id="parts-list"></div>
      <div class="actions">
        <button class="action" id="complete">Complete Job</button>
        <button class="action secondary" id="pause">Pause Job</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;

   if (!inventory.length) {
    select.innerHTML = '<option value="">No truck inventory available</option>';
    panel.querySelector('#add-part').disabled = true;
  } else {
    inventory.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.product_id;
      option.textContent = `${item.products?.name || 'Part'} (${item.qty})`;
      select.appendChild(option);
    });
  }

  const list = panel.querySelector('#parts-list');
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

  panel.querySelector('#add-part').addEventListener('click', async () => {
    const qty = parseInt(panel.querySelector('#part-qty').value, 10);
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


 const miscParts = state.miscPartsByJob[job.id] || [];
  const miscList = panel.querySelector('#misc-list');
  const renderMiscList = () => {
    miscList.innerHTML = '';
    miscParts.forEach((part, index) => {
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.innerHTML = `
        <div>${part.description} (x${part.qty})</div>
        <span class="badge">Remove</span>
      `;
      pill.addEventListener('click', () => {
        miscParts.splice(index, 1);
        state.miscPartsByJob[job.id] = miscParts;
        renderMiscList();
      });
      miscList.appendChild(pill);
    });
  };
  renderMiscList();
  panel.querySelector('#add-misc').addEventListener('click', () => {
    const desc = panel.querySelector('#misc-desc').value.trim();
    const qty = parseInt(panel.querySelector('#misc-qty').value, 10);
    if (!desc || !qty) {
      showToast('Enter misc part description and quantity.');
      return;
    }
    miscParts.push({ description: desc, qty });
    state.miscPartsByJob[job.id] = miscParts;
    panel.querySelector('#misc-desc').value = '';
    panel.querySelector('#misc-qty').value = 1;
    renderMiscList();
  });

  panel.querySelector('#complete').addEventListener('click', async () => {
    const desc = panel.querySelector('#repair-desc').value.trim();
    if (!desc) {
      showToast('Repair description required.');
      return;
    }
   const miscSummary = miscParts.length
      ? `\n\nMisc parts:\n${miscParts.map((part) => `- ${part.description} (x${part.qty})`).join('\n')}`
      : '';
    const finalDesc = `${desc}${miscSummary}`;
    await executeOrQueue('updateJob', { jobId: job.id, payload: { repair_description: finalDesc } }, ({ jobId, payload }) =>
      updateJob(jobId, payload)
    );
    await executeOrQueue('addRepair', { job_id: job.id, description: finalDesc }, addJobRepair);
    renderChecklist(job);
  });
 panel.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_REPAIR));
  panel.querySelector('#back').addEventListener('click', () => renderWorkflowStart(job));
  panel.querySelector('#repair-back').addEventListener('click', () => renderWorkflowStart(job));
  screenContainer(container);
}

function renderChecklist(job) {
  saveLastScreen('checklist', job.id);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="checklist-back">←</button>
      <h2>Final Checklist</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card checklist">
      <h3>Final Checklist</h3>
      <div class="checklist-list">
        <label class="checklist-item"><input type="checkbox" /> Verify all repair parts are tight, affixed, and in original appearance</label>
        <label class="checklist-item"><input type="checkbox" /> Verify all parts are accounted for and trash is picked up</label>
        <label class="checklist-item"><input type="checkbox" /> Adjust timer in MCP to 80% and select a direction if water is required to verify repair</label>
        <label class="checklist-item"><input type="checkbox" /> Start system and verify all towers are moving (if unable to see all towers, verify 1st tower moves at least 3 times)</label>
        <label class="checklist-item"><input type="checkbox" /> If water running verify end gun turns off and on</label>
        <label class="checklist-item"><input type="checkbox" /> Contact supervisor or customer if system is desired to be left running</label>
        <label class="checklist-item"><input type="checkbox" /> If desired to be left running make changes and finish; if no confirmation turn off system and main power disconnect</label>
        <label class="checklist-item"><input type="checkbox" /> Verify all panel doors are closed</label>
      </div>
      <textarea id="unable-reason" placeholder="Unable to perform reason (if needed)"></textarea>
      <div class="actions">
        <button class="action" id="complete">Complete</button>
        <button class="action secondary" id="unable">Unable to Perform</button>
        <button class="action secondary" id="start-another">Start Another Workflow</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;
  const checkboxes = [...panel.querySelectorAll('input[type="checkbox"]')];
  const completeBtn = panel.querySelector('#complete');
  const unableBtn = panel.querySelector('#unable');

  completeBtn.addEventListener('click', () => renderCompletionPreview(job, checkboxes));
  unableBtn.addEventListener('click', () => finalizeJob(job, checkboxes, true));
 panel.querySelector('#start-another').addEventListener('click', () => renderWorkflowStart(job));
   panel.querySelector('#back').addEventListener('click', () => {
     if (state.diagnosticsRun.run) {
       renderWorkflowStart(job);
     } else {
       renderRepair(job);
     }
   });
  panel.querySelector('#checklist-back').addEventListener('click', () => renderRepair(job));
  screenContainer(container);
}

async function renderCompletionPreview(job,checkboxes){
  const allChecked = checkboxes.every((cb) => cb.checked);
  if (!allChecked) {
    showToast('Complete all checklist items or use Unable to Perform.');
    return;
  }
  if (isOffline()) {
    showToast('Completion preview unavailable offline.');
    return;
  }
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="preview-back">←</button>
      <h2>Completion Preview</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>Review Work Order</h3>
    <div class="pill">
      <div>
        <strong>${job.customers?.name || ''}</strong>
        <div class="muted">${job.fields?.name || ''}</div>
      </div>
      <span class="badge">${job.job_types?.name || ''}</span>
    </div>
  `;
  panel.appendChild(card);

  const [diagnostics, repairs, parts] = await Promise.all([
    listJobDiagnostics(job.id),
    listJobRepairs(job.id),
    listJobParts(job.id),
  ]);
  const durations = await getJobStatusDurations(job.id);

  const details = document.createElement('div');
  details.className = 'card';
  details.innerHTML = `
    <h4>Details</h4>
    <div><strong>Repair:</strong> ${job.repair_description || repairs[repairs.length - 1]?.description || 'N/A'}</div>
    <div><strong>Problem:</strong> ${job.problem_description || 'N/A'}</div>
  `;
  panel.appendChild(details);

  const partsCard = document.createElement('div');
  partsCard.className = 'card';
  partsCard.innerHTML = `
    <h4>Parts Used</h4>
    ${parts.length ? parts.map((part) => `<div class="pill">${part.products?.name || 'Part'} (x${part.qty})</div>`).join('') : '<div class="muted">No parts recorded.</div>'}
  `;
  panel.appendChild(partsCard);

  const diagCard = document.createElement('div');
  diagCard.className = 'card';
  diagCard.innerHTML = `
    <h4>Diagnostics</h4>
    ${diagnostics.length ? diagnostics.map((entry) => `<div class="pill">${entry.component_checked}: ${entry.check_results}</div>`).join('') : '<div class="muted">No diagnostics recorded.</div>'}
  `;
  panel.appendChild(diagCard);

  const timeCard = document.createElement('div');
  timeCard.className = 'card';
  timeCard.innerHTML = `
    <h4>Time in Status</h4>
    <div class="pill">Open: ${formatDuration(durations.open)}</div>
    <div class="pill">On The Way: ${formatDuration(durations.on_the_way)}</div>
    <div class="pill">Diagnostics: ${formatDuration(durations.on_site_diagnostics)}</div>
    <div class="pill">Repair: ${formatDuration(durations.on_site_repair)}</div>
    <div class="pill">Paused: ${formatDuration(durations.paused)}</div>
  `;
  panel.appendChild(timeCard);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button class="action" id="confirm-complete">Submit Completion</button>
    <button class="action secondary" id="edit-checklist">Back to Checklist</button>
  `;
  panel.appendChild(actions);

  panel.querySelector('#preview-back').addEventListener('click', () => renderChecklist(job));
  actions.querySelector('#edit-checklist').addEventListener('click', () => renderChecklist(job));
  actions.querySelector('#confirm-complete').addEventListener('click', () => finalizeJob(job, checkboxes, false));
  screenContainer(container);
}

async function finalizeJob(job, checkboxes, allowIncomplete, reasonOverride) {
  const allChecked = checkboxes.every((cb) => cb.checked);
  const reasonInput = document.getElementById('unable-reason');
  const reason = reasonOverride !== undefined ? reasonOverride : (reasonInput ? reasonInput.value.trim() : '');
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
    await generateAndUploadDiagnosticsReport(job);
  } else {
    await enqueueAction('generateReports', { jobId: job.id });
  }
  clearLastScreen();
  delete state.miscPartsByJob[job.id];
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
    if (screen === 'inquiry') return renderInquiryCapture(state.currentJob);
  if (screen === 'repair') return renderRepair(state.currentJob);
  if (screen === 'checklist') return renderChecklist(state.currentJob);
  return renderHome();
}

async function renderRestock() {
  const restockItems = await getRestockList(state.truckId);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="restock-back">←</button>
      <h2>Restock</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
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
 panel.appendChild(card);
  panel.appendChild(commitBtn);
  panel.querySelector('#restock-back').addEventListener('click', renderHome);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);

  panel.appendChild(backBtn);
  screenContainer(container);
}

function renderRestockItem(item, restockItems) {
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="restock-item-back">←</button>
      <h2>Restock Item</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
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
  panel.querySelector('#save').addEventListener('click', () => {
    const qty = parseInt(panel.querySelector('#acquired').value, 10) || 0;
    item.acquiredQty = qty;
    renderRestock();
  });
  panel.querySelector('#out').addEventListener('click', async () => {
    await executeOrQueue('outOfStock', {
      product_id: item.product.id,
      truck_id: state.truckId,
      notes: 'Marked out of stock from tech restock flow.',
    }, createOutOfStock);
    renderRestock();
  });
  panel.querySelector('#close').addEventListener('click', renderRestock);
  panel.querySelector('#restock-item-back').addEventListener('click', renderRestock);
  screenContainer(container);
}

function renderRefuel() {
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="refuel-back">←</button>
      <h2>Re-fuel</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
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
   panel.querySelector('#save').addEventListener('click', async () => {
    const payload = {
      receipt_type: 'Re-fuel',
      truck_id: state.truckId,
      tech_id: state.tech?.id,
      odometer: panel.querySelector('#odometer').value,
      gallons: panel.querySelector('#gallons').value,
      price_per_gallon: panel.querySelector('#price').value,
      total_cost: panel.querySelector('#total').value,
      status: 'pending',
    };
    if (!payload.odometer || !payload.gallons || !payload.price_per_gallon || !payload.total_cost) {
      showToast('All fields required.');
      return;
    }
    await executeOrQueue('createReceipt', payload, createReceipt);
    await executeOrQueue('updateTruck', { truckId: state.truckId, payload: { odometer: payload.odometer } }, ({ truckId, payload }) =>
      updateTruck(truckId, payload)
    );
    if (!isOffline()) await loadBoot();
    showToast('Refuel receipt saved.');
    renderHome();
  });

  panel.querySelector('#cancel').addEventListener('click', renderHome);
  panel.querySelector('#refuel-back').addEventListener('click', renderHome);
  screenContainer(container);
}

async function renderRequests() {
  const requests = await listRequests(state.truckId);
    const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="requests-back">←</button>
      <h2>Requests</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
  const card = document.createElement('div');
  card.className = 'card list';
  card.innerHTML = '<h3>Requests</h3>';
  requests.forEach((req) => {
    const pill = document.createElement('button');
    pill.className = 'pill';
   const statusLabel = req.status === 'approved' ? 'Approved' : 'Pending';
    const statusClass = req.status === 'approved' ? 'success' : '';
    pill.innerHTML = `
      <div>
        <strong>${req.request_type}</strong>
        <div class="muted">${req.description}</div>
      </div>
      <span class="badge ${statusClass}">${statusLabel}</span>
    `;
    card.appendChild(pill);
  });
  if (!requests.length) card.innerHTML += '<p>No pending requests.</p>';
  const addBtn = document.createElement('button');
  addBtn.className = 'action';
  addBtn.textContent = 'Add Request';
  addBtn.addEventListener('click', renderRequestForm);
  panel.appendChild(card);
  panel.appendChild(addBtn);
  panel.querySelector('#requests-back').addEventListener('click', renderHome);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
 panel.appendChild(backBtn);
  screenContainer(container);
}

async function renderRequestForm() {
   const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
 const helperNames = [
    state.tech?.full_name,
    ...state.helpers,
  ].filter(Boolean);
  const helperOptions = [...new Set(helperNames)].map((name) => `<option value="${name}">${name}</option>`).join('');
  const truckTools = await listTruckTools(state.truckId);
  const toolOptions = truckTools.map((tool) => {
    const name = tool.tools?.name || tool.tool_name || tool.name || 'Tool';
    return `<option value="${name}">${name}</option>`;
  }).join('');
  const requestTypeOptions = [
    'Time off',
    'Purchase request',
    'Tool request',
    'Supply request',
  ].map((type) => `<option value="${type}">${type}</option>`).join('');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="request-form-back">←</button>
      <h2>New Request</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card">
      <h3>New Request</h3>
      <label>Request Type</label>
      <select id="req-type">${requestTypeOptions}</select>
      <div id="req-timeoff" class="section">
        <label>Person</label>
        <select id="req-person">${helperOptions}</select>
       <label>Start Date/Time</label>
        <input id="req-start" type="datetime-local" />
        <label>End Date/Time</label>
        <input id="req-end" type="datetime-local" />
        <label>Reason</label>
        <textarea id="req-reason"></textarea>
      </div>
      <div id="req-tool" class="section">
        <label>Tool Request Type</label>
        <select id="tool-type">
          <option value="replacement">Replacement</option>
          <option value="additional".Additional</option>
        </select>
        <div id="tool-replacement">
          <label>Replacement Tool</label>
          <select id="req-tool-name">${toolOptions}</select>
        </div>
        <div id="tool-additional">
          <label>Tool Name</label>
          <input id="req-tool-custom" type="text" placeholder="Tool name" />
        </div>
        <label>Quantity</label>
        <input id="req-tool-qty" type="number" min="1" value="1" />
        <label>Reason</label>
        <textarea id="req-tool-desc"></textarea>
      </div>
      <div id="req-purchase" class="section">
        <label>Purchase Description</label>
        <textarea id="req-purchase-desc"></textarea>
        <label>Estimated Cost</label>
        <input id="req-purchase-cost" type="number" min="0" step="0.01" />
      </div>
      <div id="req-supply" class="section">
        <label>Supply Description</label>
        <textarea id="req-supply-desc"></textarea>
        <label>Quantity</label>
        <input id="req-supply-qty" type="number" min="1" value="1" />
        <label>Reason</label>
        <textarea id="req-supply-reason"></textarea>
      </div>
      <div class="actions">
        <button class="action" id="save">Save</button>
        <button class="action secondary" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  const reqTypeSelect = panel.querySelector('#req-type');
  const sections = {
    'Time off': panel.querySelector('#req-timeoff'),
    'Tool request': panel.querySelector('#req-tool'),
    'Purchase request': panel.querySelector('#req-purchase'),
    'Supply request': panel.querySelector('#req-supply'),
  };
  const updateSections = () => {
    Object.values(sections).forEach((section) => { section.style.display = 'none'; });
    const selected = reqTypeSelect.value;
    if (sections[selected]) sections[selected].style.display = 'grid';
  };
  updateSections();
  reqTypeSelect.addEventListener('change', updateSections);
   const toolTypeSelect = panel.querySelector('#tool-type');
  const replacementSection = panel.querySelector('#tool-replacement');
  const additionalSection = panel.querySelector('#tool-additional');
  const toggleToolType = () => {
    const isReplacement = toolTypeSelect.value === 'replacement';
    replacementSection.style.display = isReplacement ? 'grid' : 'none';
    additionalSection.style.display = isReplacement ? 'none' : 'grid';
  };
  toggleToolType();
  toolTypeSelect.addEventListener('change', toggleToolType);

  panel.querySelector('#save').addEventListener('click', async () => {
    const type = panel.querySelector('#req-type').value;
    let desc = '';
    const metadata = {};
    if (type === 'Time off') {
      metadata.person = panel.querySelector('#req-person').value;
      metadata.start = panel.querySelector('#req-start').value;
      metadata.end = panel.querySelector('#req-end').value;
      metadata.reason = panel.querySelector('#req-reason').value.trim();
      desc = `Time off request for ${metadata.person || 'team member'} (${metadata.start || 'start TBD'} → ${metadata.end || 'end TBD'}).`;
      if (!metadata.person || !metadata.start || !metadata.end || !metadata.reason) {
        showToast('Complete all time off fields.');
        return;
      }
   } else if (type === 'Tool request') {
      metadata.tool_request_type = panel.querySelector('#tool-type').value;
      metadata.qty = panel.querySelector('#req-tool-qty').value;
      metadata.reason = panel.querySelector('#req-tool-desc').value.trim();
      if (!metadata.qty || !metadata.reason) {
        showToast('Tool qty and reason required.');
        return;
      }
    if (metadata.tool_request_type === 'replacement') {
        metadata.tool_name = panel.querySelector('#req-tool-name').value;
        if (!metadata.tool_name) {
          showToast('Select replacement tool.');
          return;
        }
      } else {
        metadata.tool_name = panel.querySelector('#req-tool-custom').value.trim();
        if (!metadata.tool_name) {
          showToast('Enter tool name.');
          return;
        }
      }
      desc = `${metadata.tool_request_type === 'replacement' ? 'Replacement' : 'Additional'} tool request: ${metadata.tool_name}`;
    } else if (type === 'Purchase request') {
      metadata.estimated_cost = panel.querySelector('#req-purchase-cost').value;
      desc = panel.querySelector('#req-purchase-desc').value.trim();
    if (!desc) {
        showToast('Purchase description required.');
        return;
      }
    } else if (type === 'Supply request') {
      metadata.qty = panel.querySelector('#req-supply-qty').value;
      metadata.reason = panel.querySelector('#req-supply-reason').value.trim();
      desc = panel.querySelector('#req-supply-desc').value.trim();
      if (!desc || !metadata.qty || !metadata.reason) {
        showToast('Supply description, qty, and reason required.');
        return;
      }
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
  panel.querySelector('#cancel').addEventListener('click', renderRequests);
  panel.querySelector('#request-form-back').addEventListener('click', renderRequests);
  screenContainer(container);
}

function renderReceipts() {
 const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  const receiptOptions = state.boot.receiptTypes.map((type) => `<option value="${type.name}">${type.name}</option>`).join('');
  const receiptItems = [{ description: '', qty: 1, price: '' }];
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="receipts-back">←</button>
      <h2>Receipts</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
    <div class="card">
      <h3>Add Receipt</h3>
      <label>Receipt Type</label>
      <select id="receipt-type">${receiptOptions}</select>
      <div class="receipt-items" id="receipt-items"></div>
      <button class="pill tiny" id="add-receipt-item" type="button">Add Item</button>
      <label>Notes</label>
      <textarea id="receipt-desc" placeholder="Optional notes"></textarea>
      <div class="receipt-summary" id="receipt-summary"></div>
      <div class="actions">
        <button class="action" id="save">Save</button>
        <button class="action secondary" id="cancel">Cancel</button>
      </div>
    </div>
  `;
   const itemsWrap = panel.querySelector('#receipt-items');
  const summary = panel.querySelector('#receipt-summary');
  const receiptTypeSelect = panel.querySelector('#receipt-type');

  const computeItemTotal = (item) => Number(item.qty || 0) * Number(item.price || 0);
  const computeTotals = () => {
    const totalCost = receiptItems.reduce((acc, item) => acc + computeItemTotal(item), 0);
    const totalQty = receiptItems.reduce((acc, item) => acc + Number(item.qty || 0), 0);
    return { totalCost, totalQty };
  };

  const updateSummary = () => {
    const { totalCost, totalQty } = computeTotals();
    summary.innerHTML = `
      <div class="pill">
        <div>
          <strong>Total for ${receiptTypeSelect.value || 'Receipt'}</strong>
          <div class="muted">Qty: ${totalQty}</div>
        </div>
        <span class="badge">${formatCurrency(totalCost)}</span>
      </div>
    `;
  };

  const renderItems = () => {
    itemsWrap.innerHTML = '';
    receiptItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'receipt-item-row';
      row.innerHTML = `
        <div class="receipt-item-field">
          <label>Item</label>
          <input type="text" value="${item.description}" placeholder="Item description" />
        </div>
        <div class="receipt-item-field">
          <label>Qty</label>
          <input type="number" min="1" value="${item.qty}" />
        </div>
        <div class="receipt-item-field">
          <label>Price Each</label>
          <input type="number" min="0" step="0.01" value="${item.price}" />
        </div>
        <div class="receipt-item-field receipt-item-total">
          <label>Total</label>
          <div class="receipt-total-value">${formatCurrency(computeItemTotal(item))}</div>
        </div>
        <button class="pill tiny danger" type="button">Remove</button>
      `;
      const [descInput, qtyInput, priceInput] = row.querySelectorAll('input');
      const totalValue = row.querySelector('.receipt-total-value');
      const removeBtn = row.querySelector('button');
      descInput.addEventListener('input', (event) => {
        item.description = event.target.value;
      });
      qtyInput.addEventListener('input', (event) => {
        item.qty = Number(event.target.value || 0);
        totalValue.textContent = formatCurrency(computeItemTotal(item));
        updateSummary();
      });
      priceInput.addEventListener('input', (event) => {
        item.price = Number(event.target.value || 0);
        totalValue.textContent = formatCurrency(computeItemTotal(item));
        updateSummary();
      });
      removeBtn.addEventListener('click', () => {
        if (receiptItems.length === 1) return;
        receiptItems.splice(index, 1);
        renderItems();
        updateSummary();
      });
      itemsWrap.appendChild(row);
    });
  };

  renderItems();
  updateSummary();

  panel.querySelector('#add-receipt-item').addEventListener('click', () => {
    receiptItems.push({ description: '', qty: 1, price: '' });
    renderItems();
  });

  receiptTypeSelect.addEventListener('change', updateSummary);
  panel.querySelector('#save').addEventListener('click', async () => {
      const cleanedItems = receiptItems
      .map((item) => ({
        description: item.description.trim(),
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        total: computeItemTotal(item),
      }))
      .filter((item) => item.description);
    if (!cleanedItems.length) {
      showToast('Add at least one item.');
      return;
    }
    if (cleanedItems.some((item) => !item.qty || item.qty < 0 || item.price < 0)) {
      showToast('Enter valid qty and price for each item.');
      return;
    }
    const totalCost = cleanedItems.reduce((acc, item) => acc + item.total, 0);
    const totalQty = cleanedItems.reduce((acc, item) => acc + item.qty, 0);
    const payload = {
      receipt_type: receiptTypeSelect.value,
      qty: totalQty,
      description: panel.querySelector('#receipt-desc').value.trim(),
      items: cleanedItems,
      total_cost: totalCost,
      truck_id: state.truckId,
      tech_id: state.tech?.id,
      status: 'pending',
    };
    await executeOrQueue('createReceipt', payload, createReceipt);
    showToast('Receipt saved.');
    renderHome();
  });
   panel.querySelector('#cancel').addEventListener('click', renderHome);
  panel.querySelector('#receipts-back').addEventListener('click', renderHome);
  screenContainer(container);
}

state.offlineQueueHandlers = {
  createJob: (payload) => createJob(payload),
  setJobStatus: ({ jobId, status, options }) => setJobStatus(jobId, status, options),
  updateJob: ({ jobId, payload }) => updateJob(jobId, payload),
  updateField: ({ fieldId, payload }) => updateField(fieldId, payload),
  updateTruck: ({ truckId, payload }) => updateTruck(truckId, payload),
  addDiagnostic: (payload) => addJobDiagnostic(payload),
  deleteDiagnostic: ({ id }) => deleteJobDiagnostic(id),
  addJobPart: (payload) => addJobPart(payload),
  removeJobPart: (payload) => removeJobPart(payload),
  addRepair: (payload) => addJobRepair(payload),
  createWorkflowRun: (payload) => createDiagnosticWorkflowRun(payload),
  updateWorkflowRun: ({ id, payload}) => updateDiagnosticWorkflowRun(id,payload),
diagnosticEvent: (payload) => createDiagnosticRunEvent(payload),
  commitRestock: ({ truckId, restockItems }) => commitRestock(truckId, restockItems),
  outOfStock: (payload) => createOutOfStock(payload),
  createRequest: (payload) => createRequest(payload),
  createReceipt: (payload) => createReceipt(payload),
  updateUser: ({ userId, payload }) => updateUser(userId, payload),
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
    await generateAndUploadDiagnosticsReport(job);
  },
};

window.addEventListener('online', syncOutbox);

renderLogin();
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.runSupabaseHealthCheck = runSupabaseHealthCheck;
  console.info('Dev helper available: window.runSupabaseHealthCheck()');
}
