import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output','browser-consumer');
await fs.mkdir(output,{recursive:true});
const server=await createServer({root,server:{host:'127.0.0.1',port:5197,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true});
const errors=[],checks=[];
const record=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
const state=()=>page.evaluate(()=>window.brakeLab.getState());
// OrbitControls can recalculate a target on resize with floating-point rounding.
// A sub-nanometer tolerance still rejects any visible reframing or camera jump.
const assertVectorClose=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((value,i)=>assert(Number.isFinite(value)&&Math.abs(value-expected[i])<=1e-10,JSON.stringify({actual,expected})));};
const assertCameraPose=(actual,expected)=>{assertVectorClose(actual.position,expected.position);assertVectorClose(actual.target,expected.target);};
const observation=()=>page.evaluate(()=>{const r=document.querySelector('#scene').getBoundingClientRect(),panel=document.querySelector('.workbench'),p=panel.getBoundingClientRect(),clipped=getComputedStyle(panel).overflowY!=='visible';return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,viewportTop:clipped?Math.max(0,p.top):0,viewportBottom:clipped?Math.min(innerHeight,p.bottom):innerHeight,viewportRight:document.documentElement.clientWidth,focus:document.activeElement.id,scroll:{x:scrollX,y:scrollY,panelTop:panel.scrollTop,panelLeft:panel.scrollLeft}};});
const assertObservation=visible=>{assert(visible.top>=visible.viewportTop-1&&visible.bottom<=visible.viewportBottom+1&&visible.left>=-1&&visible.right<=visible.viewportRight+1,JSON.stringify(visible));assert.equal(visible.focus,'scene');};
const range=(selector,value)=>page.locator(selector).evaluate((node,v)=>{node.value=String(v);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
const same=(actual,expected)=>assert.equal(createHash('sha256').update(JSON.stringify(actual)).digest('hex'),createHash('sha256').update(JSON.stringify(expected)).digest('hex'),'Project content must match exactly');
try{
 await page.clock.install({time:new Date('2026-10-01T00:00:00Z')});
 await page.goto('http://127.0.0.1:5197/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.brakeLab?.getState().scene?.renderCount>0);
 await page.clock.pauseAt(new Date('2026-10-01T00:01:00Z'));
 await record('Real WebGL scene, 19 components and vented closed cut section',async()=>{
  const s=await state();assert.equal(s.scene.componentIds.length,19);assert.equal(s.scene.caliperType,'floating');assert(s.scene.rotor.ventGap>0&&s.scene.rotor.cutFaces>0);assert(s.scene.renderer.calls>0);assert(s.scene.labels.visible>=6);assert.equal(s.running,false);assert.equal(s.scene.autoFraming,true);assert(s.scene.cameraPose.position.every(Number.isFinite)&&s.scene.cameraPose.target.every(Number.isFinite));
  assert.equal(await page.locator('#explode').isDisabled(),true);
  await page.screenshot({path:path.join(output,'desktop-cutaway.png'),fullPage:true});
 });
 await record('First comparison reveals its explanation without any test-side scrolling',async()=>{
  await page.locator('#compare-abs').click();
  const visible=await page.evaluate(()=>{const summary=document.querySelector('#comparison-summary'),workbench=document.querySelector('.workbench'),r=summary.getBoundingClientRect(),w=workbench.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewportTop:Math.max(0,w.top),viewportBottom:Math.min(innerHeight,w.bottom),scroll:workbench.scrollTop,focus:document.activeElement.id,headline:summary.querySelector('#comparison-headline').textContent,direction:summary.dataset.direction};});
  assert(visible.scroll>0,JSON.stringify(visible));assert(visible.top>=visible.viewportTop&&visible.bottom<=visible.viewportBottom,JSON.stringify(visible));assert.equal(visible.focus,'comparison-summary');assert.match(visible.headline,/짧/);assert.equal(visible.direction,'shorter');
  await page.screenshot({path:path.join(output,'first-comparison-visible.png')});
 });
 await record('Desktop comparison returns to 3D on button start and Space resume while pause preserves position and time',async()=>{
  const captured=await page.evaluate(()=>window.brakeLab.project()),originalView=(await state()).view;
  assert.equal(await page.locator('#run-status').textContent(),'준비');
  await page.locator('#start').click();assert.equal((await state()).running,true);assert.equal(await page.locator('#toast').isHidden(),true);
  assertObservation(await observation());same(await page.evaluate(()=>window.brakeLab.project()),captured);assert.deepEqual((await state()).view,originalView);
  await page.clock.runFor(400);const playing=await state();assert(Math.abs(playing.snapshot.time-.1)<.015,JSON.stringify(playing.snapshot.time));
  const playingPosition=(await observation()).scroll;
  await page.keyboard.press('Space');const before=(await state()).snapshot.time;await page.clock.runFor(300);assert.equal((await state()).snapshot.time,before);assert.deepEqual((await observation()).scroll,playingPosition);
  assert.equal(await page.locator('#run-status').textContent(),'일시정지');assert.equal(await page.locator('#start').textContent(),'이어서 제동');
  await page.locator('#compare-abs').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'comparison-summary');assert.equal((await state()).snapshot.time,before);
  await page.keyboard.press('Space');assert.equal(await page.locator('#run-status').textContent(),'제동 중');assert.equal((await state()).snapshot.time,before);assertObservation(await observation());
  await page.clock.runFor(200);assert((await state()).snapshot.time>before);const resumedPosition=(await observation()).scroll;await page.keyboard.press('Space');assert.equal(await page.locator('#run-status').textContent(),'일시정지');assert.deepEqual((await observation()).scroll,resumedPosition);
  const alreadyVisible=await observation(),paused=await state();await page.keyboard.press('Space');assert.equal((await state()).running,true);assert.equal((await state()).snapshot.time,paused.snapshot.time);assert.deepEqual((await observation()).scroll,alreadyVisible.scroll);assert.deepEqual((await state()).view,originalView);assert.equal((await state()).scene.camera,playing.scene.camera);await page.keyboard.press('Space');
  same(await page.evaluate(()=>window.brakeLab.project()),captured);
  assert(playing.snapshot.speed<playing.settings.speedKmh/3.6);assert.equal(playing.scene.actuation.pressurePa,playing.snapshot.pressure);
 });
 await record('Floating body slides, rotating parts share physical angle and labels stay upright',async()=>{
  await page.evaluate(()=>window.brakeLab.advance(.4));const s=await state();assert(s.scene.actuation.bodySlide<0);assert.equal(s.scene.rotation.rotor,s.snapshot.wheelAngle);assert.equal(s.scene.rotation.hub,s.snapshot.wheelAngle);assert.equal(s.scene.rotation.encoder,s.snapshot.wheelAngle);
  const labels=await page.locator('.brake-part-label:visible').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,transform:getComputedStyle(n).transform})));assert(labels.length>0);assert(labels.every(n=>n.text&&n.transform==='none'));
 });
 await record('Actual fixed-caliper selection, opposed pistons and removed slide pins',async()=>{
  await page.locator('[data-caliper="fixed"]').click();const s=await state();assert.equal(s.settings.caliper,'fixed');assert.equal(s.scene.caliper.pistonCount,4);assert.equal(s.scene.caliper.floatingSlide,false);assert.equal(await page.locator('[data-part="slide-pins"]').count(),0);assert.equal(s.snapshot.time,0);
  await page.locator('[data-part="pistons"]').click();assert.equal((await state()).scene.selectedPart,'pistons');assert.match(await page.locator('#part-description').textContent(),/양쪽/);
 });
 await record('Assembly/explosion controls, camera and full-window observation',async()=>{
  await page.locator('[data-mode="assembled"]').click();assert.equal((await state()).scene.mode,'assembled');assert.equal(await page.locator('#explode').isDisabled(),true);
  await page.locator('[data-mode="exploded"]').click();assert.equal(await page.locator('#explode').isEnabled(),true);await range('#explode',.8);assert.equal((await state()).view.explode,.8);
  await page.locator('[data-camera="side"]').click();assert.equal((await state()).scene.camera,'side');
  await page.locator('#focus').click();await page.clock.runFor(50);assert.equal((await state()).focused,true);await page.screenshot({path:path.join(output,'fixed-exploded-focus.png')});
  const savedComparison=await page.evaluate(()=>window.brakeLab.project().comparison);
  const beforeSelection=(await state()).scene;
  assert.equal(await page.locator('#focus-play').isVisible(),true);await page.locator('#focus-part').selectOption('pads');const afterSelection=(await state()).scene;assert.equal((await state()).view.selectedPart,'pads');assertCameraPose(afterSelection.cameraPose,beforeSelection.cameraPose);assert.deepEqual(afterSelection.framing,beforeSelection.framing);assert.equal(afterSelection.autoFraming,beforeSelection.autoFraming);assert.equal(afterSelection.selection.style,'subtle-material');assert.equal(afterSelection.selectedPart,'pads');assert.equal(await page.locator('#focus-part-description').textContent(),await page.locator('#part-description').textContent());assert.match(await page.locator('#focus-part-description').textContent(),/로터/);assert((await page.locator('#focus-part-facts').textContent()).length>0);
  await page.clock.runFor(80);assertCameraPose((await state()).scene.cameraPose,beforeSelection.cameraPose);assert.deepEqual((await state()).scene.canvas,beforeSelection.canvas);for(const id of ['pads','rotor','caliper'])assert.equal(await page.locator(`.brake-part-label[data-part-id="${id}"]`).isVisible(),true);assert.equal(await page.locator('.brake-part-label[data-part-id="pads"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#focus-pressure-note').isVisible(),true);assert.match(await page.locator('#focus-pressure-note').textContent(),/처음부터/);
  await range('#focus-pressure',75);assert.equal((await state()).settings.pressureBar,75);assert.equal(await page.locator('[data-setting="pressureBar"]').inputValue(),'75');assert.equal((await state()).snapshot.time,0);assert.equal((await state()).running,false);
  await page.locator('#focus-rate').selectOption('0.5');await page.locator('#focus-play').click();assert.equal((await state()).running,true);await page.clock.runFor(200);assert(Math.abs((await state()).snapshot.time-.1)<.015);await page.locator('#focus-play').click();const paused=(await state()).snapshot.time;await page.clock.runFor(100);assert.equal((await state()).snapshot.time,paused);assert.equal(await page.locator('#focus-status').textContent(),'일시정지');assert.equal(await page.locator('#focus-play').textContent(),'이어서 제동');
  assert.deepEqual(await page.evaluate(()=>window.brakeLab.project().comparison),savedComparison);await page.screenshot({path:path.join(output,'focus-controls-desktop.png')});await range('#focus-pressure',60);await page.locator('#focus-rate').selectOption('0.25');
  await page.keyboard.press('Escape');assert.equal((await state()).focused,false);
 });
 await record('Visible 3D label selection and actual pointer orbit movement',async()=>{
  await page.locator('[data-camera="isometric"]').click();await page.clock.runFor(100);
  const label=page.locator('.brake-part-label[data-part-id="pads"]');await label.click();assert.equal((await state()).scene.selectedPart,'pads');assert.match(await page.locator('#part-name').textContent(),/패드/);
  const canvas=page.locator('#scene canvas');const before=await canvas.screenshot();const bounds=await canvas.boundingBox();await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.55);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.65,{steps:8});await page.mouse.up();await page.clock.runFor(300);const after=await canvas.screenshot();assert.notDeepEqual(after,before);
  const orbit=(await state()).scene;assert.equal(orbit.autoFraming,false);await page.locator('.brake-part-label[data-part-id="caliper"]').click();const selected=(await state()).scene;assertCameraPose(selected.cameraPose,orbit.cameraPose);assert.equal(selected.autoFraming,false);assert.equal(selected.selectedPart,'caliper');assert.equal(selected.selection.style,'subtle-material');
 });
 await record('ABS comparison preserves conditions and original result after later edits',async()=>{
  await page.locator('#compare-abs').click();const captured=await page.evaluate(()=>window.brakeLab.project());const energy=await page.locator('#comparison-energy').textContent();assert.match(energy,/kJ/);assert.match(energy,/°C/);assert.equal(captured.settings.abs,true);assert(captured.comparison.withAbs.summary.stopped);assert(captured.comparison.withoutAbs.summary.stopped);assert(captured.comparison.withAbs.summary.lockTime<captured.comparison.withoutAbs.summary.lockTime);assert.equal(captured.comparison.withAbs.settings.caliper,'fixed');
  await range('[data-setting="pressureBar"]',40);const later=await page.evaluate(()=>window.brakeLab.project());assert.equal(later.settings.pressureBar,40);assert.deepEqual(later.comparison,captured.comparison);assert.match(await page.locator('#comparison-note').textContent(),/60 bar/);assert.match(await page.locator('#comparison-note').textContent(),/현재 조건과 다름/);
  assert.match(await page.locator('#comparison-headline').textContent(),/짧/);assert.equal(await page.locator('#comparison-summary').getAttribute('data-direction'),'shorter');
  assert.equal(await page.locator('#comparison-energy').textContent(),energy);
  await page.locator('#results').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'abs-comparison.png')});
 });
 await record('Project download and actual file-picker restoration of records',async()=>{
  const expected=await page.evaluate(()=>window.brakeLab.project());const downloaded=page.waitForEvent('download');await page.locator('#save-project').click();const download=await downloaded;const filename=path.join(output,'roundtrip.brake.json');await download.saveAs(filename);assert.deepEqual(JSON.parse(await fs.readFile(filename,'utf8')),expected);
  await range('[data-setting="speedKmh"]',70);await page.locator('#clear-results').click();await page.locator('#project-file').setInputFiles(filename);await page.waitForFunction(()=>window.brakeLab.getState().hasComparison);assert.deepEqual(await page.evaluate(()=>window.brakeLab.project()),expected);
 });
 await record('Supported imported values remain visible, including zero-speed single-sample results',async()=>{
  const original=await page.evaluate(()=>window.brakeLab.project());await page.evaluate(()=>window.brakeLab.setSettings({speedKmh:0,pressureBar:125,padFriction:.075,mass:1075,padMeanRadius:.075}));await page.locator('#compare-abs').click();const candidate=await page.evaluate(()=>window.brakeLab.project());assert.equal(candidate.comparison.withAbs.samples.length,1);
  await page.locator('#project-file').setInputFiles({name:'zero-speed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(candidate))});assert.deepEqual(await page.evaluate(()=>window.brakeLab.project()),candidate);
  const visible=await page.locator('[data-setting]').evaluateAll(nodes=>Object.fromEntries(nodes.filter(n=>n.type==='range').map(n=>[n.dataset.setting,Number(n.value)])));for(const key of ['speedKmh','pressureBar','padFriction','mass','padMeanRadius'])assert.equal(visible[key],candidate.settings[key]);
  assert(!/NaN|Infinity/.test(await page.locator('#results').textContent()));await page.locator('#project-file').setInputFiles({name:'previous.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await page.waitForFunction(expected=>JSON.stringify(window.brakeLab.project())===expected,JSON.stringify(original));same(await page.evaluate(()=>window.brakeLab.project()),original);
 });
 await record('Malformed project is rejected atomically, preserving current work',async()=>{
  const before=await page.evaluate(()=>window.brakeLab.project());const malformed=structuredClone(before);delete malformed.comparison.settings;
  await page.locator('#project-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(malformed))});
  await page.waitForFunction(()=>!document.querySelector('#toast').hidden);assert.deepEqual(await page.evaluate(()=>window.brakeLab.project()),before);
 });
 await record('Zero-pressure trial reports incomplete distance and never invents a stop',async()=>{
  await range('[data-setting="pressureBar"]',0);await page.locator('#compare-abs').click();const c=await page.evaluate(()=>window.brakeLab.project().comparison);assert.equal(c.withAbs.summary.stopped,false);assert.equal(c.difference.stopDistance,null);assert.match(await page.locator('#result-rows').textContent(),/미완료/);assert.match(await page.locator('#comparison-note').textContent(),/정지하지 못/);
  assert.equal(await page.locator('#comparison-summary').getAttribute('data-direction'),'incomplete');assert.match(await page.locator('#comparison-headline').textContent(),/정지|완료/);assert.match(await page.locator('#comparison-detail').textContent(),/압력/);
 });
 await record('Browser reload restores captured zero-pressure results and conditions',async()=>{
  const expected=await page.evaluate(()=>window.brakeLab.project());await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.brakeLab?.getState().scene?.renderCount>0);assert.deepEqual(await page.evaluate(()=>window.brakeLab.project()),expected);assert.equal(await page.locator('[data-part="slide-pins"]').count(),0);
 });
 await record('Held Space and F keys act once and repeated keydown does not flip state',async()=>{
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down('Space');const running=(await state()).running;await page.keyboard.down('Space');await page.keyboard.down('Space');assert.equal((await state()).running,running);await page.keyboard.up('Space');
  await page.keyboard.down('f');const focused=(await state()).focused;await page.keyboard.down('f');await page.keyboard.down('f');assert.equal((await state()).focused,focused);await page.keyboard.up('f');await page.keyboard.press('Escape');
 });
 await record('Mobile 390px layout, visible labels and no horizontal page overflow',async()=>{
  await page.setViewportSize({width:390,height:844});await page.clock.runFor(100);await page.evaluate(()=>window.brakeLab.scene.resize());const bounds=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert(bounds.scroll<=bounds.client+1,JSON.stringify(bounds));assert((await state()).scene.labels.visible>0);
  await page.screenshot({path:path.join(output,'mobile-390.png'),fullPage:true});
 });
 await record('Mobile comparison reveals the explanation in the screen without test-side scrolling',async()=>{
  await range('[data-setting="pressureBar"]',60);
  await page.locator('#compare-abs').click();const visible=await page.evaluate(()=>{const r=document.querySelector('#comparison-summary').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,focus:document.activeElement.id};});assert(visible.top>=0&&visible.bottom<=visible.height,JSON.stringify(visible));assert.equal(visible.focus,'comparison-summary');await page.screenshot({path:path.join(output,'mobile-first-comparison.png')});
 });
 await record('Mobile 390px comparison-to-playback keeps 3D focus, pause position, resume time and stored records',async()=>{
  // The preceding actual comparison supplies the result view; no test scroll
  // or focus operation may make the initial observation assertion pass.
  const captured=await page.evaluate(()=>window.brakeLab.project()),initial=await state();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'comparison-summary');
  await page.locator('#start').click();assert.equal((await state()).running,true);assertObservation(await observation());
  same(await page.evaluate(()=>window.brakeLab.project()),captured);assert.deepEqual((await state()).view,initial.view);
  await page.clock.runFor(300);const playing=await state();assert(playing.snapshot.time>initial.snapshot.time);const playingPosition=(await observation()).scroll;
  await page.keyboard.press('Space');const paused=await state();assert.equal(paused.running,false);assert.deepEqual((await observation()).scroll,playingPosition);await page.clock.runFor(200);assert.equal((await state()).snapshot.time,paused.snapshot.time);
  await page.locator('#compare-abs').click();const result=await page.evaluate(()=>{const r=document.querySelector('#comparison-summary').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,focus:document.activeElement.id};});assert(result.top>=0&&result.bottom<=result.height,JSON.stringify(result));assert.equal(result.focus,'comparison-summary');
  await page.keyboard.press('Space');const resumed=await state();assert.equal(resumed.running,true);assert.equal(resumed.snapshot.time,paused.snapshot.time);assertObservation(await observation());await page.clock.runFor(200);assert((await state()).snapshot.time>paused.snapshot.time);
  const resumedPosition=(await observation()).scroll;await page.keyboard.press('Space');assert.equal((await state()).running,false);assert.deepEqual((await observation()).scroll,resumedPosition);
  const alreadyVisible=await observation(),beforeResume=await state();await page.keyboard.press('Space');assert.equal((await state()).running,true);assert.equal((await state()).snapshot.time,beforeResume.snapshot.time);assert.deepEqual((await observation()).scroll,alreadyVisible.scroll);assert.deepEqual((await state()).view,initial.view);assert.equal((await state()).scene.camera,initial.scene.camera);await page.keyboard.press('Space');
  same(await page.evaluate(()=>window.brakeLab.project()),captured);await page.screenshot({path:path.join(output,'mobile-playback-observation.png')});
 });
 await record('Mobile expanded observation retains part explanations, pressure, playback and readable controls',async()=>{
  const recordBefore=await page.evaluate(()=>window.brakeLab.project().comparison);await page.locator('#compare-abs').click();assert.equal(await page.locator('#toast').isVisible(),true);await page.locator('#focus').click();await page.clock.runFor(60);assert.equal((await state()).focused,true);assert.equal(await page.locator('#toast').isHidden(),true);
  const layout=await page.evaluate(()=>{const ids=['focus-part','focus-part-description','focus-play','focus-rate','focus-pressure','focus-pressure-note','scene'];return {client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:innerHeight,items:ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});assert(layout.scroll<=layout.client+1,JSON.stringify(layout));assert(layout.items.every(r=>r.left>=0&&r.right<=layout.client&&r.top>=0&&r.bottom<=layout.height),JSON.stringify(layout));assert(layout.items.find(r=>r.id==='scene').bottom-layout.items.find(r=>r.id==='scene').top>=240);
  const beforeSelection=(await state()).scene;await page.locator('#focus-part').selectOption('bleeder');const afterSelection=(await state()).scene;assert.equal((await state()).view.selectedPart,'bleeder');assertCameraPose(afterSelection.cameraPose,beforeSelection.cameraPose);assert.deepEqual(afterSelection.framing,beforeSelection.framing);assert.equal(afterSelection.autoFraming,beforeSelection.autoFraming);assert.equal(afterSelection.selection.style,'subtle-material');assert.equal(afterSelection.selectedPart,'bleeder');assert.equal(await page.locator('#focus-part-description').textContent(),await page.locator('#part-description').textContent());assert.match(await page.locator('#focus-part-description').textContent(),/유압실/);
  // User orbit damping can still move the position on later frames. Selection
  // itself must preserve the exact pose; the dock must preserve size and target.
  await page.clock.runFor(80);const afterLayout=(await state()).scene;if(beforeSelection.autoFraming)assertCameraPose(afterLayout.cameraPose,beforeSelection.cameraPose);assertVectorClose(afterLayout.cameraPose.target,beforeSelection.cameraPose.target);assert.deepEqual(afterLayout.canvas,beforeSelection.canvas);for(const id of ['bleeder','rotor','caliper'])assert.equal(await page.locator(`.brake-part-label[data-part-id="${id}"]`).isVisible(),true);assert.equal(await page.locator('.brake-part-label[data-part-id="bleeder"]').getAttribute('aria-pressed'),'true');
  await range('#focus-pressure',70);await page.locator('#focus-rate').selectOption('1');await page.locator('#focus-play').click();await page.clock.runFor(200);assert(Math.abs((await state()).snapshot.time-.2)<.02);await page.locator('#focus-play').click();assert.equal((await state()).running,false);assert.equal(await page.locator('#focus-play').textContent(),'이어서 제동');assert.deepEqual(await page.evaluate(()=>window.brakeLab.project().comparison),recordBefore);await page.screenshot({path:path.join(output,'focus-controls-mobile.png')});
  await page.keyboard.press('Escape');assert.equal((await state()).focused,false);assert.equal(await page.locator('#playback-rate').inputValue(),'1');assert.equal(await page.locator('[data-setting="pressureBar"]').inputValue(),'70');
 });
 await page.close();
 for(const fixture of [{name:'Corrupt automatic save preserves original bytes before replacement',raw:'{broken original',future:false},{name:'Future automatic save stays protected during current-version edits',raw:JSON.stringify({format:'brake-lab-project',version:2,modelVersion:'brake-2.0.0',retained:'future-original'}),future:true}]){
  await record(fixture.name,async()=>{
   const isolated=await browser.newContext({viewport:{width:1366,height:768}});try{
    await isolated.addInitScript(raw=>localStorage.setItem('brake-lab-project-v1',raw),fixture.raw);
    const fresh=await isolated.newPage();fresh.on('pageerror',e=>errors.push(e.message));await fresh.goto('http://127.0.0.1:5197/',{waitUntil:'networkidle'});await fresh.waitForFunction(()=>window.brakeLab?.getState().scene?.renderCount>0);
    const saved=await fresh.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)])));
    if(fixture.future){assert.equal(saved['brake-lab-project-v1'],fixture.raw);assert.equal(await fresh.evaluate(()=>window.brakeLab.getState().storageBlocked),true);await fresh.evaluate(()=>window.brakeLab.setSettings({pressureBar:40}));assert.equal(await fresh.evaluate(()=>localStorage.getItem('brake-lab-project-v1')),fixture.raw);}
    else{assert(Object.entries(saved).some(([key,value])=>key.startsWith('brake-lab-project-v1-original-')&&value===fixture.raw));assert.doesNotThrow(()=>JSON.parse(saved['brake-lab-project-v1']));assert.match(await fresh.locator('#storage-status').textContent(),/원문/);}
    assert.equal(await fresh.locator('#recover-original').isVisible(),true);const downloadEvent=fresh.waitForEvent('download');await fresh.locator('#recover-original').click();const recovered=await downloadEvent;const target=path.join(output,fixture.future?'future-original.txt':'corrupt-original.txt');await recovered.saveAs(target);assert.equal(await fs.readFile(target,'utf8'),fixture.raw);
   }finally{await isolated.close();}
  });
 }
 await record('No browser errors or failed requests',async()=>assert.deepEqual(errors,[]));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:'PASSED',checks,errors},null,2));
}catch(error){
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:'FAILED',checks,errors,failure:error.stack},null,2));throw error;
}finally{await context.close();await browser.close();await server.close();}
