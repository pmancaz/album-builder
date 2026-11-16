import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseProject, readBrowserProjects } from '../project-data.js';

test('modern album keeps an unfinished note and its saved log separately', () => {
 const project=normaliseProject({albumNotes:'draft',albumNoteEntries:[{content:'saved'}]});
 assert.equal(project.albumNotes,'draft');assert.equal(project.albumNoteEntries[0].content,'saved');
});
test('legacy single note becomes a saved note without duplicating it', () => {
 const project=normaliseProject({albumNotes:'older note'});assert.equal(project.albumNotes,'');assert.equal(project.albumNoteEntries[0].content,'older note');
});
test('invalid records are rejected before replacing an open session', () => {
 for(const bad of [null,[],{schemaVersion:3},{tracks:{}},{tracks:[null]},{tracks:[{id:'same'},{id:'same'}]},{tracks:[{trackedNotes:[{text:'bad',seconds:-1}]}]},{transitionLayout:{placements:[{trackId:'x',lane:7,start:0}]}},{albumNoteEntries:[{}]}]) assert.throws(()=>normaliseProject(bad));
});
test('saved audio identifiers, native paths, notes and custom layout survive validation', () => {
 const input={id:'album',tracks:[{id:'a',nativePath:'/Music/Track.wav',name:'Song',notes:'note',status:'master',trackedNotes:[{id:'n',seconds:4,text:'Listen'}]}],transitionLayout:{placements:[{id:'p',trackId:'a',lane:1,start:3,fadeIn:1,fadeOut:2}]}};
 const result=normaliseProject(input);assert.deepEqual(result.tracks,input.tracks);assert.deepEqual(result.transitionLayout,input.transitionLayout);
});
test('malformed browser library is preserved instead of silently replaced', () => {
 for(const json of ['{','{}','[null]']) {const storage={getItem:()=>json};assert.throws(()=>readBrowserProjects(storage));}
 assert.deepEqual(readBrowserProjects({getItem:()=>null}),[]);
});

test('saved artwork cannot silently load a remote tracking URL', () => {
 assert.throws(()=>normaliseProject({artworkDataUrl:'https://example.invalid/image.png'}));
 assert.equal(normaliseProject({artworkDataUrl:'data:image/png;base64,AAAA'}).artworkDataUrl,'data:image/png;base64,AAAA');
});

test('null optional release copy is normalized before a session is replaced', () => {
 const project=normaliseProject({releaseCopy:null});assert.equal(project.releaseCopy.description,'');assert.deepEqual(Object.keys(project.releaseCopy.links).length,7);
 assert.throws(()=>normaliseProject({releaseCopy:42}));
});
