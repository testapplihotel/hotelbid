// HotelBid Dashboard

const API = '/api';
let priceChart = null;

// ---- Alerts ----

async function loadAlerts() {
  const container = document.getElementById('alerts-list');
  container.innerHTML = '<div class="loading"><span class="spinner"></span>Loading alerts...</div>';

  try {
    const res = await fetch(`${API}/alerts`);
    const alerts = await res.json();

    if (alerts.length === 0) {
      container.innerHTML = '<div class="empty-state">No alerts yet. Create one above!</div>';
      return;
    }

    container.innerHTML = alerts.map(a => `
      <div class="alert-card">
        <div class="alert-info">
          <h3>${esc(a.hotel_name)}</h3>
          <p>${a.check_in} → ${a.check_out} · ${a.adults} adults${a.children ? `, ${a.children} children` : ''}</p>
        </div>
        <div class="alert-meta">
          <span class="price-tag">Target: ${formatPrice(a.target_price)}</span>
          <span class="status-badge status-${a.status}">${statusLabel(a.status)}</span>
          <button class="btn btn-secondary btn-sm" onclick="showPriceHistory(${a.id}, '${esc(a.hotel_name)}')">Prices</button>
          <button class="btn btn-secondary btn-sm" onclick="triggerScan(${a.id})">Scan Now</button>
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

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Creating...';

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
    form.querySelector('#user_email').value = 'test@hotelbid.com';
    await loadAlerts();
  } catch (err) {
    alert('Error creating alert: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Alert';
  }
}

async function deleteAlert(id) {
  if (!confirm('Delete this alert and all its price history?')) return;
  await fetch(`${API}/alerts/${id}`, { method: 'DELETE' });
  loadAlerts();
}

async function triggerScan(alertId) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  try {
    const res = await fetch(`${API}/scan/${alertId}`, { method: 'POST' });
    const data = await res.json();
    if (data.best_price) {
      alert(`Best price found: ${formatPrice(data.best_price.prix_total)} on ${data.best_price.source}`);
    } else {
      alert(`Scan complete. ${data.prices_found} price(s) found, none matching target with free cancellation.`);
    }
    loadAlerts();
  } catch (err) {
    alert('Scan error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Now';
  }
}

// ---- Price History Chart ----

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

    // Group prices by source
    const sources = {};
    prices.forEach(p => {
      if (!sources[p.source]) sources[p.source] = [];
      sources[p.source].push({ x: new Date(p.scraped_at), y: p.price });
    });

    const colors = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    const datasets = Object.entries(sources).map(([source, data], i) => ({
      label: source,
      data: data.sort((a, b) => a.x - b.x),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '20',
      fill: false,
      tension: 0.3,
      pointRadius: 4,
    }));

    const ctx = document.getElementById('price-chart').getContext('2d');
    if (priceChart) priceChart.destroy();

    priceChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'hour', displayFormats: { hour: 'MMM d, HH:mm' } },
            title: { display: true, text: 'Time' },
          },
          y: {
            title: { display: true, text: 'Price (NIS)' },
            beginAtZero: false,
          },
        },
        plugins: {
          legend: { position: 'bottom' },
        },
      },
    });
  } catch (err) {
    title.textContent = 'Error loading price data';
  }
}

function closeChart() {
  document.getElementById('chart-modal').style.display = 'none';
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
  }
}

// ---- Bookings ----

async function loadBookings() {
  const container = document.getElementById('bookings-list');

  try {
    const res = await fetch(`${API}/bookings`);
    const bookings = await res.json();

    if (bookings.length === 0) {
      container.innerHTML = '<div class="empty-state">No bookings yet. Set up an alert and let us find your price!</div>';
      return;
    }

    container.innerHTML = bookings.map(b => `
      <div class="booking-card">
        <h3>${esc(b.hotel_name)} — Booked!</h3>
        <p>
          <strong>${formatPrice(b.price)}</strong> via ${esc(b.source)}<br>
          ${b.check_in} → ${b.check_out} · ${b.adults} adults${b.children ? `, ${b.children} children` : ''}<br>
          Target was: ${formatPrice(b.target_price)} · Saved: ${formatPrice(b.target_price - b.price)}<br>
          <a href="${esc(b.url)}" target="_blank">View Reservation →</a>
        </p>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error loading bookings</div>`;
  }
}

// ---- Helpers ----

function formatPrice(n) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n);
}

function statusLabel(s) {
  const labels = {
    watching: 'Watching',
    price_found: 'Price Found',
    booked: 'Booked',
  };
  return labels[s] || s;
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

// ---- Init ----
document.getElementById('alert-form').addEventListener('submit', createAlert);
loadAlerts();
loadBookings();
