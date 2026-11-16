import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4174';
const errors = [];
async function scenario(name, run) {
 const context = await browser.newContext(); const page = await context.newPage();
 await page.route(/\/app\.js(?:\?.*)?$/, async route => {
  if (new URL(route.request().url()).pathname !== '/app.js') return route.continue();
  const response = await route.fetch();
  await route.fulfill({ response, body: await response.text() + '\nwindow.bridgeWash={state,elements,desktop,saveProject,newAlbum,loadProject,applyHistory,historySnapshot,undo,redo,markUnsaved,hydratePreparation,receivePreparation,serialiseProject,setReleaseCopyView,resetAlbumState,initialiseLicense,exportProject, get api(){return preparationApi;}, set api(value){preparationApi=value;}};' });
 });
 await page.goto(base); await page.waitForFunction(() => window.bridgeWash);
 try { await run(page); console.log('PASS ' + name); } catch (error) { errors.push({ name, error }); console.error('FAIL ' + name + ': ' + error.message); }
 finally { await context.close(); }
}
try {
 await scenario('saving a different album never acknowledges the previous preparation or updates its package', async page => {
  const result = await page.evaluate(async () => {
   const w = bridgeWash; window.acks = [];
   const api = { busy: () => false, pause() {}, theme() {}, revision: () => 0, snapshot: () => ({ version:10, fields:{}, masters:[] }), async hydrate() {}, async saved(...args) { acks.push(args); } };
   await AlbumPreparationHost.ready(api);
   w.state.projectId = 'old'; w.state.preparation = { version:10, fields:{releaseTitleInput:'Old'}, masters:[], exportState:{outputDir:'/old',folderName:'Package'} };
   await w.newAlbum(); w.elements.albumName.value = 'New'; w.markUnsaved(); await w.saveProject();
   return { acks:acks.length, title:w.elements.albumName.value };
  });
  assert.deepEqual(result,{acks:0,title:'New'});
 });
 await scenario('Undo rebinds visible preparation before the next edit', async page => {
  const result = await page.evaluate(async () => {
   const w = bridgeWash; document.querySelector('#preparationFrame').src='about:blank'; const hydrated=[]; let bound;
   const api={ busy:()=>false,pause(){},theme(){},revision:()=>0,snapshot:()=>({version:10,fields:{},masters:[]}),async saved(){},async hydrate(project,generation){bound=generation;hydrated.push(generation);} };
   await AlbumPreparationHost.ready(api); w.setReleaseCopyView(true); await new Promise(resolve=>setTimeout(resolve,0));
   const snapshot=w.historySnapshot(); snapshot.metadata.title='Restored'; snapshot.releasePreparation={version:10,fields:{releaseTitleInput:'Restored'},masters:[]};
   w.applyHistory(snapshot); await new Promise(resolve=>setTimeout(resolve,20));
   let rejected=false;try{w.receivePreparation({version:10,fields:{releaseTitleInput:'After undo'},masters:[]},bound);}catch{rejected=true;}
   return {rejected,bound,current:w.state.sessionGeneration,title:w.elements.albumName.value};
  });
  assert.equal(result.rejected,false);assert.equal(result.bound,result.current);assert.equal(result.title,'After undo');
 });
 await scenario('a save does not clear a newer preparation revision', async page => {
  const result = await page.evaluate(async () => {
   const w=bridgeWash;let revision=1;window.acks=[];let resolveDisk;
   const api={busy:()=>false,pause(){},theme(){},snapshot:()=>({version:10,fields:{releaseTitleInput:'One'},masters:[]}),revision:()=>revision,async hydrate(){},async saved(...args){acks.push(args);}};
   await AlbumPreparationHost.ready(api);
   w.state.preparation={version:10,fields:{releaseTitleInput:'One'},masters:[]};w.elements.albumName.value='One';w.markUnsaved();
   w.desktop.invoke=async cmd=>cmd==='save_project'?await new Promise(resolve=>{resolveDisk=resolve;}):[];
   const saving=w.saveProject();revision=2;w.receivePreparation({version:10,fields:{releaseTitleInput:'Two'},masters:[]},w.state.sessionGeneration);resolveDisk({});await saving;
   clearTimeout(w.state.autoSaveTimer);return {acks:acks.length,dirty:w.state.hasUnsavedChanges,title:w.elements.albumName.value};
  });
  assert.deepEqual(result,{acks:0,dirty:true,title:'Two'});
 });
 await scenario('legacy masters missing display details open in the preparation UI',async page=>{
  await page.evaluate(()=>{
   bridgeWash.state.preparation={version:4,fields:{},masters:[{path:'/synthetic/Master.WAV',metadata:{title:'Master'}}]};
   bridgeWash.setReleaseCopyView(true);
  });
  await page.waitForFunction(()=>!document.querySelector('#preparationFrame').hidden||document.querySelector('#preparationLoading').textContent.includes('could not open'));
  assert.equal(await page.locator('#preparationFrame').isVisible(),true);
  await page.frameLocator('#preparationFrame').locator('[data-stage=masters]').click();
  assert.equal(await page.frameLocator('#preparationFrame').locator('.source-name').textContent(),'Master.WAV');
 });
 await scenario('active preparation work cannot be hidden or reconstructed by a parent save', async page=>{
  const result=await page.evaluate(async()=>{
   const w=bridgeWash;document.querySelector('#preparationFrame').src='about:blank';let busy=false;let hydrations=0;
   const api={busy:()=>busy,pause(){},theme(){},revision:()=>0,snapshot:()=>({version:10,fields:{releaseTitleInput:'Prior'},masters:[]}),async hydrate(){hydrations++;},async saved(){}};
   await AlbumPreparationHost.ready(api);w.setReleaseCopyView(true);await new Promise(resolve=>setTimeout(resolve,0));
   busy=true;const before=hydrations;w.setReleaseCopyView(false);
   w.state.preparation={version:10,fields:{releaseTitleInput:'Prior'},masters:[]};w.elements.albumName.value='Canonical';w.markUnsaved();await w.saveProject();
   return {visible:!w.elements.releaseCopyView.hidden,extraHydrations:hydrations-before};
  });
  assert.deepEqual(result,{visible:true,extraHydrations:0});
 });
 await scenario('prototype desktop opens without activation and still saves and exports', async page => {
  const result = await page.evaluate(async () => {
   const w=bridgeWash;const commands=[];
   w.desktop.invoke=async (cmd,args)=>{
    commands.push(cmd);
    if(cmd==='get_license_state')return {licensingRequired:false,active:true,configured:false};
    if(cmd==='list_projects')return [];
    if(cmd==='save_project')return args.project;
    if(cmd==='export_album')return {exported:1,failed:0,outputDir:'/synthetic-export/Prototype'};
    throw Error('Unexpected command: '+cmd);
   };
   w.desktop.open=async()=>'/synthetic-export';
   w.state.licenseGateLocked=true;w.elements.licenseDialog.showModal();
   await w.initialiseLicense();
   w.state.tracks=[{id:'one',name:'One',nativePath:'/synthetic/one.wav'}];w.elements.albumName.value='Prototype';w.markUnsaved();
   await w.saveProject();await w.exportProject();
   return {commands,locked:w.state.licenseGateLocked,open:w.elements.licenseDialog.open,licenseHidden:w.elements.licenseButton.hidden,dirty:w.state.hasUnsavedChanges};
  });
  assert.deepEqual(result,{commands:['get_license_state','save_project','list_projects','export_album'],locked:false,open:false,licenseHidden:true,dirty:false});
 });
 await scenario('licensed builds still validate a saved activation when the prototype flag is absent', async page => {
  const result=await page.evaluate(async()=>{
   const w=bridgeWash;const commands=[];
   w.desktop.invoke=async cmd=>{commands.push(cmd);return {configured:true,active:true,requiresActivation:false};};
   await w.initialiseLicense();await new Promise(resolve=>setTimeout(resolve,0));
   return {commands,licenseHidden:w.elements.licenseButton.hidden};
  });
  assert.deepEqual(result,{commands:['get_license_state','validate_license'],licenseHidden:false});
 });
 await scenario('overlapping hydration only reveals the latest album reconstruction', async page=>{
  const result=await page.evaluate(async()=>{
   const w=bridgeWash;let finishFirst;const hydrated=[];
   const api={busy:()=>false,pause(){},theme(){},snapshot:()=>({version:10,fields:{},masters:[]}),revision:()=>0,async saved(){},async hydrate(project){hydrated.push(project.fields.releaseTitleInput);if(hydrated.length===1)await new Promise(resolve=>finishFirst=resolve);}};
   w.api=api;
   w.elements.albumName.value='First';const first=w.hydratePreparation();
   await new Promise(resolve=>setTimeout(resolve,0));
   w.elements.albumName.value='Latest';const latest=w.hydratePreparation();
   finishFirst();const results=await Promise.all([first,latest]);
   return {hydrated,results,hidden:document.querySelector('#preparationFrame').hidden};
  });
  assert.deepEqual(result,{hydrated:['First','Latest'],results:[false,true],hidden:false});
 });
} finally { await browser.close(); }
if (errors.length) { console.error(`${errors.length} bridge checks failed`); process.exitCode=1; }
