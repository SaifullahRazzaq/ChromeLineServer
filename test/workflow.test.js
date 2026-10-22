import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { execFileSync } from 'node:child_process';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/primebody_test';
process.env.JWT_SECRET = 'test-secret';

let server, base;
const tok = {};

const api = async (method, path, { token, body, form } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = (kind) => {
  const f = new FormData();
  f.append('kind', kind);
  f.append('photos', new Blob([PNG], { type: 'image/png' }), 'p.png');
  return f;
};

before(async () => {
  execFileSync('node', ['src/seed.js'], { env: { ...process.env }, stdio: 'ignore' });
  const { createApp } = await import('../src/createApp.js');
  await mongoose.connect(process.env.MONGO_URI);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, email] of [['tech', 'tech@chromeline.test'], ['sara', 'sara@chromeline.test'], ['sup', 'supervisor@chromeline.test'], ['admin', 'admin@chromeline.test']]) {
    const r = await api('POST', '/auth/login', { body: { email, password: 'Password123!' } });
    assert.equal(r.status, 200);
    tok[k] = r.data.token;
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});

test('rejects bad login and unauthenticated access', async () => {
  assert.equal((await api('POST', '/auth/login', { body: { email: 'tech@chromeline.test', password: 'nope' } })).status, 401);
  assert.equal((await api('GET', '/jobs')).status, 401);
});

test('roles: technician is scoped to own jobs and blocked from staff actions', async () => {
  const mine = (await api('GET', '/jobs', { token: tok.tech })).data;
  assert.ok(mine.every((j) => j.technician.name === 'Ali Technician'));
  const all = (await api('GET', '/jobs', { token: tok.sup })).data;
  assert.ok(all.length > mine.length);
  const saraJob = all.find((j) => j.technician.name === 'Sara Technician');
  assert.equal((await api('GET', `/jobs/${saraJob._id}`, { token: tok.tech })).status, 403);
  assert.equal((await api('GET', '/admin/reports/financial', { token: tok.tech })).status, 403);
  assert.equal((await api('GET', '/admin/reports/financial', { token: tok.sup })).status, 403);
  assert.equal((await api('GET', '/admin/reports/financial', { token: tok.admin })).status, 200);
  assert.equal((await api('PUT', '/admin/settings', { token: tok.sup, body: { shiftMinutes: 400 } })).status, 403);
  assert.equal((await api('POST', `/qc/${saraJob._id}/review`, { token: tok.tech, body: { passed: true } })).status, 403);
});

test('full repair → QC fail → rework → pass → sign-off', async () => {
  const jobs = (await api('GET', '/jobs?status=assigned', { token: tok.tech })).data;
  const job = jobs.find((j) => j.orderNo === 'RO-1002');
  const J = `/jobs/${job._id}`;

  assert.equal((await api('POST', `${J}/start`, { token: tok.tech })).status, 400, 'cannot start before accepting');
  assert.equal((await api('POST', `${J}/accept`, { token: tok.tech })).status, 200);
  assert.equal((await api('POST', `${J}/start`, { token: tok.tech })).status, 200);

  // supervisor adds two dependent tasks
  const t1 = (await api('POST', '/tasks', { token: tok.sup, body: { job: job._id, title: 'Fit door shell', estimatedMinutes: 60 } })).data;
  const t2 = (await api('POST', '/tasks', { token: tok.sup, body: { job: job._id, title: 'Colour match', dependencies: [t1._id] } })).data;

  // timers need a shift and respect dependencies
  assert.equal((await api('POST', `/tasks/${t1._id}/start`, { token: tok.tech })).status, 400, 'needs clock-in');
  assert.equal((await api('POST', '/attendance/clock-in', { token: tok.tech })).status, 201);
  assert.equal((await api('POST', `/tasks/${t2._id}/start`, { token: tok.tech })).status, 400, 'dependency blocks');
  assert.equal((await api('POST', `/tasks/${t1._id}/start`, { token: tok.tech })).status, 200);
  assert.equal((await api('POST', `/tasks/${t1._id}/complete`, { token: tok.tech })).status, 200);
  assert.equal((await api('POST', `/tasks/${t2._id}/complete`, { token: tok.tech })).status, 200);

  // cannot finish with unchecked final checklist
  assert.equal((await api('POST', `${J}/complete-work`, { token: tok.tech })).status, 400);
  const detail = (await api('GET', J, { token: tok.tech })).data;
  for (const c of detail.finalChecklist) await api('PATCH', `${J}/checklist/final/${c.key}`, { token: tok.tech, body: { done: true } });
  assert.equal((await api('POST', `${J}/complete-work`, { token: tok.tech })).status, 200);

  // QC submission needs self-check + after photo
  assert.equal((await api('POST', `/qc/${job._id}/submit`, { token: tok.tech })).status, 400);
  for (const c of detail.qc.selfChecklist) await api('PATCH', `${J}/checklist/qc/${c.key}`, { token: tok.tech, body: { done: true } });
  assert.equal((await api('POST', `/qc/${job._id}/submit`, { token: tok.tech })).status, 400, 'no after photo yet');
  assert.equal((await api('POST', `${J}/photos`, { token: tok.tech, form: photo('after') })).status, 201);
  assert.equal((await api('POST', `/qc/${job._id}/submit`, { token: tok.tech })).status, 200);

  // supervisor fails it with rework
  assert.equal((await api('POST', `/qc/${job._id}/review`, { token: tok.sup, body: { passed: false } })).status, 400, 'fail needs feedback');
  const fail = await api('POST', `/qc/${job._id}/review`, { token: tok.sup, body: { passed: false, feedback: 'Orange peel on door', reworkTasks: [{ title: 'Re-polish door' }] } });
  assert.equal(fail.status, 200);
  assert.equal(fail.data.status, 'rework');
  const rw = (await api('GET', `/tasks?job=${job._id}&status=rework`, { token: tok.tech })).data;
  assert.equal(rw.length, 1);

  // technician reworks and resubmits
  assert.equal((await api('POST', `${J}/start`, { token: tok.tech })).status, 200);
  assert.equal((await api('POST', `/tasks/${rw[0]._id}/complete`, { token: tok.tech })).status, 200);
  const d2 = (await api('GET', J, { token: tok.tech })).data;
  for (const c of d2.finalChecklist) await api('PATCH', `${J}/checklist/final/${c.key}`, { token: tok.tech, body: { done: true } });
  assert.equal((await api('POST', `${J}/complete-work`, { token: tok.tech })).status, 200);
  for (const c of d2.qc.selfChecklist) await api('PATCH', `${J}/checklist/qc/${c.key}`, { token: tok.tech, body: { done: true } });
  assert.equal((await api('POST', `/qc/${job._id}/submit`, { token: tok.tech })).status, 400, 'needs fresh after photos');
  await api('POST', `${J}/photos`, { token: tok.tech, form: photo('after') });
  const resub = await api('POST', `/qc/${job._id}/submit`, { token: tok.tech });
  assert.equal(resub.status, 200);
  assert.equal(resub.data.qc.round, 2);

  assert.equal((await api('POST', `/qc/${job._id}/signoff`, { token: tok.sup })).status, 400, 'must pass first');
  assert.equal((await api('POST', `/qc/${job._id}/review`, { token: tok.sup, body: { passed: true } })).data.status, 'qc_passed');
  const so = await api('POST', `/qc/${job._id}/signoff`, { token: tok.sup });
  assert.equal(so.data.status, 'ready_for_delivery');
});

test('dashboard, parts flow, attendance', async () => {
  const d = (await api('GET', '/dashboard', { token: tok.tech })).data;
  assert.ok(d.counters.inProgress >= 1);
  assert.equal(d.hours.clockedIn, true);

  const jobs = (await api('GET', '/jobs', { token: tok.tech })).data;
  const j = jobs.find((x) => x.orderNo === 'RO-1001');
  const parts = (await api('GET', '/parts', { token: tok.tech })).data;
  const bumper = parts.find((p) => p.sku === 'BMP-CIV-F');
  const pr = (await api('POST', '/parts/requests', { token: tok.tech, body: { job: j._id, part: bumper._id, qty: 1 } })).data;
  assert.equal((await api('POST', `/parts/requests/${pr._id}/status`, { token: tok.tech, body: { status: 'issued' } })).status, 403);
  assert.equal((await api('POST', `/parts/requests/${pr._id}/status`, { token: tok.sup, body: { status: 'issued' } })).status, 200);
  const after = (await api('GET', '/parts', { token: tok.tech })).data.find((p) => p.sku === 'BMP-CIV-F');
  assert.equal(after.stock, bumper.stock - 1);

  assert.equal((await api('POST', '/attendance/break/start', { token: tok.tech })).status, 200);
  assert.equal((await api('POST', '/attendance/break/end', { token: tok.tech })).status, 200);
  const out = await api('POST', '/attendance/clock-out', { token: tok.tech });
  assert.equal(out.status, 200);
  assert.ok(out.data.clockOut);
});

test('public contact form validates, stores, and is staff-only to read', async () => {
  const ok = { name: 'Test Customer', email: 'c@example.com', phone: '0300 1234567', service: 'Collision Repair', message: 'Need a quote' };
  assert.equal((await api('POST', '/contact', { body: { ...ok, email: 'nope' } })).status, 400);
  assert.equal((await api('POST', '/contact', { body: { ...ok, message: '' } })).status, 400);
  assert.equal((await api('POST', '/contact', { body: ok })).status, 201);
  assert.equal((await api('GET', '/contact')).status, 401);
  assert.equal((await api('GET', '/contact', { token: tok.tech })).status, 403);
  const list = await api('GET', '/contact', { token: tok.sup });
  assert.equal(list.data.length, 1);
  assert.equal((await api('PATCH', `/contact/${list.data[0]._id}`, { token: tok.sup, body: { status: 'contacted' } })).data.status, 'contacted');
});

test('public tracking needs matching order number and plate, and leaks nothing internal', async () => {
  assert.equal((await api('POST', '/track', { body: { orderNo: 'RO-1001' } })).status, 400);
  assert.equal((await api('POST', '/track', { body: { orderNo: 'RO-1001', plate: 'WRONG-1' } })).status, 404);
  const ok = await api('POST', '/track', { body: { orderNo: 'ro 1001', plate: 'leb2301' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.stages.find((s) => s.state === 'current').id, 'repair');
  assert.ok(!('customer' in ok.data) && !('internalNotes' in ok.data) && !('estimate' in ok.data));
});
