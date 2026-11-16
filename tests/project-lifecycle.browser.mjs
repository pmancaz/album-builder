/* Regression probes use an isolated browser and fake native commands. The test
   route exposes helpers only in this page; no test hooks ship in the app. */
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
let passed=0;
async function scenario(name,run) {
 const page=await browser.newPage();
 await page.route('**/@vite/client', route=>route.fulfill({contentType:'application/javascript',body:''}));
 await page.route('**/app.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.wash={state,elements,desktop,saveProject,newAlbum,loadProject,markUnsaved,serialiseProject,flushCurrentProject,setProjectArchived,deleteSavedProject,createTrack,resetHistory,requestApplicationClose,showLicenseStatus,refreshLicense,exportProject};'});});
 await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4174');await page.waitForFunction(()=>window.wash);await page.waitForTimeout(30);
 try {await run(page);passed++;console.log('PASS '+name);}finally{await page.close({runBeforeUnload:false});}
}
try {
await scenario('New flushes an edit inside the autosave delay',async page=>{
 const result=await page.evaluate(async()=>{const w=wash;w.elements.albumName.value='First';w.markUnsaved();await w.saveProject();const id=w.state.projectId;w.elements.albumName.value='Latest';w.markUnsaved();await w.newAlbum();return {saved:JSON.parse(localStorage.getItem('album-builder-projects')).find(p=>p.id===id).metadata.title,current:w.state.projectId};});assert.deepEqual(result,{saved:'Latest',current:null});
});
await scenario('New waits for the real save acknowledgement',async page=>{
 await page.evaluate(()=>{const w=wash;w.desktop.invoke=async cmd=>cmd==='save_project'?await new Promise(resolve=>window.finishSave=resolve):[];w.elements.albumName.value='Old';w.markUnsaved();window.saving=w.saveProject();window.changing=w.newAlbum();});
 assert.equal(await page.evaluate(()=>wash.elements.albumName.value),'Old');await page.evaluate(async()=>{finishSave({id:'ignored-native-id'});await saving;await changing;});assert.equal(await page.evaluate(()=>wash.state.projectId),null);
});
await scenario('A failed save keeps the open album and clears the overlay',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;w.desktop.invoke=async()=>{throw Error('disk full fixture')};w.elements.albumName.value='Keep me';w.markUnsaved();let failed=false;try{await w.newAlbum()}catch{failed=true}return {failed,title:w.elements.albumName.value,dirty:w.state.hasUnsavedChanges,loading:w.state.loadingProjectId,hidden:w.elements.projectLoading.hidden,inert:document.querySelector('.app-shell').inert};});assert.deepEqual(r,{failed:true,title:'Keep me',dirty:true,loading:null,hidden:true,inert:false});
});
await scenario('Malformed saved data leaves current album unchanged',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;w.elements.albumName.value='Current';w.desktop.invoke=async cmd=>cmd==='load_project'?{id:'bad',tracks:{}}:[];let failed=false;try{await w.loadProject('bad')}catch{failed=true}return {failed,title:w.elements.albumName.value,loading:w.state.loadingProjectId};});assert.deepEqual(r,{failed:true,title:'Current',loading:null});
});
await scenario('A missing source never replaces the current album with a partial load',async page=>{
 await page.route('**/fixture-not-present.wav', route=>route.fulfill({status:404,body:'missing fixture'}));
 const r=await page.evaluate(async()=>{const w=wash;w.elements.albumName.value='Keep sources';w.desktop.convertFileSrc=()=>'/fixture-not-present.wav';w.desktop.invoke=async cmd=>cmd==='load_project'?{id:'missing',tracks:[{id:'source',name:'Missing',nativePath:'/fixture/absent.wav'}]}:[];let failed=false;try{await w.loadProject('missing')}catch{failed=true}return {failed,title:w.elements.albumName.value,loading:w.state.loadingProjectId,hidden:w.elements.projectLoading.hidden};});assert.deepEqual(r,{failed:true,title:'Keep sources',loading:null,hidden:true});
});
await scenario('An unfinished album note survives save and reopen beside its log',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;w.elements.albumNotesInput.innerHTML='<div>Unfinished</div>';w.state.albumNoteEntries=[{id:'entry',content:'Logged',createdAt:new Date().toISOString()}];w.markUnsaved();await w.saveProject();const id=w.state.projectId;await w.newAlbum();await w.loadProject(id);return {draft:w.elements.albumNotesInput.textContent,log:document.querySelector('.album-note-content').textContent};});assert.deepEqual(r,{draft:'Unfinished',log:'Logged'});
});
await scenario('A library failure always unlocks the loading surface',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;w.desktop.invoke=async()=>{throw Error('read failure fixture')};try{await w.loadProject('anything')}catch{}return {loading:w.state.loadingProjectId,hidden:w.elements.projectLoading.hidden};});assert.deepEqual(r,{loading:null,hidden:true});
});
await scenario('Archiving waits for an outstanding save and preserves its final flag',async page=>{
 await page.evaluate(()=>{const w=wash;w.state.projectId='album';window.calls=[];w.desktop.invoke=async(cmd,args)=>{calls.push(cmd);if(cmd==='save_project')return new Promise(resolve=>window.finishSave=resolve);if(cmd==='list_projects')return [];};w.markUnsaved();window.saving=w.saveProject();window.archiving=w.setProjectArchived('album',true);});
 assert.deepEqual(await page.evaluate(()=>calls),['save_project']);await page.evaluate(async()=>{finishSave({id:'album'});await saving;await archiving;});assert.equal(await page.evaluate(()=>wash.state.isProjectArchived),true);
});
await scenario('Deleting the open saved record cancels its pending autosave',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;w.elements.albumName.value='To delete';w.markUnsaved();await w.saveProject();const id=w.state.projectId;w.elements.albumName.value='Last edit';w.markUnsaved();await w.deleteSavedProject(id);await new Promise(resolve=>setTimeout(resolve,850));return {count:JSON.parse(localStorage.getItem('album-builder-projects')).length,id:w.state.projectId};});assert.deepEqual(r,{count:0,id:null});
});
await scenario('Native Quit waits for a successful save',async page=>{
 await page.evaluate(()=>{const w=wash;window.commands=[];w.desktop.invoke=async(cmd)=>{commands.push(cmd);if(cmd==='save_project')return new Promise(resolve=>window.finishSave=resolve);if(cmd==='list_projects')return [];};w.elements.albumName.value='Last edit';w.markUnsaved();window.closing=w.requestApplicationClose();});
 assert.deepEqual(await page.evaluate(()=>commands),['save_project']);await page.evaluate(async()=>{finishSave({id:'saved'});await closing;});assert.equal((await page.evaluate(()=>commands)).at(-1),'confirm_app_close');
});
await scenario('Native Quit is not confirmed after a failed save',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;const commands=[];w.desktop.invoke=async cmd=>{commands.push(cmd);throw Error('disk full')};w.markUnsaved();await w.requestApplicationClose();return {commands,hidden:w.elements.projectLoading.hidden,dirty:w.state.hasUnsavedChanges};});assert.deepEqual(r,{commands:['save_project'],hidden:true,dirty:true});
});
await scenario('Expired offline licence exposes a diagnostic and can retry without restarting',async page=>{
 const first=await page.evaluate(()=>{const w=wash;w.state.licenseGateLocked=true;w.showLicenseStatus({configured:true,active:false,requiresActivation:false,keyHint:'••••fixture',lastValidatedAtMs:1,message:'Reconnect fixture'});w.elements.licenseDialog.showModal();return {retry:!w.elements.licenseCheckButton.hidden,report:!!w.elements.licenseDialog.querySelector('.error-report-notice')};});assert.deepEqual(first,{retry:true,report:true});
 const second=await page.evaluate(async()=>{const w=wash;w.desktop.invoke=async cmd=>cmd==='validate_license'?{configured:true,active:true,requiresActivation:false}:[];await w.refreshLicense();return {locked:w.state.licenseGateLocked,open:w.elements.licenseDialog.open};});assert.deepEqual(second,{locked:false,open:false});
});
await scenario('A staged native album retains usable sources and both note drafts',async page=>{
 const bytes=Buffer.alloc(44+16000*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 await page.route('**/fixture.wav',route=>route.fulfill({contentType:'audio/wav',body:bytes}));
 const r=await page.evaluate(async()=>{const w=wash;const fixture={id:'native-album',name:'Restored',metadata:{title:'Restored'},albumNotes:'<div>Album draft</div>',albumNoteEntries:[],tracks:[{id:'track',name:'Fixture',nativePath:'/fixture.wav',notes:'Track note'}],listeningDraft:{trackId:'track',seconds:0,text:'Listening draft'}};w.desktop.convertFileSrc=()=>'/fixture.wav';w.desktop.invoke=async cmd=>cmd==='load_project'?fixture:[];await w.loadProject(fixture.id);const track=w.state.tracks[0];return {name:w.elements.albumName.value,source:(await fetch(track.objectUrl)).ok,analysed:track.analysisState,draft:w.elements.albumNotesInput.textContent,listening:w.state.trackedNoteDraft.text,dirty:w.state.hasUnsavedChanges};});assert.deepEqual(r,{name:'Restored',source:true,analysed:'ready',draft:'Album draft',listening:'Listening draft',dirty:false});
});
await scenario('A legacy null release-copy section can open without destroying the session',async page=>{
 const r=await page.evaluate(async()=>{const w=wash;w.elements.albumName.value='Previous';w.desktop.invoke=async cmd=>cmd==='load_project'?{id:'legacy',name:'Legacy',metadata:{},tracks:[],releaseCopy:null}:[];await w.loadProject('legacy');return {title:w.elements.albumName.value,description:w.elements.releaseDescriptionInput.value,loading:w.state.loadingProjectId};});assert.deepEqual(r,{title:'Legacy',description:'',loading:null});
});
await scenario('Export warnings remain visible even when the metadata companion failed',async page=>{
 await page.evaluate(async()=>{const w=wash;w.state.tracks=[{id:'fixture',name:'Synthetic',nativePath:'/fixture.wav'}];w.desktop.open=async()=>'/exports';w.desktop.invoke=async()=>({exported:1,failed:0,outputDir:'/exports/Album',warnings:['Metadata companion could not be written: fixture failure']});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied fixture')}}});await w.exportProject();});
 await page.getByRole('button',{name:'copy export report',exact:true}).click();assert.match(await page.locator('.error-report-fallback').inputValue(),/Metadata companion could not be written: fixture failure/);
});
console.log(`${passed} lifecycle regressions passed (browser with synthetic IPC).`);
} finally {await browser.close();}
