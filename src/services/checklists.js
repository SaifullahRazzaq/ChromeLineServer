const mk = (arr) => arr.map(([key, label]) => ({ key, label, done: false, note: '' }));

export const INSPECTION_CHECKLIST = () =>
  mk([
    ['exterior_walkaround', 'Exterior walk-around completed'],
    ['vin_verified', 'VIN matches paperwork'],
    ['odometer', 'Odometer reading recorded'],
    ['fuel_level', 'Fuel level recorded'],
    ['lights_glass', 'Lights and glass checked'],
    ['tyres_wheels', 'Tyres and wheels checked'],
    ['interior', 'Interior condition noted'],
    ['personal_items', 'Personal items removed or logged'],
    ['warning_lights', 'Dashboard warning lights checked'],
  ]);

const WORKFLOWS = {
  body_panel: ['Strip trim and fittings', 'Assess panel and mark repair area', 'Straighten and shape panel', 'Apply filler and block sand', 'Check panel gaps and alignment'],
  dent_removal: ['Locate and mark dent', 'Access panel backside / glue-pull setup', 'Pull or push dent to level', 'Tap down high spots', 'Inspect under light board'],
  bumper: ['Remove bumper and fittings', 'Inspect clips, brackets and absorber', 'Repair or replace bumper cover', 'Test fit bumper', 'Refit sensors and trim'],
  frame: ['Mount vehicle on frame machine', 'Measure and record dimensions', 'Pull to factory specs', 'Re-measure and print report', 'Weld / seal and corrosion protect'],
  paint_prep: ['Degrease and wash repair area', 'Sand to feather edge', 'Apply primer', 'Guide coat and block sand', 'Mask vehicle'],
  color_matching: ['Locate paint code', 'Mix paint to code', 'Spray test card', 'Compare under daylight lamp', 'Adjust tint and approve match'],
  painting: ['Final clean and tack off', 'Apply base coat', 'Apply clear coat', 'Bake / cure', 'Polish and de-nib'],
  parts_replacement: ['Verify part number against order', 'Remove damaged part', 'Fit replacement part', 'Torque fasteners to spec', 'Record parts used'],
  mechanical: ['Diagnose fault', 'Carry out repair', 'Test operation', 'Clear fault codes', 'Road test'],
  reassembly: ['Refit trim and fittings', 'Reconnect electrics and sensors', 'Check panel gaps', 'Refit lights and glass seals', 'Clean interior and exterior'],
};

export const workflowFor = (types) =>
  types.map((type) => ({ type, steps: mk((WORKFLOWS[type] || []).map((l, i) => [`${type}_${i}`, l])) }));

export const FINAL_CHECKLIST = () =>
  mk([
    ['all_tasks', 'All assigned tasks completed'],
    ['panels_aligned', 'Panels aligned with even gaps'],
    ['paint_finish', 'Paint finish free of runs, dust and orange peel'],
    ['fasteners', 'All fasteners and clips fitted'],
    ['electrics', 'Lights, sensors and electrics working'],
    ['cleaned', 'Vehicle cleaned inside and out'],
    ['parts_logged', 'Parts used recorded'],
    ['tools_removed', 'Tools and masking removed'],
  ]);

export const QC_SELF_CHECKLIST = () =>
  mk([
    ['matches_instructions', 'Work matches repair instructions and approved estimate'],
    ['no_new_damage', 'No new damage caused during repair'],
    ['photos_taken', 'After photos taken for every repaired area'],
    ['functional_test', 'Functional test completed'],
    ['clean_handover', 'Vehicle ready for handover'],
  ]);
