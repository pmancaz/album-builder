import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisKey, validWaveform, packSpectrum, unpackSpectrum, fitSpectrum } from '../analysis-cache.js';
test('audio identity follows bytes despite unchanged path, size and timestamps; profile revisions invalidate', async()=>{
 const a=new File(['aaaa'],'same.wav',{lastModified:1});const b=new File(['bbbb'],'same.wav',{lastModified:1});
 assert.notEqual(await analysisKey(a,'waveform:48000'),await analysisKey(b,'waveform:48000'));
 assert.equal(await analysisKey(a,'waveform:48000'),await analysisKey(new File(['aaaa'],'renamed.wav'),'waveform:48000'));
 assert.notEqual(await analysisKey(a,'waveform:48000'),await analysisKey(a,'waveform:44100'));
});
test('corrupt waveform and spectrum entries are rejected and valid spectra round trip',()=>{
 assert.ok(validWaveform({duration:1,waveform:[[-1,1]],peakDb:0,lufs:null}));
 assert.ok(!validWaveform({duration:1,waveform:[[NaN,1]],peakDb:0,lufs:0}));
 const part={columns:2,rows:2,peakDb:-1,values:new Float32Array([-1,-2,-3,-4])};const packed=packSpectrum(part);
 assert.deepEqual(unpackSpectrum(packed,2,2),part); assert.equal(unpackSpectrum(packed,3,2),null);assert.equal(unpackSpectrum({...packed,data:'broken'},2,2),null);
 assert.deepEqual([...fitSpectrum(part,1)],[-1,-2]); assert.deepEqual([...fitSpectrum(part,0)],[]);
});
