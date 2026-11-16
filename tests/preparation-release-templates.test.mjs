import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilenamePattern, buildPlatformCopies, formatDate } from '../preparation/release-templates.js';
import { hashSeed, randomFromSeed } from '../preparation/release-symbol.js';
import { coverPlacement, movedBackgroundPosition } from '../preparation/artwork-position.js';
import { moveMasterAroundTarget, moveMasterToIndex } from '../preparation/master-order.js';
import { applyArtistPresetToMasters, normaliseArtistPreset, refreshedArtistPresetTags } from '../preparation/artist-presets.js';
import { buildCodexHandoff } from '../preparation/codex-handoff.js';
import { buildAiDraftRequest, mergeDraftIntoProject, selectStyleReferences } from '../preparation/ai-drafting.js';
import { applyVideoTemplate, normaliseVideoSettings, videoOutputFileName, videoTemplateSettings } from '../preparation/video-settings.js';
import { videoBlurPlan, videoPreviewStyle } from '../preparation/video-blur.js';
import { buildTagCopy, normaliseSocialPosts, normaliseTags } from '../preparation/social-posts.js';
import {
  CANVAS_PRESETS, activeCanvasEvents, applyCanvasPreset, canvasEventSchedule, canvasOutputFileName,
  canvasPreviewFrame, canvasValidationErrors, canvasVariants, normaliseCanvasSettings,
} from '../preparation/canvas-settings.js';

test('filename patterns insert padded track numbers and remove unsafe characters', () => {
  const name = applyFilenamePattern('{catalogue} - {track} - {artist} - {title}', { trackNumber: '2', artist: 'A/B', title: 'Track: One' }, { catalogue: 'PC001' }, 1);
  assert.equal(name, 'PC001 - 02 - A-B - Track- One');
});

test('Bandcamp copy uses the label section structure', () => {
  const copy = buildPlatformCopies({ title: 'Test', artist: 'Artist', longDescription: 'Story', credits: 'Made by Artist', catalogue: 'PC001' }).bandcamp;
  assert.match(copy, /ALBUM DESCRIPTION\n_________________/);
  assert.match(copy, /CATALOGUE NUMBER: PC001/i);
});

test('empty or invalid dates stay safe', () => {
  assert.equal(formatDate(''), '');
  assert.equal(formatDate('not-a-date'), 'not-a-date');
});

test('a release symbol seed is repeatable and changes with the release identity', () => {
  const first = randomFromSeed(hashSeed('Pat Carroll|Signals at Low Tide'));
  const repeat = randomFromSeed(hashSeed('Pat Carroll|Signals at Low Tide'));
  const different = randomFromSeed(hashSeed('Pat Carroll|Another Release'));
  const firstSequence = [first(), first(), first(), first()];
  assert.deepEqual(firstSequence, [repeat(), repeat(), repeat(), repeat()]);
  assert.notDeepEqual(firstSequence, [different(), different(), different(), different()]);
});

test('portrait artwork can move from its top edge through centre to bottom edge', () => {
  const top = coverPlacement(3000, 3000, 2000, 3000, 50, 0);
  const centre = coverPlacement(3000, 3000, 2000, 3000, 50, 50);
  const bottom = coverPlacement(3000, 3000, 2000, 3000, 50, 100);

  assert.equal(top.y, 0);
  assert.equal(centre.y, -750);
  assert.equal(bottom.y, -1500);
  assert.equal(movedBackgroundPosition(50, 300, centre.overflowY), 30);
});

test('master cards can move by button or drag and are renumbered', () => {
  const masters = ['one', 'two', 'three'].map((id, index) => ({ id, metadata: { title: id, trackNumber: String(index + 1) } }));
  const movedUp = moveMasterToIndex(masters, 'three', 1);
  assert.deepEqual(movedUp.map((master) => master.id), ['one', 'three', 'two']);
  assert.deepEqual(movedUp.map((master) => master.metadata.trackNumber), ['1', '2', '3']);

  const draggedFirstAfterLast = moveMasterAroundTarget(movedUp, 'one', 'two', true);
  assert.deepEqual(draggedFirstAfterLast.map((master) => master.id), ['three', 'two', 'one']);
  assert.deepEqual(draggedFirstAfterLast.map((master) => master.metadata.trackNumber), ['1', '2', '3']);
});

test('artist templates populate every master without erasing unrelated metadata', () => {
  const preset = normaliseArtistPreset({ id: 'bounty-hill', name: 'Bounty Hill', primaryArtist: 'Bounty Hill', composer: 'Patrick Carroll', tags: 'ambient, drone' });
  const masters = [{ id: 'one', metadata: { title: 'Track One', artist: 'Old Artist', composer: '', isrc: 'AU-ABC-26-00001' } }];
  const applied = applyArtistPresetToMasters(masters, preset);
  assert.equal(applied[0].metadata.artist, 'Bounty Hill');
  assert.equal(applied[0].metadata.composer, 'Patrick Carroll');
  assert.equal(applied[0].metadata.title, 'Track One');
  assert.equal(applied[0].metadata.isrc, 'AU-ABC-26-00001');
  assert.equal(preset.tags, 'ambient, drone');
});

test('older fixed social fields migrate into the expandable ordered list', () => {
  const posts = normaliseSocialPosts(undefined, {
    socialReleaseDayInput: 'Out now.',
    socialPost4Input: 'A process note.',
  });
  assert.equal(posts.length, 7);
  assert.equal(posts[0].title, 'Announcement');
  assert.equal(posts[0].content, '');
  assert.equal(posts[1].title, 'A few days out');
  assert.equal(posts[2].title, 'Release day');
  assert.equal(posts[2].content, 'Out now.');
  assert.equal(posts[5].title, 'Process');
  assert.equal(posts[5].content, 'A process note.');
});

test('saved releases gain both announcement slots without duplicating an existing one', () => {
  const posts = normaliseSocialPosts([
    { id: 'existing-announcement', title: 'Announcement', content: 'Coming soon.' },
    { id: 'release-day', title: 'Release day', content: 'Out now.' },
  ]);
  assert.deepEqual(posts.map((post) => post.title), ['Announcement', 'A few days out', 'Release day']);
  assert.equal(posts[0].id, 'existing-announcement');
  assert.equal(posts[0].content, 'Coming soon.');
  assert.equal(posts[1].id, 'social-few-days-out');
});

test('dynamic social posts and reusable tags receive platform-ready copy', () => {
  const copies = buildPlatformCopies({
    socialPosts: [
      { id: 'announcement', title: 'Announcement', content: 'A new record is coming.' },
      { id: 'release-day', title: 'Release day', content: 'The record is out now.' },
    ],
    tags: '#ambient, drone\nAmbient, deep listening',
    playlistPitch: 'A concise shared editorial pitch.',
  });
  assert.match(copies.social, /SOCIAL POST 01 — ANNOUNCEMENT/);
  assert.match(copies.social, /SOCIAL POST 03 — RELEASE DAY/);
  assert.deepEqual(normaliseTags('#ambient, drone\nAmbient, deep listening'), ['ambient', 'drone', 'deep listening']);
  assert.deepEqual(normaliseTags('#ambient #drone #chill'), ['ambient', 'drone', 'chill']);
  assert.equal(buildTagCopy('ambient, deep listening'), 'BANDCAMP TAGS\n_____________\nambient, deep listening\n\nSOUNDCLOUD TAGS\n_______________\n#ambient #deeplistening');
  assert.equal(copies.playlistPitch, 'A concise shared editorial pitch.');
});

test('updated artist tags refresh defaults without replacing release-specific choices', () => {
  assert.equal(refreshedArtistPresetTags('', '#ambient #drone', '#ambient #drone #chill'), '#ambient #drone #chill');
  assert.equal(refreshedArtistPresetTags('ambient, drone', '#ambient #drone', '#ambient #drone #chill'), '#ambient #drone #chill');
  assert.equal(refreshedArtistPresetTags('#ambient #field-recording', '#ambient #drone', '#ambient #drone #chill'), '#ambient #field-recording');
});

test('Codex handoff identifies one project file and carries the complete brainstorm', () => {
  const handoff = buildCodexHandoff({
    projectPath: '/Users/test/Library/Application Support/release/projects/release-123.json',
    projectId: 'release-123',
    projectName: 'Fourth Cause',
    releaseTitle: 'Fourth Cause',
    artist: 'Bounty Hill',
    brainstorm: 'The full unedited thought, including its awkward but important phrasing.',
  });
  assert.match(handoff, /release-123\.json/);
  assert.match(handoff, /Bounty Hill/);
  assert.match(handoff, /longDescriptionInput/);
  assert.match(handoff, /top-level "socialPosts" array/);
  assert.match(handoff, /tagsInput/);
  assert.match(handoff, /playlistPitchInput/);
  assert.match(handoff, /"leadSingle": true/);
  assert.match(handoff, /fill an empty target/);
  assert.match(handoff, /#ambient #drone #chill/);
  assert.match(handoff, /"Announcement"/);
  assert.match(handoff, /"A few days out"/);
  assert.match(handoff, /Keep the two announcement captions meaningfully different/);
  assert.match(handoff, /up to five of the most recently updated previous release JSON files/);
  assert.match(handoff, /Use those previous releases only as a style reference/);
  assert.match(handoff, /Do not control the Release Preparer interface or my computer/);
  assert.match(handoff, /The full unedited thought, including its awkward but important phrasing\./);
});

test('AI drafting uses same-artist releases first and returns a strict field schema', () => {
  const projects = [
    { id: 'other-new', updatedAt: '2026-07-30', fields: { artistInput: 'Other Artist' } },
    { id: 'same-old', updatedAt: '2026-07-01', fields: { artistInput: 'Bounty Hill' } },
  ];
  const references = selectStyleReferences(projects, 'current', 'Bounty Hill');
  assert.equal(references[0].artist, 'Bounty Hill');
  const request = buildAiDraftRequest({
    project: { id: 'current', fields: { artistInput: 'Bounty Hill', brainstormInput: 'Spacious loops.' }, masters: [{ metadata: { title: 'Drastic Indifference', artist: 'Bounty Hill', trackNumber: '1' }, leadSingle: true }], socialPosts: [] },
    previousProjects: projects,
  });
  assert.equal(request.model, 'gpt-5.6-sol');
  assert.equal(request.schema.additionalProperties, false);
  assert.ok(request.schema.required.includes('playlistPitchInput'));
  assert.match(request.input, /Spacious loops/);
  assert.match(request.input, /"leadSingle": true/);
  assert.match(request.instructions, /individual song at the forefront/);
});

test('AI draft merge preserves existing social IDs and limits the short description', () => {
  const project = {
    fields: { shortDescriptionInput: '', longDescriptionInput: '' },
    socialPosts: [{ id: 'announcement', title: 'Announcement', content: '' }],
  };
  const merged = mergeDraftIntoProject(project, {
    shortDescriptionInput: 'x'.repeat(700),
    longDescriptionInput: 'A full story.',
    socialPosts: [{ id: 'announcement', title: 'Changed title', content: 'New caption.' }],
  });
  assert.equal(merged.fields.shortDescriptionInput.length, 500);
  assert.equal(merged.socialPosts[0].id, 'announcement');
  assert.equal(merged.socialPosts[0].title, 'Announcement');
  assert.equal(merged.socialPosts[0].content, 'New caption.');
});

test('video settings migrate safely and video filenames remain Finder-safe', () => {
  const settings = normaliseVideoSettings({ backgroundBlur: 200, foregroundSize: 5 });
  assert.equal(settings.backgroundBlur, 200);
  assert.equal(settings.foregroundSize, 20);
  assert.equal(settings.backgroundMatchesForeground, true);
  assert.equal(videoOutputFileName({ metadata: { title: 'A/B: Track' } }, 0), '01 - A-B- Track.mp4');
});

test('video preview blur keeps its full backing resolution', () => {
  const normal = videoBlurPlan(28);
  const strong = videoBlurPlan(80);
  const drastic = videoBlurPlan(200);
  assert.deepEqual([normal.workingWidth, strong.workingWidth, drastic.workingWidth], [1280, 1280, 1280]);
  assert.ok(normal.sigma < strong.sigma);
  assert.ok(strong.sigma < drastic.sigma);
  assert.equal(videoPreviewStyle(0, 1280, 640).filter, 'none');
  assert.match(videoPreviewStyle(139, 1280, 640).filter, /^blur\([1-9]/);
  assert.ok(videoPreviewStyle(139, 1280, 640).scale > 1);
});

test('video templates apply layout settings without carrying release-specific files', () => {
  const current = normaliseVideoSettings({
    foreground: { source: 'file', path: '/current/cover.png', name: 'cover.png', kind: 'image' },
    background: { source: 'file', path: '/current/photo.jpg', name: 'photo.jpg', kind: 'image' },
  });
  const saved = videoTemplateSettings({
    foreground: { source: 'file', path: '/old/cover.png', name: 'old.png', kind: 'image' },
    backgroundBlur: 139,
    foregroundShadowEnabled: true,
    foregroundShadowIntensity: 62,
  });
  assert.equal(saved.foreground, undefined);
  const applied = applyVideoTemplate(current, saved);
  assert.equal(applied.foreground.path, '/current/cover.png');
  assert.equal(applied.background.path, '/current/photo.jpg');
  assert.equal(applied.backgroundBlur, 139);
  assert.equal(applied.foregroundShadowEnabled, true);
  assert.equal(applied.foregroundShadowIntensity, 62);
});

test('Canvas settings migrate the old effects into safe Spotify film projects', () => {
  const spotify = normaliseCanvasSettings({ durationSeconds: 60, positionX: 120, effect: 'gate-weave' });
  const tracks = normaliseCanvasSettings({ durationSeconds: 3, exportMode: 'tracks', outputFrameRate: 30 });
  assert.equal(spotify.durationSeconds, 8);
  assert.equal(spotify.positionX, 100);
  assert.equal(spotify.preset, 'clean-35mm');
  assert.equal(tracks.durationSeconds, 3);
  assert.equal(tracks.outputFrameRate, 30);
  assert.equal(tracks.exportMode, 'tracks');
});

test('Canvas variants create one release file or one safely named file per track', () => {
  const tracks = [
    { metadata: { title: 'First/Light' } },
    { metadata: { title: 'Second: Drift' } },
  ];
  assert.equal(canvasVariants({ exportMode: 'single' }, tracks, 'An/Ambient Record')[0].outputFileName, 'An-Ambient Record - Canvas.mp4');
  assert.deepEqual(
    canvasVariants({ exportMode: 'tracks' }, tracks, 'Release').map((item) => item.outputFileName),
    ['01 - First-Light - Canvas.mp4', '02 - Second- Drift - Canvas.mp4'],
  );
  assert.equal(canvasOutputFileName(tracks[0], 0), '01 - First-Light - Canvas.mp4');
});

test('film presets produce distinct states and every continuous property closes its loop', () => {
  assert.equal(CANVAS_PRESETS.length, 6);
  const frames = CANVAS_PRESETS.map(({ id }) => canvasPreviewFrame(applyCanvasPreset({}, id), 2.25, 4));
  assert.equal(new Set(frames.map((frame) => JSON.stringify(frame))).size, 6);
  for (const { id } of CANVAS_PRESETS) {
    const settings = applyCanvasPreset({}, id);
    const start = canvasPreviewFrame(settings, 0, 2);
    const loop = canvasPreviewFrame(settings, settings.durationSeconds, 2);
    assert.deepEqual(loop, start);
  }
});

test('procedural dirt scheduling is deterministic and wraps events across the seam', () => {
  const settings = normaliseCanvasSettings({ seed: 99, dustAmount: 80, scratchProbability: 100, scratchPersistence: 100 });
  const first = canvasEventSchedule(settings, 3);
  const second = canvasEventSchedule(settings, 3);
  assert.deepEqual(first, second);
  assert.ok(first.dust.length > 0);
  assert.equal(first.scratches.length, 1);
  const wrapped = { totalFrames: 192, dust: [{ birthFrame: 190, lifeFrames: 4 }], scratches: [], hairs: [], damage: [], lightLeaks: [], cueMarks: [] };
  assert.equal(activeCanvasEvents(wrapped, 0).dust.length, 1);
});

test('Canvas validation blocks missing sources and per-track exports without masters', () => {
  assert.deepEqual(canvasValidationErrors({}, true, 0), []);
  assert.match(canvasValidationErrors({ exportMode: 'tracks' }, false, 0).join(' '), /source/);
  assert.match(canvasValidationErrors({ exportMode: 'tracks' }, true, 0).join(' '), /master/);
});

test('late AI draft keeps concurrent writing and removed social slots intact', () => {
  const requested={fields:{longDescriptionInput:'Old story',shortDescriptionInput:''},socialPosts:[{id:'edited',title:'Original title',content:'Old caption'},{id:'removed',title:'Deleted slot',content:'Before'}]};
  const live=structuredClone(requested);live.fields.longDescriptionInput='Manual story';live.fields.releaseTitleInput='New title';live.socialPosts=[{id:'edited',title:'Renamed slot',content:'Manual caption'},{id:'new-local',title:'Local slot',content:'New caption'}];
  const result=mergeDraftIntoProject(live,{longDescriptionInput:'Model story',shortDescriptionInput:'Model summary',socialPosts:[{id:'edited',content:'Model caption'},{id:'removed',content:'Do not resurrect'},{id:'new-model',content:'Suggested caption'}]},requested);
  assert.equal(result.fields.longDescriptionInput,'Manual story');assert.equal(result.fields.releaseTitleInput,'New title');assert.equal(result.fields.shortDescriptionInput,'Model summary');
  assert.deepEqual(result.socialPosts.map(post=>post.id),['edited','new-local','new-model']);assert.equal(result.socialPosts[0].content,'Manual caption');assert.equal(result.socialPosts[0].title,'Renamed slot');
  assert.equal(mergeDraftIntoProject(live,{socialPosts:{}},requested).socialPosts.length,2);
});

test('null and malformed legacy settings use defaults instead of crashing preparation', () => {
  for (const damaged of [null, [], 'invalid']) {
    assert.deepEqual(normaliseVideoSettings(damaged), normaliseVideoSettings());
    assert.deepEqual(normaliseCanvasSettings(damaged), normaliseCanvasSettings());
    assert.deepEqual(normaliseArtistPreset(damaged), normaliseArtistPreset());
  }
});
