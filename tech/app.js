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
const mapState = {
  map: null,
  markersLayer: null,
  watchId: null,
  locationMarker: null,
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
  updateTechDisplay();
}

function setTruck(truckId) {
  state.truckId = truckId;
  localStorage.setItem('TECH_TRUCK_ID', truckId);
  updateTechDisplay();
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
      <button class="menuBtn" data-action="current">
        <div class="menuLeft">
          <div class="name">Current Inventory</div>
          <div class="desc">Parts on this truck</div>
        </div>
        <span class="chev">›</span>
      </button>
      <button class="menuBtn" data-action="master">
        <div class="menuLeft">
          <div class="name">Master Truck Inventory</div>
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
  const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED] });
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
    await executeOrQueue('upsertInventory', {
      truck_id: state.truckId,
      product_id: productId,
      qty,
    }, upsertTruckInventory);
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

async function renderMasterInventory() {
  const restock = await getRestockList(state.truckId);
  const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="master-back">←</button>
      <h2>Master Truck Inventory</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h3>Minimum stock list</h3>';
  panel.appendChild(card);
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
  panel.querySelector('#master-back').addEventListener('click', renderHome);
  const backBtn = document.createElement('button');
  backBtn.className = 'pill';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', renderHome);
  container.appendChild(backBtn);
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
  const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED] });
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

  const jobs = await listJobs({ statuses: [JOB_STATUSES.OPEN, JOB_STATUSES.PAUSED] });
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
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery?MapServer/tile/{z}/{y}/{x}',
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
    openBtn.className = 'pill inline';
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
function renderJobCard(job) {
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
        <button class="action" id="take-job">Take Job</button>
       <button class="action secondary" id="job-card-secondary-back">Back</button>
      </div>
    </div>
  `;
  panel.querySelector('#job-card-back').addEventListener('click', renderOpenJobs);
  panel.querySelector('#job-card-secondary-back').addEventListener('click', renderOpenJobs);
  panel.querySelector('#take-job').addEventListener('click', () => renderRoutePrompt(job));
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
        window.open(`https://maps.google.com/?q=${job.fields.lat},${job.fields.lon}`);
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
        <button class="action secondary" id="skip-repair">Skip to Repair</button>
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
    renderDiagnostics(job);
  });
  panel.querySelector('#skip-repair').addEventListener('click', async () => {
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
   const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  const card = document.createElement('div');
  card.className = 'card';
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="diagnostics-back">←</button>
      <h2>Diagnostics</h2>
      <span class="badge">${getTruckLabel()}</span>
    </div>
  `;
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
 panel.querySelector('#diagnostics-back').addEventListener('click', renderJobIntake.bind(null, job));
  panel.appendChild(card);
  screenContainer(container);
}

function renderFoundProblem(job) {
  saveLastScreen('found-problem', job.id);
   const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  panel.innerHTML = `
    <div class="screenTitle">
      <button class="backBtn" id="found-problem-back">←</button>
      <h2>Found Problem</h2>
      <span class="badge">${getTruckLabel()}</span
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
 const input = panel.querySelector('#problem');
  const continueBtn = panel.querySelector('#continue');
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
 panel.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_DIAGNOSTICS));
  panel.querySelector('#back').addEventListener('click', () => renderDiagnostics(job));
  panel.querySelector('#found-problem-back').addEventListener('click', () => renderDiagnostics(job));
  screenContainer(container);
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
      <div class="list" id="parts-list"></div>
      <div class="actions">
        <button class="action" id="complete">Complete Job</button>
        <button class="action secondary" id="pause">Pause Job</button>
        <button class="action secondary" id="back">Back</button>
      </div>
    </div>
  `;

  const select = panel.querySelector('#part-select');
  inventory.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.product_id;
    option.textContent = `${item.products?.name} (${item.qty})`;
    select.appendChild(option);
  });

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

  panel.querySelector('#complete').addEventListener('click', async () => {
    const desc = panel.querySelector('#repair-desc').value.trim();
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
 panel.querySelector('#pause').addEventListener('click', () => pauseJob(job, JOB_STATUSES.ON_SITE_REPAIR));
  panel.querySelector('#back').addEventListener('click', () => renderFoundProblem(job));
  panel.querySelector('#repair-back').addEventListener('click', () => renderFoundProblem(job));
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
  const checkboxes = [...panel.querySelectorAll('input[type="checkbox"]')];
  const completeBtn = panel.querySelector('#complete');
  const unableBtn = panel.querySelector('#unable');

  completeBtn.addEventListener('click', () => finalizeJob(job, checkboxes, false));
  unableBtn.addEventListener('click', () => finalizeJob(job, checkboxes, true));
   panel.querySelector('#back').addEventListener('click', () => renderRepair(job));
  panel.querySelector('#checklist-back').addEventListener('click', () => renderRepair(job));
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
    pill.innerHTML = `<div>${req.request_type}</div><span class="badge">${req.description}</span>`;
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
  const helperOptions = state.boot.users.map((user) => `<option value="${user.id}">${user.full_name}</option>`).join('');
  const truckTools = await listTruckTools(state.truckId);
  const toolOptions = truckTools.map((tool) => {
    const name = tool.tools?.name || tool.tool_name || tool.name || 'Tool';
    return `<option value="${name}">${name}</option>`;
  }).join('');
  const requestTypeOptions = state.boot.requestTypes.map((type) => `<option value="${type.name}">${type.name}</option>`).join('');
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
  const reqTypeSelect = panel.querySelector('#req-type');
  const sections = {
    'Time off': panel.querySelector('#req-timeoff'),
    Tool: panel.querySelector('#req-tool'),
    'Truck maintenance': panel.querySelector('#req-maintenance'),
    Purchase: panel.querySelector('#req-purchase'),
  };
  const updateSections = () => {
    Object.values(sections).forEach((section) => { section.style.display = 'none'; });
    const selected = reqTypeSelect.value;
    if (sections[selected]) sections[selected].style.display = 'grid';
  };
  updateSections();
  reqTypeSelect.addEventListener('change', updateSections);

  panel.querySelector('#save').addEventListener('click', async () => {
    const type = panel.querySelector('#req-type').value;
    let desc = '';
    const metadata = {};
    if (type === 'Time off') {
      metadata.person_id = panel.querySelector('#req-person').value;
      metadata.date = panel.querySelector('#req-date').value;
      desc = `Time off requested for ${metadata.date || 'unspecified date'}.`;
    } else if (type === 'Tool') {
      metadata.tool_type = panel.querySelector('#tool-type').value;
      metadata.tool_name = panel.querySelector('#req-tool-name').value;
      desc = panel.querySelector('#req-tool-desc').value.trim();
      if (metadata.tool_type === 'replacement' && !metadata.tool_name) {
        showToast('Select replacement tool.');
        return;
      }
    } else if (type === 'Truck maintenance') {
      metadata.odometer = panel.querySelector('#req-odometer').value;
      desc = panel.querySelector('#req-maintenance-desc').value.trim();
      if (!metadata.odometer) {
        showToast('Odometer required.');
        return;
      }
    } else if (type === 'Purchase') {
      desc = panel.querySelector('#req-purchase-desc').value.trim();
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
  panel.querySelector('#cancel').addEventListener('click', renderRequests);
  panel.querySelector('#request-form-back').addEventListener('click', renderRequests);
  screenContainer(container);
}

function renderReceipts() {
 const { container, panel } = createAppLayout();
  panel.classList.add('panel-stack');
  const receiptOptions = state.boot.receiptTypes.map((type) => `<option value="${type.name}">${type.name}</option>`).join('');
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
  panel.querySelector('#save').addEventListener('click', async () => {
    const payload = {
      receipt_type: panel.querySelector('#receipt-type').value,
      qty: panel.querySelector('#receipt-qty').value,
      description: panel.querySelector('#receipt-desc').value,
      truck_id: state.truckId,
      tech_id: state.tech?.id,
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
if (typeof window.renderLogin === 'function'){
  window.renderLogin();
  }else {
    console.error('renderLogin is not available.');
  }
