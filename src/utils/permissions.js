// Single source of truth for the Phase 12 role matrix
const isStaff = (u) => u.role === 'supervisor' || u.role === 'admin';

export const can = {
  approveQC: (u) => isStaff(u) || !!u.permissions?.approveQC,
  viewFinancials: (u) => u.role === 'admin' || (u.role === 'supervisor' && !!u.permissions?.viewFinancials) || !!u.permissions?.viewFinancials,
  manageTechnicians: (u) => u.role === 'admin' || !!u.permissions?.manageTechnicians,
  manageSettings: (u) => u.role === 'admin',
  viewAllJobs: isStaff,
};

export const isStaffRole = isStaff;
