/*
  A release can have one lead single. Keeping this rule in a tiny helper means
  old projects, checkbox clicks, and AI drafting all see the same selection.
*/

export function normaliseLeadSingles(masters = []) {
  let leadFound = false;
  return (Array.isArray(masters) ? masters : []).map((master) => {
    const leadSingle = Boolean(master?.leadSingle) && !leadFound;
    if (leadSingle) leadFound = true;
    return { ...master, leadSingle };
  });
}

export function setLeadSingle(masters = [], masterId = '', checked = true) {
  const targetId = String(masterId || '');
  return normaliseLeadSingles(masters).map((master) => ({
    ...master,
    // Turning one checkbox on clears every other checkbox. Turning the active
    // one off leaves the release without a lead single until another is chosen.
    leadSingle: checked ? String(master.id) === targetId : (String(master.id) === targetId ? false : master.leadSingle),
  }));
}

export function selectedLeadSingle(masters = []) {
  return normaliseLeadSingles(masters).find((master) => master.leadSingle) || null;
}
