import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Job from './models/Job.js';
import Task from './models/Task.js';
import { Part, PartRequest, StockMovement } from './models/Part.js';
import { Notification, Message } from './models/Comms.js';
import { Attendance, LeaveRequest } from './models/Attendance.js';
import { INSPECTION_CHECKLIST, workflowFor, FINAL_CHECKLIST, QC_SELF_CHECKLIST } from './services/checklists.js';

await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primebody');
await Promise.all([User, Job, Task, Part, PartRequest, StockMovement, Notification, Message, Attendance, LeaveRequest].map((m) => m.deleteMany({})));

const pw = await bcrypt.hash('Password123!', 10);
const [admin, sup, ali, sara] = await User.create([
  { name: 'Ayesha Admin', email: 'admin@chromeline.test', role: 'admin', passwordHash: pw },
  { name: 'Sam Supervisor', email: 'supervisor@chromeline.test', role: 'supervisor', passwordHash: pw },
  { name: 'Ali Technician', email: 'tech@chromeline.test', role: 'technician', specialty: 'Body & paint', employeeId: 'TECH-001', phone: '0300-1000001', skills: ['Dent removal', 'Painting'], joinedAt: new Date('2023-03-01'), passwordHash: pw },
  { name: 'Sara Technician', email: 'sara@chromeline.test', role: 'technician', specialty: 'Mechanical', employeeId: 'TECH-002', phone: '0300-1000002', skills: ['Engine', 'Suspension'], joinedAt: new Date('2024-01-15'), passwordHash: pw },
]);

const parts = await Part.create([
  { sku: 'BMP-CIV-F', name: 'Front bumper cover — Civic', category: 'body', stock: 3, location: 'A1', unitCost: 180, reorderLevel: 2, supplier: 'AutoParts Co' },
  { sku: 'HDL-CAM-L', name: 'Headlight LH — Camry', category: 'lighting', stock: 0, location: 'B2', unitCost: 240, reorderLevel: 1, supplier: 'LightHouse Spares' },
  { sku: 'CLR-2K', name: '2K clear coat 5L', category: 'paint', stock: 12, location: 'P1', unitCost: 95, reorderLevel: 4, supplier: 'ColourPro' },
  { sku: 'FLR-1KG', name: 'Body filler 1kg', category: 'consumable', stock: 40, location: 'C3', unitCost: 14, reorderLevel: 10, supplier: 'ColourPro' },
  { sku: 'CLP-KIT', name: 'Trim clip kit', category: 'hardware', stock: 25, location: 'C1', unitCost: 22, reorderLevel: 8, supplier: 'AutoParts Co' },
  { sku: 'DOOR-COR-R', name: 'Rear door shell — Corolla', category: 'body', stock: 1, location: 'A3', unitCost: 410, reorderLevel: 1, supplier: 'AutoParts Co' },
]);

const hrs = (h) => new Date(Date.now() + h * 36e5);
const base = (i, o) => ({
  orderNo: `RO-${1001 + i}`, supervisor: sup._id, technician: ali._id,
  inspection: { checklist: INSPECTION_CHECKLIST() }, finalChecklist: FINAL_CHECKLIST(), qc: { selfChecklist: QC_SELF_CHECKLIST() },
  estimate: { amount: 1800, customerApproved: true, approvedAt: new Date() }, insurance: { provider: 'SafeGuard', claimNo: `CLM-${9000 + i}`, status: 'approved' },
  history: [{ type: 'created', text: 'Repair order created', by: sup._id }],
  ...o, workflows: workflowFor(o.repairTypes || []),
});

const jobs = await Job.create([
  base(0, { customer: { name: 'Hassan Raza', phone: '0300-1112233', email: 'hassan@example.com' }, vehicle: { make: 'Honda', model: 'Civic', year: 2021, vin: '2HGFC2F59MH500001', plate: 'LEB-2301', color: 'Silver', mileage: 42100 }, damageDescription: 'Front-right impact: bumper cracked, RH fender dented, headlight bracket bent.', instructions: 'Replace bumper cover, repair fender, refinish both panels. Match pearl silver.', priority: 'urgent', deadline: hrs(5), repairTypes: ['bumper', 'dent_removal', 'paint_prep', 'painting'], status: 'in_progress', progress: 35, startedAt: new Date() }),
  base(1, { customer: { name: 'Maria Khan', phone: '0321-5558899' }, vehicle: { make: 'Toyota', model: 'Corolla', year: 2019, vin: '2T1BURHE0KC200002', plate: 'ABC-554', color: 'White', mileage: 78200 }, damageDescription: 'Rear door crease with paint transfer after parking collision.', instructions: 'Replace rear door shell, colour match white, reassemble trim.', priority: 'high', deadline: hrs(28), repairTypes: ['parts_replacement', 'color_matching', 'reassembly'], status: 'assigned' }),
  base(2, { customer: { name: 'Bilal Ahmed' }, vehicle: { make: 'Suzuki', model: 'Swift', year: 2022, vin: 'MA3NYC21S00300003', plate: 'LXZ-882', color: 'Red' }, damageDescription: 'Hail damage across bonnet and roof.', instructions: 'PDR where possible; repaint bonnet if dents exceed tolerance.', priority: 'normal', deadline: hrs(52), repairTypes: ['dent_removal', 'painting'], status: 'accepted', estimate: { amount: 950, customerApproved: true }, insurance: { status: 'pending', provider: 'ShieldCo', claimNo: 'CLM-9102' } }),
  base(3, { customer: { name: 'Zainab Tariq' }, vehicle: { make: 'Kia', model: 'Sportage', year: 2020, vin: 'KNDPB3AC5L7400004', plate: 'MNP-120', color: 'Black' }, damageDescription: 'Side-swipe: left doors scratched, mirror housing broken.', instructions: 'Refinish both LH doors, replace mirror cap.', priority: 'high', deadline: hrs(-6), repairTypes: ['body_panel', 'paint_prep', 'painting'], status: 'paused', progress: 55, pauses: [{ start: new Date(), reason: 'Waiting for mirror cap' }] }),
  base(4, { customer: { name: 'Omar Sheikh' }, vehicle: { make: 'Hyundai', model: 'Tucson', year: 2018, vin: 'KM8J33A47JU500005', plate: 'RST-776', color: 'Grey' }, damageDescription: 'Rear bumper repair completed; awaiting QC.', priority: 'normal', deadline: hrs(10), repairTypes: ['bumper'], status: 'ready_for_qc', progress: 100, completedAt: new Date(), qc: { round: 1, submittedAt: new Date(), selfChecklist: QC_SELF_CHECKLIST().map((c) => ({ ...c, done: true })), lastResult: 'none' } }),
  base(5, { customer: { name: 'Fatima Noor' }, vehicle: { make: 'Honda', model: 'City', year: 2023, vin: 'MAKGM6670PN600006', plate: 'KLM-445', color: 'Blue' }, damageDescription: 'Front grille and bonnet latch repair.', priority: 'low', deadline: hrs(80), repairTypes: ['mechanical', 'reassembly'], status: 'assigned', technician: sara._id }),
]);

const j0 = jobs[0];
await Task.create([
  { job: j0._id, title: 'Remove & replace front bumper', assignee: ali._id, estimatedMinutes: 90, status: 'completed', completionPct: 100, completedAt: new Date(), repairType: 'bumper', priority: 'urgent' },
  { job: j0._id, title: 'Repair RH fender dent', assignee: ali._id, estimatedMinutes: 120, status: 'todo', repairType: 'dent_removal', priority: 'high', dueAt: j0.deadline, instructions: 'Pull dent, finish with filler if needed. Keep filler thin.' },
  { job: j0._id, title: 'Prep & prime fender and bumper', assignee: ali._id, estimatedMinutes: 90, status: 'todo', repairType: 'paint_prep', dueAt: j0.deadline },
  { job: j0._id, title: 'Paint & clear coat', assignee: ali._id, estimatedMinutes: 150, status: 'todo', repairType: 'painting', dueAt: j0.deadline },
]);
const [, t2, t3, t4] = await Task.find({ job: j0._id }).sort({ createdAt: 1 });
t3.dependencies = [t2._id]; t4.dependencies = [t3._id];
await Promise.all([t3.save(), t4.save()]);
await Task.create({ job: jobs[3]._id, title: 'Refinish LH doors', assignee: ali._id, estimatedMinutes: 180, status: 'blocked', blocked: { reason: 'Mirror cap not yet delivered', at: new Date(), by: ali._id }, completionPct: 55 });

await PartRequest.create([
  { job: j0._id, part: parts[0]._id, name: parts[0].name, qty: 1, kind: 'inventory', status: 'approved', requestedBy: ali._id, statusLog: [{ status: 'requested', by: ali._id }, { status: 'approved', by: sup._id }] },
  { job: jobs[3]._id, name: 'Mirror cap LH — Sportage', qty: 1, kind: 'new', status: 'ordered', requestedBy: ali._id, statusLog: [{ status: 'requested', by: ali._id }, { status: 'ordered', by: sup._id }] },
]);
await Part.updateOne({ _id: parts[0]._id }, { reserved: 1 });

await Notification.create([
  { user: ali._id, type: 'assignment', title: 'New job assigned', body: 'RO-1002 · Toyota Corolla', link: `/jobs/${jobs[1]._id}` },
  { user: ali._id, type: 'deadline', title: 'Job overdue', body: 'RO-1004 · Kia Sportage', link: `/jobs/${jobs[3]._id}` },
  { user: ali._id, type: 'parts', title: 'Parts approved', body: 'RO-1001: 1 × Front bumper cover — Civic', link: '/parts' },
]);
await Message.create({ channel: 'team', sender: sup._id, text: 'Morning all — paint booth is booked 1–4pm for RO-1001.' });

console.log('Seeded. Logins (password Password123!): admin@, supervisor@, tech@, sara@ chromeline.test');
await mongoose.disconnect();
