const API = '/api';
let currentUser = JSON.parse(localStorage.getItem('bb_user') || 'null');
let token = localStorage.getItem('bb_token') || '';
let currentLocation = JSON.parse(localStorage.getItem('bb_location') || 'null');
let currentBloodResults = [];
let latestDonations = [];
let inventoryMap;
let inventoryMarkers = [];
let bloodChart;
let donationChart;
let adminInventory = [];

const apiFetch = async (url, options = {}) => {
  showLoader(true);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  } finally {
    showLoader(false);
  }
};

function showLoader(show) {
  const el = document.getElementById('loader');
  if (!el) return;
  el.classList.toggle('hidden', !show);
  el.classList.toggle('flex', show);
}

function toast(message, type = 'info') {
  const box = document.getElementById('toast');
  document.getElementById('toast-message').textContent = message;
  document.getElementById('toast-icon').textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : '🔔';
  box.classList.remove('translate-y-24', 'opacity-0');
  setTimeout(() => box.classList.add('translate-y-24', 'opacity-0'), 3000);
}

function setSession(nextToken, user) {
  token = nextToken;
  currentUser = user;
  localStorage.setItem('bb_token', token);
  localStorage.setItem('bb_user', JSON.stringify(user));
  updateAuthButtons();
}

function clearSession() {
  token = '';
  currentUser = null;
  localStorage.removeItem('bb_token');
  localStorage.removeItem('bb_user');
  updateAuthButtons();
}

function updateAuthButtons() {
  document.querySelectorAll('[data-auth-only]').forEach((el) => el.classList.toggle('hidden', !currentUser));
  document.querySelectorAll('[data-guest-only]').forEach((el) => el.classList.toggle('hidden', !!currentUser));
}

function guard(pageId) {
  if (['donor-dashboard', 'profile', 'requests'].includes(pageId) && !currentUser) {
    toast('Please login first', 'error');
    pageId = 'auth';
  }
  if (pageId === 'admin' && (!currentUser || !['admin', 'manager'].includes(currentUser.role))) {
    toast('Admin access required', 'error');
    pageId = currentUser ? 'home' : 'auth';
  }
  return pageId;
}

function showPage(pageId) {
  pageId = guard(pageId);
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);

  if (pageId === 'search') filterBloodResults();
  if (pageId === 'nearby') {};
  if (pageId === 'requests') loadMyRequests();
  if (pageId === 'donor-dashboard') loadDonorDashboard();
  if (pageId === 'profile') loadProfile();
  if (pageId === 'admin') loadAdminDashboard();
}

function switchAuthTab(tab) {
  const login = document.getElementById('login-form');
  const register = document.getElementById('register-form');
  const loginTab = document.getElementById('login-tab');
  const regTab = document.getElementById('register-tab');
  if (tab === 'login') {
    login.classList.remove('hidden');
    register.classList.add('hidden');
    loginTab.classList.add('bg-white', 'dark:bg-slate-900', 'text-blood-600', 'shadow');
    regTab.classList.remove('bg-white', 'dark:bg-slate-900', 'text-blood-600', 'shadow');
  } else {
    login.classList.add('hidden');
    register.classList.remove('hidden');
    regTab.classList.add('bg-white', 'dark:bg-slate-900', 'text-blood-600', 'shadow');
    loginTab.classList.remove('bg-white', 'dark:bg-slate-900', 'text-blood-600', 'shadow');
  }
}

function openRegister(){ showPage('auth'); switchAuthTab('register'); }
function logout(){ clearSession(); toast('Logged out', 'success'); showPage('home'); }

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('bb_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}

async function captureLocation(runNearby = false, saveProfile = false) {
  if (!navigator.geolocation) return toast('Geolocation not supported', 'error');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    currentLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    localStorage.setItem('bb_location', JSON.stringify(currentLocation));
    toast('Location captured', 'success');
    if (runNearby) searchNearbyDonors();
    if (saveProfile && currentUser) {
      await saveProfile(true);
    }
  }, () => toast('Could not capture location', 'error'), { enableHighAccuracy: true, timeout: 10000 });
}

async function useMyLocationAndSearch(){ await captureLocation(); filterBloodResults(true); }

async function handleRegister(e) {
  e.preventDefault();

  try {
    const payload = {
      firstName: document.getElementById('reg-fname').value.trim(),
      lastName: document.getElementById('reg-lname').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      phone: document.getElementById('reg-phone').value.trim(),
      bloodGroup: document.getElementById('reg-blood').value,
      role: document.getElementById('reg-role').value,

      city: document.getElementById('reg-city').value,
      state: document.getElementById('reg-state').value,

      address: document.getElementById('reg-address').value.trim(),

      password: document.getElementById('reg-password').value,

      latitude: currentLocation?.latitude,
      longitude: currentLocation?.longitude
    };

    const data = await apiFetch(
      `${API}/auth/register`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );

    setSession(data.token, data.user);

    toast('Registration successful', 'success');

    showPage(
      data.user.role === 'donor'
        ? 'donor-dashboard'
        : 'profile'
    );

  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const data = await apiFetch(`${API}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value
      })
    });
    setSession(data.token, data.user);
    toast('Login successful', 'success');
    showPage(data.user.role === 'admin' || data.user.role === 'manager' ? 'admin' : data.user.role === 'donor' ? 'donor-dashboard' : 'requests');
  } catch (err) { toast(err.message, 'error'); }
}

async function startForgotPassword() {
  try {
    const email = document.getElementById('forgot-email').value.trim();
    const data = await apiFetch(`${API}/auth/forgot-password`, { method: 'POST', body: JSON.stringify({ email }) });
    toast(data.resetToken ? `Reset token: ${data.resetToken}` : data.message, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function resetPassword() {
  try {
    await apiFetch(`${API}/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('forgot-email').value.trim(),
        token: document.getElementById('reset-token').value.trim(),
        newPassword: document.getElementById('reset-password').value
      })
    });
    toast('Password reset successful', 'success');
    showPage('auth');
  } catch (err) { toast(err.message, 'error'); }
}

async function sendEmailVerification() {
  try {
    const user = JSON.parse(localStorage.getItem('bb_user') || '{}');

    if (!user.email) {
      return toast('User email not found', 'error');
    }

    const data = await apiFetch(`${API}/auth/send-email-token`, {
      method: 'POST',
      body: JSON.stringify({ email: user.email })
    });

    document.getElementById('email-token').value = data.emailVerificationToken || '';
    toast(data.message || 'Email token generated', 'success');

  } catch (err) {
    toast(err.message || 'Request failed', 'error');
  }
}

async function sendMobileOtp() {
  try {
    const user = JSON.parse(localStorage.getItem('bb_user') || '{}');

    if (!user.email) {
      return toast('User email not found', 'error');
    }

    const data = await apiFetch(`${API}/auth/send-phone-otp`, {
      method: 'POST',
      body: JSON.stringify({ email: user.email })
    });

    document.getElementById('mobile-otp').value = data.phoneOtp || '';
    toast(data.message || 'OTP generated', 'success');

  } catch (err) {
    toast(err.message || 'Request failed', 'error');
  }
}

async function verifyMobileOtp() {
  try {
    const user = JSON.parse(localStorage.getItem('bb_user') || '{}');
    const otp = document.getElementById('mobile-otp').value.trim();

    if (!user.email) {
      return toast('User email not found', 'error');
    }

    if (!otp) {
      return toast('Enter OTP first', 'error');
    }

    const data = await apiFetch(`${API}/auth/verify-phone-otp`, {
      method: 'POST',
      body: JSON.stringify({
        email: user.email,
        otp
      })
    });

    if (data.user) {
      localStorage.setItem('bb_user', JSON.stringify(data.user));
    }

    toast(data.message || 'Phone verified', 'success');

  } catch (err) {
    toast(err.message || 'Request failed', 'error');
  }
}

async function verifyEmailToken() {
  try {
    const token = document.getElementById('email-token').value.trim();

    if (!token) {
      return toast('Enter email token first', 'error');
    }

    const data = await apiFetch(`${API}/auth/verify-email`, {
      method: 'POST',
      body: JSON.stringify({ token })
    });

    if (data.user) {
      localStorage.setItem('bb_user', JSON.stringify(data.user));
    }

    toast(data.message || 'Email verified', 'success');

  } catch (err) {
    toast(err.message || 'Request failed', 'error');
  }
}

async function filterBloodResults(useGeo = false) {
  try {
    const q = new URLSearchParams();

    const bloodGroup = document.getElementById('search-blood-group').value;
    const city = document.getElementById('search-location').value;
    const urgency = document.getElementById('search-urgency').value;

    if (bloodGroup) q.append('bloodGroup', bloodGroup);

    if (city) q.append('state', city);

    if (urgency) q.append('urgency', urgency);

    if (useGeo && currentLocation) {
      q.append('lat', currentLocation.latitude);
      q.append('lng', currentLocation.longitude);
      q.append('radius', 100);
    }

    const data = await apiFetch(
      `${API}/inventory/search?${q.toString()}`
    );

    currentBloodResults = data.results || [];

    renderBloodResults();

    renderInventoryMap();

  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderBloodResults() {
  const wrap = document.getElementById('blood-results');
  document.getElementById('results-count').textContent = `${currentBloodResults.length} results found`;
  if (!currentBloodResults.length) {
    wrap.innerHTML = '<div class="rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">No blood units found.</div>';
    return;
  }
  wrap.innerHTML = currentBloodResults.map(item => `
    <div class="rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">
      <div class="flex items-start justify-between gap-3">
        <div><div class="text-3xl font-black text-blood-600">${item.bloodGroup}</div><div class="font-bold">${item.hospitalName}</div><div class="text-sm text-slate-500">${item.city}${item.distanceKm ? ` • ${item.distanceKm.toFixed(1)} km away` : ''}</div></div>
        <span class="rounded-full px-3 py-1 text-xs font-bold ${item.urgency === 'emergency' ? 'bg-red-100 text-red-700' : item.urgency === 'urgent' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}">${item.urgency}</span>
      </div>
      <div class="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
        <div>Units: <b>${item.units}</b></div>
        <div>Phone: <a href="tel:${item.hospitalPhone}" class="text-blood-600 font-semibold">${item.hospitalPhone || 'N/A'}</a></div>
        <div>Expiry: ${new Date(item.expiryDate).toLocaleDateString()}</div>
      </div>
      <div class="mt-4 flex gap-2">
        <button onclick="requestBlood('${item._id}')" class="flex-1 rounded-2xl bg-blood-600 px-4 py-3 font-bold text-white">Request Blood</button>
        <a href="tel:${item.hospitalPhone}" class="rounded-2xl border px-4 py-3 font-bold">Call</a>
      </div>
    </div>`).join('');
}

function renderInventoryMap() {
  const container = document.getElementById('inventory-map');
  if (!container || typeof L === 'undefined') return;

  if (!inventoryMap) {
    inventoryMap = L.map('inventory-map').setView([26.8467, 80.9462], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(inventoryMap);
  }

  inventoryMarkers.forEach(m => inventoryMap.removeLayer(m));
  inventoryMarkers = [];

  const points = Array.isArray(currentBloodResults) && currentBloodResults.length
    ? currentBloodResults
    : [
        {
          location: { coordinates: [80.9462, 26.8467] },
          hospitalName: 'Lucknow'
        }
      ];

  const bounds = [];

  points.forEach(item => {
    let lat, lng;

    if (item?.location?.coordinates && item.location.coordinates.length >= 2) {
      lng = Number(item.location.coordinates[0]);
      lat = Number(item.location.coordinates[1]);
    } else if (item?.coordinates?.lat && item?.coordinates?.lng) {
      lat = Number(item.coordinates.lat);
      lng = Number(item.coordinates.lng);
    } else {
      return;
    }

    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const marker = L.marker([lat, lng]).addTo(inventoryMap).bindPopup(`
      <b>${item.hospitalName || 'Unknown Hospital'}</b><br/>
      ${item.bloodGroup || ''} ${item.units ? `• ${item.units} units` : ''}
    `);

    inventoryMarkers.push(marker);
    bounds.push([lat, lng]);
  });

  if (bounds.length === 1) {
    inventoryMap.setView(bounds[0], 11);
  } else if (bounds.length > 1) {
    inventoryMap.fitBounds(bounds, { padding: [30, 30] });
  } else {
    inventoryMap.setView([26.8467, 80.9462], 5);
  }

  setTimeout(() => {
    inventoryMap.invalidateSize();
  }, 200);
}

async function searchNearbyDonors() {
  try {
    if (!currentLocation) {
      return toast('Capture current location first', 'error');
    }

    const bloodGroup = document.getElementById('nearby-blood-group').value;
    const radius = document.getElementById('nearby-radius').value || 100;

    const data = await apiFetch(
      `${API}/inventory/nearby-donors?bloodGroup=${encodeURIComponent(bloodGroup)}&lat=${currentLocation.latitude}&lng=${currentLocation.longitude}&radius=${radius}`
    );

    const donors = data?.donors || data?.results || [];

    const wrap = document.getElementById('nearby-results');
    if (!wrap) return;

    if (!Array.isArray(donors) || donors.length === 0) {
      wrap.innerHTML = '<div class="rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">No nearby compatible donors found.</div>';
      return;
    }

    wrap.innerHTML = donors.map(d => `
      <div class="rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div class="text-xl font-black text-blood-600">${d.bloodGroup || 'N/A'}</div>
        <div class="font-bold">${d.firstName || ''} ${d.lastName || ''}</div>
        <div class="text-sm text-slate-500">
          ${d.city || 'Unknown city'}${d.state ? `, ${d.state}` : ''}${d.distanceKm ? ` • ${Number(d.distanceKm).toFixed(1)} km away` : ''}
        </div>
        <div class="mt-3 text-sm">
          Status: ${d.isAvailable ? 'Available' : 'Unavailable'} / ${d.isEligible ? 'Eligible' : 'Not eligible'}
        </div>
        <div class="mt-4 flex gap-2">
          <a href="tel:${d.phone || ''}" class="flex-1 rounded-2xl border px-4 py-3 text-center font-bold">Call</a>
          <button onclick="showPage('requests')" class="flex-1 rounded-2xl bg-blood-600 px-4 py-3 font-bold text-white">Open Requests</button>
        </div>
      </div>
    `).join('');

    toast(`${donors.length} nearby donors found`, 'success');
  } catch (err) {
    console.error(err);
    toast(err.message, 'error');
  }
}

async function requestBlood(inventoryId) {
  try {
    if (!currentUser) return showPage('auth');
    const item = currentBloodResults.find(x => x._id === inventoryId);
    if (!item) return;
    await apiFetch(`${API}/requests`, { method: 'POST', body: JSON.stringify({ inventoryId, bloodGroup: item.bloodGroup, unitsNeeded: 1, urgency: item.urgency, hospitalName: item.hospitalName, hospitalPhone: item.hospitalPhone, city: item.city, notes: 'Requested from website' }) });
    toast('Blood request created', 'success');
    loadMyRequests();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadMyRequests() {
  try {
    if (!currentUser) return;
    const data = await apiFetch(`${API}/requests/mine`);
    const wrap = document.getElementById('request-list');
    if (!data.requests.length) {
      wrap.innerHTML = '<div class="rounded-2xl border p-4">No requests found.</div>'; return;
    }
    wrap.innerHTML = data.requests.map(r => `
      <div class="rounded-3xl border p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-xl font-black">${r.bloodGroup} • ${r.hospitalName}</div>
            <div class="text-sm text-slate-500">${r.city} • ${r.urgency} • ${new Date(r.createdAt).toLocaleString()}</div>
            <div class="mt-1 text-sm">Status: <span class="font-bold">${r.status}</span></div>
          </div>
          <div class="flex flex-wrap gap-2">
            ${r.status !== 'completed' ? `<button onclick="contactDonor('${r._id}')" class="rounded-2xl border px-4 py-2 font-bold">Contact donor</button>` : ''}
            ${['approved','pending'].includes(r.status) ? `<button onclick="completeRequest('${r._id}')" class="rounded-2xl bg-blood-600 px-4 py-2 font-bold text-white">Mark Completed</button>` : ''}
          </div>
        </div>
      </div>`).join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function contactDonor(id) {
  try {
    const data = await apiFetch(`${API}/requests/${id}/contact-donor`, { method: 'POST' });
    toast(`Donor assigned: ${data.donor.name} (${data.donor.phone})`, 'success');
    loadMyRequests();
  } catch (err) { toast(err.message, 'error'); }
}

async function completeRequest(id) {
  try {
    await apiFetch(`${API}/requests/${id}/complete`, { method: 'POST' });
    toast('Request completed', 'success');
    loadMyRequests();
    if (currentUser?.role === 'donor') loadDonorDashboard();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadDonorDashboard() {
  try {
    if (!currentUser || currentUser.role === 'admin' || currentUser.role === 'manager') return;

    const profile = await apiFetch(`${API}/donor/me`);
    const donations = await apiFetch(`${API}/donor/donations`);
    latestDonations = donations.donations || [];

    const notes = await apiFetch(`${API}/notifications`);

    document.getElementById('donor-name').textContent =
      `${profile.firstName} ${profile.lastName}`;

    document.getElementById('donor-subtitle').textContent =
      `Blood group ${profile.bloodGroup || '-'} • ${profile.city}`;

    document.getElementById('don-stat-1').textContent = profile.totalDonations;
    document.getElementById('don-stat-2').textContent = profile.totalLivesSaved;
    document.getElementById('don-stat-3').textContent = profile.lastDonationVolume;
    document.getElementById('don-stat-4').textContent = profile.daysUntilNextEligible;

    document.getElementById('availability-toggle').checked = !!profile.isAvailable;
    document.getElementById('availability-toggle').disabled = !profile.isEligible;

    document.getElementById('donation-history').innerHTML =
      latestDonations.length
        ? latestDonations.map(d => `
          <div class="rounded-2xl border p-4">
            <div class="font-bold">${d.hospitalName}</div>
            <div class="text-sm text-slate-500">
              ${new Date(d.donatedAt).toLocaleDateString()} • ${d.quantityMl}ml • ${d.bloodGroup}
            </div>
          </div>
        `).join('')
        : '<div class="rounded-2xl border p-4">No donation history yet.</div>';

    document.getElementById('notification-list').innerHTML =
      notes.notifications.length
        ? notes.notifications.map(n => `
          <div class="rounded-2xl border p-4">
            <div class="font-bold">${n.title}</div>
            <div class="text-sm text-slate-500">${n.message}</div>
          </div>
        `).join('')
        : '<div class="rounded-2xl border p-4">No notifications yet.</div>';

  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleAvailability(isAvailable) {
  try {
    const data = await apiFetch(`${API}/donor/availability`, { method: 'PATCH', body: JSON.stringify({ isAvailable }) });
    toast(`Availability: ${data.isAvailable ? 'available' : 'unavailable'}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function downloadMyReceiptPdf() {
  if (!latestDonations.length) return toast('No donation receipt available', 'error');
  const latest = latestDonations[0];
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(20); doc.text('BloodBank Donation Receipt', 20, 20);
  doc.setFontSize(12);
  doc.text(`Receipt ID: ${latest.receiptId}`, 20, 40);
  doc.text(`Hospital: ${latest.hospitalName}`, 20, 50);
  doc.text(`Blood Group: ${latest.bloodGroup}`, 20, 60);
  doc.text(`Quantity: ${latest.quantityMl}ml`, 20, 70);
  doc.text(`Date: ${new Date(latest.donatedAt).toLocaleString()}`, 20, 80);
  doc.save(`receipt-${latest.receiptId}.pdf`);
}

async function loadProfile() {
  try {
    if (!currentUser) return;

    const me = await apiFetch(`${API}/auth/me`);
    const u = me.user || me;

    document.getElementById('profile-fname').value = u.firstName || '';
    document.getElementById('profile-lname').value = u.lastName || '';
    document.getElementById('profile-phone').value = u.phone || '';
    document.getElementById('profile-city').value = u.city || 'lucknow';
    document.getElementById('profile-address').value = u.address || '';
    document.getElementById('profile-bio').value = u.bio || '';
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function saveProfile(withLocation = false) {
  try {
    const payload = {
      firstName: document.getElementById('profile-fname').value.trim(),
      lastName: document.getElementById('profile-lname').value.trim(),
      phone: document.getElementById('profile-phone').value.trim(),
      city: document.getElementById('profile-city').value,
      address: document.getElementById('profile-address').value.trim(),
      bio: document.getElementById('profile-bio').value.trim(),
    };

    if (withLocation && currentLocation) {
      payload.latitude = currentLocation.latitude;
      payload.longitude = currentLocation.longitude;
    }

    const data = await apiFetch(`${API}/auth/profile`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    currentUser = data.user || data;
    localStorage.setItem('bb_user', JSON.stringify(currentUser));

    toast('Profile updated', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadAdminDashboard() {
  try {
    const [stats, users, requests, inventory] = await Promise.all([
      apiFetch(`${API}/admin/stats`),
      apiFetch(`${API}/admin/users`),
      apiFetch(`${API}/admin/requests`),
      apiFetch(`${API}/admin/inventory`)
    ]);
    document.getElementById('admin-stat-1').textContent = stats.totalUsers;
    document.getElementById('admin-stat-2').textContent = stats.totalDonors;
    document.getElementById('admin-stat-3').textContent = stats.pendingRequests;
    document.getElementById('admin-stat-4').textContent = stats.totalUnits;

    renderCharts(stats);
    renderAdminInventory(inventory.inventory);
    renderAdminRequests(requests.requests);
    renderAdminUsers(users.users);
  } catch (err) { toast(err.message, 'error'); }
}

function renderCharts(stats) {
  if (bloodChart) bloodChart.destroy();
  if (donationChart) donationChart.destroy();
  bloodChart = new Chart(document.getElementById('blood-chart'), {
    type: 'bar',
    data: {
      labels: stats.bloodGroupStats.map(x => x._id),
      datasets: [{ label: 'Units', data: stats.bloodGroupStats.map(x => x.units) }]
    }
  });
  donationChart = new Chart(document.getElementById('donation-chart'), {
    type: 'line',
    data: {
      labels: stats.monthlyDonations.map(x => `M${x._id}`),
      datasets: [{ label: 'Donations', data: stats.monthlyDonations.map(x => x.count) }]
    }
  });
}

function renderAdminInventory(items) {
  adminInventory = items;
  const wrap = document.getElementById('admin-inventory-list');
  wrap.innerHTML = items.map(item => `
    <div class="rounded-2xl border p-4">
      <div class="flex items-center justify-between gap-2"><div><div class="text-2xl font-black text-blood-600">${item.bloodGroup}</div><div class="font-bold">${item.hospitalName}</div><div class="text-sm text-slate-500">${item.city}</div></div><span class="text-sm font-bold">${item.units} units</span></div>
      <div class="mt-3 grid gap-2 text-sm"><div>Phone: ${item.hospitalPhone || '-'}</div><div>Expiry: ${new Date(item.expiryDate).toLocaleDateString()}</div></div>
      <div class="mt-4 flex gap-2"><button onclick="prefillInventoryById('${item._id}')" class="flex-1 rounded-2xl border px-4 py-2 font-bold">Edit</button><button onclick="deleteInventory('${item._id}')" class="flex-1 rounded-2xl bg-red-600 px-4 py-2 font-bold text-white">Delete</button></div>
    </div>`).join('');
}

function prefillInventoryById(id) {
  const item = adminInventory.find(x => x._id === id);
  if (!item) return;
  document.getElementById('inv-blood').value = item.bloodGroup;
  document.getElementById('inv-units').value = item.units;
  document.getElementById('inv-city').value = item.city;
  document.getElementById('inv-hospital').value = item.hospitalName;
  document.getElementById('inv-phone').value = item.hospitalPhone || '';
  document.getElementById('inv-urgency').value = item.urgency;
  document.getElementById('inv-expiry').value = new Date(item.expiryDate).toISOString().slice(0,10);
  document.getElementById('inv-lat').value = item.coordinates.lat;
  document.getElementById('inv-lng').value = item.coordinates.lng;
  document.getElementById('inv-hospital').dataset.editId = item._id;
}

async function saveInventory() {
  try {
    const hospitalInput = document.getElementById('inv-hospital');
    const editId = hospitalInput.dataset.editId || '';

    const lat = Number(document.getElementById('inv-lat').value) || 26.8467;
    const lng = Number(document.getElementById('inv-lng').value) || 80.9462;

    const payload = {
      bloodGroup: document.getElementById('inv-blood').value,
      units: Number(document.getElementById('inv-units').value),
      city: document.getElementById('inv-city').value.trim().toLowerCase(),
      state: 'uttar pradesh',
      hospitalName: hospitalInput.value.trim(),
      hospitalPhone: document.getElementById('inv-phone').value.trim(),
      urgency: document.getElementById('inv-urgency').value,
      expiryDate: document.getElementById('inv-expiry').value,
      location: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    };

    if (editId) {
      await apiFetch(`${API}/inventory/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      toast('Inventory updated', 'success');
    } else {
      await apiFetch(`${API}/inventory`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('Inventory added', 'success');
    }

    document.getElementById('inv-blood').value = 'A+';
    document.getElementById('inv-units').value = '';
    document.getElementById('inv-city').value = 'lucknow';
    document.getElementById('inv-hospital').value = '';
    document.getElementById('inv-phone').value = '';
    document.getElementById('inv-urgency').value = 'normal';
    document.getElementById('inv-expiry').value = '';
    document.getElementById('inv-lat').value = '';
    document.getElementById('inv-lng').value = '';
    document.getElementById('inv-hospital').dataset.editId = '';

    loadAdminDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}


function editInventory(
  id,
  bloodGroup,
  units,
  city,
  hospitalName,
  hospitalPhone,
  urgency,
  expiryDate,
  lat,
  lng
) {
  document.getElementById('inv-blood').value = bloodGroup || 'A+';
  document.getElementById('inv-units').value = units || '';
  document.getElementById('inv-city').value = city || 'lucknow';
  document.getElementById('inv-hospital').value = hospitalName || '';
  document.getElementById('inv-phone').value = hospitalPhone || '';
  document.getElementById('inv-urgency').value = urgency || 'normal';
  document.getElementById('inv-expiry').value = expiryDate ? String(expiryDate).slice(0, 10) : '';
  document.getElementById('inv-lat').value = lat ?? '';
  document.getElementById('inv-lng').value = lng ?? '';
  document.getElementById('inv-hospital').dataset.editId = id || '';

  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Inventory loaded for editing', 'success');
}


async function deleteInventory(id) { try { await apiFetch(`${API}/inventory/${id}`, { method: 'DELETE' }); toast('Inventory deleted', 'success'); loadAdminDashboard(); } catch (err) { toast(err.message, 'error'); } }
async function cleanupExpiredInventory(){ try { const data = await apiFetch(`${API}/admin/inventory/expired/cleanup`, { method: 'DELETE' }); toast(`${data.deletedCount} expired items removed`, 'success'); loadAdminDashboard(); } catch (err) { toast(err.message, 'error'); } }

function renderAdminRequests(items) {
  const wrap = document.getElementById('admin-requests-list');
  wrap.innerHTML = items.map(item => `
    <div class="rounded-2xl border p-4">
      <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="text-xl font-black">${item.bloodGroup} • ${item.hospitalName}</div><div class="text-sm text-slate-500">${item.requesterName} • ${item.city} • ${item.urgency}</div><div class="text-sm">Status: <b>${item.status}</b></div></div><div class="flex flex-wrap gap-2"><button onclick="adminUpdateRequest('${item._id}','approved')" class="rounded-2xl border px-4 py-2 font-bold">Approve</button><button onclick="adminUpdateRequest('${item._id}','rejected')" class="rounded-2xl border px-4 py-2 font-bold">Reject</button><button onclick="adminUpdateRequest('${item._id}','completed')" class="rounded-2xl bg-blood-600 px-4 py-2 font-bold text-white">Complete</button></div></div>
    </div>`).join('');
}

async function adminUpdateRequest(id, status) { try { await apiFetch(`${API}/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast(`Request ${status}`, 'success'); loadAdminDashboard(); } catch (err) { toast(err.message, 'error'); } }

function renderAdminUsers(users) {
  const wrap = document.getElementById('admin-users-list');
  wrap.innerHTML = users.map(u => `
    <div class="rounded-2xl border p-4">
      <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="font-black">${u.firstName} ${u.lastName}</div><div class="text-sm text-slate-500">${u.email} • ${u.role} • ${u.city}</div><div class="text-sm">Blocked: ${u.isBlocked ? 'Yes' : 'No'}</div></div><div class="flex gap-2"><button onclick="toggleBlock('${u._id}')" class="rounded-2xl border px-4 py-2 font-bold">${u.isBlocked ? 'Unblock' : 'Block'}</button><button onclick="deleteUser('${u._id}')" class="rounded-2xl bg-red-600 px-4 py-2 font-bold text-white">Delete</button></div></div>
    </div>`).join('');
}

async function toggleBlock(id){ try { await apiFetch(`${API}/admin/users/${id}/block`, { method: 'PATCH' }); toast('User status changed', 'success'); loadAdminDashboard(); } catch (err) { toast(err.message, 'error'); } }
async function deleteUser(id){ try { await apiFetch(`${API}/admin/users/${id}`, { method: 'DELETE' }); toast('User deleted', 'success'); loadAdminDashboard(); } catch (err) { toast(err.message, 'error'); } }

async function loadHomeStats() {
  try {
    const stats = await apiFetch(`${API}/public/summary`);
    document.getElementById('stat-donors').textContent = stats.activeDonors;
    document.getElementById('stat-pending').textContent = stats.pendingRequests;
    document.getElementById('stat-units').textContent = stats.totalUnits;
    document.getElementById('home-alerts').innerHTML = stats.recentRequests.map(r => `<div class=\"rounded-2xl border p-4\"><div class=\"font-bold\">${r.bloodGroup} needed</div><div class=\"text-sm text-slate-500\">${r.hospitalName} • ${r.urgency}</div></div>`).join('') || '<div class=\"rounded-2xl border p-4 text-sm\">No recent alerts.</div>';
  } catch {
    document.getElementById('home-alerts').innerHTML = '<div class="rounded-2xl border p-4 text-sm">Could not load live summary.</div>';
  }
}

async function submitContact() {
  toast('Contact message captured locally. Connect a mail service or CRM for production.', 'success');
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-email').value = '';
  document.getElementById('contact-message').value = '';
}

function bindFeatureCards() {
  document.querySelectorAll('.feature-card').forEach(card => card.addEventListener('click', () => showPage(card.dataset.action)));
}

window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('bb_theme') === 'dark') document.documentElement.classList.add('dark');
  updateAuthButtons();
  bindFeatureCards();
  loadHomeStats();
  filterBloodResults();
  if (currentUser) {
    if (['admin', 'manager'].includes(currentUser.role)) showPage('admin');
    else if (currentUser.role === 'donor') loadDonorDashboard();
  }
});
