import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4174';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const page = await browser.newPage({viewport:{width:1440,height:940}});
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(()=>{localStorage.setItem('release-preparer-artwork-presets-v1',JSON.stringify([null,{id:'valid-art',name:'Surviving artwork',settings:null}]));localStorage.setItem('release-preparer-video-presets-v1',JSON.stringify([null,{id:'valid-video',name:'Surviving video',settings:null}]));localStorage.setItem('release-preparer-default-video-preset-v1','valid-video');localStorage.setItem('release-preparer-artist-presets-v1',JSON.stringify([null,{id:'valid-artist',name:'Surviving artist'}]));});
const fixture = { version:10, id:'wash-fixture', name:'Wash fixture', fields:{releaseTitleInput:'Wash fixture',artistInput:'Fixture artist',filenamePatternInput:'{track} - {artist} - {title}',brainstormInput:'Fixture writing notes'}, masters:[], socialPosts:[{id:'post',title:'Fixture post',content:'Before draft'}] };
// Only the served test copy exposes controls. Product sources and real native
// commands/data are never used by this isolated fake desktop host.
await page.route('**/preparation/app.js*', async route => {
 const response = await route.fetch();
 await route.fulfill({response, body: await response.text() + `\nwindow.washPreparation={state,elements,desktop,chooseMasters,toggleMasterPlayback,seekMasterPreview,stopMasterPreview,drawArtwork,ensureArtworkReady,chooseImage,drawVideoPreview,drawCanvasPreview,clearVisualPreviewMedia,loadVideoPreviewMedia,toggleVideoPreview,showStage,showVideoPanel,exportTrackVideos,exportCanvases,previewCompressedCanvas,exportRelease,generateAiDraft,markDirty,masterPreviewAudio,setImageLoader:fn=>loadImage=fn,previewResources:()=>({elements:videoPreviewElements.size,videoTimer:!!videoPreviewTimer,canvasTimer:!!canvasPreviewTimer})};`});
});
await page.route('**/wash-preparation-host', route => route.fulfill({contentType:'text/html',body:`<style>body{margin:0}iframe{width:100vw;height:100vh;border:0;display:block}</style><script>
window.calls=[]; window.fixture=${JSON.stringify(fixture)};
window.fakeInvoke=async(command,args)=>{calls.push([command,args]);if(command==='list_projects')return[];if(command==='openai_api_key_status')return{saved:true,hint:'fixture'};throw Error('Unexpected fake command '+command)};
window.fakeOpen=async()=>null; window.fakeListen=async()=>()=>{};
window.AlbumPreparationHost={isDesktop:()=>true,theme:()=> 'day',linkPresets:()=>[],invoke:(...args)=>fakeInvoke(...args),open:(...args)=>fakeOpen(...args),listen:(...args)=>fakeListen(...args),convertFileSrc:path=>path,changed:()=>{},save:async()=>({id:'wash-fixture'}),ready:async api=>{window.api=api;await api.hydrate(fixture,1);window.ready=true}};
</script><iframe src='/preparation/index.html'></iframe>`}));
try {
 await page.goto(`${base}/wash-preparation-host`); await page.waitForFunction(()=>window.ready);
 const frame = page.frames().find(frame=>frame.url().includes('/preparation/index.html'));
 const run = fn => frame.evaluate(fn);
 assert.equal(await run(()=>Array.from(washPreparation.elements.artworkPresetSelect.options).some(option=>option.text==='Surviving artwork')),true);
 assert.equal(await run(()=>Array.from(washPreparation.elements.videoPresetSelect.options).some(option=>option.text==='Surviving video')),true);
 console.log('PASS damaged legacy template rows cannot prevent preparation startup or hide valid templates');

 await frame.locator('[data-stage=promotion]').click();
 assert.equal(await frame.locator('[data-stage=promotion]').getAttribute('aria-current'),'step');
 assert.equal(await frame.locator('[data-stage=release]').getAttribute('aria-current'),null);
 const copyTab=frame.locator('#copy-tab-bandcamp');await copyTab.focus();await copyTab.press('ArrowRight');
 assert.equal(await frame.locator('#copy-tab-youtube').getAttribute('aria-selected'),'true');
 assert.equal(await frame.locator('#copyPreview').getAttribute('aria-labelledby'),'copy-tab-youtube');
 await frame.locator('#copy-tab-youtube').press('End');assert.equal(await frame.locator('#copy-tab-tags').getAttribute('aria-selected'),'true');
 await frame.locator('#copy-tab-tags').press('Home');await frame.locator('#copy-tab-bandcamp').press('Tab');
 assert.equal(await frame.locator('#copyPreview').evaluate(element=>element===document.activeElement),true);
 await frame.locator('[data-stage=video]').click();await frame.locator('#showTrackVideosButton').focus();await frame.locator('#showTrackVideosButton').press('ArrowRight');
 assert.equal(await frame.locator('#showCanvasesButton').getAttribute('aria-selected'),'true');assert.equal(await frame.locator('#canvasesPanel').isVisible(),true);assert.equal(await frame.locator('#trackVideosPanel').isVisible(),false);
 await frame.locator('#showCanvasesButton').press('Home');assert.equal(await frame.locator('#showTrackVideosButton').getAttribute('aria-selected'),'true');
 await frame.locator('[data-stage=release]').click();
 console.log('PASS stage state and copy/video tab selection are accessible through keyboard and semantic relationships');

 const compilation=frame.getByRole('combobox',{name:'Compilation',exact:true});assert.equal(await compilation.count(),1);
 await compilation.focus();
 const focusSize=await compilation.evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,clip:getComputedStyle(element).clip}));
 assert.ok(focusSize.width>80&&focusSize.height>20);assert.equal(focusSize.clip,'auto');
 await compilation.selectOption('true');assert.equal(await compilation.inputValue(),'true');
 const customCompilation=frame.locator('#compilationInput').locator('..');
 assert.equal(await customCompilation.locator('.custom-select-trigger').getAttribute('aria-hidden'),'true');assert.equal(await customCompilation.locator('.custom-select-trigger').getAttribute('tabindex'),'-1');
 await compilation.press('Tab');assert.equal(await frame.locator('#copyrightInput').evaluate(element=>element===document.activeElement),true);
 await customCompilation.locator('.custom-select-trigger').click();await customCompilation.locator('.custom-select-option[data-value="false"]').click();assert.equal(await compilation.inputValue(),'false');
 console.log('PASS each enhanced select has one labelled native keyboard control with visible focus and working pointer menu');
 await page.evaluate(()=>{fakeOpen=async()=>['/fixture/one.wav','/fixture/two.wav','/fixture/three.wav'];fakeInvoke=async(command)=>command==='inspect_audio'?[1,2,3,3].map(n=>({path:`/fixture/${n}.wav`,fileName:`Track ${n}.wav`,durationSeconds:10,metadata:{title:'',artist:'',album:'',trackNumber:'',composer:'',genre:'',isrc:'',comment:''}})):[];});
 await run(async()=>{await washPreparation.chooseMasters();});
 assert.deepEqual(await run(()=>washPreparation.state.masters.map(t=>t.metadata.trackNumber)),['1','2','3']);
 assert.equal(await run(()=>washPreparation.state.masters.length),3);
 console.log('PASS master batches receive contiguous numbers and duplicate paths are ignored');

 await run(()=>{const a=washPreparation.masterPreviewAudio;let paused=true;Object.defineProperty(a,'paused',{get:()=>paused});Object.defineProperty(a,'ended',{get:()=>false});a.pause=()=>{paused=true};a.load=()=>{};a.play=async()=>{paused=false;window.played=(window.played||0)+1};});
 await page.evaluate(()=>{window.previewResolvers={};fakeInvoke=(command,args)=>command==='allow_audio_preview'?new Promise(resolve=>previewResolvers[args.path]=resolve):Promise.resolve([]);});
 await run(()=>{window.previewA=washPreparation.toggleMasterPlayback(washPreparation.state.masters[0]);window.previewB=washPreparation.toggleMasterPlayback(washPreparation.state.masters[1]);});
 await page.evaluate(()=>previewResolvers['/fixture/2.wav']('data:audio/wav;base64,AAAA'));await run(()=>window.previewB);
 await page.evaluate(()=>previewResolvers['/fixture/1.wav']('data:audio/wav;base64,BBBB'));await run(()=>window.previewA);
 assert.equal(await run(()=>washPreparation.state.previewTrackId),await run(()=>washPreparation.state.masters[1].id));
 assert.equal(await run(()=>window.played),1);
 await run(()=>{window.previewReturn=washPreparation.toggleMasterPlayback(washPreparation.state.masters[0]);});
 await run(()=>washPreparation.toggleMasterPlayback(washPreparation.state.masters[1]));
 await page.evaluate(()=>previewResolvers['/fixture/1.wav']('data:audio/wav;base64,BBBB'));await run(()=>window.previewReturn);
 assert.equal(await run(()=>washPreparation.state.previewTrackId),await run(()=>washPreparation.state.masters[1].id));
 await run(()=>{window.previewC=washPreparation.toggleMasterPlayback(washPreparation.state.masters[2]);washPreparation.stopMasterPreview();});
 await page.evaluate(()=>previewResolvers['/fixture/3.wav']('data:audio/wav;base64,CCCC'));await run(()=>window.previewC);
 assert.equal(await run(()=>washPreparation.state.previewTrackId),null);assert.equal(await run(()=>window.played),2);
 console.log('PASS out-of-order preview authorization and stop cannot start an old master');

 await run(()=>{washPreparation.state.lastExportDir='/fixture';washPreparation.state.lastExportFolderName='Package';washPreparation.state.backgroundDataUrl='data:image/png;base64,fixture';});
 await page.evaluate(()=>{fakeListen=async()=>{throw Error('Fixture listener unavailable')};});
 for(const operation of ['exportTrackVideos','exportCanvases','previewCompressedCanvas']){
  await frame.evaluate(async operation=>{await washPreparation[operation]();},operation);
  assert.equal(await page.evaluate(()=>api.busy()),false,operation+' releases busy state');
  assert.match(await frame.evaluate(operation=>washPreparation.elements[operation==='exportTrackVideos'?'videoExportStatus':'canvasExportStatus'].textContent,operation),/Fixture listener unavailable/);
 }
 assert.equal(await run(()=>washPreparation.state.videoExportActiveId),'');assert.equal(await run(()=>washPreparation.state.canvasExportActiveId),'');
 console.log('PASS encoder-listener failures recover every export and compressed-preview control');

 await page.evaluate(()=>{fakeListen=async()=>()=>{};window.exportResolvers=[];fakeInvoke=(command,args)=>{calls.push([command,args]);if(command==='export_track_videos')return new Promise(resolve=>exportResolvers.push(resolve));return Promise.resolve([])};});
 await run(()=>{washPreparation.state.videoSettings.logoEnabled=false;window.videoExportOne=washPreparation.exportTrackVideos();window.videoExportTwo=washPreparation.exportTrackVideos();});
 await page.waitForFunction(()=>window.exportResolvers.length===1);await run(()=>window.videoExportTwo);
 assert.equal(await page.evaluate(()=>exportResolvers.length),1);
 await page.evaluate(()=>exportResolvers[0]({exported:0,failed:0,encoder:'fixture',destination:'/fixture'}));await run(()=>window.videoExportOne);
 console.log('PASS duplicate video exports are suppressed before encoding');

 await page.evaluate(()=>{window.draftResolve=null;fakeInvoke=(command,args)=>{calls.push([command,args]);if(command==='list_projects')return Promise.resolve([]);if(command==='generate_release_copy')return new Promise(resolve=>draftResolve=resolve);if(command==='openai_api_key_status')return Promise.resolve({saved:true,hint:'fixture'});throw Error(command)};});
 await run(()=>{washPreparation.state.lastExportDir='';washPreparation.state.openAiKeySaved=true;window.draft=washPreparation.generateAiDraft();});
 await page.waitForFunction(()=>window.draftResolve);
 await run(()=>{washPreparation.elements.releaseTitleInput.value='New title while drafting';washPreparation.elements.longDescriptionInput.value='Manual story while drafting';washPreparation.state.socialPosts.find(p=>p.id==='post').content='Manual post';washPreparation.markDirty();});
 await page.evaluate(()=>draftResolve({longDescriptionInput:'Stale model story',shortDescriptionInput:'New model summary',socialPosts:[{id:'post',title:'Model title',content:'Stale model post'}]}));await run(()=>window.draft);
 assert.equal(await run(()=>washPreparation.elements.releaseTitleInput.value),'New title while drafting');
 assert.equal(await run(()=>washPreparation.elements.longDescriptionInput.value),'Manual story while drafting');
 assert.equal(await run(()=>washPreparation.elements.shortDescriptionInput.value),'New model summary');
 assert.equal(await run(()=>washPreparation.state.socialPosts.find(p=>p.id==='post').content),'Manual post');
 console.log('PASS late AI copy preserves concurrent facts, writing and social edits');

 await page.evaluate(()=>{fakeInvoke=async(command,args)=>{calls.push([command,args]);return {updated:1,destination:'/fixture'}};});
 await run(()=>{washPreparation.state.lastExportDir='/fixture';washPreparation.state.lastExportFolderName='Package';washPreparation.markDirty();});
 const revision=await page.evaluate(()=>api.revision());
 assert.equal(await page.evaluate(revision=>api.saved('other-album',2,revision),revision),false);
 assert.equal(await page.evaluate(revision=>api.saved('wash-fixture',1,revision-1),revision),false);
 assert.equal(await run(()=>washPreparation.state.dirty),true);
 const before=await page.evaluate(()=>calls.filter(([c])=>c==='update_non_music_files').length);
 assert.equal(await page.evaluate(revision=>api.saved('wash-fixture',1,revision),revision),true);
 assert.equal(await page.evaluate(()=>calls.filter(([c])=>c==='update_non_music_files').length),before+1);
 console.log('PASS save acknowledgments require the current album generation and exact edit revision');

 await run(async()=>{washPreparation.state.lastExportDir='';const realLoader=async()=>{const c=document.createElement('canvas');c.width=2;c.height=2;return c};window.resolveDrawing=null;washPreparation.setImageLoader(()=>new Promise(resolve=>resolveDrawing=()=>realLoader().then(resolve)));washPreparation.state.backgroundDataUrl='fixture-new-artwork';washPreparation.drawArtwork();});
 await page.evaluate(()=>{fakeOpen=async()=>'/fixture';fakeInvoke=async(command,args)=>{calls.push([command,args]);if(command==='export_release')return {preparedTracks:[],exported:0,mp3Exported:0,destination:'/fixture'};if(command==='update_non_music_files')return {updated:1,destination:'/fixture'};throw Error(command)};});
 const exportCount=await page.evaluate(()=>calls.filter(([c])=>c==='export_release').length);
 await run(()=>{window.artworkExport=washPreparation.exportRelease();});
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await page.evaluate(()=>calls.filter(([c])=>c==='export_release').length),exportCount);
 await run(()=>{washPreparation.state.logoDataUrl='';window.resolveDrawing();});await run(()=>window.artworkExport);
 assert.equal(await page.evaluate(()=>calls.filter(([c])=>c==='export_release').length),exportCount+1);
 console.log('PASS release export waits for the most recent artwork decode and render');

 await page.evaluate(()=>{window.visualResolvers=[];fakeInvoke=(command,args)=>{calls.push([command,args]);if(command==='allow_visual_preview')return new Promise(resolve=>visualResolvers.push(resolve));throw Error(command)};});
 await run(()=>{const source={source:'file',path:'/fixture/old.mp4',kind:'video'};window.visualOne=washPreparation.loadVideoPreviewMedia(source).catch(error=>error.message);window.visualTwo=washPreparation.loadVideoPreviewMedia(source).catch(error=>error.message);});
 assert.equal(await page.evaluate(()=>visualResolvers.length),1);
 await run(()=>washPreparation.clearVisualPreviewMedia());
 await page.evaluate(()=>visualResolvers[0]('data:video/mp4;base64,AAAA'));
 assert.match(await run(()=>window.visualOne),/replaced/);assert.match(await run(()=>window.visualTwo),/replaced/);
 assert.equal(await run(()=>washPreparation.previewResources().elements),0);
 await run(async()=>{washPreparation.state.logoDataUrl='';washPreparation.state.videoSettings.logoEnabled=false;washPreparation.showStage('video');washPreparation.showVideoPanel('tracks');await washPreparation.drawVideoPreview();});
 await page.evaluate(()=>api.pause());
 const pausedFrame=await run(()=>washPreparation.state.videoPreviewFrame);
 await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(await run(()=>washPreparation.state.videoPreviewFrame),pausedFrame);
 console.log('PASS visual loads are deduplicated, invalidated on reset, and preview loops stop when hidden');

 await page.evaluate(()=>{fakeOpen=async()=>'/fixture/corrupt.png';fakeInvoke=async(command)=>command==='read_file_data_url'?{dataUrl:'data:image/png;base64,bad',fileName:'corrupt.png'}:null;});
 await run(()=>{window.alerts=[];window.alert=message=>alerts.push(message);washPreparation.setImageLoader(async()=>{throw Error('Fixture invalid image')});window.beforeBackground=washPreparation.state.backgroundDataUrl;});
 await run(()=>washPreparation.chooseImage('background'));
 assert.equal(await run(()=>washPreparation.state.backgroundDataUrl),await run(()=>window.beforeBackground));
 assert.match(await run(()=>window.alerts[0]),/invalid image/);
 console.log('PASS undecodable artwork cannot replace a working source');
 assert.deepEqual(errors,[]);
} finally { await browser.close(); }
