const state = { token: localStorage.getItem('token'), user: JSON.parse(localStorage.getItem('user') || 'null'), page: 'dashboard' };
const authBtns = document.getElementById('authBtns');
const app = document.getElementById('app');
const statusColors = { Jewish: '#16a34a', Jewish_husband_only: '#2563eb', Jewish_wife_only: '#7c3aed', Not_jewish: '#dc2626', Not_sure: '#eab308' };

function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: state.token ? `Bearer ${state.token}` : '', ...(opts.headers || {}) } }).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  });
}

function renderAuth() {
  if (state.user) {
    authBtns.innerHTML = `<span>${state.user.username} (${state.user.role})</span> <button class='btn-dark' id='logout'>Logout</button>`;
    document.getElementById('logout').onclick = () => { localStorage.clear(); location.reload(); };
  } else {
    authBtns.innerHTML = `<button class='btn-primary' id='adminLogin'>Admin Login</button> <button class='btn-dark' id='memberLogin'>Chabura Login</button>`;
    document.getElementById('adminLogin').onclick = showAdminLogin;
    document.getElementById('memberLogin').onclick = showMemberLogin;
  }
}

function showAdminLogin() {
  app.innerHTML = `<div class='card' style='max-width:420px;margin:30px auto'><h3>Admin Google Sign-In</h3><p>Enter your admin email (simulated Google sign-in).</p><input id='email' placeholder='admin@example.com'/><button class='btn-primary' id='go' style='margin-top:8px'>Sign in</button></div>`;
  document.getElementById('go').onclick = async () => {
    try { const data = await api('/api/auth/google-login', { method: 'POST', body: JSON.stringify({ email: email.value }) }); onLogin(data); }
    catch (e) { alert(e.message); }
  };
}

function showMemberLogin() {
  app.innerHTML = `<div class='card' style='max-width:420px;margin:30px auto'><h3>Chabura Login</h3><input id='username' placeholder='username'/><input id='password' type='password' placeholder='password' style='margin-top:8px'/><button class='btn-dark' id='go' style='margin-top:8px'>Login</button><p>Default admin password login: admin/admin123</p></div>`;
  document.getElementById('go').onclick = async () => {
    try { const data = await api('/api/auth/member-login', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) }); onLogin(data); }
    catch (e) { alert(e.message); }
  };
}

function onLogin(data) {
  state.token = data.token; state.user = data.user;
  localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user));
  renderApp();
}

function sidebar() {
  const sections = ['dashboard', 'canvass', 'import', 'manage'];
  if (state.user?.role === 'admin') sections.push('admin');
  return `<div class='sidebar'>${sections.map(s => `<a href='#' data-page='${s}' class='${state.page === s ? 'active' : ''}'>${s[0].toUpperCase() + s.slice(1)}</a>`).join('')}</div>`;
}

async function renderDashboard() {
  const d = await api('/api/dashboard');
  return `<h2>Dashboard</h2><div class='cards'>
    <div class='card'><h4>Total Addresses</h4><a href='#' data-nav='manage'>${d.addresses}</a></div>
    <div class='card'><h4>Total Routes</h4><a href='#' data-nav='canvass'>${d.routes}</a></div>
    <div class='card'><h4>Active Campaigns</h4><a href='#' data-nav='manage'>${d.activeCampaigns}</a></div>
    <div class='card'><h4>Total Interactions</h4><a href='#' data-nav='canvass'>${d.interactions}</a></div>
  </div>${Object.values(d).every(v => v === 0) ? `<p>No data available yet. Charts will appear when data exists.</p>` : ''}`;
}

async function renderCanvass() {
  const routes = await api('/api/routes');
  const interactions = await api('/api/interactions');
  return `<h2>Canvass</h2>${!routes.length ? `<p>No routes assigned yet. When an admin assigns you to a route it will appear here.</p>` : ''}
    ${routes.map(r => `<div class='card'><h4>${r.route_name} (${r.route_type})</h4><p>${r.notes || ''}</p></div>`).join('')}
    <div class='card'><h3>Submit Duch Report</h3><div class='form-grid'><input id='iAddress' placeholder='Address ID'/><input id='iCampaign' placeholder='Campaign ID'/><input id='iOutcome' placeholder='Visit outcome'/><input id='iFollow' placeholder='Follow-up? yes/no'/></div><textarea id='iNotes' placeholder='Notes'></textarea><button class='btn-primary' id='submitDuch'>Submit report</button></div>
    <div class='table-wrap'><h3>Your Reports</h3><table><tr><th>ID</th><th>Address</th><th>Result</th><th>Notes</th></tr>${interactions.map(i=>`<tr><td>${i.id}</td><td>${i.address_id}</td><td>${i.visit_result}</td><td>${i.notes}</td></tr>`).join('')}</table></div>`;
}

function addrBadge(v) { return `<span class='badge' style='background:${statusColors[v] || '#64748b'}'>${v || 'N/A'}</span>`; }

async function renderManage() {
  const [addresses, contacts, routes, campaigns] = await Promise.all([api('/api/addresses'), api('/api/contacts'), api('/api/routes'), api('/api/campaigns')]);
  return `<h2>Manage</h2>
  ${state.user.role !== 'admin' ? '<p>Read-only view for members.</p>' : `
  <div class='card'><h3>Add Address (Autocomplete-ready)</h3><div class='form-grid'><input id='street_address' placeholder='Street address'/><input id='city' placeholder='City'/><input id='state' placeholder='State'/><input id='zip' placeholder='Zip'/><select id='jewish_status'><option>Jewish</option><option>Jewish_husband_only</option><option>Jewish_wife_only</option><option>Not_jewish</option><option selected>Not_sure</option></select><input id='age_range' placeholder='Age range'/></div><button id='addAddress' class='btn-primary'>Save Address</button></div>
  <div class='card'><h3>Bulk Address Creation</h3><div class='form-grid'><input id='bulkStreet' placeholder='Street e.g. Eastern Parkway'/><input id='bulkCity' placeholder='City'/><input id='bulkState' placeholder='State'/><input id='bulkZip' placeholder='Zip'/><input id='bulkNumbers' placeholder='Numbers e.g. 748,750,752'/></div><button class='btn-primary' id='bulkCreate'>Generate Addresses</button></div>
  <div class='card'><h3>Create Contact</h3><div class='form-grid'><input id='cFirst' placeholder='First'/><input id='cLast' placeholder='Last'/><input id='cEmail' placeholder='Email'/><input id='cPhone' placeholder='Phone'/><input id='cAddress' placeholder='Address ID'/></div><textarea id='cNotes' placeholder='Notes'></textarea><button class='btn-primary' id='addContact'>Save Contact</button></div>
  <div class='card'><h3>Create Campaign</h3><div class='form-grid'><input id='cmpName' placeholder='Campaign name'/><input id='cmpType' placeholder='Campaign type'/><input id='cmpYear' placeholder='Year'/><input id='cmpJewishYear' placeholder='Jewish year'/><select id='cmpStatus'><option>Active</option><option>Completed</option><option>Planning</option></select></div><button class='btn-primary' id='addCampaign'>Save Campaign</button></div>
  <div class='card'><h3>Route Optimizer (3 Steps)</h3><p>Step 1: Select audience filters · Step 2: choose walking/driving counts · Step 3: create optimized routes.</p><div class='form-grid'><input id='fCity' placeholder='City filter'/><input id='fState' placeholder='State filter'/><input id='fZip' placeholder='Zip filter'/><select id='fStatus'><option value=''>Any status</option><option>Jewish</option><option>Jewish_husband_only</option><option>Jewish_wife_only</option><option>Not_jewish</option><option>Not_sure</option></select><input id='walkCount' placeholder='Walking routes'/><input id='driveCount' placeholder='Driving routes'/></div><button id='optimizeRoutes' class='btn-primary'>Create Routes</button></div>`}
  <div class='card'><h3>Address Map View</h3><button id='toggleMap'>Show/Hide Map</button><div id='mapPanel' class='map-panel hidden'>
  <p>Google Maps panel ready. Add your Google Maps JS key to enable advanced map + Places Autocomplete. Current filtered addresses: ${addresses.length}</p>
  <iframe style='width:100%;height:240px;border:0' loading='lazy' referrerpolicy='no-referrer-when-downgrade' src='https://maps.google.com/maps?q=${encodeURIComponent(addresses[0]?.street_address || 'Brooklyn, NY')}&z=12&output=embed'></iframe></div></div>
  <div class='card'><h3>Address Column Selection</h3>${['address','city','state','zip','route','contact name','email','phone','age range','jewish status'].map(c=>`<label><input type='checkbox' checked disabled/>${c}</label>`).join(' ')}</div>
  <div class='table-wrap'><table><tr><th>Address</th><th>City</th><th>State</th><th>Zip</th><th>Route</th><th>Contact</th><th>Email</th><th>Phone</th><th>Age</th><th>Status</th></tr>
  ${addresses.map(a=>`<tr><td>${a.street_address}</td><td>${a.city||''}</td><td>${a.state||''}</td><td>${a.zip||''}</td><td>${a.route_name||''}</td><td>${a.contact_name||''}</td><td>${a.email||''}</td><td>${a.phone||''}</td><td>${a.age_range||''}</td><td>${addrBadge(a.jewish_status)}</td></tr>`).join('')}</table></div>
  <div class='table-wrap'><h3>Contacts</h3><table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Notes</th></tr>${contacts.map(c=>`<tr><td>${c.first_name||''} ${c.last_name||''}</td><td>${c.email||''}</td><td>${c.phone||''}</td><td>${c.street_address||''}</td><td>${c.notes||''}</td></tr>`).join('')}</table></div>
  <div class='table-wrap'><h3>Campaigns</h3><table><tr><th>Name</th><th>Type</th><th>Year</th><th>Jewish Year</th><th>Status</th></tr>${campaigns.map(c=>`<tr><td>${c.campaign_name}</td><td>${c.campaign_type||''}</td><td>${c.year||''}</td><td>${c.jewish_year||''}</td><td>${c.status||''}</td></tr>`).join('')}</table></div>`;
}

async function renderImport() {
  return `<h2>Import CSV</h2><div class='card'><p>Step 1 Upload CSV · Step 2 Preview map · Step 3 Confirm import</p><textarea id='csvText' rows='10' placeholder='street_address,city,state,zip,route\n770 Eastern Pkwy,Brooklyn,NY,11213,Route 1'></textarea><button class='btn-primary' id='doImport'>Confirm Import</button><pre id='importResult'></pre></div>`;
}

async function renderAdmin() {
  const [users, logs, keys, routes] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit-logs'), api('/api/admin/api-keys'), api('/api/routes')]);
  return `<h2>Admin</h2><div class='card'><h3>Create Chabura Login Account</h3><div class='form-grid'><input id='uName' placeholder='username or admin email'/><input id='uPass' placeholder='password (for member login)'/><select id='uRole'><option value='member'>member</option><option value='admin'>admin</option></select><input id='uRoutes' placeholder='assigned route ids comma-separated'/></div><button class='btn-primary' id='createUser'>Create Account</button></div>
  <div class='card'><h3>API Key Management</h3><input id='apiKeyName' placeholder='Key name'/><button id='createApiKey' class='btn-dark'>Generate API Key</button><ul>${keys.map(k=>`<li>${k.name}: ${k.api_key}</li>`).join('')}</ul></div>
  <div class='table-wrap'><h3>Users</h3><table><tr><th>Username</th><th>Role</th><th>Assigned Routes</th></tr>${users.map(u=>`<tr><td>${u.username}</td><td>${u.role}</td><td>${u.assigned_routes}</td></tr>`).join('')}</table></div>
  <div class='table-wrap'><h3>Audit Log</h3><table><tr><th>Action</th><th>Details</th><th>At</th></tr>${logs.map(l=>`<tr><td>${l.action}</td><td>${l.details||''}</td><td>${l.created_at}</td></tr>`).join('')}</table></div>
  <div class='card'><h3>System Settings</h3><p>Internal-only mode enabled. Self-registration disabled. All pages require authentication.</p><p>Existing routes: ${routes.length}</p></div>`;
}

async function renderApp() {
  renderAuth();
  if (!state.user) return;
  const pageRenderer = { dashboard: renderDashboard, canvass: renderCanvass, manage: renderManage, import: renderImport, admin: renderAdmin }[state.page];
  app.innerHTML = `<div class='layout'>${sidebar()}<div class='content'>Loading...</div></div>`;
  try {
    document.querySelector('.content').innerHTML = await pageRenderer();
  } catch (e) { document.querySelector('.content').innerHTML = `<div class='card'>${e.message}</div>`; }

  document.querySelectorAll('[data-page]').forEach(el => el.onclick = (ev) => { ev.preventDefault(); state.page = el.dataset.page; renderApp(); });
  document.querySelectorAll('[data-nav]').forEach(el => el.onclick = (ev) => { ev.preventDefault(); state.page = el.dataset.nav; renderApp(); });

  document.getElementById('submitDuch')?.addEventListener('click', async () => {
    await api('/api/interactions', { method: 'POST', body: JSON.stringify({ address_id: Number(iAddress.value), campaign_id: Number(iCampaign.value) || null, visit_result: iOutcome.value, notes: iNotes.value, follow_up: /yes/i.test(iFollow.value) }) });
    renderApp();
  });
  document.getElementById('toggleMap')?.addEventListener('click', () => mapPanel.classList.toggle('hidden'));
  document.getElementById('addAddress')?.addEventListener('click', async () => {
    await api('/api/addresses', { method: 'POST', body: JSON.stringify({ street_address: street_address.value, city: city.value, state: state.value, zip: zip.value, jewish_status: jewish_status.value, age_range: age_range.value }) });
    renderApp();
  });
  document.getElementById('bulkCreate')?.addEventListener('click', async () => {
    await api('/api/addresses/bulk', { method: 'POST', body: JSON.stringify({ street: bulkStreet.value, city: bulkCity.value, state: bulkState.value, zip: bulkZip.value, numbers: bulkNumbers.value.split(',').map(v => v.trim()).filter(Boolean) }) });
    renderApp();
  });
  document.getElementById('addContact')?.addEventListener('click', async () => {
    await api('/api/contacts', { method: 'POST', body: JSON.stringify({ first_name: cFirst.value, last_name: cLast.value, email: cEmail.value, phone: cPhone.value, address_id: Number(cAddress.value), notes: cNotes.value }) });
    renderApp();
  });
  document.getElementById('addCampaign')?.addEventListener('click', async () => {
    await api('/api/campaigns', { method: 'POST', body: JSON.stringify({ campaign_name: cmpName.value, campaign_type: cmpType.value, year: Number(cmpYear.value), jewish_year: cmpJewishYear.value, status: cmpStatus.value }) });
    renderApp();
  });
  document.getElementById('optimizeRoutes')?.addEventListener('click', async () => {
    await api('/api/routes/optimize', { method: 'POST', body: JSON.stringify({ filters: { city: fCity.value, state: fState.value, zip: fZip.value, jewish_status: fStatus.value }, walkingRoutes: Number(walkCount.value), drivingRoutes: Number(driveCount.value) }) });
    alert('Routes optimized and created.'); renderApp();
  });
  document.getElementById('doImport')?.addEventListener('click', async () => {
    const result = await api('/api/import/csv', { method: 'POST', body: JSON.stringify({ csvText: csvText.value }) });
    importResult.textContent = JSON.stringify(result, null, 2);
  });
  document.getElementById('createUser')?.addEventListener('click', async () => {
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username: uName.value, password: uPass.value || null, role: uRole.value, assigned_routes: uRoutes.value ? uRoutes.value.split(',').map(v => Number(v.trim())) : [] }) });
    renderApp();
  });
  document.getElementById('createApiKey')?.addEventListener('click', async () => {
    const key = await api('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name: apiKeyName.value }) });
    alert(`Generated key: ${key.key}`); renderApp();
  });
}

renderAuth();
if (state.user) renderApp();
