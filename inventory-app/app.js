import { getSupabaseClient, listProducts } from '../shared/db.js';

const supabase = getSupabaseClient();

const state = {
  aisles: [],
  shelves: [],
  bins: [],
  products: [],
  productsById: new Map(),
  selectedAisleId: null,
  selectedSide: 'A',
  selectedShelfId: null,
  selectedBinId: null,
  errors: {
    aisles: null,
    shelves: null,
    bins: null,
    products: null,
  },
};
let elements = {};

function cacheElements() {
  elements = {
    aisleList: document.getElementById('aisle-list'),
    shelfList: document.getElementById('shelf-list'),
    binList: document.getElementById('bin-list'),
    aisleTitle: document.getElementById('aisle-title'),
    aisleSubtitle: document.getElementById('aisle-subtitle'),
    shelfTitle: document.getElementById('shelf-title'),
    shelfSubtitle: document.getElementById('shelf-subtitle'),
    addAisle: document.getElementById('add-aisle'),
    addShelf: document.getElementById('add-shelf'),
    addBin: document.getElementById('add-bin'),
    sideButtons: document.querySelectorAll('.side-toggle .btn'),
    modalWrap: document.getElementById('modalWrap'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),
    toast: document.getElementById('toast'),
    navOffice: document.getElementById('nav_office'),
    navHome: document.getElementById('nav_home'),
    navMap: document.getElementById('nav_map'),
  };
}


function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.style.display = 'block';
  setTimeout(() => {
    elements.toast.style.display = 'none';
  }, 3200);
}

function openModal(title, bodyHtml) {
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = bodyHtml;
  elements.modalWrap.style.display = 'flex';
  elements.modalWrap.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  elements.modalWrap.style.display = 'none';
  elements.modalWrap.setAttribute('aria-hidden', 'true');
  elements.modalBody.innerHTML = '';
}

function setNavHandlers() {
  elements.navOffice.addEventListener('click', () => {
    window.location.href = '../office/index.html';
  });
  elements.navHome.addEventListener('click', () => {
    window.location.href = '../office/index.html';
  });
  elements.navMap.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function loadProducts() {
  state.errors.products = null;
  try {
    const products = await listProducts();
    state.products = (products || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    state.productsById = new Map(state.products.map((product) => [product.id, product]));
  } catch (error) {
    console.error(error);
    state.errors.products = error.message;
    showToast(`Products load failed: ${error.message}`);
  }
}

async function loadAisles() {
  state.errors.aisles = null;
  try {
    const { data, error } = await supabase
      .from('aisles')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    state.aisles = data || [];
    if (!state.selectedAisleId && state.aisles.length) {
      state.selectedAisleId = state.aisles[0].id;
    }
  } catch (error) {
    console.error(error);
    state.errors.aisles = error.message;
    showToast(`Shelf systems load failed: ${error.message}`);
  }
  renderAisles();
}

async function loadShelves() {
  state.errors.shelves = null;
  state.shelves = [];
  state.selectedShelfId = null;
  if (!state.selectedAisleId) {
    renderShelves();
    return;
  }
  try {
    const { data, error } = await supabase
      .from('shelves')
      .select('*')
      .eq('aisle_id', state.selectedAisleId)
      .eq('side', state.selectedSide)
      .order('level_number', { ascending: true });
    if (error) throw error;
    state.shelves = data || [];
    state.selectedShelfId = state.shelves[0]?.id || null;
  } catch (error) {
    console.error(error);
    state.errors.shelves = error.message;
    showToast(`Shelves load failed: ${error.message}`);
  }
  renderShelves();
  await loadBins();
}

async function loadBins() {
  state.errors.bins = null;
  state.bins = [];
  if (!state.selectedShelfId) {
    renderBins();
    return;
  }
  try {
    const { data, error } = await supabase
      .from('bins')
      .select('*')
      .eq('shelf_id', state.selectedShelfId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    state.bins = data || [];
  } catch (error) {
    console.error(error);
    state.errors.bins = error.message;
    showToast(`Bins load failed: ${error.message}`);
  }
  renderBins();
}

function aisleSubtitleText() {
  const aisle = state.aisles.find((item) => item.id === state.selectedAisleId);
  if (!aisle) return 'Pick a shelf side to see levels.';
  const labels = aisleMarkersFor(aisle.id);
  return `Orientation: ${aisle.orientation || '—'} · ${labels.sideB} → ${labels.sideA}`;
}

function shelfSubtitleText() {
  const shelf = state.shelves.find((item) => item.id === state.selectedShelfId);
  if (!shelf) return 'Pick a shelf leveln to see bins.';
  return `Side ${shelf.side} · Level ${shelf.level_number}`;
}

function aisleMarkersFor(aisleId) {
  const index = state.aisles.findIndex((item) => item.id === aisleId);
  if (index === -1) {
    return { sideA: 'Aisle —', sideB: 'Aisle —' };
  }
  return {
    sideB: `Aisle ${index + 1}`,
    sideA: `Aisle ${index + 2}`,
  };
}

function renderAisles() {
  elements.aisleList.innerHTML = '';
  if (state.errors.aisles) {
    elements.aisleList.innerHTML = `<div class="empty-state">${state.errors.aisles}</div>`;
    return;
  }
  if (!state.aisles.length) {
       elements.aisleList.innerHTML = '<div class="empty-state">No shelf systems yet. Add the first shelf system.</div>'; 
  }

  state.aisles.forEach((aisle) => {
   const labels = aisleMarkersFor(aisle.id);
    const orientation = aisle.orientation === 'EW' ? 'EW' : 'NS';
    const isSelected = aisle.id === state.selectedAisleId;
    const item = document.createElement('div');
    item.className = `shelf-system orientation-${orientation.toLowerCase()}${isSelected ? ' active' : ''}`;
    item.dataset.aisleId = aisle.id;
    item.draggable = true;
    item.innerHTML = `
       <div class="aisle-marker marker-b">${labels.sideB}</div>
      <div class="aisle-marker marker-a">${labels.sideA}</div>
      <div class="shelf-body">
        <button class="shelf-half side-b${isSelected && state.selectedSide === 'B' ? ' selected' : ''}" type="button" data-side="B">Side B</button>
        <button class="shelf-half side-a${isSelected && state.selectedSide === 'A' ? ' selected' : ''}" type="button" data-side="A">Side A</button>
      </div>
      <div class="shelf-label">
        <strong>${aisle.name || 'Shelf system'}</strong>
        <span class="muted">Orientation ${orientation}</span>
      </div>
    `;
  
      item.querySelectorAll('.shelf-half').forEach((half) => {
      half.addEventListener('click', (event) => {
        event.stopPropagation();
        selectShelfSide(aisle.id, half.dataset.side);
      });
    });

    item.addEventListener('dragstart', handleAisleDragStart);
    item.addEventListener('dragend', handleAisleDragEnd);
    item.addEventListener('dragover', handleAisleDragOver);
    item.addEventListener('drop', handleAisleDrop);
    elements.aisleList.appendChild(item);
  });
}

function renderShelves() {
  elements.shelfList.innerHTML = '';
  const aisle = state.aisles.find((item) => item.id === state.selectedAisleId);
 const labels = aisle ? aisleMarkersFor(aisle.id) : { sideA: 'Aisle —', sideB: 'Aisle —' };
  const sideLabel = state.selectedSide === 'A' ? labels.sideA : labels.sideB;
  elements.aisleTitle.textContent = aisle ? `${aisle.name} · ${sideLabel} · Side ${state.selectedSide}` : 'Shelf System';

  elements.sideButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.side === state.selectedSide);
  });

  if (!state.selectedAisleId) {
    elements.shelfList.innerHTML = '<div class="empty-state">Select a shelf side to load levels.</div>';
    elements.shelfTitle.textContent = 'Shelf Level';
    elements.shelfSubtitle.textContent = 'Pick a shelf to see bins.';
    renderBins();
    return;
  }

  if (state.errors.shelves) {
    elements.shelfList.innerHTML = `<div class="empty-state">${state.errors.shelves}</div>`;
    return;
  }

  if (!state.shelves.length) {
    elements.shelfList.innerHTML = '<div class="empty-state">No levels yet. Add the first shelf level.</div>';
  }

  state.shelves.forEach((shelf) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `levelbtn${shelf.id === state.selectedShelfId ? ' active' : ''}`;
    item.textContent = `Level ${shelf.level_number}`;
    item.addEventListener('click', () => selectShelf(shelf.id));
    elements.shelfList.appendChild(item);
  });

  elements.shelfTitle.textContent = state.selectedShelfId ? `Shelf Level ${state.selectedShelfId.slice(0, 6)}` : 'Shelf Level';
  elements.shelfSubtitle.textContent = shelfSubtitleText();
}

function binStatus(bin) {
  if (!bin.product_id) return 'empty';
  const qty = Number(bin.qty ?? 0);
  const reorder = Number(bin.reorder_point ?? 0);
  if (!qty) return 'oos';
  if (reorder && qty <= reorder) return 'low';
  return 'ok';
}

function renderBins() {
  elements.binList.innerHTML = '';
  if (!state.selectedShelfId) {
    elements.binList.innerHTML = '<div class="empty-state">Select a shelf level to load bins.</div>';
    elements.shelfTitle.textContent = 'Shelf Level';
    elements.shelfSubtitle.textContent = 'Pick a shelf level to see bins.';
    return;
  }

  if (state.errors.bins) {
    elements.binList.innerHTML = `<div class="empty-state">${state.errors.bins}</div>`;
    return;
  }

  if (!state.bins.length) {
    elements.binList.innerHTML = '<div class="empty-state">No bins yet. Add the first bin.</div>';
    return;
  }

  state.bins.forEach((bin) => {
    const product = bin.product_id ? state.productsById.get(bin.product_id) : null;
    const status = binStatus(bin);
    const item = document.createElement('div');
    item.className = `bin ${status}`;
    item.draggable = true;
    item.dataset.binId = bin.id;
    item.innerHTML = `
      <div class="binhead">
        <div class="binlabel">${bin.label || 'Bin'}</div>
        <div class="chip soft">${product ? 'Assigned' : 'Unassigned'}</div>
      </div>
      <div class="countbig">${Number(bin.qty ?? 0)}</div>
      <div class="sell">${product ? `${product.sku ? `${product.sku} · ` : ''}${product.name || ''}` : 'No product'}</div>
    `;

    item.addEventListener('click', () => openBinDetails(bin.id));
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);

    elements.binList.appendChild(item);
  });
}

function selectAisle(aisleId) {
  state.selectedAisleId = aisleId;
  renderAisles();
  loadShelves();
}

function selectShelfSide(aisleId, side) {
  state.selectedAisleId = aisleId;
  state.selectedSide = side;
  renderAisles();
  loadShelves();
}

function selectShelf(shelfId) {
  state.selectedShelfId = shelfId;
  renderShelves();
  loadBins();
}

function handleSideToggle(event) {
  const side = event.currentTarget.dataset.side;
  if (!side || side === state.selectedSide) return;
  state.selectedSide = side;
  renderAisles();
  loadShelves();
}

function nextSortOrder(items, key = 'sort_order') {
  return (Math.max(0, ...items.map((item) => Number(item[key] || 0))) || 0) + 1;
}

async function handleAddAisle() {
  openModal('Add Shelf System', `
    <form id="aisle-form" class="stack">
      <div class="field">
        <label for="aisle-name">Shelf System name</label>
        <input id="aisle-name" name="name" required placeholder="Shelf System 1" />
      </div>
      <div class="field">
        <label for="aisle-orientation">Orientation</label>
        <select id="aisle-orientation" name="orientation" required>
          <option value="NS">NS</option>
          <option value="EW">EW</option>
        </select>
      </div>
      <div class="row">
        <button class="btn primary" type="submit">Create Shelf System</button>
        <button class="btn ghost" type="button" id="aisle-cancel">Cancel</button>
      </div>
    </form>
  `);

  document.getElementById('aisle-cancel').addEventListener('click', closeModal);
  document.getElementById('aisle-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = String(formData.get('name') || '').trim();
    const orientation = String(formData.get('orientation') || '').trim();
    if (!name) return;
    const sortOrder = nextSortOrder(state.aisles);
    const payload = {
      name,
      orientation,
      sort_order: sortOrder,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const optimistic = { ...payload, id: `temp-${Date.now()}` };
    state.aisles.push(optimistic);
    renderAisles();
    closeModal();

    const { data, error } = await supabase
      .from('aisles')
      .insert(payload)
      .select()
      .single();
    if (error) {
      state.aisles = state.aisles.filter((item) => item.id !== optimistic.id);
      renderAisles();
      showToast(`Add shelf system failed: ${error.message}`);
      return;
    }
    const index = state.aisles.findIndex((item) => item.id === optimistic.id);
    if (index !== -1) state.aisles[index] = data;
    state.selectedAisleId = data.id;
    renderAisles();
    await loadShelves();
  });
}

async function handleAddShelf() {
  if (!state.selectedAisleId) {
    showToast('Select a shelf system side first.');
    return;
  }
  const nextLevel = nextSortOrder(state.shelves, 'level_number');
  const payload = {
    aisle_id: state.selectedAisleId,
    side: state.selectedSide,
    level_number: nextLevel,
    sort_order: nextLevel,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const optimistic = { ...payload, id: `temp-${Date.now()}` };
  state.shelves.push(optimistic);
  state.selectedShelfId = optimistic.id;
  renderShelves();

  const { data, error } = await supabase
    .from('shelves')
    .insert(payload)
    .select()
    .single();
  if (error) {
    state.shelves = state.shelves.filter((item) => item.id !== optimistic.id);
    renderShelves();
    showToast(`Add shelf failed: ${error.message}`);
    return;
  }
  const index = state.shelves.findIndex((item) => item.id === optimistic.id);
  if (index !== -1) state.shelves[index] = data;
  state.selectedShelfId = data.id;
  renderShelves();
  await loadBins();
}

async function handleAddBin() {
  if (!state.selectedShelfId) {
    showToast('Select a shelf first.');
    return;
  }
  const nextOrder = nextSortOrder(state.bins);
  const payload = {
    shelf_id: state.selectedShelfId,
    label: `Bin ${nextOrder}`,
    sort_order: nextOrder,
    qty: 0,
    updated_at: new Date().toISOString(),
  };
  const optimistic = { ...payload, id: `temp-${Date.now()}` };
  state.bins.push(optimistic);
  renderBins();

  const { data, error } = await supabase
    .from('bins')
    .insert(payload)
    .select()
    .single();
  if (error) {
    state.bins = state.bins.filter((item) => item.id !== optimistic.id);
    renderBins();
    showToast(`Add bin failed: ${error.message}`);
    return;
  }
  const index = state.bins.findIndex((item) => item.id === optimistic.id);
  if (index !== -1) state.bins[index] = data;
  renderBins();
}

function openBinDetails(binId) {
  const bin = state.bins.find((item) => item.id === binId);
  if (!bin) return;
  state.selectedBinId = binId;
  const productOptions = state.products
    .map((product) => {
      const label = `${product.sku ? `${product.sku} · ` : ''}${product.name || ''}`;
      return `<option value="${product.id}" ${product.id === bin.product_id ? 'selected' : ''}>${label}</option>`;
    })
    .join('');

  openModal(`Bin Details · ${bin.label || 'Bin'}`, `
    <form id="bin-form" class="bin-details">
      <div class="field">
        <label>Product</label>
        <select name="product_id">
          <option value="">Unassigned</option>
          ${productOptions}
        </select>
      </div>
      <div class="split">
        <div class="field">
          <label>Qty</label>
          <input type="number" name="qty" min="0" step="1" value="${Number(bin.qty ?? 0)}" />
        </div>
        <div class="field">
          <label>Reorder point</label>
          <input type="number" name="reorder_point" min="0" step="1" value="${bin.reorder_point ?? ''}" />
        </div>
      </div>
      <div class="row">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn ghost" type="button" id="bin-cancel">Cancel</button>
      </div>
    </form>
  `);

  document.getElementById('bin-cancel').addEventListener('click', closeModal);
  document.getElementById('bin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const productId = formData.get('product_id');
    const qty = Number(formData.get('qty') || 0);
    const reorderRaw = formData.get('reorder_point');
    const reorderPoint = reorderRaw === '' ? null : Number(reorderRaw);
    const payload = {
      product_id: productId || null,
      qty: Number.isNaN(qty) ? 0 : qty,
      reorder_point: Number.isNaN(reorderPoint) ? null : reorderPoint,
      updated_at: new Date().toISOString(),
    };
    const previous = { ...bin };
    Object.assign(bin, payload);
    renderBins();
    closeModal();

    const { error } = await supabase
      .from('bins')
      .update(payload)
      .eq('id', bin.id);
    if (error) {
      Object.assign(bin, previous);
      renderBins();
      showToast(`Save failed: ${error.message}`);
      return;
    }
    showToast('Bin updated.');
  });
}

let draggedId = null;
let dragSnapshot = [];

function handleDragStart(event) {
  draggedId = event.currentTarget.dataset.binId;
  dragSnapshot = state.bins.slice();
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging');
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

async function handleDrop(event) {
  event.preventDefault();
  const targetId = event.currentTarget.dataset.binId;
  if (!draggedId || draggedId === targetId) return;

  const ids = state.bins.map((bin) => bin.id);
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) return;

  const reordered = state.bins.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  state.bins = reordered.map((bin, index) => ({
    ...bin,
    sort_order: index + 1,
  }));
  renderBins();

  const updates = state.bins.map((bin) => ({
    id: bin.id,
    sort_order: bin.sort_order,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('bins')
    .upsert(updates, { onConflict: 'id' });

  if (error) {
    state.bins = dragSnapshot;
    renderBins();
    showToast(`Reorder failed: ${error.message}`);
    return;
  }
  showToast('Bin order saved.');
}

let draggedAisleId = null;
let aisleDragSnapshot = [];

function handleAisleDragStart(event) {
  draggedAisleId = event.currentTarget.dataset.aisleId;
  aisleDragSnapshot = state.aisles.slice();
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging');
}

function handleAisleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
}

function handleAisleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

async function handleAisleDrop(event) {
  event.preventDefault();
  const targetId = event.currentTarget.dataset.aisleId;
  if (!draggedAisleId || draggedAisleId === targetId) return;

  const ids = state.aisles.map((aisle) => aisle.id);
  const fromIndex = ids.indexOf(draggedAisleId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) return;

  const reordered = state.aisles.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  state.aisles = reordered.map((aisle, index) => ({
    ...aisle,
    sort_order: index + 1,
  }));
  renderAisles();

  const updates = state.aisles.map((aisle) => ({
    id: aisle.id,
    sort_order: aisle.sort_order,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('aisles')
    .upsert(updates, { onConflict: 'id' });

  if (error) {
    state.aisles = aisleDragSnapshot;
    renderAisles();
    showToast(`Reorder failed: ${error.message}`);
    return;
  }
  showToast('Shelf system order saved.');
}


function bindEvents() {
  elements.addAisle.addEventListener('click', handleAddAisle);
  elements.addShelf.addEventListener('click', handleAddShelf);
  elements.addBin.addEventListener('click', handleAddBin);
  elements.sideButtons.forEach((btn) => btn.addEventListener('click', handleSideToggle));
  elements.modalClose.addEventListener('click', closeModal);
  elements.modalWrap.addEventListener('click', (event) => {
    if (event.target === elements.modalWrap) closeModal();
  });
}
function missingElements() {
  const required = [
    ['aisleList', elements.aisleList],
    ['shelfList', elements.shelfList],
    ['binList', elements.binList],
    ['aisleTitle', elements.aisleTitle],
    ['aisleSubtitle', elements.aisleSubtitle],
    ['shelfTitle', elements.shelfTitle],
    ['shelfSubtitle', elements.shelfSubtitle],
    ['addAisle', elements.addAisle],
    ['addShelf', elements.addShelf],
    ['addBin', elements.addBin],
    ['modalWrap', elements.modalWrap],
    ['modalTitle', elements.modalTitle],
    ['modalBody', elements.modalBody],
    ['modalClose', elements.modalClose],
    ['toast', elements.toast],
    ['navOffice', elements.navOffice],
    ['navHome', elements.navHome],
    ['navMap', elements.navMap],
  ];

  return required.filter(([, element]) => !element).map(([name]) => name);
}

async function init() {
    cacheElements();
  const missing = missingElements();
  if (missing.length) {
    console.error(`Inventory app init failed. Missing elements: ${missing.join(', ')}`);
    return;
  }
  setNavHandlers();
  bindEvents();
  await loadProducts();
  await loadAisles();
  await loadShelves();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}