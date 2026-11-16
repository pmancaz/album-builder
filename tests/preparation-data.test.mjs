import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparationForAlbum, sharedFieldsFromPreparation, validatePreparation, albumFromPreparation } from '../release-preparation-data.js';
const album = () => ({ id: 'a', name: 'Record', metadata: { title: 'Record', artist: 'Artist', albumArtist: 'Artist', composer: 'Composer' }, releaseCopy: { releaseDate: '2026-12-01', description: 'Existing story', credits: 'Credits', downloadUrl: 'https://example.com/download', links: { website: 'https://example.com', spotify: 'https://example.com/listen' } }, tracks: [{ id: 't', name: 'First', nativePath: '/music/first.wav', duration: 120 }] });
test('existing album metadata, copy, links and track order become one preparation record', () => {
 const doc = preparationForAlbum(album());
 assert.equal(doc.fields.longDescriptionInput, 'Existing story'); assert.equal(doc.fields.releaseDateInput, '2026-12-01');
 assert.equal(doc.fields.spotifyUrlInput, 'https://example.com/listen');
 assert.equal(doc.masters[0].sourceTrackId, 't'); assert.equal(doc.masters[0].durationSeconds, 120);
 assert.equal(doc.masters[0].metadata.composer, 'Composer');
 const round = sharedFieldsFromPreparation(doc); assert.equal(round.metadata.title, 'Record'); assert.equal(round.releaseCopy.description, 'Existing story');
});
test('prepared audio stays linked to exported copies until its album source is replaced', () => {
 const a = album(); const prep = preparationForAlbum(a);
 prep.masters[0].path = '/package/01 - First.wav'; prep.masters[0].leadSingle = true;
 prep.masters[0].metadata.isrc = 'AU123'; prep.fields.brainstormInput = 'Keep brainstorm';
 a.releasePreparation = prep;
 assert.equal(preparationForAlbum(a).masters[0].path, '/package/01 - First.wav');
 a.tracks[0].nativePath = '/music/final.wav';
 const changed = preparationForAlbum(a);
 assert.equal(changed.masters[0].path, '/music/final.wav'); assert.equal(changed.masters[0].metadata.isrc, 'AU123');
 assert.equal(changed.fields.brainstormInput, 'Keep brainstorm'); assert.equal(changed.masters[0].leadSingle, true);
});
test('cleared release fields stay cleared, unlinked masters stay available, corrupt preparation is rejected', () => {
 const a = album();a.releasePreparation = preparationForAlbum(a);a.releaseCopy.description = '';
 a.releasePreparation.masters.push({ id: 'extra', path: '/music/extra.wav', metadata: { title: 'Extra' } });
 assert.equal(preparationForAlbum(a).fields.longDescriptionInput, '');assert.equal(preparationForAlbum(a).masters.length, 2);
 assert.throws(() => validatePreparation({ fields: [], masters: [] }), /damaged/);
 assert.throws(() => validatePreparation({ fields: {}, artwork: { backgroundDataUrl: 'https://example.com/image.png' } }), /embedded/);
});

test('standalone import creates an independent album and cannot update the old export package', () => {
 const original=preparationForAlbum(album()); original.exportState={outputDir:'/old',folderName:'Package'};
 const imported=albumFromPreparation(original);
 assert.equal(imported.schemaVersion,2); assert.notEqual(imported.id, original.id);
 assert.equal(imported.tracks[0].nativePath,'/music/first.wav');
 assert.equal(imported.releasePreparation.masters[0].sourceTrackId, imported.tracks[0].id);
 assert.deepEqual(imported.releasePreparation.exportState,{});
 assert.deepEqual(original.exportState,{outputDir:'/old',folderName:'Package'});
});
