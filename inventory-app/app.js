const STORAGE_KEY = 'shelfMapData';
const HIGHLIGHT_DURATION_MS = 4000;

const state = {
  aisles: [],
  shelves: [],
  bins: [],
 view: 'aisles',
  selectedAisleId: null,
  selectedSide: null,
  selectedShelfId: null,
 levelFilter: 'all',
  highlight: {
    aisleId: null,
    shelfId: null,
    binId: null,
    timeoutId: null,
  },
};

let elements = {};

function cacheElements() {
  elements = {
    aisleList: document.getElementById('aisle-list'),
    shelfList: document.getElementById('shelf-list'),
    aisleTitle: document.getElementById('aisle-title'),
    aisleSubtitle: document.getElementById('aisle-subtitle'),
    addAisle: document.getElementById('add-aisle'),
    addShelf: document.getElementById('add-shelf'),
    addBin: document.getElementById('add-bin'),
    levelFilter: document.getElementById('level-filter'),
    findInput: document.getElementById('find-input'),
    findButton: document.getElementById('find-btn'),
    backAisles: document.getElementById('back-aisles'),
    backShelves: document.getElementById('back-shelves'),
    modalWrap: document.getElementById('modalWrap'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),
    toast: document.getElementById('toast'),
    navOffice: document.getElementById('nav_office'),
    navHome: document.getElementById('nav_home'),
    navMap: document.getElementById('nav_map'),
    views: document.querySelectorAll('.view'),
  };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { aisles: [], shelves: [], bins: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      aisles: Array.isArray(parsed.aisles) ? parsed.aisles : [],
      shelves: Array.isArray(parsed.shelves) ? parsed.shelves : [],
      bins: Array.isArray(parsed.bins) ? parsed.bins : [],
    };
  } catch (error) {
    console.warn('Invalid shelf mapping data, resetting.', error);
    return { aisles: [], shelves: [], bins: [] };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    aisles: state.aisles,
    shelves: state.shelves,
    bins: state.bins,
  }));
}

function ensureAisleSides() {
  state.aisles = state.aisles.map((aisle) => {
    const sides = aisle.sides || { A: { shelfIds: [] }, B: { shelfIds: [] } };
    return {
      ...aisle,
      sides: {
        A: { shelfIds: Array.isArray(sides.A?.shelfIds) ? sides.A.shelfIds : [] },
        B: { shelfIds: Array.isArray(sides.B?.shelfIds) ? sides.B.shelfIds : [] },
      },
    };
  });
}

function syncAisleSides(aisleId) {
  const aisle = state.aisles.find((item) => item.id === aisleId);
  if (!aisle) return;
  const shelves = state.shelves.filter((shelf) => shelf.aisleId === aisleId);
  aisle.sides = {
    A: { shelfIds: shelves.filter((shelf) => shelf.side === 'A').map((shelf) => shelf.id) },
    B: { shelfIds: shelves.filter((shelf) => shelf.side === 'B').map((shelf) => shelf.id) },
  };
}

function generateId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
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

function updateView(viewName) {
  state.view = viewName;
  elements.views.forEach((view) => {
    view.classList.toggle('active', view.dataset.view === viewName);
  });
}

function clearHighlight() {
  if (state.highlight.timeoutId) {
    clearTimeout(state.highlight.timeoutId);
  }
  state.highlight = {
    aisleId: null,
    shelfId: null,
    binId: null,
    timeoutId: null,
  };
}

function startHighlight({ aisleId, shelfId, binId }) {
  clearHighlight();
  state.highlight.aisleId = aisleId || null;
  state.highlight.shelfId = shelfId || null;
  state.highlight.binId = binId || null;
  state.highlight.timeoutId = setTimeout(() => {
    clearHighlight();
    renderAll();
  }, HIGHLIGHT_DURATION_MS);
}

function handleGlobalClick(event) {
  if (!state.highlight.aisleId && !state.highlight.shelfId && !state.highlight.binId) return;
  if (event.target.closest('.is-highlighted')) return;
  clearHighlight();
  renderAll();
}

function uniqueLevels() {
  const levels = new Set(state.shelves.map((shelf) => Number(shelf.level)).filter((level) => !Number.isNaN(level)));
  return Array.from(levels).sort((a, b) => a - b);
}

function renderLevelFilter() {
  const levels = uniqueLevels();
  if (state.levelFilter !== 'all' && !levels.includes(Number(state.levelFilter))) {
    state.levelFilter = 'all';
  }
  elements.levelFilter.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = levels.length ? 'All levels' : 'All levels';
  elements.levelFilter.appendChild(allOption);
  levels.forEach((level) => {
    const option = document.createElement('option');
    option.value = String(level);
    option.textContent = `Level ${level}`;
    elements.levelFilter.appendChild(option);
  });
  elements.levelFilter.value = state.levelFilter;
}

function aisleShelves(aisleId) {
  let shelves = state.shelves.filter((shelf) => shelf.aisleId === aisleId);
  if (state.levelFilter !== 'all') {
    const level = Number(state.levelFilter);
    shelves = shelves.filter((shelf) => Number(shelf.level) === level);
  }
    return shelves;
}

function renderAisles() {
  elements.aisleList.innerHTML = '';
   if (!state.aisles.length) {
    elements.aisleList.innerHTML = '<div class="empty-state">No aisles yet. Add the first aisle to begin.</div>';
    return;  
  }

  state.aisles.forEach((aisle) => {
     const shelves = aisleShelves(aisle.id);
    const sideAShelves = shelves.filter((shelf) => shelf.side === 'A');
    const sideBShelves = shelves.filter((shelf) => shelf.side === 'B');
    const sideACount = sideAShelves.length;
    const sideBCount = sideBShelves.length;
    const sideABins = state.bins.filter((bin) => sideAShelves.some((shelf) => shelf.id === bin.shelfId)).length;
    const sideBBins = state.bins.filter((bin) => sideBShelves.some((shelf) => shelf.id === bin.shelfId)).length;
    const row = document.createElement('div');
    const isHighlighted = aisle.id === state.highlight.aisleId;
    row.className = `aisle-row${isHighlighted ? ' is-highlighted' : ''}`;
    row.dataset.aisleId = aisle.id;
    const orientationText = aisle.orientation ? `<div class="chip soft">${aisle.orientation}</div>` : '';
    row.innerHTML = `
      <div class="aisle-side${isHighlighted && state.selectedSide === 'A' ? ' is-highlighted' : ''}" data-side="A">
        <div class="row space">
          <div class="stack">
            <div class="chip soft">Side A</div>
            <div class="muted">${sideACount} shelves · ${sideABins} bins</div>
          </div>
          <button class="btn ghost small" type="button" data-action="select-side" data-side="A">Select Side</button>
        </div>
      </div>
      <div class="aisle-card aisle-center">
        <div class="row space" style="width:100%">
          <input class="aisle-name" value="${aisle.name || ''}" aria-label="Aisle name"/>
          <button class="btn ghost small danger icon-btn" type="button" data-action="delete-aisle" title="Delete aisle">🗑</button>
        </div>
        <div class="field compact" style="width:100%">
          <label>Orientation</label>
          <select class="orientation-select">
            <option value="">—</option>
            <option value="NS"${aisle.orientation === 'NS' ? ' selected' : ''}>NS</option>
            <option value="EW"${aisle.orientation === 'EW' ? ' selected' : ''}>EW</option>
          </select>
        </div>
        ${orientationText}
        <div class="aisle-divider"></div>
        <div class="row" style="justify-content:center; width:100%">
          <button class="btn ghost small" type="button" data-action="select-side" data-side="A">Side A</button>
          <button class="btn ghost small" type="button" data-action="select-side" data-side="B">Side B</button>
        </div>
      </div>
      <div class="aisle-side${isHighlighted && state.selectedSide === 'B' ? ' is-highlighted' : ''}" data-side="B">
        <div class="row space">
          <div class="stack">
            <div class="chip soft">Side B</div>
            <div class="muted">${sideBCount} shelves · ${sideBBins} bins</div>
          </div>
          <button class="btn ghost small" type="button" data-action="select-side" data-side="B">Select Side</button>
        </div>
      </div>
    `;
  
    const nameInput = row.querySelector('.aisle-name');
    nameInput.addEventListener('change', (event) => {
      aisle.name = event.target.value.trim() || 'Aisle';
      saveData();
      renderAisles();
    });
 nameInput.addEventListener('click', (event) => event.stopPropagation());
 
    row.querySelector('[data-action="delete-aisle"]').addEventListener('click', (event) => {
      event.stopPropagation();
      handleDeleteAisle(aisle.id);
    });

    row.querySelector('.orientation-select').addEventListener('change', (event) => {
      aisle.orientation = event.target.value || null;
      saveData();
      renderAisles();
    });

    row.querySelectorAll('[data-action="select-side"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const side = event.currentTarget.dataset.side;
        selectAisleSide(aisle.id, side);
      });
    });

    elements.aisleList.appendChild(row);
  });
}

function renderShelves() {
  elements.shelfList.innerHTML = '';
  const aisle = state.aisles.find((item) => item.id === state.selectedAisleId);
  if (!aisle || !state.selectedSide) {
    elements.aisleTitle.textContent = 'Select an aisle side';
    elements.aisleSubtitle.textContent = 'Pick an aisle and side to see shelf levels.';
    elements.shelfList.innerHTML = '<div class="empty-state">Select an aisle side to load shelves.</div>';
    return;
  }

  elements.aisleTitle.textContent = `${aisle.name || 'Aisle'} · Side ${state.selectedSide}`;
  elements.aisleSubtitle.textContent = 'Shelves ordered by level with bins displayed for each shelf.';

 let shelves = state.shelves.filter((shelf) => shelf.aisleId === aisle.id && shelf.side === state.selectedSide);
  if (state.levelFilter !== 'all') {
    const level = Number(state.levelFilter);
    shelves = shelves.filter((shelf) => Number(shelf.level) === level);
  }

  shelves = shelves.sort((a, b) => {
    const levelDiff = Number(a.level) - Number(b.level);
    if (levelDiff !== 0) return levelDiff;
    return (a.name || '').localeCompare(b.name || '');
  });

  if (!shelves.length) {
    elements.shelfList.innerHTML = '<div class="empty-state">No shelves yet. Add one to get started.</div>';
    return;
  }

  shelves.forEach((shelf) => {
    const bins = state.bins
      .filter((bin) => bin.shelfId === shelf.id)
      .sort((a, b) => Number(a.position) - Number(b.position));
    const item = document.createElement('div');
    const isHighlighted = shelf.id === state.highlight.shelfId;
    const isSelected = shelf.id === state.selectedShelfId;
    item.className = `shelf-section${isHighlighted ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}`;
    item.innerHTML = `
      <div class="shelf-header">
        <div class="stack">
          <input class="shelf-name" value="${shelf.name || ''}" aria-label="Shelf name"/>
          <div class="muted">Level ${shelf.level}</div>
        </div>
        <div class="shelf-actions">
          <button class="btn ghost small" type="button" data-action="focus-shelf">Focus</button>
          <button class="btn ghost small" type="button" data-action="add-bin">Add Bin</button>
          <button class="btn ghost small danger icon-btn" type="button" data-action="delete-shelf" title="Delete shelf">🗑</button>
        </div>
      </div>
      <div class="bins shelf-bins" data-shelf-bins></div>
    `;

    item.querySelector('.shelf-name').addEventListener('change', (event) => {
      shelf.name = event.target.value.trim() || `Shelf ${shelf.level}`;
      saveData();
      renderShelves();
    });
    item.querySelector('.shelf-name').addEventListener('click', (event) => event.stopPropagation());

    item.querySelector('[data-action="delete-shelf"]').addEventListener('click', (event) => {
      event.stopPropagation();
      handleDeleteShelf(shelf.id);
    });

    item.querySelector('[data-action="focus-shelf"]').addEventListener('click', (event) => {
      event.stopPropagation();
      selectShelf(shelf.id);
      renderShelves();
    });

    item.querySelector('[data-action="add-bin"]').addEventListener('click', (event) => {
      event.stopPropagation();
      selectShelf(shelf.id);
      handleAddBin(shelf.id);
    });

    const binWrap = item.querySelector('[data-shelf-bins]');
    if (!bins.length) {
      binWrap.innerHTML = '<div class="empty-state">No bins yet for this shelf.</div>';
    } else {
      bins.forEach((bin) => {
        const binTile = document.createElement('div');
        const isHighlightedBin = bin.id === state.highlight.binId;
        const outOfStock = Boolean(bin.out_of_stock) || Number(bin.qty ?? 0) === 0;
        binTile.className = `bin${outOfStock ? ' oos' : ''}${isHighlightedBin ? ' is-highlighted' : ''}`;
        binTile.innerHTML = `
          <div class="binhead">
            <div class="binlabel">Bin ${bin.position}</div>
            <button class="btn ghost small danger icon-btn" type="button" data-action="delete-bin" title="Delete bin">🗑</button>
          </div>
          <div class="binmeta">
            <div class="chip soft">${bin.sku || 'No SKU'}</div>
            <div class="chip soft">${bin.part_name || 'Empty'}</div>
          </div>
          <div class="row space">
            <div class="muted">Qty</div>
            <div class="chip ${outOfStock ? 'bad' : 'good'}">${Number(bin.qty ?? 0)}</div>
          </div>
        `;

        binTile.querySelector('[data-action="delete-bin"]').addEventListener('click', (event) => {
          event.stopPropagation();
          handleDeleteBin(bin.id);
        });

        binTile.addEventListener('click', () => openBinDetails(bin.id));
        binWrap.appendChild(binTile);
      });
    }

    item.addEventListener('click', () => {
      selectShelf(shelf.id);
      renderShelves();
    });
    elements.shelfList.appendChild(item);
  });

}

function renderAll() {
  renderLevelFilter();
  renderAisles();
  renderShelves();
}

function selectShelf(shelfId) {
  state.selectedShelfId = shelfId;
}

function selectAisleSide(aisleId, side) {
  state.selectedAisleId = aisleId;
  state.selectedSide = side;
  state.selectedShelfId = null;
  updateView('shelves');
  renderShelves();
}

function handleAddAisle() {
  openModal('Add Aisle', `
    <form id="aisle-form" class="stack">
      <div class="field">
         <label for="aisle-name">Aisle name</label>
        <input id="aisle-name" name="name" required placeholder="Aisle 1" />
      </div>
      <div class="field">
        <label for="aisle-orientation">Orientation</label>
       <select id="aisle-orientation" name="orientation">
          <option value="">—</option>
          <option value="NS">NS</option>
          <option value="EW">EW</option>
        </select>
      </div>
      <div class="row">
        <button class="btn primary" type="submit">Create Aisle</button>
        <button class="btn ghost" type="button" id="aisle-cancel">Cancel</button>
      </div>
    </form>
  `);


  document.getElementById('aisle-cancel').addEventListener('click', closeModal);
  document.getElementById('aisle-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = String(formData.get('name') || '').trim();
   const orientation = String(formData.get('orientation') || '').trim() || null;
     if (!name) return;
    const payload = {
        id: generateId('aisle'),
      name,
      orientation,
     sides: { A: { shelfIds: [] }, B: { shelfIds: [] } },
    };
     state.aisles.push(payload);
    saveData();
    closeModal();
    renderAisles();
  });
}

function handleAddShelf() {
  if (!state.selectedAisleId || !state.selectedSide) {
    showToast('Select an aisle side first.');
    return;
  }
 
   openModal('Add Shelf', `
    <form id="shelf-form" class="stack">
      <div class="field">
        <label for="shelf-name">Shelf name</label>
        <input id="shelf-name" name="name" required placeholder="Shelf A1" />
      </div>
      <div class="field">
        <label for="shelf-level">Level number</label>
        <input id="shelf-level" name="level" type="number" min="1" step="1" required placeholder="1" />
      </div>
      <div class="row">
        <button class="btn primary" type="submit">Create Shelf</button>
        <button class="btn ghost" type="button" id="shelf-cancel">Cancel</button>
      </div>
    </form>
  `);

  document.getElementById('shelf-cancel').addEventListener('click', closeModal);
  document.getElementById('shelf-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = String(formData.get('name') || '').trim();
    const level = Number(formData.get('level') || 0);
    if (!name || Number.isNaN(level) || level <= 0) return;
    const payload = {
      id: generateId('shelf'),
      aisleId: state.selectedAisleId,
      side: state.selectedSide,
      level,
      name,
    };
    state.shelves.push(payload);
    syncAisleSides(state.selectedAisleId);
    saveData();
    closeModal();
    renderLevelFilter();
    renderShelves();
  });
}

function handleAddBin(shelfId = null) {
  const targetShelfId = shelfId || state.selectedShelfId;
  const shelf = state.shelves.find((item) => item.id === targetShelfId);
  if (!shelf) {
    showToast('Select a shelf first.');
    return;
  }
 const bins = state.bins.filter((bin) => bin.shelfId === shelf.id);
  const position = (Math.max(0, ...bins.map((bin) => Number(bin.position))) || 0) + 1;
  const payload = {
    id: generateId('bin'),
    shelfId: shelf.id,
    position,
    sku: '',
    part_name: '',
    qty: 0,
    out_of_stock: true,
  };
 state.bins.push(payload);
  saveData();
  renderShelves();
  openBinDetails(payload.id, true);
}

function openBinDetails(binId, isNew = false) {
  const bin = state.bins.find((item) => item.id === binId);
  if (!bin) return;
  const shelf = state.shelves.find((item) => item.id === bin.shelfId);
  const aisle = shelf ? state.aisles.find((item) => item.id === shelf.aisleId) : null;
  const titleParts = [];
  if (shelf?.level) {
    titleParts.push(`Level ${shelf.level}`);
  }
  const systemName = aisle?.system || aisle?.name || 'Aisle';
  if (systemName) {
    const sideSuffix = shelf?.side ? `${shelf.side}` : '';
    titleParts.push(`Shelf System ${systemName}${sideSuffix}`);
  }
  if (shelf?.name) {
    titleParts.push(`Shelf ${shelf.name}`);
  } else if (shelf) {
    titleParts.push('Shelf');
  }
  titleParts.push(`Bin ${bin.position}`);
  openModal(titleParts.join(' • '), `
    <form id="bin-form" class="stack">
      <div class="field">
       <label for="bin-sku">SKU</label>
        <input id="bin-sku" name="sku" value="${bin.sku || ''}" placeholder="SKU-001" />
      </div>
      <div class="field">
        <label for="bin-part">Part name</label>
        <input id="bin-part" name="part_name" value="${bin.part_name || ''}" placeholder="Part description" />
      </div>
      <div class="field">
        <label for="bin-qty">Qty</label>
        <input id="bin-qty" name="qty" type="number" min="0" step="1" value="${Number(bin.qty ?? 0)}" />
        </div>
      <div class="row">
        <label class="chip soft">
          <input id="bin-oos" name="out_of_stock" type="checkbox" ${bin.out_of_stock ? 'checked' : ''} />
          Out of stock
        </label>
      </div>
      <div class="row">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn ghost" type="button" id="bin-cancel">Cancel</button>
         <button class="btn ghost" type="button" id="bin-clear">Clear Product</button>
      </div>
    </form>
  `);

  document.getElementById('bin-cancel').addEventListener('click', closeModal);
   document.getElementById('bin-clear').addEventListener('click', () => {
    bin.sku = '';
    bin.part_name = '';
    bin.qty = 0;
    bin.out_of_stock = true;
    saveData();
    renderShelves();
    closeModal();
  });
  document.getElementById('bin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    bin.sku = String(formData.get('sku') || '').trim();
    bin.part_name = String(formData.get('part_name') || '').trim();
    const qty = Number(formData.get('qty') || 0);
   bin.qty = Number.isNaN(qty) ? 0 : qty;
    bin.out_of_stock = formData.get('out_of_stock') === 'on';
    saveData();
    renderShelves();
    closeModal();
});
}

function handleDeleteAisle(aisleId) {
  const aisle = state.aisles.find((item) => item.id === aisleId);
  if (!aisle) return;
  const confirmed = window.confirm(`Delete ${aisle.name || 'this aisle'} and all shelves/bins inside?`);
  if (!confirmed) return;
  const shelvesToRemove = state.shelves.filter((shelf) => shelf.aisleId === aisleId).map((shelf) => shelf.id);
  state.bins = state.bins.filter((bin) => !shelvesToRemove.includes(bin.shelfId));
  state.shelves = state.shelves.filter((shelf) => shelf.aisleId !== aisleId);
  state.aisles = state.aisles.filter((item) => item.id !== aisleId);
  if (state.selectedAisleId === aisleId) {
    state.selectedAisleId = null;
    state.selectedSide = null;
    state.selectedShelfId = null;
    updateView('aisles');
  }
  saveData();
  renderAll();
}

function handleDeleteShelf(shelfId) {
  const shelf = state.shelves.find((item) => item.id === shelfId);
  if (!shelf) return;
  const confirmed = window.confirm(`Delete ${shelf.name || 'this shelf'} and all bins inside?`);
  if (!confirmed) return;
  state.bins = state.bins.filter((bin) => bin.shelfId !== shelfId);
  state.shelves = state.shelves.filter((item) => item.id !== shelfId);
  syncAisleSides(shelf.aisleId);
  if (state.selectedShelfId === shelfId) {
    state.selectedShelfId = null;
    updateView('shelves');
  }
  saveData();
  renderAll();
}

function handleDeleteBin(binId) {
  const bin = state.bins.find((item) => item.id === binId);
  if (!bin) return;
  const confirmed = window.confirm(`Delete Bin ${bin.position}?`);
  if (!confirmed) return;
  state.bins = state.bins.filter((item) => item.id !== binId);
  saveData();
  renderShelves();
}

  function handleFind() {
  const query = String(elements.findInput.value || '').trim().toLowerCase();
  if (!query) {
    showToast('Enter a SKU or part name to search.');
    return;
  }
   const match = state.bins.find((bin) => {
    const sku = String(bin.sku || '').toLowerCase();
    const part = String(bin.part_name || '').toLowerCase();
    return sku.includes(query) || part.includes(query);
  });

  if (!match) {
    showToast('No matching bins found.');
    return;
  }

 const shelf = state.shelves.find((item) => item.id === match.shelfId);
  const aisle = shelf ? state.aisles.find((item) => item.id === shelf.aisleId) : null;
  if (!shelf || !aisle) {
    showToast('Match found, but its aisle details are missing.');
    return;
  }
  state.selectedAisleId = aisle.id;
  state.selectedSide = shelf.side;
  state.selectedShelfId = shelf.id;
  startHighlight({ aisleId: aisle.id, shelfId: shelf.id, binId: match.id });
  updateView('aisles');
  renderAll();
  setTimeout(() => {
    updateView('shelves');
    renderAll();
  }, 400);
}

function bindEvents() {
  elements.addAisle.addEventListener('click', handleAddAisle);
  elements.addShelf.addEventListener('click', handleAddShelf);
  elements.addBin.addEventListener('click', handleAddBin);
  elements.levelFilter.addEventListener('change', (event) => {
    state.levelFilter = event.target.value;
    renderAll();
  });
  elements.findButton.addEventListener('click', handleFind);
  elements.findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleFind();
    }
  });
  elements.backAisles.addEventListener('click', () => {
    window.history.back();
  });
  elements.backShelves.addEventListener('click', () => {
    updateView('aisles');
  });
  elements.modalClose.addEventListener('click', closeModal);
  elements.modalWrap.addEventListener('click', (event) => {
    if (event.target === elements.modalWrap) closeModal();
  });
   document.addEventListener('click', handleGlobalClick);
}

function missingElements() {
  const required = [
    ['aisleList', elements.aisleList],
    ['shelfList', elements.shelfList],
    ['aisleTitle', elements.aisleTitle],
    ['aisleSubtitle', elements.aisleSubtitle],
    ['addAisle', elements.addAisle],
    ['addShelf', elements.addShelf],
    ['addBin', elements.addBin],
     ['levelFilter', elements.levelFilter],
    ['findInput', elements.findInput],
    ['findButton', elements.findButton],
    ['backAisles', elements.backAisles],
    ['backShelves', elements.backShelves],
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

function init() {
  cacheElements();
  const missing = missingElements();
  if (missing.length) {
    console.error(`Inventory app init failed. Missing elements: ${missing.join(', ')}`);
    return;
  }
  setNavHandlers();
  bindEvents();
  const loaded = loadData();
  state.aisles = loaded.aisles;
  state.shelves = loaded.shelves;
  state.bins = loaded.bins;
  ensureAisleSides();
  renderAll();
  updateView('aisles');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
