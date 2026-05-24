'use strict';

const App = (() => {
  // ─── State ────────────────────────────────────────────────
  let state = {
    user: null,
    activeOrderId: null,
    activeSiteId: null,
    gpsLat: null,
    gpsLng: null,
    gpsWatchId: null,
    maps: {},
    vehicleMarkers: {},
    siteMarkers: {},
    routeLine: null,
    driverMapLine: null,
    simInterval: null,
    chartWeek: null,
    chartStatus: null
  };

  // ─── Utils ────────────────────────────────────────────────
  function fmt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU');
  }
  function fmtFull(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function statusLabel(s) {
    return { pending: 'Не начато', in_progress: 'В работе', completed: 'Выполнено', skipped: 'Пропущено' }[s] || s;
  }
  function orderStatusLabel(s) {
    return { pending: 'Не начато', in_progress: 'В работе', completed: 'Выполнено' }[s] || s;
  }
  function violTypeLabel(t) {
    return { missed_site: 'Пропущена площадка', no_photo: 'Отсутствует фото', late: 'Опоздание', complaint: 'Жалоба жителей' }[t] || t;
  }
  function distanceMeter(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── Toast ────────────────────────────────────────────────
  function toast(msg, type = '', dur = 3000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = type ? `show ${type}` : 'show';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, dur);
  }

  // ─── Screen navigation ────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${id}`).classList.add('active');
  }

  function showTab(screen, tab) {
    const prefix = screen === 'driver' ? 'driver' : screen === 'dispatcher' ? 'disp' : 'mgr';
    document.querySelectorAll(`#screen-${screen} .tab-content`).forEach(t => t.classList.remove('active'));
    document.querySelectorAll(`#screen-${screen} .tab-btn`).forEach(b => b.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${tab}`);
    if (tabEl) tabEl.classList.add('active');
    document.querySelectorAll(`#screen-${screen} .tab-btn[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));
  }

  // ─── Login / Logout ───────────────────────────────────────
  function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const user = Data.login(username, password);
    if (!user) { errEl.classList.add('show'); return; }
    errEl.classList.remove('show');
    state.user = user;
    Data.setSession(user);
    initRole(user);
  }

  function logout() {
    stopGPS();
    if (state.simInterval) { clearInterval(state.simInterval); state.simInterval = null; }
    Data.clearSession();
    state.user = null;
    state.activeOrderId = null;
    state.activeSiteId = null;
    state.maps = {};
    state.vehicleMarkers = {};
    state.siteMarkers = {};
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    showScreen('login');
    toast('Вы вышли из системы');
  }

  function initRole(user) {
    if (user.role === 'driver') initDriver(user);
    else if (user.role === 'dispatcher') initDispatcher(user);
    else if (user.role === 'manager') initManager(user);
  }

  // ─── DRIVER ───────────────────────────────────────────────
  function initDriver(user) {
    document.getElementById('driver-header-title').textContent = user.name.split(' ')[0] + ' ' + (user.name.split(' ')[1] || '');
    document.getElementById('driver-avatar').textContent = user.name[0];
    showScreen('driver');
    renderDriverOrders();
    startGPS();

    // auto-select active order
    const orders = Data.getOrdersByDriver(user.id);
    const active = orders.find(o => o.status === 'in_progress');
    if (active) {
      state.activeOrderId = active.id;
      const visits = Data.getVisitsByOrder(active.id);
      const cur = visits.find(v => v.status === 'in_progress') || visits.find(v => v.status === 'pending');
      if (cur) state.activeSiteId = cur.siteId;
      renderDriverActive();
    }
  }

  function renderDriverOrders() {
    const orders = Data.getOrdersByDriver(state.user.id);
    const el = document.getElementById('driver-orders-list');
    if (!orders.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Нет назначенных нарядов</p></div>';
      return;
    }
    el.innerHTML = orders.map(o => {
      const visits = Data.getVisitsByOrder(o.id);
      const done = visits.filter(v => v.status === 'completed').length;
      return `<div class="order-item status-${o.status}" onclick="App.selectDriverOrder('${o.id}')">
        <div class="order-num">Наряд №${o.number} · ${fmtDate(o.date)}</div>
        <div class="order-title">📍 ${o.district} район</div>
        <div class="order-meta">
          <span>🚛 ${(Data.getVehicleById(o.vehicleId) || {}).number || '—'}</span>
          <span>📍 ${done}/${visits.length} площадок</span>
          <span><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'in_progress' ? 'warning' : 'pending'}">${orderStatusLabel(o.status)}</span></span>
        </div>
      </div>`;
    }).join('');
  }

  function selectDriverOrder(orderId) {
    const order = Data.getOrderById(orderId);
    if (!order) return;

    if (order.status === 'pending') {
      Data.updateOrder(orderId, { status: 'in_progress' });
      // create visit records if not exist
      order.sites.forEach(siteId => {
        if (!Data.getVisit(orderId, siteId)) {
          Data.createVisit({ orderId, siteId, vehicleId: order.vehicleId, status: 'pending', arrivedAt: null, completedAt: null, photoBefore: null, photoAfter: null, lat: null, lng: null });
        }
      });
      toast('Наряд начат!', 'success');
    }

    state.activeOrderId = orderId;
    const visits = Data.getVisitsByOrder(orderId);
    const cur = visits.find(v => v.status === 'in_progress') || visits.find(v => v.status === 'pending');
    state.activeSiteId = cur ? cur.siteId : null;

    renderDriverOrders();
    renderDriverActive();
    showTab('driver', 'driver-active');
    initDriverMap();
  }

  function renderDriverActive() {
    const noActive = document.getElementById('driver-no-active');
    const content = document.getElementById('driver-active-content');

    if (!state.activeOrderId) {
      noActive.style.display = '';
      content.style.display = 'none';
      return;
    }

    noActive.style.display = 'none';
    content.style.display = '';

    const order = Data.getOrderById(state.activeOrderId);
    if (!order) return;
    const visits = Data.getVisitsByOrder(state.activeOrderId);

    document.getElementById('active-order-title').textContent = `Наряд №${order.number} · ${order.district}`;
    document.getElementById('active-order-badge').className = `badge badge-${order.status === 'completed' ? 'success' : order.status === 'in_progress' ? 'warning' : 'pending'}`;
    document.getElementById('active-order-badge').textContent = orderStatusLabel(order.status);

    // current site panel
    const curVisit = visits.find(v => v.siteId === state.activeSiteId);
    const curSite = state.activeSiteId ? Data.getSiteById(state.activeSiteId) : null;

    if (curSite) {
      document.getElementById('active-site-name').textContent = curSite.name;
      document.getElementById('active-site-addr').textContent = curSite.address;
    } else {
      document.getElementById('active-site-name').textContent = 'Все площадки обслужены';
      document.getElementById('active-site-addr').textContent = order.district + ' район';
    }

    const arriveBtn = document.getElementById('btn-arrive');
    const completeBtn = document.getElementById('btn-complete-site');
    const skipBtn = document.getElementById('btn-skip-site');

    if (!curVisit || curVisit.status === 'pending') {
      arriveBtn.disabled = false;
      completeBtn.disabled = true;
    } else if (curVisit.status === 'in_progress') {
      arriveBtn.disabled = true;
      completeBtn.disabled = false;
    } else {
      arriveBtn.disabled = true;
      completeBtn.disabled = true;
    }

    // photo slots
    renderPhotoSlots(curVisit);

    // sites list
    const list = document.getElementById('active-sites-list');
    list.innerHTML = order.sites.map((siteId, i) => {
      const site = Data.getSiteById(siteId);
      const visit = visits.find(v => v.siteId === siteId);
      const st = visit ? visit.status : 'pending';
      const numClass = st === 'completed' ? 'done' : st === 'in_progress' ? 'active' : st === 'skipped' ? 'skip' : '';
      const icon = st === 'completed' ? '✓' : st === 'in_progress' ? '▶' : st === 'skipped' ? '✗' : i + 1;
      return `<div class="site-row" onclick="App.selectSite('${siteId}')">
        <div class="site-num ${numClass}">${icon}</div>
        <div class="site-info">
          <div class="site-name">${site ? site.name : siteId}</div>
          <div class="site-addr">${site ? site.address : ''}</div>
          ${visit && visit.arrivedAt ? `<div class="site-time">Прибыл: ${fmt(visit.arrivedAt)} · ${visit.completedAt ? 'Выполнен: ' + fmt(visit.completedAt) : 'В работе'}</div>` : ''}
        </div>
        <span class="badge badge-${st === 'completed' ? 'success' : st === 'in_progress' ? 'warning' : st === 'skipped' ? 'danger' : 'pending'}">${statusLabel(st)}</span>
      </div>`;
    }).join('');
  }

  function renderPhotoSlots(visit) {
    const slotBefore = document.getElementById('slot-before');
    const slotAfter = document.getElementById('slot-after');
    if (!visit) return;

    // Before photo
    const imgBefore = slotBefore.querySelector('img') || (() => { const img = document.createElement('img'); slotBefore.appendChild(img); return img; })();
    if (visit.photoBefore) {
      imgBefore.src = visit.photoBefore;
      imgBefore.style.display = '';
      slotBefore.querySelector('.photo-icon').style.display = 'none';
      slotBefore.querySelector('.photo-label').style.display = 'none';
    } else {
      imgBefore.style.display = 'none';
      const pi = slotBefore.querySelector('.photo-icon');
      const pl = slotBefore.querySelector('.photo-label');
      if (pi) pi.style.display = '';
      if (pl) pl.style.display = '';
    }

    const imgAfter = slotAfter.querySelector('img') || (() => { const img = document.createElement('img'); slotAfter.appendChild(img); return img; })();
    if (visit.photoAfter) {
      imgAfter.src = visit.photoAfter;
      imgAfter.style.display = '';
      slotAfter.querySelector('.photo-icon').style.display = 'none';
      slotAfter.querySelector('.photo-label').style.display = 'none';
    } else {
      imgAfter.style.display = 'none';
      const pi = slotAfter.querySelector('.photo-icon');
      const pl = slotAfter.querySelector('.photo-label');
      if (pi) pi.style.display = '';
      if (pl) pl.style.display = '';
    }
  }

  function selectSite(siteId) {
    if (!state.activeOrderId) return;
    const visits = Data.getVisitsByOrder(state.activeOrderId);
    const visit = visits.find(v => v.siteId === siteId);
    if (visit && (visit.status === 'completed' || visit.status === 'skipped')) return;
    state.activeSiteId = siteId;
    renderDriverActive();
  }

  function arrive() {
    if (!state.activeOrderId || !state.activeSiteId) return;
    const visit = Data.getVisit(state.activeOrderId, state.activeSiteId);
    if (!visit) return;
    Data.updateVisit(visit.id, {
      status: 'in_progress',
      arrivedAt: new Date().toISOString(),
      lat: state.gpsLat,
      lng: state.gpsLng
    });
    // Update vehicle status
    const order = Data.getOrderById(state.activeOrderId);
    if (order) Data.updateVehicle(order.vehicleId, { status: 'at_site', lat: state.gpsLat || 52.9578, lng: state.gpsLng || 63.1283 });
    toast('Прибытие зафиксировано!', 'success');
    renderDriverActive();
  }

  function completeSite() {
    if (!state.activeOrderId || !state.activeSiteId) return;
    const visit = Data.getVisit(state.activeOrderId, state.activeSiteId);
    if (!visit) return;
    if (!visit.photoAfter) {
      toast('⚠️ Добавьте фото ПОСЛЕ уборки!', 'warning');
      return;
    }
    Data.updateVisit(visit.id, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
    toast('✅ Площадка выполнена!', 'success');

    // Move to next site
    const order = Data.getOrderById(state.activeOrderId);
    const visits = Data.getVisitsByOrder(state.activeOrderId);
    const nextVisit = order.sites.map(sid => visits.find(v => v.siteId === sid)).find(v => v && v.status === 'pending');
    if (nextVisit) {
      state.activeSiteId = nextVisit.siteId;
      Data.updateVehicle(order.vehicleId, { status: 'en_route' });
    } else {
      state.activeSiteId = null;
      Data.updateOrder(state.activeOrderId, { status: 'completed' });
      Data.updateVehicle(order.vehicleId, { status: 'idle' });
      toast('🎉 Наряд полностью выполнен!', 'success', 5000);
    }
    renderDriverActive();
    updateDriverMapMarkers();
  }

  function skipSite() {
    if (!state.activeOrderId || !state.activeSiteId) return;
    if (!confirm('Пропустить площадку? Это будет зафиксировано как нарушение.')) return;
    const visit = Data.getVisit(state.activeOrderId, state.activeSiteId);
    if (!visit) return;
    Data.updateVisit(visit.id, { status: 'skipped' });
    Data.addViolation({ orderId: state.activeOrderId, siteId: state.activeSiteId, type: 'missed_site', description: 'Площадка пропущена водителем', driverId: state.user.id });
    toast('⚠️ Площадка пропущена, нарушение зафиксировано', 'warning');

    const order = Data.getOrderById(state.activeOrderId);
    const visits = Data.getVisitsByOrder(state.activeOrderId);
    const next = order.sites.map(sid => visits.find(v => v.siteId === sid)).find(v => v && v.status === 'pending');
    if (next) state.activeSiteId = next.siteId;
    else { state.activeSiteId = null; Data.updateOrder(state.activeOrderId, { status: 'completed' }); }
    renderDriverActive();
  }

  function handlePhoto(type, input) {
    if (!input.files || !input.files[0]) return;
    if (!state.activeOrderId || !state.activeSiteId) { toast('Сначала выберите активную площадку', 'warning'); return; }
    const visit = Data.getVisit(state.activeOrderId, state.activeSiteId);
    if (!visit) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      // Compress photo
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 800;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        const updates = {};
        updates[type === 'before' ? 'photoBefore' : 'photoAfter'] = dataUrl;
        Data.updateVisit(visit.id, updates);

        if (type === 'after' && !visit.photoBefore) {
          Data.addViolation({ orderId: state.activeOrderId, siteId: state.activeSiteId, type: 'no_photo', description: 'Отсутствует фото ДО уборки', driverId: state.user.id });
        }
        toast(`📸 Фото ${type === 'before' ? 'ДО' : 'ПОСЛЕ'} сохранено`, 'success');
        renderDriverActive();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  // ─── GPS ──────────────────────────────────────────────────
  function startGPS() {
    if (!navigator.geolocation) {
      document.getElementById('gps-status').textContent = 'GPS: не поддерживается';
      return;
    }
    state.gpsWatchId = navigator.geolocation.watchPosition(
      pos => {
        state.gpsLat = pos.coords.latitude;
        state.gpsLng = pos.coords.longitude;
        document.getElementById('gps-status').textContent = `GPS: активен (±${Math.round(pos.coords.accuracy)}м)`;
        document.getElementById('gps-coords').textContent = `${state.gpsLat.toFixed(4)}, ${state.gpsLng.toFixed(4)}`;
        document.getElementById('gps-dot').style.background = 'var(--success)';

        if (state.user && state.user.vehicleId) {
          Data.updateVehicle(state.user.vehicleId, { lat: state.gpsLat, lng: state.gpsLng });
        }
        updateDriverMapMarkers();
        checkGeofences();
      },
      () => {
        // Fallback: simulate GPS in Rudny area
        state.gpsLat = 52.9578 + (Math.random() - 0.5) * 0.002;
        state.gpsLng = 63.1283 + (Math.random() - 0.5) * 0.002;
        document.getElementById('gps-status').textContent = 'GPS: симуляция (демо)';
        document.getElementById('gps-coords').textContent = `${state.gpsLat.toFixed(4)}, ${state.gpsLng.toFixed(4)}`;
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );
  }

  function stopGPS() {
    if (state.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.gpsWatchId);
      state.gpsWatchId = null;
    }
  }

  function checkGeofences() {
    if (!state.activeOrderId || !state.activeSiteId || !state.gpsLat) return;
    const site = Data.getSiteById(state.activeSiteId);
    if (!site) return;
    const visit = Data.getVisit(state.activeOrderId, state.activeSiteId);
    if (!visit || visit.status !== 'pending') return;
    const dist = distanceMeter(state.gpsLat, state.gpsLng, site.lat, site.lng);
    if (dist <= site.geofenceRadius) {
      toast(`📍 Вы прибыли на ${site.name}!`, 'success', 4000);
    }
  }

  // ─── Driver Map ───────────────────────────────────────────
  function initDriverMap() {
    if (state.maps.driver) { state.maps.driver.invalidateSize(); updateDriverMapMarkers(); return; }
    const map = L.map('driver-route-map').setView([52.9578, 63.1283], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    state.maps.driver = map;
    updateDriverMapMarkers();
  }

  function updateDriverMapMarkers() {
    const map = state.maps.driver;
    if (!map || !state.activeOrderId) return;
    map.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline || l instanceof L.Circle) map.removeLayer(l); });

    const order = Data.getOrderById(state.activeOrderId);
    const visits = Data.getVisitsByOrder(state.activeOrderId);
    const coords = [];

    order.sites.forEach((siteId, i) => {
      const site = Data.getSiteById(siteId);
      const visit = visits.find(v => v.siteId === siteId);
      const st = visit ? visit.status : 'pending';
      const color = st === 'completed' ? '#43A047' : st === 'in_progress' ? '#FB8C00' : st === 'skipped' ? '#E53935' : '#9E9E9E';

      L.circle([site.lat, site.lng], { radius: site.geofenceRadius, color, fillColor: color, fillOpacity: 0.2, weight: 2 }).addTo(map);
      const marker = L.circleMarker([site.lat, site.lng], { radius: 10, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });
      marker.bindTooltip(`${i + 1}. ${site.name}`);
      marker.addTo(map);
      coords.push([site.lat, site.lng]);
    });

    if (coords.length > 1) L.polyline(coords, { color: '#1565C0', weight: 3, dashArray: '8,4', opacity: 0.7 }).addTo(map);

    if (state.gpsLat) {
      const truckIcon = L.divIcon({ html: '<div style="font-size:24px;line-height:1">🚛</div>', iconSize: [30, 30], iconAnchor: [15, 15], className: '' });
      L.marker([state.gpsLat, state.gpsLng], { icon: truckIcon }).addTo(map).bindTooltip('Ваше положение');
    }

    if (coords.length) map.fitBounds(coords, { padding: [30, 30] });
  }

  // ─── DISPATCHER ───────────────────────────────────────────
  function initDispatcher(user) {
    document.getElementById('dispatcher-avatar').textContent = user.name[0];
    document.getElementById('dispatcher-username').textContent = user.name;
    showScreen('dispatcher');
    initDispatcherMap();
    renderDispatcherOrders();
    renderViolations();
    initOrderForm();
    startVehicleSimulation();
  }

  function initDispatcherMap() {
    if (state.maps.dispatcher) { state.maps.dispatcher.invalidateSize(); return; }
    const map = L.map('dispatcher-map').setView([52.9620, 63.1280], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    state.maps.dispatcher = map;
    renderDispatcherMapLayers();
  }

  function renderDispatcherMapLayers() {
    const map = state.maps.dispatcher;
    if (!map) return;

    // Clear old layers (keep tile)
    map.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.CircleMarker || l instanceof L.Circle) map.removeLayer(l); });

    const sites = Data.getSites();
    const visits = Data.getVisits();
    const todayOrders = Data.getTodayOrders();

    sites.forEach(site => {
      let status = 'pending';
      todayOrders.forEach(order => {
        if (order.sites.includes(site.id)) {
          const visit = visits.find(v => v.orderId === order.id && v.siteId === site.id);
          if (visit) status = visit.status;
        }
      });
      const color = status === 'completed' ? '#43A047' : status === 'in_progress' ? '#FB8C00' : status === 'skipped' ? '#E53935' : '#9E9E9E';
      const marker = L.circleMarker([site.lat, site.lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9 });
      marker.bindPopup(`<b>${site.name}</b><br>${site.address}<br>Статус: <b>${statusLabel(status)}</b>`);
      marker.addTo(map);
    });

    // Vehicles
    renderVehicleMarkers(map);
    renderVehiclePanel();
  }

  function renderVehicleMarkers(map) {
    Object.values(state.vehicleMarkers).forEach(m => m.remove());
    state.vehicleMarkers = {};
    const vehicles = Data.getVehicles();
    vehicles.forEach(v => {
      const driver = Data.getUserById(v.driverId);
      const truckIcon = L.divIcon({
        html: `<div style="background:${v.status === 'idle' ? '#9E9E9E' : v.status === 'at_site' ? '#43A047' : '#1565C0'};color:#fff;border-radius:8px;padding:2px 6px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3)">🚛 ${v.number}</div>`,
        className: '',
        iconAnchor: [30, 14]
      });
      const m = L.marker([v.lat, v.lng], { icon: truckIcon });
      const statusTxt = { idle: 'Простой', en_route: 'В пути', at_site: 'На объекте' }[v.status] || v.status;
      m.bindPopup(`<b>${v.number}</b> (${v.model})<br>Водитель: ${driver ? driver.name : '—'}<br>Статус: <b>${statusTxt}</b><br>Топливо: ${v.fuel}%<br>Скорость: ${v.speed} км/ч`);
      m.addTo(map);
      state.vehicleMarkers[v.id] = m;
    });
  }

  function renderVehiclePanel() {
    const vehicles = Data.getVehicles();
    const el = document.getElementById('vehicle-list');
    if (!el) return;
    const statusTxt = { idle: 'Простой', en_route: 'В пути', at_site: 'На объекте' };
    const statusColor = { idle: '#9E9E9E', en_route: '#1565C0', at_site: '#43A047' };
    el.innerHTML = vehicles.map(v => {
      const driver = Data.getUserById(v.driverId);
      return `<div class="vehicle-row">
        <span class="vehicle-icon">🚛</span>
        <div class="vehicle-info">
          <div class="vnum">${v.number}</div>
          <div class="vdriver">${driver ? driver.name.split(' ')[0] + ' ' + driver.name.split(' ')[1][0] + '.' : '—'}</div>
        </div>
        <span style="font-size:11px;padding:2px 7px;background:${statusColor[v.status]}22;color:${statusColor[v.status]};border-radius:10px;font-weight:600">${statusTxt[v.status] || v.status}</span>
      </div>`;
    }).join('');
  }

  function startVehicleSimulation() {
    if (state.simInterval) return;
    // Routes: vehicle moves between their order sites
    state.simInterval = setInterval(() => {
      const orders = Data.getTodayOrders();
      const vehicles = Data.getVehicles();
      vehicles.forEach(v => {
        const order = orders.find(o => o.vehicleId === v.id && o.status === 'in_progress');
        if (!order || v.status === 'at_site') return;

        const visits = Data.getVisitsByOrder(order.id);
        const nextVisit = order.sites.map(sid => visits.find(vi => vi.siteId === sid)).find(vi => vi && vi.status === 'pending');
        if (!nextVisit) return;
        const site = Data.getSiteById(nextVisit.siteId);
        if (!site) return;

        // Move towards next site
        const dlat = (site.lat - v.lat) * 0.08 + (Math.random() - 0.5) * 0.0002;
        const dlng = (site.lng - v.lng) * 0.08 + (Math.random() - 0.5) * 0.0002;
        const speed = Math.round(20 + Math.random() * 20);
        Data.updateVehicle(v.id, { lat: v.lat + dlat, lng: v.lng + dlng, speed, status: 'en_route' });
      });

      // Update map markers
      if (state.maps.dispatcher) {
        Object.values(state.vehicleMarkers).forEach(m => m.remove());
        state.vehicleMarkers = {};
        renderVehicleMarkers(state.maps.dispatcher);
        renderVehiclePanel();
        renderDispatcherMapLayers();
      }
      if (state.maps.manager) {
        Object.values(state.vehicleMarkers).forEach(m => { if (m._map === state.maps.manager) m.remove(); });
        renderManagerMapLayers();
      }
    }, 4000);
  }

  function renderDispatcherOrders() {
    const orders = Data.getOrders().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const el = document.getElementById('disp-orders-list');
    if (!orders.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Нет нарядов</p></div>';
      return;
    }
    el.innerHTML = orders.map(o => {
      const vehicle = Data.getVehicleById(o.vehicleId) || {};
      const driver = Data.getUserById(o.driverId) || {};
      const visits = Data.getVisitsByOrder(o.id);
      const done = visits.filter(v => v.status === 'completed').length;
      const hasPhoto = visits.some(v => v.photoBefore || v.photoAfter);
      return `<div class="order-item status-${o.status}" onclick="App.openOrderModal('${o.id}')">
        <div class="order-num">Наряд №${o.number} · ${fmtDate(o.date)}</div>
        <div class="order-title">📍 ${o.district} район</div>
        <div class="order-meta">
          <span>🚛 ${vehicle.number || '—'}</span>
          <span>👤 ${driver.name ? driver.name.split(' ').slice(0, 2).join(' ') : '—'}</span>
          <span>📍 ${done}/${visits.length}</span>
          ${hasPhoto ? '<span>📸 Есть фото</span>' : ''}
          <span><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'in_progress' ? 'warning' : 'pending'}">${orderStatusLabel(o.status)}</span></span>
        </div>
      </div>`;
    }).join('');
  }

  function openOrderModal(orderId) {
    const order = Data.getOrderById(orderId);
    if (!order) return;
    const visits = Data.getVisitsByOrder(orderId);
    const vehicle = Data.getVehicleById(order.vehicleId) || {};
    const driver = Data.getUserById(order.driverId) || {};

    document.getElementById('modal-order-title').textContent = `Наряд №${order.number} · ${order.district}`;
    document.getElementById('modal-order-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div><div style="font-size:11px;color:var(--text-muted);font-weight:700">ВОДИТЕЛЬ</div><div style="font-size:14px;font-weight:600">${driver.name || '—'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);font-weight:700">ТРАНСПОРТ</div><div style="font-size:14px;font-weight:600">${vehicle.number || '—'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);font-weight:700">ДАТА</div><div style="font-size:14px">${fmtDate(order.date)}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);font-weight:700">СТАТУС</div><span class="badge badge-${order.status === 'completed' ? 'success' : order.status === 'in_progress' ? 'warning' : 'pending'}">${orderStatusLabel(order.status)}</span></div>
      </div>
      ${order.notes ? `<div style="padding:10px 12px;background:var(--bg);border-radius:8px;font-size:13px;margin-bottom:14px">📝 ${order.notes}</div>` : ''}
      <div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:8px">ПЛОЩАДКИ (${visits.filter(v => v.status === 'completed').length}/${visits.length} выполнено)</div>
      <div class="site-list" style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
        ${order.sites.map((siteId, i) => {
          const site = Data.getSiteById(siteId);
          const visit = visits.find(v => v.siteId === siteId);
          const st = visit ? visit.status : 'pending';
          const hasPhoto = visit && (visit.photoBefore || visit.photoAfter);
          return `<div class="site-row" ${hasPhoto ? `onclick="App.openPhotoModal('${order.id}','${siteId}')"` : ''} style="${hasPhoto ? 'cursor:pointer' : ''}">
            <div class="site-num ${st === 'completed' ? 'done' : st === 'in_progress' ? 'active' : st === 'skipped' ? 'skip' : ''}">${st === 'completed' ? '✓' : st === 'skipped' ? '✗' : i + 1}</div>
            <div class="site-info">
              <div class="site-name">${site ? site.name : siteId}</div>
              ${visit && visit.arrivedAt ? `<div class="site-time">Прибыл: ${fmt(visit.arrivedAt)}${visit.completedAt ? ' · Выполнен: ' + fmt(visit.completedAt) : ''}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${hasPhoto ? '<span title="Есть фотоотчёт">📸</span>' : ''}
              <span class="badge badge-${st === 'completed' ? 'success' : st === 'in_progress' ? 'warning' : st === 'skipped' ? 'danger' : 'pending'}">${statusLabel(st)}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    document.getElementById('modal-order').classList.add('show');
  }

  function openPhotoModal(orderId, siteId) {
    const visit = Data.getVisit(orderId, siteId);
    const site = Data.getSiteById(siteId);
    if (!visit) return;
    document.getElementById('modal-photo-title').textContent = `Фотоотчёт — ${site ? site.name : siteId}`;

    const before = document.getElementById('modal-photo-before');
    const beforeEmpty = document.getElementById('modal-photo-before-empty');
    const after = document.getElementById('modal-photo-after');
    const afterEmpty = document.getElementById('modal-photo-after-empty');

    if (visit.photoBefore) { before.src = visit.photoBefore; before.style.display = ''; beforeEmpty.style.display = 'none'; }
    else { before.style.display = 'none'; beforeEmpty.style.display = ''; }

    if (visit.photoAfter) { after.src = visit.photoAfter; after.style.display = ''; afterEmpty.style.display = 'none'; }
    else { after.style.display = 'none'; afterEmpty.style.display = ''; }

    document.getElementById('modal-photo-meta').innerHTML =
      `📍 ${visit.lat ? visit.lat.toFixed(5) + ', ' + visit.lng.toFixed(5) : '—'}&nbsp;&nbsp;🕐 Прибыл: ${fmtFull(visit.arrivedAt)}&nbsp;&nbsp;✅ Выполнен: ${fmtFull(visit.completedAt)}`;

    closeModal('modal-order');
    document.getElementById('modal-photo').classList.add('show');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('show');
  }

  function renderViolations() {
    const violations = Data.getViolations().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const el = document.getElementById('violations-list');
    if (!violations.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>Нарушений не зафиксировано</p></div>';
      return;
    }
    el.innerHTML = violations.map(v => {
      const site = Data.getSiteById(v.siteId);
      const driver = Data.getUserById(v.driverId);
      return `<div class="violation-item">
        <div class="viol-title">⚠️ ${violTypeLabel(v.type)}</div>
        <div class="viol-meta">
          📍 ${site ? site.name : v.siteId}&nbsp;&nbsp;
          👤 ${driver ? driver.name : '—'}&nbsp;&nbsp;
          🕐 ${fmtFull(v.timestamp)}<br>
          ${v.description}
        </div>
      </div>`;
    }).join('');
  }

  // ─── Order form ───────────────────────────────────────────
  function initOrderForm() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('order-date').value = today;

    const driverSel = document.getElementById('order-driver');
    const vehicleSel = document.getElementById('order-vehicle');
    Data.getDrivers().forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      driverSel.appendChild(opt);
    });
    Data.getVehicles().forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.number} (${v.model})`;
      vehicleSel.appendChild(opt);
    });

    // Link driver to vehicle
    driverSel.addEventListener('change', () => {
      const driver = Data.getUserById(driverSel.value);
      if (driver && driver.vehicleId) vehicleSel.value = driver.vehicleId;
    });

    renderSiteCheckboxes();

    // Filter by district
    document.getElementById('order-district').addEventListener('change', renderSiteCheckboxes);
  }

  function renderSiteCheckboxes() {
    const district = document.getElementById('order-district').value;
    const sites = Data.getSites().filter(s => !district || s.district === district);
    const el = document.getElementById('site-checkbox-list');
    el.innerHTML = sites.map(s => `
      <div class="site-checkbox-item">
        <input type="checkbox" id="site-cb-${s.id}" value="${s.id}">
        <label for="site-cb-${s.id}">${s.name} · ${s.district}</label>
      </div>`).join('');
  }

  function createOrder() {
    const date = document.getElementById('order-date').value;
    const district = document.getElementById('order-district').value;
    const driverId = document.getElementById('order-driver').value;
    const vehicleId = document.getElementById('order-vehicle').value;
    const notes = document.getElementById('order-notes').value.trim();
    const sites = [...document.querySelectorAll('#site-checkbox-list input:checked')].map(i => i.value);

    if (!date || !district || !driverId || !vehicleId || !sites.length) {
      toast('⚠️ Заполните все обязательные поля и выберите площадки', 'warning');
      return;
    }

    const order = Data.createOrder({ date, district, driverId, vehicleId, sites, notes, status: 'pending', createdBy: state.user.id });

    // create visit stubs
    sites.forEach(siteId => {
      Data.createVisit({ orderId: order.id, siteId, vehicleId, status: 'pending', arrivedAt: null, completedAt: null, photoBefore: null, photoAfter: null, lat: null, lng: null });
    });

    toast(`✅ Наряд №${order.number} создан и отправлен водителю!`, 'success', 4000);
    resetOrderForm();
    renderDispatcherOrders();
    showTab('dispatcher', 'disp-orders');
  }

  function resetOrderForm() {
    document.getElementById('order-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('order-district').value = '';
    document.getElementById('order-driver').value = '';
    document.getElementById('order-vehicle').value = '';
    document.getElementById('order-notes').value = '';
    renderSiteCheckboxes();
  }

  // ─── MANAGER ──────────────────────────────────────────────
  function initManager(user) {
    document.getElementById('manager-avatar').textContent = user.name[0];
    document.getElementById('manager-username').textContent = user.name;
    showScreen('manager');
    renderStats();
    renderKPI();
    document.getElementById('report-date').value = new Date().toISOString().split('T')[0];
    startVehicleSimulation();
  }

  function renderStats() {
    const s = Data.getStats();
    const grid = document.getElementById('stats-grid');
    grid.innerHTML = [
      { icon: '📋', value: s.todayOrders, label: 'Нарядов сегодня' },
      { icon: '✅', value: s.completedOrders, label: 'Выполнено нарядов' },
      { icon: '▶️', value: s.inProgressOrders, label: 'В работе' },
      { icon: '📍', value: s.completedVisits, label: 'Площадок обслужено' },
      { icon: '⛔', value: s.skippedVisits, label: 'Пропущено' },
      { icon: '⚠️', value: s.violations, label: 'Нарушений' }
    ].map(s => `<div class="stat-card"><div class="stat-icon">${s.icon}</div><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');

    renderCharts(s);
  }

  function renderCharts(stats) {
    // Week chart
    const weekLabels = [];
    const weekData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      weekLabels.push(d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }));
      const dayOrders = Data.getOrders().filter(o => o.date === dateStr);
      const dayVisits = Data.getVisits().filter(v => dayOrders.find(o => o.id === v.orderId) && v.status === 'completed');
      weekData.push(dayVisits.length);
    }

    if (state.chartWeek) state.chartWeek.destroy();
    state.chartWeek = new Chart(document.getElementById('chart-week'), {
      type: 'bar',
      data: {
        labels: weekLabels,
        datasets: [{ label: 'Площадок', data: weekData, backgroundColor: '#1565C0', borderRadius: 6 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    // Status donut
    if (state.chartStatus) state.chartStatus.destroy();
    state.chartStatus = new Chart(document.getElementById('chart-status'), {
      type: 'doughnut',
      data: {
        labels: ['Выполнено', 'В работе', 'Не начато'],
        datasets: [{ data: [stats.completedOrders, stats.inProgressOrders, stats.todayOrders - stats.completedOrders - stats.inProgressOrders], backgroundColor: ['#43A047', '#FB8C00', '#9E9E9E'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '65%' }
    });
  }

  function renderKPI() {
    const drivers = Data.getDrivers();
    const orders = Data.getTodayOrders();
    const visits = Data.getVisits();
    const violations = Data.getViolations();
    const tbody = document.getElementById('kpi-tbody');

    tbody.innerHTML = drivers.map(driver => {
      const order = orders.find(o => o.driverId === driver.id);
      const driverVisits = order ? visits.filter(v => v.orderId === order.id) : [];
      const done = driverVisits.filter(v => v.status === 'completed').length;
      const skipped = driverVisits.filter(v => v.status === 'skipped').length;
      const photos = driverVisits.filter(v => v.photoBefore || v.photoAfter).length;
      const viols = violations.filter(v => v.driverId === driver.id && order && v.orderId === order.id).length;
      const vehicle = Data.getVehicleByDriver(driver.id);
      const score = order ? Math.max(0, Math.round((done / Math.max(driverVisits.length, 1)) * 100 - viols * 10)) : '—';
      const scoreColor = typeof score === 'number' ? (score >= 80 ? '#43A047' : score >= 50 ? '#FB8C00' : '#E53935') : '#9E9E9E';
      return `<tr>
        <td><b>${driver.name}</b></td>
        <td>${vehicle ? vehicle.number : '—'}</td>
        <td>${order ? `№${order.number}` : '—'}</td>
        <td style="color:var(--success);font-weight:700">${done}</td>
        <td style="color:${skipped > 0 ? 'var(--danger)' : 'var(--text-muted)'};font-weight:${skipped > 0 ? 700 : 400}">${skipped}</td>
        <td>📸 ${photos}</td>
        <td style="color:${viols > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${viols}</td>
        <td><span style="font-weight:800;color:${scoreColor};font-size:16px">${score}${typeof score === 'number' ? '%' : ''}</span></td>
      </tr>`;
    }).join('');
  }

  function initManagerMap() {
    if (state.maps.manager) { state.maps.manager.invalidateSize(); renderManagerMapLayers(); return; }
    const map = L.map('manager-map').setView([52.9620, 63.1280], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    state.maps.manager = map;
    renderManagerMapLayers();
  }

  function renderManagerMapLayers() {
    const map = state.maps.manager;
    if (!map) return;
    map.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.CircleMarker) map.removeLayer(l); });

    const sites = Data.getSites();
    const visits = Data.getVisits();
    const todayOrders = Data.getTodayOrders();
    sites.forEach(site => {
      let status = 'pending';
      todayOrders.forEach(order => {
        if (order.sites.includes(site.id)) {
          const visit = visits.find(v => v.orderId === order.id && v.siteId === site.id);
          if (visit) status = visit.status;
        }
      });
      const color = status === 'completed' ? '#43A047' : status === 'in_progress' ? '#FB8C00' : status === 'skipped' ? '#E53935' : '#9E9E9E';
      L.circleMarker([site.lat, site.lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9 })
        .bindPopup(`<b>${site.name}</b><br>${statusLabel(status)}`)
        .addTo(map);
    });

    Data.getVehicles().forEach(v => {
      const driver = Data.getUserById(v.driverId);
      const icon = L.divIcon({
        html: `<div style="background:#1565C0;color:#fff;border-radius:8px;padding:2px 6px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3)">🚛 ${v.number}</div>`,
        className: '', iconAnchor: [30, 14]
      });
      L.marker([v.lat, v.lng], { icon }).bindPopup(`<b>${v.number}</b><br>${driver ? driver.name : '—'}`).addTo(map);
    });
  }

  // ─── Report ───────────────────────────────────────────────
  function generateReport() {
    const date = document.getElementById('report-date').value;
    if (!date) return;
    const orders = Data.getOrders().filter(o => o.date === date);
    const visits = Data.getVisits();
    const violations = Data.getViolations();

    let totalSites = 0, doneSites = 0, skippedSites = 0, photoCount = 0;
    orders.forEach(o => {
      const v = visits.filter(vi => vi.orderId === o.id);
      totalSites += v.length;
      doneSites += v.filter(vi => vi.status === 'completed').length;
      skippedSites += v.filter(vi => vi.status === 'skipped').length;
      photoCount += v.filter(vi => vi.photoBefore || vi.photoAfter).length;
    });

    const dayViolations = violations.filter(v => {
      const o = orders.find(o => o.id === v.orderId);
      return !!o;
    });

    const el = document.getElementById('report-content');
    el.innerHTML = `
      <div style="font-size:17px;font-weight:800;margin-bottom:4px">Суточный отчёт — ${new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">ТОО «L Trading» · г. Рудный · Составлен: ${new Date().toLocaleString('ru-RU')}</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:20px">
        ${[
          ['📋', orders.length, 'Нарядов'],
          ['✅', orders.filter(o => o.status === 'completed').length, 'Выполнено'],
          ['📍', doneSites, 'Площадок обслужено'],
          ['⛔', skippedSites, 'Пропущено'],
          ['📸', photoCount, 'Фотоотчётов'],
          ['⚠️', dayViolations.length, 'Нарушений']
        ].map(([icon, val, label]) => `
          <div style="background:var(--bg);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:22px">${icon}</div>
            <div style="font-size:24px;font-weight:800;color:var(--primary)">${val}</div>
            <div style="font-size:11px;color:var(--text-muted)">${label}</div>
          </div>`).join('')}
      </div>

      <table>
        <thead><tr><th>Наряд</th><th>Район</th><th>Водитель</th><th>ТС</th><th>Площадок</th><th>Выполнено</th><th>Пропущено</th><th>Статус</th></tr></thead>
        <tbody>
          ${orders.map(o => {
            const v = visits.filter(vi => vi.orderId === o.id);
            const driver = Data.getUserById(o.driverId);
            const vehicle = Data.getVehicleById(o.vehicleId);
            return `<tr>
              <td>№${o.number}</td>
              <td>${o.district}</td>
              <td>${driver ? driver.name.split(' ').slice(0, 2).join(' ') : '—'}</td>
              <td>${vehicle ? vehicle.number : '—'}</td>
              <td>${v.length}</td>
              <td style="color:var(--success);font-weight:700">${v.filter(vi => vi.status === 'completed').length}</td>
              <td style="color:${v.filter(vi => vi.status === 'skipped').length > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${v.filter(vi => vi.status === 'skipped').length}</td>
              <td><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'in_progress' ? 'warning' : 'pending'}">${orderStatusLabel(o.status)}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>

      ${dayViolations.length ? `
        <div style="margin-top:20px;font-size:14px;font-weight:700;margin-bottom:8px">⚠️ Нарушения (${dayViolations.length})</div>
        ${dayViolations.map(v => {
          const site = Data.getSiteById(v.siteId);
          const driver = Data.getUserById(v.driverId);
          return `<div style="padding:8px 12px;background:#FFF3E0;border-radius:8px;border-left:3px solid var(--warning);margin-bottom:6px;font-size:13px">
            <b>${violTypeLabel(v.type)}</b> · ${site ? site.name : ''} · ${driver ? driver.name.split(' ').slice(0, 2).join(' ') : ''} · ${fmtFull(v.timestamp)}
          </div>`;
        }).join('')}` : ''}`;
  }

  function printReport() {
    window.print();
  }

  function exportCSV() {
    const date = document.getElementById('report-date').value || new Date().toISOString().split('T')[0];
    const orders = Data.getOrders().filter(o => o.date === date);
    const visits = Data.getVisits();
    const rows = [['Наряд', 'Район', 'Водитель', 'ТС', 'Площадка', 'Адрес', 'Статус', 'Прибыл', 'Выполнен', 'Фото']];
    orders.forEach(o => {
      const driver = Data.getUserById(o.driverId);
      const vehicle = Data.getVehicleById(o.vehicleId);
      o.sites.forEach(siteId => {
        const site = Data.getSiteById(siteId);
        const visit = visits.find(v => v.orderId === o.id && v.siteId === siteId);
        rows.push([
          `№${o.number}`, o.district,
          driver ? driver.name : '', vehicle ? vehicle.number : '',
          site ? site.name : siteId, site ? site.address : '',
          statusLabel(visit ? visit.status : 'pending'),
          fmt(visit ? visit.arrivedAt : null), fmt(visit ? visit.completedAt : null),
          visit && (visit.photoBefore || visit.photoAfter) ? 'Да' : 'Нет'
        ]);
      });
    });

    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tbo-report-${date}.csv`;
    a.click();
    toast('📊 CSV файл скачан', 'success');
  }

  // ─── Tab wiring ───────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        const screen = btn.dataset.screen;
        if (!tab || !screen) return;

        if (tab === 'driver-logout' || tab === 'disp-logout' || tab === 'mgr-logout') { logout(); return; }
        showTab(screen, tab);

        // Lazy init maps and data
        if (tab === 'driver-map') { setTimeout(() => { initDriverMap(); state.maps.driver && state.maps.driver.invalidateSize(); }, 100); }
        if (tab === 'disp-map') { setTimeout(() => { initDispatcherMap(); state.maps.dispatcher && state.maps.dispatcher.invalidateSize(); }, 100); }
        if (tab === 'disp-orders') renderDispatcherOrders();
        if (tab === 'disp-violations') renderViolations();
        if (tab === 'mgr-map') { setTimeout(() => { initManagerMap(); state.maps.manager && state.maps.manager.invalidateSize(); }, 100); }
        if (tab === 'mgr-stats') renderStats();
        if (tab === 'mgr-kpi') renderKPI();
      });
    });
  }

  // ─── Boot ─────────────────────────────────────────────────
  function init() {
    Data.init();
    initTabs();

    document.getElementById('btn-login').addEventListener('click', login);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    document.getElementById('btn-arrive').addEventListener('click', arrive);
    document.getElementById('btn-complete-site').addEventListener('click', completeSite);
    document.getElementById('btn-skip-site').addEventListener('click', skipSite);
    document.getElementById('btn-create-order').addEventListener('click', createOrder);

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
    });

    // Restore session
    const session = Data.getSession();
    if (session) {
      state.user = session;
      initRole(session);
    }
  }

  return {
    init,
    selectDriverOrder,
    selectSite,
    handlePhoto,
    arrive,
    completeSite,
    skipSite,
    openOrderModal,
    openPhotoModal,
    closeModal,
    createOrder,
    resetOrderForm,
    generateReport,
    printReport,
    exportCSV
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
