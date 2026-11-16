import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparationForAlbum,validatePreparation} from '../release-preparation-data.js';
const album=()=>({id:'album',metadata:{title:'Album',artist:'Release artist',composer:'Release composer',genre:'Ambient',comment:'Release comment'},releaseCopy:{description:'Story',credits:'Credits',releaseDate:'2027-01-01',links:{}},tracks:[{id:'one',name:'One',nativePath:'/one.wav',duration:10},{id:'two',name:'Two',nativePath:'/two.wav',duration:10}]});
test('an intentionally blank master field remains blank after switching stages',()=>{
 const a=album();a.releasePreparation=preparationForAlbum(a);
 for(const key of ['artist','composer','genre','comment'])a.releasePreparation.masters[0].metadata[key]='';
 const after=preparationForAlbum(a);
 for(const key of ['artist','composer','genre','comment'])assert.equal(after.masters[0].metadata[key],'',key);
});
test('preparation-only masters keep their chosen position among linked album masters',()=>{
 const a=album();a.releasePreparation=preparationForAlbum(a);
 a.releasePreparation.masters.splice(1,0,{id:'bonus',path:'/bonus.wav',metadata:{title:'Bonus'}});
 assert.deepEqual(preparationForAlbum(a).masters.map(t=>t.id),['one','bonus','two']);
 a.tracks.reverse();
 assert.deepEqual(preparationForAlbum(a).masters.map(t=>t.id),['bonus','two','one']);
});
test('malformed preparation metadata and collections fail before replacing an open album',()=>{
 for(const bad of [
  {fields:{},masters:[{path:'/a.wav',metadata:[]}]},
  {fields:{},masters:[{path:'/a.wav',metadata:{title:4}}]},
  {fields:{},masters:[],albumTrackIds:{}},
  {fields:{},masters:[],socialPosts:[null]},
  {fields:{},masters:[],artwork:[]},
  {fields:{},masters:[],video:'bad'},
 ])assert.throws(()=>validatePreparation(bad));
});

test('legacy preparation masters without display details receive safe source defaults',()=>{
 const legacy={fields:{},masters:[{path:'/archive/Master.Final.WAV',metadata:{title:'Master'}}]};
 const prepared=validatePreparation(legacy);
 assert.equal(prepared.masters[0].fileName,'Master.Final.WAV');
 assert.equal(prepared.masters[0].extension,'wav');
 assert.equal(prepared.masters[0].durationSeconds,0);
 assert.equal(legacy.masters[0].fileName,undefined);
});
