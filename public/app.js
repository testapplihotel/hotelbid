// HotelBid Dashboard

const API = '/api';
let priceChart = null;

// ===== HOTEL AUTOCOMPLETE =====

const hotelInput = document.getElementById('hotel_name');
const dropdown = document.getElementById('hotel-dropdown');
const destInput = document.getElementById('destination');
let acTimeout = null;
let acIndex = -1;

hotelInput.addEventListener('input', () => {
  clearTimeout(acTimeout);
  const q = hotelInput.value.trim();
  if (q.length < 2) { closeDropdown(); return; }
  acTimeout = setTimeout(() => fetchHotels(q), 200);
});

hotelInput.addEventListener('keydown', (e) => {
  const items = dropdown.querySelectorAll('.autocomplete-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acIndex = Math.min(acIndex + 1, items.length - 1);
    highlightItem(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acIndex = Math.max(acIndex - 1, 0);
    highlightItem(items);
  } else if (e.key === 'Enter' && acIndex >= 0) {
    e.preventDefault();
    items[acIndex].click();
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.autocomplete-wrap')) closeDropdown();
});

async function fetchHotels(q) {
  try {
    const res = await fetch(`${API}/hotels?q=${encodeURIComponent(q)}`);
    const hotels = await res.json();
    if (hotels.length === 0) { closeDropdown(); return; }

    dropdown.innerHTML = hotels.map((h, i) => `
      <div class="autocomplete-item" data-name="${esc(h.name)}" data-dest="${esc(h.destination)}">
        <div>
          <div class="autocomplete-item-name">${esc(h.name)}</div>
          <div class="autocomplete-item-he">${esc(h.nameHe)}</div>
        </div>
        <div class="autocomplete-item-meta">
          <div class="autocomplete-item-dest">${esc(h.destination)}</div>
          <div class="autocomplete-item-stars">${'&#9733;'.repeat(h.stars)}</div>
        </div>
      </div>
    `).join('');

    dropdown.classList.add('open');
    acIndex = -1;

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        hotelInput.value = item.dataset.name;
        destInput.value = item.dataset.dest;
        closeDropdown();
      });
    });
  } catch (err) {
    closeDropdown();
  }
}

function highlightItem(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === acIndex));
  if (items[acIndex]) items[acIndex].scrollIntoView({ block: 'nearest' });
}

function closeDropdown() {
  dropdown.classList.remove('open');
  dropdown.innerHTML = '';
  acIndex = -1;
}

// ===== ALERTS =====

async function loadAlerts() {
  const container = document.getElementById('alerts-list');
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading alerts...</div>';

  try {
    const res = await fetch(`${API}/alerts`);
    const alerts = await res.json();

    if (alerts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">&#9830;</span>
          No alerts yet. Create one above to start watching prices!
        </div>`;
      return;
    }

    container.innerHTML = alerts.map(a => `
      <div class="alert-card">
        <div class="alert-info">
          <h3>${esc(a.hotel_name)}</h3>
          <p>${formatDate(a.check_in)} &rarr; ${formatDate(a.check_out)} &middot; ${a.adults} adults${a.children ? `, ${a.children} children` : ''}</p>
        </div>
        <div class="alert-meta">
          <span class="price-tag">Target: ${formatPrice(a.target_price)}</span>
          <span class="status-badge status-${a.status}">${statusLabel(a.status)}</span>
          <button class="btn btn-outline btn-sm" onclick="showPriceHistory(${a.id}, '${esc(a.hotel_name)}')">Prices</button>
          <button class="btn btn-navy btn-sm" onclick="triggerScan(${a.id}, this)">Scan Now</button>
          <button class="btn btn-danger btn-sm" onclick="deleteAlert(${a.id})">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error loading alerts: ${err.message}</div>`;
  }
}

async function createAlert(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  data.adults = parseInt(data.adults) || 2;
  data.children = parseInt(data.children) || 0;
  data.target_price = parseFloat(data.target_price);

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating...';

  try {
    const res = await fetch(`${API}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    form.reset();
    form.querySelector('#adults').value = 2;
    form.querySelector('#children').value = 0;
    destInput.value = '';
    await loadAlerts();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">&#9830;</span> Create Alert';
  }
}

async function deleteAlert(id) {
  if (!confirm('Delete this alert and all its price history?')) return;
  await fetch(`${API}/alerts/${id}`, { method: 'DELETE' });
  loadAlerts();
}

async function triggerScan(alertId, btn) {
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  try {
    const res = await fetch(`${API}/scan/${alertId}`, { method: 'POST' });
    const data = await res.json();
    if (data.best_price) {
      showToast(`Best price: ${formatPrice(data.best_price.prix_total)} on ${data.best_price.source}`, 'success');
    } else {
      showToast(`Scan complete. ${data.prices_found} price(s) found.`, 'info');
    }
    loadAlerts();
  } catch (err) {
    showToast('Scan error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Now';
  }
}

// ===== PRICE CHART =====

async function showPriceHistory(alertId, hotelName) {
  const modal = document.getElementById('chart-modal');
  const title = document.getElementById('chart-title');
  title.textContent = `Price History — ${hotelName}`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`${API}/alerts/${alertId}/prices`);
    const prices = await res.json();

    if (prices.length === 0) {
      title.textContent += ' (no data yet)';
      return;
    }

    const sources = {};
    prices.forEach(p => {
      if (!sources[p.source]) sources[p.source] = [];
      sources[p.source].push({ x: new Date(p.scraped_at), y: p.price });
    });

    const colors = ['#d4a843', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    const datasets = Object.entries(sources).map(([source, data], i) => ({
      label: source,
      data: data.sort((a, b) => a.x - b.x),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '20',
      fill: false,
      tension: 0.3,
      pointRadius: 4,
      borderWidth: 2,
    }));

    const ctx = document.getElementById('price-chart').getContext('2d');
    if (priceChart) priceChart.destroy();

    priceChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'hour', displayFormats: { hour: 'MMM d, HH:mm' } },
            title: { display: true, text: 'Time', color: '#8892a8' },
            grid: { color: '#e9ecf2' },
          },
          y: {
            title: { display: true, text: 'Price (NIS)', color: '#8892a8' },
            beginAtZero: false,
            grid: { color: '#e9ecf2' },
          },
        },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } },
        },
      },
    });
  } catch (err) {
    title.textContent = 'Error loading price data';
  }
}

function closeChart() {
  document.getElementById('chart-modal').style.display = 'none';
  if (priceChart) { priceChart.destroy(); priceChart = null; }
}

// ===== BOOKINGS =====

async function loadBookings() {
  const container = document.getElementById('bookings-list');

  try {
    const res = await fetch(`${API}/bookings`);
    const bookings = await res.json();

    if (bookings.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">&#10003;</span>
          No bookings yet. We'll book automatically when a price matches your target!
        </div>`;
      return;
    }

    container.innerHTML = bookings.map(b => `
      <div class="booking-card">
        <h3>${esc(b.hotel_name)} — Booked!</h3>
        <p>
          <strong>${formatPrice(b.price)}</strong> via ${esc(b.source)}<br>
          ${formatDate(b.check_in)} &rarr; ${formatDate(b.check_out)} &middot; ${b.adults} adults${b.children ? `, ${b.children} children` : ''}<br>
          Target was: ${formatPrice(b.target_price)} &middot; Saved: ${formatPrice(b.target_price - b.price)}<br>
          <a href="${esc(b.url)}" target="_blank">View Reservation &rarr;</a>
        </p>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state">Error loading bookings</div>';
  }
}

// ===== TOAST =====

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const colors = { success: '#22c55e', error: '#ef4444', info: '#d4a843' };
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: ${colors[type] || colors.info}; color: white;
    padding: 14px 28px; border-radius: 10px; font-size: 0.9rem; font-weight: 600;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 200;
    animation: toastIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  const style = document.createElement('style');
  style.textContent = '@keyframes toastIn { from { opacity:0; transform: translateX(-50%) translateY(20px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }';
  document.head.appendChild(style);

  setTimeout(() => toast.remove(), 4000);
}

// ===== HELPERS =====

function formatPrice(n) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n);
}

function formatDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function statusLabel(s) {
  return { watching: 'Watching', price_found: 'Price Found', booked: 'Booked' }[s] || s;
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Close modal on backdrop click
document.getElementById('chart-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeChart();
});

// ===== INIT =====
document.getElementById('alert-form').addEventListener('submit', createAlert);
loadAlerts();
loadBookings();
