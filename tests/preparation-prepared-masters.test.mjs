import test from 'node:test';
import assert from 'node:assert/strict';
import { relinkPreparedMasters } from '../preparation/prepared-masters.js';

test('prepared masters keep their IDs and order while adopting rescanned details', () => {
  const masters = [
    {
      id: 'track-one',
      path: '/Originals/rough-name.wav',
      fileName: 'rough-name.wav',
      extension: 'wav',
      durationSeconds: 60,
      formatName: 'wav',
      metadata: {
        title: 'Hand-edited title',
        artist: 'Hand-edited artist',
        album: 'Hand-edited album',
        genre: '',
      },
    },
    {
      id: 'track-two',
      path: '/Originals/second.wav',
      fileName: 'second.wav',
      extension: 'wav',
      metadata: { title: 'Second track' },
    },
  ];
  const originalSnapshot = structuredClone(masters);
  const preparedPath = '/Exports/Fourth Cause/Masters/BH001 - 01 - First Cause.wav';

  const result = relinkPreparedMasters(
    masters,
    [{ id: 'track-one', path: preparedPath }],
    [{
      path: preparedPath,
      fileName: 'BH001 - 01 - First Cause.wav',
      extension: 'wav',
      durationSeconds: 64.25,
      formatName: 'wav',
      metadata: {
        title: '',
        artist: 'Bounty Hill',
        album: '   ',
        genre: 'ambient',
      },
    }],
  );

  assert.deepEqual(result.map((master) => master.id), ['track-one', 'track-two']);
  assert.equal(result[0].path, preparedPath);
  assert.equal(result[0].fileName, 'BH001 - 01 - First Cause.wav');
  assert.equal(result[0].extension, 'wav');
  assert.equal(result[0].durationSeconds, 64.25);
  assert.equal(result[0].formatName, 'wav');
  assert.equal(result[0].metadata.title, 'Hand-edited title');
  assert.equal(result[0].metadata.artist, 'Bounty Hill');
  assert.equal(result[0].metadata.album, 'Hand-edited album');
  assert.equal(result[0].metadata.genre, 'ambient');
  assert.strictEqual(result[1], masters[1]);
  assert.deepEqual(masters, originalSnapshot);
});

test('a prepared path still relinks safely when its rescan is missing or empty', () => {
  const masters = [{
    id: 'track-one',
    path: '/Originals/track.aiff',
    fileName: 'track.aiff',
    extension: 'aiff',
    durationSeconds: 91,
    formatName: 'aiff',
    metadata: { title: 'Edited title', composer: 'Patrick Carroll' },
  }];
  const preparedPath = '/Exports/Release/Masters/01 - Prepared Master.WAV';

  const result = relinkPreparedMasters(
    masters,
    [
      { id: 'track-one', path: preparedPath },
      { id: 'not-in-this-project', path: '/Exports/Release/Masters/extra.wav' },
    ],
    [{
      path: preparedPath,
      fileName: '',
      extension: '',
      durationSeconds: null,
      formatName: ' ',
      metadata: { title: '', composer: null },
    }],
  );

  assert.equal(result[0].path, preparedPath);
  assert.equal(result[0].fileName, '01 - Prepared Master.WAV');
  assert.equal(result[0].extension, 'wav');
  assert.equal(result[0].durationSeconds, 91);
  assert.equal(result[0].formatName, 'aiff');
  assert.deepEqual(result[0].metadata, {
    title: 'Edited title',
    composer: 'Patrick Carroll',
  });
  assert.equal(result[0].id, 'track-one');
});
