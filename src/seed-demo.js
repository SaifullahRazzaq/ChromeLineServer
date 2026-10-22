// Large, realistic, repeatable demo dataset. WIPES the target database first.
//   npm run seed:demo                      -> uses MONGO_URI from .env
//   MONGO_URI=... npm run seed:demo        -> any other database
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Job from './models/Job.js';
import Task from './models/Task.js';
import { Part, PartRequest, StockMovement } from './models/Part.js';
import { Notification, Message } from './models/Comms.js';
import { Attendance, LeaveRequest } from './models/Attendance.js';
import Inquiry from './models/Inquiry.js';
import { INSPECTION_CHECKLIST, workflowFor, FINAL_CHECKLIST, QC_SELF_CHECKLIST } from './services/checklists.js';

// ---------- deterministic randomness so every run produces the same story ----------
let seed = 20261022;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (arr) => arr.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const wpick = (pairs) => { const total = pairs.reduce((s, [, w]) => s + w, 0); let r = rnd() * total; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };

const NOW = Date.now();
const H = 36e5;
const D = 864e5;
const ago = (ms) => new Date(NOW - ms);
const ahead = (ms) => new Date(NOW + ms);
const dayKey = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primebody');
const db = mongoose.connection.name;
await Promise.all([User, Job, Task, Part, PartRequest, StockMovement, Notification, Message, Attendance, LeaveRequest, Inquiry].map((m) => m.deleteMany({})));

// ---------- people ----------
const pw = await bcrypt.hash('Password123!', 10);
const TECHS = [
  ['Ali Technician', 'tech', 'Body & paint', ['Dent removal', 'Painting', 'Colour matching']],
  ['Sara Technician', 'sara', 'Mechanical', ['Engine', 'Suspension', 'Diagnostics']],
  ['Bilal Ahmed', 'bilal', 'Dent removal', ['Dent removal', 'Panel beating']],
  ['Hina Malik', 'hina', 'Painting', ['Spray painting', 'Colour matching', 'Polishing']],
  ['Usman Tariq', 'usman', 'Frame & structural', ['Frame straightening', 'Welding']],
  ['Zainab Noor', 'zainab', 'Electrical', ['Wiring', 'Sensors', 'Lighting']],
  ['Hamza Iqbal', 'hamza', 'Body & paint', ['Bumper repair', 'Painting']],
  ['Ayesha Farooq', 'ayesha', 'Detailing', ['Polishing', 'Ceramic coating']],
  ['Daniyal Shah', 'daniyal', 'Mechanical', ['Brakes', 'Cooling system']],
  ['Maryam Aslam', 'maryam', 'Painting', ['Paint prep', 'Spray painting']],
  ['Omar Sheikh', 'omar', 'Body & paint', ['Panel beating', 'Reassembly']],
  ['Fatima Zahid', 'fatima', 'Parts & fitting', ['Parts replacement', 'Reassembly']],
];
const staffDocs = [
  { name: 'Ayesha Admin', email: 'admin@chromeline.test', role: 'admin', phone: '0300-9000001' },
  { name: 'Sam Supervisor', email: 'supervisor@chromeline.test', role: 'supervisor', phone: '0300-9000002', specialty: 'Workshop supervisor' },
  { name: 'Rabia Khan', email: 'rabia@chromeline.test', role: 'supervisor', phone: '0300-9000003', specialty: 'Quality inspector', permissions: { approveQC: true, viewFinancials: true, manageTechnicians: false } },
  { name: 'Imran Qureshi', email: 'imran@chromeline.test', role: 'supervisor', phone: '0300-9000004', specialty: 'Paint shop lead' },
];
const users = await User.create([
  ...staffDocs.map((u) => ({ ...u, passwordHash: pw, joinedAt: new Date('2022-01-10') })),
  ...TECHS.map(([name, handle, specialty, skills], i) => ({
    name, email: `${handle}@chromeline.test`, role: 'technician', specialty, skills, employeeId: `TECH-${String(i + 1).padStart(3, '0')}`,
    phone: `0300-10000${String(i + 10)}`, address: `${int(10, 99)} ${pick(['Gulberg', 'DHA Phase 5', 'Johar Town', 'Model Town', 'Cantt', 'Bahria Town'])}, Lahore`,
    emergencyContact: { name: pick(['Parent', 'Spouse', 'Brother', 'Sister']), phone: `0321-20000${int(10, 99)}` },
    joinedAt: ago(int(120, 1400) * D), passwordHash: pw,
  })),
]);
const admin = users[0];
const sups = users.slice(1, 4);
const techs = users.slice(4);
const sup = sups[0];
const staffIds = [admin, ...sups].map((u) => u._id);

// ---------- inventory ----------
const PART_CATALOG = [];
const cars = [['Honda', ['Civic', 'City', 'Accord']], ['Toyota', ['Corolla', 'Camry', 'Yaris']], ['Suzuki', ['Swift', 'Cultus']], ['Kia', ['Sportage', 'Picanto']], ['Hyundai', ['Tucson', 'Elantra']], ['Nissan', ['Kicks']], ['Mazda', ['CX-5']]];
const bodyParts = [['Front bumper cover', 'body', 150, 320], ['Rear bumper cover', 'body', 140, 300], ['Headlight LH', 'lighting', 120, 380], ['Headlight RH', 'lighting', 120, 380], ['Side mirror LH', 'body', 60, 160], ['Front fender RH', 'body', 110, 260], ['Bonnet', 'body', 200, 480]];
for (const [make, models] of cars) for (const model of models) for (const [bp, cat, lo, hi] of shuffle(bodyParts)) PART_CATALOG.push({ name: `${bp} — ${model}`, category: cat, unitCost: int(lo, hi), supplier: pick(['AutoParts Co', 'LightHouse Spares', 'Prime Imports', 'Metro Auto Spares']), sku: `${make.slice(0, 3).toUpperCase()}-${model.slice(0, 3).toUpperCase()}-${bp.split(' ').map((w) => w[0]).join('')}-${int(10, 99)}` });
const consumables = [['2K clear coat 5L', 'paint', 95], ['Base coat — pearl white 1L', 'paint', 70], ['Base coat — silver metallic 1L', 'paint', 70], ['Primer surfacer 4L', 'paint', 55], ['Body filler 1kg', 'consumable', 14], ['Fibreglass filler 1kg', 'consumable', 18], ['Masking tape 48mm', 'consumable', 4], ['Sanding discs P80 (50)', 'consumable', 22], ['Sanding discs P240 (50)', 'consumable', 22], ['Polishing compound 1L', 'consumable', 28], ['Trim clip kit', 'hardware', 22], ['Body panel adhesive', 'consumable', 26], ['Seam sealer 310ml', 'consumable', 12], ['Windscreen urethane', 'glass', 24], ['Brake pad set front', 'mechanical', 45], ['Brake disc pair', 'mechanical', 110], ['Radiator hose', 'mechanical', 30], ['Coolant 5L', 'mechanical', 20], ['Engine mount', 'mechanical', 85], ['Control arm bush kit', 'mechanical', 40], ['Wiper blade set', 'general', 15], ['Fog lamp LH', 'lighting', 55], ['Parking sensor kit', 'electrical', 75], ['Wiring harness repair kit', 'electrical', 48], ['ABS wheel speed sensor', 'electrical', 52]];
consumables.forEach(([name, category, unitCost], i) => PART_CATALOG.push({ name, category, unitCost, supplier: pick(['ColourPro', 'AutoParts Co', 'Metro Auto Spares']), sku: `CON-${String(i + 1).padStart(3, '0')}` }));
const catalog = PART_CATALOG.slice(0, 105);
const seenSku = new Set();
for (const p of catalog) { while (seenSku.has(p.sku)) p.sku += 'X'; seenSku.add(p.sku); }
const bodyish = new Set(['body', 'lighting']);
const partDocs = catalog.map((p, i) => ({
  ...p, location: `${pick(['A', 'B', 'C', 'P'])}${int(1, 9)}`, reorderLevel: bodyish.has(p.category) ? int(1, 2) : int(4, 12), stock: 0, reserved: 0,
  description: '', active: i % 40 !== 39, _plan: { low: i % 8 === 0, out: i % 21 === 0 },
}));
const parts = await Part.create(partDocs.map(({ _plan, ...p }) => p));
const partPlan = new Map(parts.map((p, i) => [String(p._id), partDocs[i]._plan]));
const activeParts = parts.filter((p) => p.active);

// ---------- jobs ----------
const MAKES = [['Honda', ['Civic', 'City', 'Accord', 'CR-V', 'BR-V']], ['Toyota', ['Corolla', 'Camry', 'Yaris', 'Fortuner', 'Hilux']], ['Suzuki', ['Swift', 'Cultus', 'Alto', 'Wagon R']], ['Kia', ['Sportage', 'Picanto', 'Stonic']], ['Hyundai', ['Tucson', 'Elantra', 'Sonata']], ['Nissan', ['Kicks', 'Sunny']], ['Mazda', ['Mazda3', 'CX-5']], ['BMW', ['320i', 'X1']], ['Mercedes-Benz', ['C200', 'A180']], ['MG', ['HS', 'ZS']]];
const COLORS = ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Pearl white', 'Maroon', 'Green', 'Bronze'];
const FIRST = ['Hassan', 'Maria', 'Bilal', 'Zainab', 'Omar', 'Fatima', 'Ahmed', 'Sana', 'Kamran', 'Ayesha', 'Faisal', 'Nadia', 'Tariq', 'Hira', 'Salman', 'Mehwish', 'Junaid', 'Iqra', 'Asad', 'Rida', 'Waqar', 'Saima', 'Danish', 'Laiba', 'Rehan', 'Amna', 'Shahid', 'Komal', 'Adeel', 'Bushra'];
const LAST = ['Raza', 'Khan', 'Ahmed', 'Tariq', 'Sheikh', 'Noor', 'Malik', 'Butt', 'Chaudhry', 'Qureshi', 'Siddiqui', 'Hussain', 'Iqbal', 'Mirza', 'Aslam', 'Farooq', 'Javed', 'Rauf'];
const INSURERS = ['SafeGuard Insurance', 'ShieldCo', 'Unity Assurance', 'Pak Motor Cover', 'Allied Auto Insurance'];
const COMBOS = [
  [['bumper', 'paint_prep', 'painting'], 'Front bumper cracked and paint damaged after a low-speed impact.', 'Repair or replace the bumper cover, prep and refinish to match.'],
  [['dent_removal', 'paint_prep', 'painting'], 'Multiple dents on doors and quarter panel from a parking collision.', 'Pull dents, prep and respray affected panels, blend into neighbours.'],
  [['body_panel', 'paint_prep', 'color_matching', 'painting'], 'Side-swipe damage along both doors with deep scratches.', 'Straighten panels, colour match to paint code and refinish.'],
  [['frame', 'body_panel', 'painting', 'reassembly'], 'Front-end collision with structural deformation and crushed bonnet.', 'Measure and pull frame to spec, replace panels, refinish and reassemble.'],
  [['parts_replacement', 'reassembly'], 'Headlight and grille broken after minor front impact.', 'Replace damaged lighting and grille, refit trim and sensors.'],
  [['mechanical'], 'Vehicle pulling to one side after kerb impact; suspension suspected.', 'Diagnose steering and suspension, repair or replace worn components.'],
  [['mechanical', 'reassembly'], 'Radiator and cooling hoses damaged in frontal collision.', 'Replace radiator and hoses, refill coolant and pressure test.'],
  [['dent_removal'], 'Hail damage across bonnet and roof.', 'Paintless dent removal where possible; report any panel needing paint.'],
  [['bumper', 'color_matching', 'painting', 'reassembly'], 'Rear bumper smashed in a reversing accident.', 'Replace rear bumper, match colour and refit parking sensors.'],
  [['paint_prep', 'painting'], 'Faded clear coat and surface rust spots on the bonnet.', 'Strip affected area, treat rust, prime and refinish.'],
];
const PANELS = ['front bumper', 'rear bumper', 'RH fender', 'LH fender', 'bonnet', 'LH front door', 'RH rear door', 'boot lid', 'roof panel', 'LH quarter panel'];
const TASK_TITLE = {
  body_panel: (p) => `Repair and shape ${p}`, dent_removal: (p) => `Pull dents on ${p}`, bumper: () => 'Remove, repair/replace bumper', frame: () => 'Frame measuring and straightening',
  paint_prep: (p) => `Sand, prime and mask ${p}`, color_matching: () => 'Colour match to paint code', painting: (p) => `Paint and clear coat ${p}`,
  parts_replacement: () => 'Fit replacement parts', mechanical: () => 'Diagnose and repair mechanical fault', reassembly: () => 'Reassemble trim, lights and sensors',
};
const TASK_MINS = { body_panel: 150, dent_removal: 120, bumper: 90, frame: 300, paint_prep: 90, color_matching: 45, painting: 150, parts_replacement: 100, mechanical: 180, reassembly: 75 };
const IMG = {
  before: ['/images/crash-silver.jpg', '/images/crash-vw.jpg', '/images/crash-red.jpg', '/images/crash-white.jpg', '/images/crash-frontal.jpg', '/images/dent-blue.jpg'],
  progress: ['/images/hero-sanding.jpg', '/images/paint-booth.jpg', '/images/paint-orange.jpg', '/images/shop-floor.jpg'],
  after: ['/images/sports-red.jpg', '/images/polish-blue.jpg', '/images/polish-dark.jpg'],
};

const STATUS_PLAN = [
  ['assigned', 12], ['accepted', 10], ['in_progress', 22], ['paused', 6], ['awaiting_parts', 6],
  ['ready_for_qc', 12], ['rework', 7], ['qc_passed', 8], ['ready_for_delivery', 42],
];
const statuses = shuffle(STATUS_PLAN.flatMap(([s, n]) => Array(n).fill(s)));
const TOTAL = statuses.length; // 125

const usedPlates = new Set();
const plate = () => { let p; do { p = `${pick(['LEB', 'LXZ', 'ABC', 'MNP', 'RST', 'KLM', 'BDE', 'AHR'])}-${int(10, 99)}${pick(['', int(0, 9)])}`; } while (usedPlates.has(p)); usedPlates.add(p); return p; };
const vin = () => Array.from({ length: 17 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'[int(0, 32)]).join('');
const techWeights = techs.map((t, i) => [t, i === 0 ? 5 : i === 1 ? 4 : 2]);

const jobDocs = [];
const taskDocs = [];
const reqDocs = [];
const notifDocs = [];
const moveEvents = []; // per part
const jobMeta = [];

for (let i = 0; i < TOTAL; i++) {
  const status = statuses[i];
  const tech = wpick(techWeights);
  const [types, damage, instr] = pick(COMBOS);
  const [make, models] = pick(MAKES);
  const done = ['ready_for_qc', 'qc_passed', 'ready_for_delivery'].includes(status);
  const delivered = status === 'ready_for_delivery';
  const started = !['assigned', 'accepted'].includes(status);
  const createdAt = delivered ? ago(int(8, 85) * D) : ago(int(0, 9) * D + int(1, 20) * H);
  const startedAt = started ? new Date(createdAt.getTime() + int(2, 30) * H) : undefined;
  const completedAt = done ? new Date((startedAt?.getTime() ?? createdAt.getTime()) + int(20, 90) * H) : undefined;
  const reviewedAt = ['qc_passed', 'ready_for_delivery'].includes(status) ? new Date(completedAt.getTime() + int(1, 20) * H) : undefined;
  const priority = wpick([['urgent', 1], ['high', 3], ['normal', 7], ['low', 2]]);
  let deadline;
  if (delivered) deadline = new Date(completedAt.getTime() + (chance(0.85) ? int(2, 48) : -int(1, 24)) * H);
  else if (done) deadline = ahead(int(-6, 60) * H);
  else if (i % 11 === 0) deadline = ago(int(2, 70) * H); // a few genuinely overdue
  else if (i % 5 === 0) deadline = ahead(int(1, 14) * H); // due today
  else deadline = ahead(int(15, 160) * H);
  const orderNo = `RO-${1001 + i}`;
  const jobId = new mongoose.Types.ObjectId();
  const approved = !(status === 'assigned' && chance(0.3));
  const insured = chance(0.55);
  const amount = int(30, 480) * 10 + (types.includes('frame') ? 2500 : 0);

  // tasks
  const panel = pick(PANELS);
  const tasks = types.map((type, k) => ({ type, title: TASK_TITLE[type](pick([panel, pick(PANELS)])), est: Math.round(TASK_MINS[type] * (0.8 + rnd() * 0.5) / 5) * 5, k }));
  const nDone = done ? tasks.length : status === 'in_progress' || status === 'paused' || status === 'awaiting_parts' || status === 'rework' ? int(0, tasks.length - 1) : 0;
  const reworkIdx = status === 'rework' ? new Set([tasks.length - 1]) : new Set();
  const taskIds = tasks.map(() => new mongoose.Types.ObjectId());
  let progressSum = 0;
  tasks.forEach((t, k) => {
    let st = 'todo';
    let pct = 0;
    const entries = [];
    if (k < nDone && !reworkIdx.has(k)) {
      st = 'completed'; pct = 100;
      const s = new Date((startedAt?.getTime() ?? createdAt.getTime()) + (k * 3 + int(0, 2)) * H);
      const dur = Math.round(t.est * (0.7 + rnd() * 0.7)) * 60000;
      entries.push({ start: s, end: new Date(s.getTime() + dur), user: tech._id });
      if (chance(0.3)) entries.push({ start: new Date(s.getTime() + dur + 40 * 60000), end: new Date(s.getTime() + dur + 40 * 60000 + 15 * 60000), user: tech._id });
    } else if (reworkIdx.has(k)) {
      st = 'rework'; pct = 50;
      entries.push({ start: ago(int(30, 600) * 60000), end: ago(int(5, 29) * 60000), user: tech._id });
    } else if (started && k === nDone) {
      if (status === 'in_progress' && i % 7 === 0) { st = 'paused'; pct = int(20, 70); entries.push({ start: ago(int(100, 300) * 60000), end: ago(int(20, 90) * 60000), user: tech._id }); }
      else if (status === 'awaiting_parts' || status === 'paused') { st = 'blocked'; pct = int(10, 60); }
      else if (status === 'in_progress') { st = 'paused'; pct = int(10, 60); entries.push({ start: ago(int(100, 300) * 60000), end: ago(int(20, 90) * 60000), user: tech._id }); }
    }
    progressSum += pct;
    taskDocs.push({
      _id: taskIds[k], job: jobId, title: t.title, repairType: t.type, instructions: k === 0 ? instr : '', priority, assignee: tech._id,
      dependencies: k > 0 && chance(0.6) ? [taskIds[k - 1]] : [], estimatedMinutes: t.est, status: st, completionPct: pct, timeEntries: entries,
      blocked: st === 'blocked' ? { reason: status === 'awaiting_parts' ? 'Waiting for part to arrive' : 'Waiting on supervisor decision', at: ago(int(1, 20) * H), by: tech._id } : undefined,
      dueAt: deadline, completedAt: st === 'completed' ? entries.at(-1).end : undefined,
      reassignRequest: st === 'blocked' && chance(0.2) ? { reason: 'Specialist needed for this panel', requestedBy: tech._id, at: ago(int(1, 10) * H), status: 'pending' } : undefined,
      review: st === 'completed' && delivered && chance(0.25) ? { by: sup._id, approved: true, note: 'Good work', at: completedAt } : undefined,
      createdAt, updatedAt: new Date(), reworkOf: undefined,
    });
  });
  const progress = done ? 100 : Math.round(progressSum / tasks.length);

  // photos
  const photos = [];
  const addPhotos = (kind, pool, n, at) => { for (let k = 0; k < n; k++) photos.push({ kind, url: pick(pool), caption: kind === 'before' ? 'Check-in' : kind === 'after' ? 'Finished repair' : 'Work in progress', uploadedBy: tech._id, at: new Date(at.getTime() + k * 60000), annotations: kind === 'before' && chance(0.4) ? [{ x: int(20, 80), y: int(20, 80), text: 'Damage here' }] : [] }); };
  addPhotos('before', IMG.before, int(1, 3), createdAt);
  if (started) { addPhotos('damage', IMG.before, int(1, 2), startedAt); if (chance(0.7)) addPhotos('progress', IMG.progress, int(1, 3), new Date(startedAt.getTime() + 6 * H)); }
  if (done) addPhotos('after', IMG.after, int(1, 3), completedAt);

  // history
  const history = [{ type: 'created', text: 'Repair order created', by: sup._id, at: createdAt }];
  const ev = (type, text, at, by = tech._id) => history.push({ type, text, at, by });
  if (status !== 'assigned') ev('accepted', 'Job accepted', new Date(createdAt.getTime() + int(1, 3) * H));
  if (started) { ev('started', 'Repair started', startedAt); ev('photos', 'Progress photos uploaded', new Date(startedAt.getTime() + 5 * H)); }
  if (status === 'paused') ev('paused', 'Paused: waiting for customer decision', ago(int(1, 20) * H));
  if (status === 'awaiting_parts') ev('paused', 'Paused: waiting for parts', ago(int(1, 20) * H));
  if (done) { ev('work_completed', 'Assigned work completed', completedAt); ev('qc_submitted', 'Submitted for QC', new Date(completedAt.getTime() + 20 * 60000)); }
  if (status === 'rework') { ev('qc_failed', 'QC failed: paint finish needs polishing', ago(int(2, 30) * H), sup._id); ev('started', 'Rework started', ago(int(1, 5) * H)); }
  if (reviewedAt) ev('qc_passed', 'QC passed', reviewedAt, sup._id);
  if (delivered) ev('signed_off', 'Final repair sign-off — ready for delivery', new Date(reviewedAt.getTime() + 2 * H), sup._id);

  // checklists
  const inspectionDone = started || chance(0.4);
  const inspection = {
    completed: inspectionDone, completedAt: inspectionDone ? new Date(createdAt.getTime() + 3 * H) : undefined,
    notes: inspectionDone ? `${damage} Customer reports no other issues. Existing minor scratches noted on ${pick(PANELS)}.` : '',
    checklist: INSPECTION_CHECKLIST().map((c) => ({ ...c, done: inspectionDone, by: inspectionDone ? tech._id : undefined })),
    damageMarkers: Array.from({ length: int(1, 4) }, () => ({ view: pick(['front', 'rear', 'left', 'right', 'top']), x: int(15, 85), y: int(25, 75), severity: pick(['minor', 'moderate', 'severe']), note: pick(['Dent', 'Scratch', 'Crack', 'Paint chip', 'Crushed panel']), existing: chance(0.2) })),
    equipmentIssues: chance(0.08) ? [{ description: 'Spray gun nozzle clogged, replaced', by: tech._id, at: ago(int(1, 30) * H) }] : [],
  };
  const workflows = workflowFor(types).map((w) => ({ ...w, steps: w.steps.map((s, idx) => ({ ...s, done: done || (started && idx < Math.round((progress / 100) * w.steps.length)) })) }));

  const supplements = chance(0.18) ? [{ amount: int(5, 40) * 10, reason: pick(['Hidden damage behind bumper', 'Additional panel needs replacement', 'Sensor bracket also broken']), status: pick(['requested', 'approved', 'approved', 'rejected']), requestedBy: tech._id, at: ago(int(1, 40) * H) }] : [];
  const customerName = `${pick(FIRST)} ${pick(LAST)}`;
  const model = pick(models);
  jobDocs.push({
    _id: jobId, orderNo,
    customer: { name: customerName, phone: `03${int(0, 4)}${int(0, 9)}-${int(1000000, 9999999)}`, email: `${customerName.toLowerCase().replace(/ /g, '.')}@example.com` },
    vehicle: { make, model, year: int(2013, 2024), vin: vin(), plate: plate(), color: pick(COLORS), mileage: int(8, 160) * 1000 },
    damageDescription: damage, instructions: instr, priority, deadline, status, repairTypes: types,
    technician: tech._id, supervisor: pick(sups)._id, progress,
    estimate: { amount, customerApproved: approved, approvedAt: approved ? new Date(createdAt.getTime() + 2 * H) : undefined, supplements },
    insurance: insured ? { provider: pick(INSURERS), claimNo: `CLM-${int(10000, 99999)}`, status: approved ? wpick([['approved', 6], ['pending', 3], ['rejected', 1]]) : 'pending' } : { provider: '', claimNo: '', status: 'none' },
    acceptedAt: status !== 'assigned' ? new Date(createdAt.getTime() + 2 * H) : undefined, startedAt, completedAt,
    pauses: status === 'paused' || status === 'awaiting_parts' ? [{ start: ago(int(1, 20) * H), reason: status === 'awaiting_parts' ? 'Waiting for parts' : 'Waiting for customer decision' }] : [],
    internalNotes: chance(0.5) ? [{ text: pick(['Customer wants delivery before the weekend.', 'Check clearcoat thickness before polishing.', 'Insurer surveyor visiting tomorrow.', 'Original paint code verified from door pillar.']), by: sup._id, at: ago(int(2, 60) * H) }] : [],
    comments: started && chance(0.45) ? [{ text: pick(['How is the repair going?', 'Parts arrived, continuing now.', 'Please send me the latest photos.']), by: sup._id, at: ago(int(2, 50) * H) }, { text: pick(['On track, photos uploaded.', 'Will finish by tomorrow morning.', 'Need one more clip kit.']), by: tech._id, at: ago(int(1, 49) * H) }] : [],
    history: history.sort((a, b) => a.at - b.at),
    delays: chance(0.12) ? [{ reason: pick(['Part delayed by supplier', 'Paint booth fully booked', 'Hidden damage found']), newDeadline: ahead(int(1, 3) * D), by: tech._id, at: ago(int(2, 30) * H) }] : [],
    additionalDamage: started && chance(0.1) ? [{ description: 'Hidden crack found on bumper bracket', severity: pick(['minor', 'moderate']), photos: [], by: tech._id, at: ago(int(2, 40) * H) }] : [],
    inspectionRequests: started && chance(0.1) ? [{ note: 'Please check panel gap before paint', by: tech._id, at: ago(int(2, 30) * H), resolved: chance(0.5) }] : [],
    inspection, workflows,
    finalChecklist: FINAL_CHECKLIST().map((c) => ({ ...c, done: done, by: done ? tech._id : undefined })),
    photos, partsUsed: [], requiredParts: [],
    qc: {
      round: status === 'ready_for_qc' ? (chance(0.25) ? 2 : 1) : status === 'rework' ? 1 : reviewedAt ? (chance(0.2) ? 2 : 1) : 0,
      selfChecklist: QC_SELF_CHECKLIST().map((c) => ({ ...c, done: done, by: done ? tech._id : undefined })),
      submittedAt: done ? new Date(completedAt.getTime() + 20 * 60000) : undefined,
      lastResult: status === 'rework' ? 'failed' : reviewedAt ? 'passed' : 'none',
      feedback: status === 'rework' ? pick(['Orange peel on the clear coat — re-polish.', 'Panel gap uneven on the left side.', 'Overspray on trim, clean and re-mask.']) : '',
      reviewedBy: reviewedAt || status === 'rework' ? sups[1]._id : undefined, reviewedAt: reviewedAt || (status === 'rework' ? ago(int(2, 30) * H) : undefined),
      signedOffBy: delivered ? sups[1]._id : undefined, signedOffAt: delivered ? new Date(reviewedAt.getTime() + 2 * H) : undefined,
    },
    createdAt, updatedAt: history.at(-1).at > createdAt ? history.at(-1).at : createdAt,
  });
  jobMeta.push({ jobId, orderNo, tech, status, createdAt, completedAt, deadline, customerName });
}

// ---------- parts requests (+ stock plan) ----------
const issuedByPart = new Map();
const pendingReserved = new Map();
const KIND_POOL = [['inventory', 70], ['new', 12], ['damaged', 10], ['missing', 8]];
jobMeta.forEach((m, idx) => {
  const jd = jobDocs[idx];
  const n = chance(0.65) ? int(1, 2) : 0;
  for (let k = 0; k < n; k++) {
    const kind = wpick(KIND_POOL);
    const part = kind === 'inventory' ? pick(activeParts) : null;
    const qty = kind === 'inventory' && ['consumable', 'paint', 'hardware'].includes(part.category) ? int(1, 4) : int(1, 2);
    const at = new Date(m.createdAt.getTime() + int(2, 30) * H);
    let status;
    if (['ready_for_qc', 'qc_passed', 'ready_for_delivery', 'rework'].includes(m.status)) status = chance(0.93) ? 'issued' : 'rejected';
    else if (m.status === 'awaiting_parts') status = pick(['ordered', 'approved', 'requested']);
    else if (m.status === 'in_progress' || m.status === 'paused') status = wpick([['issued', 5], ['approved', 2], ['ordered', 2], ['requested', 1]]);
    else status = wpick([['requested', 4], ['approved', 3], ['ordered', 2]]);
    const name = part ? part.name : kind === 'new' ? pick(['Aftermarket tail lamp assembly', 'OEM badge set', 'Special-order wing mirror']) : kind === 'damaged' ? pick(['Bumper bracket (cracked)', 'Grille clip set (broken)', 'Fender liner (torn)']) : pick(['Wheel arch trim (missing)', 'Mud flap set (missing)', 'Number plate light (missing)']);
    const log = [{ status: 'requested', by: m.tech._id, at }];
    const order = ['requested', 'approved', 'ordered', 'issued'];
    if (status === 'rejected') log.push({ status: 'rejected', by: sup._id, at: new Date(at.getTime() + 3 * H) });
    else for (let s = 1; s <= order.indexOf(status); s++) log.push({ status: order[s], by: sup._id, at: new Date(at.getTime() + s * 3 * H) });
    reqDocs.push({ job: m.jobId, part: part?._id, name, qty, kind, status, note: chance(0.3) ? pick(['Needed before painting', 'Urgent — customer waiting', 'Check compatibility']) : '', requestedBy: m.tech._id, handledBy: status === 'requested' ? undefined : sup._id, statusLog: log, createdAt: at, updatedAt: log.at(-1).at });
    if (part && kind === 'inventory') {
      if (status === 'issued') {
        issuedByPart.set(String(part._id), [...(issuedByPart.get(String(part._id)) ?? []), { qty, at: log.at(-1).at, job: m.jobId }]);
        jd.requiredParts.push({ part: part._id, name, qty });
        if (chance(0.7)) jd.partsUsed.push({ part: part._id, name, qty, by: m.tech._id, at: log.at(-1).at });
      } else if (['requested', 'approved', 'ordered'].includes(status)) pendingReserved.set(String(part._id), (pendingReserved.get(String(part._id)) ?? 0) + qty);
    }
  }
});

// stock + movement history that adds up exactly
const moves = [];
for (const p of parts) {
  const plan = partPlan.get(String(p._id));
  const issues = (issuedByPart.get(String(p._id)) ?? []).sort((a, b) => a.at - b.at);
  const totalIssued = issues.reduce((s, x) => s + x.qty, 0);
  const finalTarget = plan.out ? 0 : plan.low ? int(0, Math.max(0, p.reorderLevel)) : int(p.reorderLevel + 3, p.reorderLevel + 60);
  const receives = plan.low || plan.out ? [] : Array.from({ length: int(0, 2) }, () => ({ qty: int(5, 30), at: ago(int(2, 70) * D) }));
  const sumR = receives.reduce((s, r) => s + r.qty, 0);
  const opening = Math.max(0, finalTarget + totalIssued - sumR);
  const events = [{ type: 'initial', delta: opening, at: ago(int(80, 160) * D), note: 'Opening stock' }, ...receives.map((r) => ({ type: 'receive', delta: r.qty, at: r.at, note: `PO-${int(1000, 9999)}` })), ...issues.map((x) => ({ type: 'issue', delta: -x.qty, at: x.at, note: 'Issued to repair order', job: x.job }))].filter((e) => e.delta !== 0).sort((a, b) => a.at - b.at);
  let bal = 0;
  for (const e of events) { bal += e.delta; moves.push({ part: p._id, type: e.type, delta: e.delta, balanceAfter: bal, note: e.note, job: e.job, by: pick(sups)._id, createdAt: e.at, updatedAt: e.at }); }
  p.stock = bal;
  p.reserved = pendingReserved.get(String(p._id)) ?? 0;
}
await Promise.all(parts.map((p) => p.save()));

// ---------- attendance ----------
const attendance = [];
const settingsShift = 480;
for (const t of [...techs, ...sups, admin]) {
  for (let d = 1; d <= 34; d++) {
    const day = new Date(NOW - d * D);
    if (day.getDay() === 0) continue;
    if (chance(0.06)) continue; // absent / leave
    const inAt = new Date(day); inAt.setHours(int(8, 9), int(0, 59), 0, 0);
    const lunch = new Date(inAt.getTime() + int(4, 5) * H); const lunchEnd = new Date(lunch.getTime() + int(30, 55) * 60000);
    const brk = chance(0.4) ? [{ start: new Date(inAt.getTime() + 2 * H), end: new Date(inAt.getTime() + 2 * H + int(8, 15) * 60000) }] : [];
    const outAt = new Date(inAt.getTime() + int(8, 11) * H + int(0, 40) * 60000);
    const breaks = [...brk, { start: lunch, end: lunchEnd }];
    const worked = Math.round((outAt - inAt - breaks.reduce((s, b) => s + (b.end - b.start), 0)) / 60000);
    attendance.push({ user: t._id, date: dayKey(day), clockIn: inAt, clockOut: outAt, breaks, overtimeMinutes: Math.max(0, worked - settingsShift), createdAt: inAt, updatedAt: outAt });
  }
}
// Today: ali + sara have NOT clocked in so the clock-in flow can be demoed; most others are on shift
for (const t of [...techs.slice(2), ...sups, admin]) {
  if (chance(0.15)) continue;
  const inAt = ago(int(60, 300) * 60000);
  attendance.push({ user: t._id, date: dayKey(new Date(NOW)), clockIn: inAt, breaks: chance(0.15) ? [{ start: ago(int(5, 20) * 60000) }] : [], overtimeMinutes: 0, createdAt: inAt, updatedAt: inAt });
}

// ---------- leave ----------
const leaves = [];
for (const t of [...techs, ...sups]) {
  for (let k = 0; k < int(9, 12); k++) {
    const from = new Date(NOW + int(-90, 60) * D); const to = new Date(from.getTime() + int(0, 4) * D);
    const past = to < NOW;
    leaves.push({ user: t._id, from, to, type: wpick([['casual', 4], ['annual', 3], ['sick', 3], ['unpaid', 1]]), reason: pick(['Family event', 'Medical appointment', 'Travel', 'Personal work', 'Feeling unwell']), status: past ? wpick([['approved', 7], ['rejected', 2]]) : wpick([['pending', 6], ['approved', 3], ['rejected', 1]]), decidedBy: undefined, createdAt: new Date(from.getTime() - int(2, 14) * D), updatedAt: new Date(from.getTime() - D) });
  }
}
leaves.forEach((l) => { if (l.status !== 'pending') l.decidedBy = pick(sups)._id; });

// ---------- notifications ----------
const N = (user, type, title, body, link, at, read) => notifDocs.push({ user, type, title, body, link, read, createdAt: at, updatedAt: at });
jobMeta.forEach((m, i) => {
  const jd = jobDocs[i];
  const veh = `${jd.vehicle.make} ${jd.vehicle.model}`;
  N(m.tech._id, 'assignment', 'New job assigned', `${m.orderNo} · ${veh}`, `/jobs/${m.jobId}`, m.createdAt, m.status !== 'assigned');
  if (m.deadline < NOW && !['qc_passed', 'ready_for_delivery'].includes(m.status)) N(m.tech._id, 'deadline', 'Job overdue', `${m.orderNo} · ${veh}`, `/jobs/${m.jobId}`, ago(int(1, 12) * H), false);
  else if (m.deadline - NOW < 24 * H && !['qc_passed', 'ready_for_delivery', 'ready_for_qc'].includes(m.status)) N(m.tech._id, 'deadline', 'Deadline within 24 hours', `${m.orderNo} · ${veh}`, `/jobs/${m.jobId}`, ago(int(1, 8) * H), chance(0.3));
  if (['ready_for_qc'].includes(m.status)) staffIds.forEach((s) => chance(0.6) && N(s, 'qc', 'Ready for QC', `${m.orderNo} from ${m.tech.name}`, `/jobs/${m.jobId}`, ago(int(1, 20) * H), chance(0.3)));
  if (m.status === 'rework') N(m.tech._id, 'qc', 'QC failed — rework required', `${m.orderNo}: ${jd.qc.feedback}`, `/jobs/${m.jobId}`, ago(int(2, 30) * H), false);
  if (['qc_passed', 'ready_for_delivery'].includes(m.status)) N(m.tech._id, 'qc', 'QC passed', m.orderNo, `/jobs/${m.jobId}`, jd.qc.reviewedAt, true);
  if (m.status === 'ready_for_delivery') N(m.tech._id, 'qc', 'Vehicle signed off', `${m.orderNo} is ready for delivery`, `/jobs/${m.jobId}`, jd.qc.signedOffAt, true);
  if (jd.delays.length) N(sup._id, 'delay', 'Delay reported', `${m.orderNo}: ${jd.delays[0].reason}`, `/jobs/${m.jobId}`, jd.delays[0].at, chance(0.5));
  if (jd.comments.length) N(m.tech._id, 'comment', `Comment on ${m.orderNo}`, `Sam Supervisor: ${jd.comments[0].text}`, `/jobs/${m.jobId}`, jd.comments[0].at, chance(0.6));
});
reqDocs.forEach((r) => {
  const j = jobMeta.find((m) => String(m.jobId) === String(r.job));
  if (r.status !== 'requested') N(r.requestedBy, 'parts', `Parts ${r.status}`, `${j.orderNo}: ${r.qty} × ${r.name}`, '/parts', r.statusLog.at(-1).at, r.status === 'issued' || chance(0.4));
  else staffIds.slice(0, 2).forEach((s) => N(s, 'parts', 'Parts request', `${j.orderNo}: ${r.qty} × ${r.name}`, '/parts', r.createdAt, chance(0.4)));
});
parts.filter((p) => p.stock - p.reserved <= p.reorderLevel && p.active).slice(0, 12).forEach((p) => staffIds.forEach((s) => N(s, 'parts', 'Low stock', `${p.name}: ${p.stock} left (reorder at ${p.reorderLevel})`, '/inventory', ago(int(1, 60) * H), chance(0.4))));
leaves.filter((l) => l.status === 'pending').slice(0, 15).forEach((l) => N(sup._id, 'system', 'Leave request', `${users.find((t) => String(t._id) === String(l.user)).name}: ${l.from.toDateString()}`, '/attendance', l.createdAt, chance(0.3)));

// ---------- chat ----------
const msgs = [];
const TEAM_LINES = ['Paint booth is booked 1–4pm today.', 'Reminder: photograph every panel at check-in.', 'New clear coat delivery arrives tomorrow morning.', 'Who has the spare spray gun nozzle?', 'Compressor serviced — all good.', 'Please log parts used before leaving.', 'QC is in the back bay after lunch.', 'Customer for RO-1010 is coming at 4pm.', 'Cleaning the paint shop filters this evening.', 'Great job on the Civic yesterday!', 'We are low on P240 discs, ordering today.', 'Friday toolbox talk at 5pm.'];
const people = [...sups, ...techs];
for (let k = 0; k < 70; k++) { const at = ago(int(1, 14 * 24) * H); msgs.push({ channel: 'team', sender: pick(people)._id, text: pick(TEAM_LINES), attachments: [], createdAt: at, updatedAt: at }); }
const activeJobs = jobDocs.map((j, i) => ({ j, m: jobMeta[i] })).filter(({ m }) => ['in_progress', 'paused', 'awaiting_parts', 'rework', 'ready_for_qc', 'accepted'].includes(m.status));
for (const { j, m } of activeJobs.slice(0, 40)) {
  const lines = [[sups[0], 'How is this one coming along?'], [m.tech, pick(['Prep is done, painting this afternoon.', 'Waiting for the part, should arrive tomorrow.', 'Almost finished, polishing next.', 'Found extra damage behind the bumper.'])], [sups[0], pick(['Thanks — keep me posted.', 'Send photos when you can.', 'Okay, I will talk to the customer.'])]];
  lines.forEach(([s, text], k) => { const at = ago((int(1, 30) + (3 - k)) * H); msgs.push({ channel: `job:${j._id}`, sender: s._id, text, attachments: k === 1 && chance(0.2) ? [{ url: pick(IMG.progress), name: 'progress.jpg', mime: 'image/jpeg' }] : [], createdAt: at, updatedAt: at }); });
}

// ---------- website inquiries ----------
const SERVICES = ['Auto Body Repair', 'Collision Repair', 'Insurance Claim', 'Auto Paint Repair', 'Mechanical Repair', 'Other'];
const INQ = ['Hi, my car was hit from behind. Can I get a quote?', 'Need the scratches on my door repainted. How much roughly?', 'Do you handle insurance claims directly with the insurer?', 'Hail damage on my bonnet and roof, please advise.', 'Brake noise after a minor accident, can you inspect?', 'I want a full respray in pearl white. What are the options?', 'Rear bumper cracked, need replacement and paint.', 'Can you pick up the car from my home?', 'How long does a typical collision repair take?', 'Front fender dented, is paintless repair possible?'];
const inquiries = Array.from({ length: 110 }, (_, k) => {
  const name = `${pick(FIRST)} ${pick(LAST)}`; const at = ago(int(0, 75) * D + int(0, 23) * H);
  return { name, email: `${name.toLowerCase().replace(/ /g, '.')}${int(1, 99)}@example.com`, phone: `03${int(0, 4)}${int(0, 9)}-${int(1000000, 9999999)}`, service: pick(SERVICES), vehicle: `${pick(MAKES)[0]} ${pick(['Civic', 'Corolla', 'Swift', 'Sportage', 'City'])} ${int(2014, 2024)}`, message: pick(INQ), status: at > ago(5 * D) ? wpick([['new', 6], ['contacted', 3]]) : wpick([['contacted', 3], ['closed', 6], ['new', 1]]), createdAt: at, updatedAt: at };
});

// ---------- write ----------
const opts = { timestamps: false };
await Job.insertMany(jobDocs, opts);
await Task.insertMany(taskDocs, opts);
await PartRequest.insertMany(reqDocs, opts);
await StockMovement.insertMany(moves, opts);
await Attendance.insertMany(attendance, opts);
await LeaveRequest.insertMany(leaves, opts);
await Notification.insertMany(notifDocs, opts);
await Message.insertMany(msgs, opts);
await Inquiry.insertMany(inquiries, opts);

// A timer left running for the two main demo technicians (they appear clocked-out, so clear it for realism: none running)
const counts = {};
for (const [n, m] of Object.entries({ users: User, jobs: Job, tasks: Task, parts: Part, partrequests: PartRequest, stockmovements: StockMovement, attendances: Attendance, leaverequests: LeaveRequest, notifications: Notification, messages: Message, inquiries: Inquiry })) counts[n] = await m.countDocuments();
console.log(`Seeded database "${db}":`, counts);
const sample = (st) => jobDocs.filter((j) => j.status === st).slice(0, 1).map((j) => `${j.orderNo} / ${j.vehicle.plate}  (${st})`)[0];
console.log('Track page samples (order / plate):');
for (const st of ['assigned', 'in_progress', 'awaiting_parts', 'ready_for_qc', 'rework', 'ready_for_delivery']) console.log('  ', sample(st));
console.log('Logins (password Password123!): admin@, supervisor@, rabia@, imran@, tech@, sara@, bilal@, hina@ ... @chromeline.test');
await mongoose.disconnect();
