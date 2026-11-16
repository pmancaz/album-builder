// Fresh browser storage and fake native cache only; no personal albums/files.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route(/\/app\.js(?:\?.*)?$/,async route=>{if(new URL(route.request().url()).pathname!='/app.js')return route.continue();const r=await route.fetch();await route.fulfill({response:r,body:await r.text()+'\nwindow.cacheTest={desktop,state,elements,createTrack,analyseTrack,ensureAlbumSpectrogram,loadProject,serialiseProject,replaceTrackAudio,render,resetHistory};'});});
function wav(frequency){const rate=16000,n=rate;const b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(1000*Math.sin(i/rate*Math.PI*2*frequency)),44+i*2);return [...b];}
try{
 await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4174');await page.waitForFunction(()=>window.cacheTest);
 const result=await page.evaluate(async({a,b})=>{
  const w=cacheTest,cache=new Map(),records=new Map();let decodes=0,writes=0;const decode=AudioContext.prototype.decodeAudioData;AudioContext.prototype.decodeAudioData=function(...args){decodes++;return decode.apply(this,args)};
  const nativeFiles=new Map([['/synthetic/a.wav',new File([new Uint8Array(a)],'same.wav',{lastModified:1})],['/synthetic/b.wav',new File([new Uint8Array(b)],'same.wav',{lastModified:1})]]);
  w.desktop.convertFileSrc=p=>URL.createObjectURL(nativeFiles.get(p));
  w.desktop.invoke=async(cmd,args={})=>{if(cmd==='read_analysis_cache')return structuredClone(cache.get(args.kind+args.key)||null);if(cmd==='write_analysis_cache'){cache.set(args.kind+args.key,structuredClone(args.value));writes++;return;}if(cmd==='save_project'){records.set(args.project.id,structuredClone(args.project));return args.project;}if(cmd==='load_project')return structuredClone(records.get(args.id));if(cmd==='list_projects')return [...records.values()];throw Error(cmd)};
  const t1=w.createTrack(nativeFiles.get('/synthetic/a.wav'),'/synthetic/a.wav');const t2=w.createTrack(nativeFiles.get('/synthetic/b.wav'),'/synthetic/b.wav');await w.analyseTrack(t1);await w.analyseTrack(t2);w.state.tracks=[t1,t2];w.render();await w.ensureAlbumSpectrogram();
  const cold=decodes;const first=w.state.albumSpectrogram.values.slice();
  const project=w.serialiseProject();records.set(project.id,project);w.state.hasUnsavedChanges=false;
  await w.loadProject(project.id);await w.ensureAlbumSpectrogram();const warm=decodes-cold;const equal=first.every((v,i)=>v===w.state.albumSpectrogram.values[i]);
  const beforeOrder=decodes;w.state.tracks.reverse();await w.ensureAlbumSpectrogram();const reorder=decodes-beforeOrder;
  // Same filename/size/time, actual new bytes at a saved path: reopening invalidates both cached passes.
  nativeFiles.set('/synthetic/a.wav',new File([new Uint8Array(b.map((v,i)=>i>44? v^1:v))],'same.wav',{lastModified:1}));
  const beforeEdit=decodes;await w.loadProject(project.id);await w.ensureAlbumSpectrogram();const edit=decodes-beforeEdit;
  // Replacing with an already analysed source needs neither decoding nor FFT again.
  const beforeReplace=decodes;w.resetHistory();await w.replaceTrackAudio(w.state.tracks[0].id,nativeFiles.get('/synthetic/b.wav'),'/synthetic/b.wav');await w.ensureAlbumSpectrogram();const replace=decodes-beforeReplace;
  // A damaged cache is a miss, not an album-load failure.
  for(const [key] of cache)if(key.startsWith('waveform'))cache.set(key,{bad:true});
  const beforeCorrupt=decodes;await w.loadProject(project.id);const corrupt=decodes-beforeCorrupt;
  // New sources automatically populate their own analysis and can be removed without affecting others.
  const beforeAdd=writes;const added=w.createTrack(new File([new Uint8Array(b)],'renamed.wav'),'/synthetic/renamed.wav');await w.analyseTrack(added);w.state.tracks.push(added);await w.ensureAlbumSpectrogram();const ready=added.analysisState;
  return {cold,warm,equal,reorder,edit,replace,corrupt,ready,reused:writes===beforeAdd};
 },{a:wav(220),b:wav(880)});
 console.log(result); assert.equal(result.cold,4);assert.equal(result.warm,0);assert.equal(result.equal,true);assert.equal(result.reorder,0);assert.equal(result.edit,2);assert.equal(result.replace,0);assert.equal(result.corrupt,2);assert.equal(result.ready,'ready');assert.equal(result.reused,true);assert.deepEqual(errors,[]);console.log('PASS real decode/FFT cold vs reopen, content edit, reorder, replace, corruption and renamed/add cache reuse',JSON.stringify(result));
}finally{await browser.close()}
