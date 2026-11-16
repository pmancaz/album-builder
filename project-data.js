import { validatePreparation } from './release-preparation-data.js';
/* Saved projects are ordinary JSON. Check their shape before the interface
   replaces an open album, so a damaged file cannot erase the current session. */
export function normaliseProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('This album does not contain a project object.');
  if (value.schemaVersion != null && (!Number.isInteger(value.schemaVersion) || value.schemaVersion > 2)) throw new Error('This album uses an unsupported project format. Open it in a compatible Album Builder version.');
  const text = (v, fallback = '') => typeof v === 'string' ? v : fallback;
  const array = (v, label) => { if (v == null) return []; if (!Array.isArray(v)) throw new Error(`The saved ${label} list is damaged.`); return v; };
  const ids = new Set();
  const tracks = (items, label) => array(items, label).map((track) => {
    if (!track || typeof track !== 'object' || Array.isArray(track)) throw new Error(`A saved ${label} entry is damaged.`);
    const id = text(track.id) || crypto.randomUUID();
    if (ids.has(id)) throw new Error('Two saved audio items have the same ID. The album was not opened.');
    ids.add(id);
    const trackedNotes = array(track.trackedNotes, 'listening notes').map((note) => {
      if (!note || typeof note.text !== 'string' || !Number.isFinite(note.seconds) || note.seconds < 0) throw new Error('A saved listening note is damaged.');
      return { ...note, id: text(note.id) || crypto.randomUUID() };
    });
    return { ...track, id, nativePath: text(track.nativePath) || null, name: text(track.name, 'Untitled track'), status: ['sketch', 'demo', 'master'].includes(track.status) ? track.status : '', notes: text(track.notes), trackedNotes };
  });
  const project = { ...value, id: text(value.id) || null, name: text(value.name, 'Untitled album'), archived: Boolean(value.archived), metadata: {}, tracks: tracks(value.tracks, 'tracks'), materials: tracks(value.materials, 'materials'), references: tracks(value.references, 'references') };
  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata : {};
  for (const key of ['title', 'artist', 'albumArtist', 'year', 'genre', 'composer', 'discNumber', 'label', 'catalogue', 'comment', 'releaseDate', 'description', 'credits', 'downloadUrl']) project.metadata[key] = text(metadata[key]);
  project.metadata.title ||= project.name;
  project.metadata.compilation = Boolean(metadata.compilation);
  if (value.releaseCopy != null && (typeof value.releaseCopy !== 'object' || Array.isArray(value.releaseCopy))) throw new Error('The saved release copy is damaged. The album was left unchanged.');
  const release = value.releaseCopy || {};
  project.releaseCopy = { links: {} };
  for (const key of ['releaseDate', 'description', 'credits', 'downloadUrl', 'presetId']) project.releaseCopy[key] = text(release[key]);
  for (const key of ['website', 'instagram', 'bandcamp', 'soundcloud', 'youtube', 'spotify', 'appleMusic']) project.releaseCopy.links[key] = text(release.links?.[key]);
  // Saved artwork is an embedded image, never a URL that contacts a remote host.
  if (value.artworkDataUrl && (typeof value.artworkDataUrl !== 'string' || !/^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,/i.test(value.artworkDataUrl))) throw new Error('The saved artwork preview is not an embedded image. The album was left unchanged.');
  project.releasePreparation = validatePreparation(value.releasePreparation);
  project.albumNotes = text(value.albumNotes);
  project.albumNoteEntries = array(value.albumNoteEntries, 'album notes').map((entry) => {
    if (!entry || typeof entry.content !== 'string') throw new Error('A saved album note is damaged.');
    return { ...entry, id: text(entry.id) || crypto.randomUUID() };
  });
  // Earlier albums had one saved note field. New albums keep the unfinished
  // editor draft separately from the dated note log, including an empty log.
  if (value.albumNoteEntries == null && project.albumNotes) {
    project.albumNoteEntries = [{ id: crypto.randomUUID(), createdAt: value.updatedAt || new Date().toISOString(), content: project.albumNotes }];
    project.albumNotes = '';
  }
  const placements = array(value.transitionLayout?.placements, 'transition placements').map((clip) => {
    if (!clip || typeof clip.trackId !== 'string' || ![0, 1, 2].includes(clip.lane) || !Number.isFinite(clip.start) || clip.start < 0) throw new Error('A saved transition placement is damaged.');
    for (const field of ['fadeIn', 'fadeOut']) if (clip[field] != null && (!Number.isFinite(clip[field]) || clip[field] < 0)) throw new Error('A saved transition fade is damaged.');
    return { ...clip, id: text(clip.id) || crypto.randomUUID(), fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 };
  });
  project.transitionLayout = { placements };
  return project;
}

// Never silently turn malformed browser storage into an empty library: doing
// that would overwrite the only copy on the next autosave.
export function readBrowserProjects(storage = localStorage) {
  let projects;
  try { projects = JSON.parse(storage.getItem('album-builder-projects') || '[]'); }
  catch { throw new Error('The saved album library contains invalid JSON. Its contents have been left unchanged.'); }
  if (!Array.isArray(projects) || projects.some((project) => !project || typeof project !== 'object' || Array.isArray(project))) throw new Error('The saved album library is damaged. Its contents have been left unchanged.');
  return projects;
}
