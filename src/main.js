import './style.css';
import './scene.css';
import './recovery.css';
import './comparison.css';
import {defaultSettings,normalizeSettings,createSimulation,compareAbs,MODEL_VERSION} from './model.js';
import {createBrakeScene} from './scene.js';
import {projectFormat,parseProject,makeProject} from './project.js';
import {describeComparison} from './comparison-summary.js';
import {describeComparisonEnergy} from './comparison-energy.js';

const $=selector=>document.querySelector(selector),all=selector=>[...document.querySelectorAll(selector)];
const storageKey='brake-lab-project-v1',format=projectFormat;
const number=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const toast=(message,context='notice')=>{const node=$('#toast');node.textContent=message;node.dataset.context=context;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,5000);};
function dismissComparisonNotice(){if($('#toast').dataset.context==='comparison'){$('#toast').hidden=true;clearTimeout(toast.timer);}}
let settings=normalizeSettings(defaultSettings),comparison=null,view={mode:'cutaway',cutaway:.65,explode:.5,labels:true,selectedPart:'rotor',quality:'auto',camera:'isometric'};
let storageBlocked=false,storageMessage='',recoveryOriginal=null,running=false,last=0,accumulator=0,rate=.25,focused=false,loadSequence=0;
try{
 const raw=localStorage.getItem(storageKey);
 if(raw){
  try{const saved=parseProject(raw,view);({settings,comparison,view}=saved);}
  catch(error){
   recoveryOriginal=raw;
   const data=(()=>{try{return JSON.parse(raw);}catch{return null;}})();
   if(error.futureVersion||data?.format===format&&data.version>1){storageBlocked=true;storageMessage='새로운 저장 형식을 보호합니다. 현재 실험은 파일로 저장해 주세요.';}
   else{
    try{const backup=storageKey+'-original-'+Date.now();localStorage.setItem(backup,raw);if(localStorage.getItem(backup)!==raw)throw new Error();storageMessage='읽을 수 없는 이전 저장의 원문을 보관했습니다.';}
    catch{storageBlocked=true;storageMessage='이전 저장을 보호합니다. 현재 실험은 파일로 저장해 주세요.';}
   }
  }
 }
 if(recoveryOriginal===null){const keys=Object.keys(localStorage).filter(key=>key.startsWith(storageKey+'-original-')).sort((a,b)=>Number(b.split('-').at(-1))-Number(a.split('-').at(-1)));if(keys.length)recoveryOriginal=localStorage.getItem(keys[0]);}
}catch{storageBlocked=true;storageMessage='자동 저장을 사용할 수 없습니다. 실험 파일로 보관해 주세요.';}
let simulation=createSimulation(settings),snapshot=simulation.snapshot(),scene;
const project=()=>makeProject(settings,view,comparison);
function persist(){
 if(storageBlocked){$('#storage-status').textContent=storageMessage;return;}
 try{localStorage.setItem(storageKey,JSON.stringify(project()));$('#storage-status').textContent=storageMessage||'이 기기에 자동 저장됨';}
 catch{storageBlocked=true;storageMessage='자동 저장 공간이 부족합니다. 실험 파일로 보관해 주세요.';$('#storage-status').textContent=storageMessage;toast(storageMessage);}
}
function syncInputs(){
 for(const el of all('[data-setting]')){const value=settings[el.dataset.setting];if(el.type==='checkbox')el.checked=value;else{if(el.type==='range'){el.dataset.baseMin??=el.min;el.dataset.baseMax??=el.max;el.dataset.baseStep??=el.step;el.min=Math.min(Number(el.dataset.baseMin),value);el.max=Math.max(Number(el.dataset.baseMax),value);const position=(value-Number(el.dataset.baseMin))/Number(el.dataset.baseStep);el.step=Math.abs(position-Math.round(position))<1e-7?el.dataset.baseStep:'any';}el.value=value;}}
 for(const el of all('[data-output]')){const key=el.dataset.output,value=settings[key];el.textContent=key==='speedKmh'?number(value,0)+' km/h':key==='pressureBar'?number(value,0)+' bar':key==='padFriction'?number(value,2):key==='padMeanRadius'?number(value*1000,0)+' mm':number(value,0)+' kg';}
 all('[data-caliper]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.caliper===settings.caliper)));
 all('[data-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mode===view.mode)));
 $('#explode').value=view.explode;$('#explode').disabled=view.mode!=='exploded';$('#labels').checked=view.labels;
}
function setRunning(value){running=Boolean(value)&&!snapshot.stopped;last=performance.now();const paused=!running&&!snapshot.stopped&&snapshot.time>0;$('#start').textContent=running?'일시정지':snapshot.stopped?'다시 제동':paused?'이어서 제동':'제동 시작';$('#start').setAttribute('aria-pressed',String(running));$('#run-status').textContent=running?'제동 중':snapshot.stopped?'정지 완료':paused?'일시정지':'준비';syncFocusPanel();}
function syncFocusPanel(){
 $('#focus-play').textContent=$('#start').textContent;$('#focus-play').setAttribute('aria-pressed',String(running));$('#focus-status').textContent=$('#run-status').textContent;$('#focus-rate').value=String(rate);
 if($('#focus-part').value!==view.selectedPart)$('#focus-part').value=view.selectedPart;const description=$('#part-description').textContent,facts=[...$('#part-facts').children].map(node=>node.textContent).join(' · ');if($('#focus-part-description').textContent!==description)$('#focus-part-description').textContent=description;if($('#focus-part-facts').textContent!==facts)$('#focus-part-facts').textContent=facts;
 const pressure=$('#focus-pressure');pressure.max=Math.max(100,settings.pressureBar);pressure.step=Number.isInteger(settings.pressureBar)?'1':'any';pressure.value=String(settings.pressureBar);$('#focus-pressure-value').textContent=number(settings.pressureBar,0)+' bar';
 $('#focus-speed').textContent=number(snapshot.speed*3.6);$('#focus-slip').textContent=snapshot.slip===null?'—':number(snapshot.slip*100,0)+'%';$('#focus-time').textContent=number(snapshot.time,2);
}
function observePlayback(){
 dismissComparisonNotice();
 const target=$('#scene'),box=target.getBoundingClientRect(),visible={top:0,left:0,bottom:document.documentElement.clientHeight,right:document.documentElement.clientWidth};
 // Desktop panels scroll independently; mobile uses the document viewport.
 for(let parent=target.parentElement;parent;parent=parent.parentElement){
  const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
  if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)){visible.top=Math.max(visible.top,bounds.top+parent.clientTop);visible.bottom=Math.min(visible.bottom,bounds.top+parent.clientTop+parent.clientHeight);}
  if(/^(auto|scroll|hidden|clip)$/.test(style.overflowX)){visible.left=Math.max(visible.left,bounds.left+parent.clientLeft);visible.right=Math.min(visible.right,bounds.left+parent.clientLeft+parent.clientWidth);}
 }
 const width=Math.max(0,Math.min(box.right,visible.right)-Math.max(box.left,visible.left)),height=Math.max(0,Math.min(box.bottom,visible.bottom)-Math.max(box.top,visible.top));
 if(width===0||height===0||width<Math.min(box.width,Math.max(0,visible.right-visible.left))-1||height<Math.min(box.height,Math.max(0,visible.bottom-visible.top))-1)target.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
 target.focus({preventScroll:true});
}
function togglePlayback(){if(snapshot.stopped)reset();setRunning(!running);if(running)observePlayback();}
function reset(){simulation.reset(settings);snapshot=simulation.snapshot();accumulator=0;setRunning(false);render();}
function setSettings(patch){const previousCaliper=settings.caliper;settings=normalizeSettings({...settings,...patch});reset();syncInputs();if(settings.caliper!==previousCaliper)updateParts();if(comparison)showComparison();persist();return snapshot;}
function selectPart(id){view.selectedPart=id;scene?.focus(id);const part=scene?.getComponents().find(p=>p.id===id);if(part){$('#part-name').textContent=part.name||part.label;$('#part-description').textContent=part.description;$('#part-facts').replaceChildren(...[part.material,part.rotates?'바퀴와 회전':'고정 지지·작동부'].filter(Boolean).map(text=>{const span=document.createElement('span');span.textContent=text;return span;}));}all('[data-part]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.part===id)));render();}
function updateParts(){const parts=(scene?.getComponents()||[]).filter(part=>part.visible!==false);const nodes=parts.map(part=>{const b=document.createElement('button');b.dataset.part=part.id;b.textContent=part.name||part.label;b.onclick=()=>selectPart(part.id);return b;});$('#parts-list').replaceChildren(...nodes);$('#focus-part').replaceChildren(...parts.map(part=>{const option=document.createElement('option');option.value=part.id;option.textContent=part.name||part.label;return option;}));selectPart(parts.some(part=>part.id===view.selectedPart)?view.selectedPart:parts[0]?.id);}
function render(){
 $('#speed').textContent=number(snapshot.speed*3.6);$('#distance').textContent=number(snapshot.distance,2);$('#slip').textContent=snapshot.slip===null?'—':number(snapshot.slip*100,0);$('#temperature').textContent=number(snapshot.discTemperatureC);
 const phases={increase:'압력 증가',hold:'압력 유지',decrease:'압력 감소',off:'ABS 끔',stopped:'정지 완료','low-speed':'저속 · 운전자 압력'};$('#abs-phase').textContent=phases[snapshot.absPhase]||snapshot.absPhase;
 $('#inlet').textContent='입구 '+(snapshot.inletOpen?'열림':'닫힘');$('#inlet').classList.toggle('active',!!snapshot.inletOpen);$('#outlet').textContent='출구 '+(snapshot.outletOpen?'열림':'닫힘');$('#outlet').classList.toggle('active',!!snapshot.outletOpen);$('#pump').classList.toggle('active',!!snapshot.pumpActive);$('#pump').textContent=snapshot.pumpActive?'환류 펌프 작동':'환류 펌프 대기';$('#caliper-pressure').textContent='캘리퍼 '+number(snapshot.pressure/1e5)+' bar';
 $('#force-readout').textContent='브레이크 토크 '+number(snapshot.brakeTorque,0)+' N·m · 노면 제동력 '+number(snapshot.tireForce,0)+' N · 경과 '+number(snapshot.time,2)+' s';
 scene?.setState(snapshot,settings,view);
 syncFocusPanel();
}
function advance(seconds){
 if(!Number.isFinite(seconds)||seconds<0||seconds>60)throw new Error('진행 시간은 0–60초여야 합니다.');
 accumulator+=seconds;
 while(accumulator>=.001-1e-10&&!snapshot.stopped){simulation.step(.001);snapshot=simulation.snapshot();accumulator-=.001;}
 if(snapshot.stopped){accumulator=0;setRunning(false);}render();return structuredClone(snapshot);
}
function drawTrace(){
 const canvas=$('#trace'),ctx=canvas.getContext('2d'),dpr=devicePixelRatio||1,w=Math.max(320,canvas.clientWidth),h=170;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);if(!comparison)return;
 const runs=[comparison.withoutAbs,comparison.withAbs],maxTime=Math.max(.001,...runs.map(r=>r.samples.at(-1).time)),maxSpeed=Math.max(1,...runs.map(r=>r.samples[0].speed*3.6));
 ctx.font='11px Segoe UI';ctx.strokeStyle='#37505d';ctx.fillStyle='#8faab8';for(let i=0;i<4;i++){const y=22+(h-48)*i/3;ctx.beginPath();ctx.moveTo(44,y);ctx.lineTo(w-14,y);ctx.stroke();ctx.fillText(number(maxSpeed*(1-i/3),0),5,y+4);}ctx.fillText('km/h',5,12);ctx.fillText(number(maxTime)+' s',w-65,h-5);ctx.fillText('0',44,h-5);
 runs.forEach((run,i)=>{ctx.strokeStyle=['#ffb688','#68dbc5'][i];ctx.lineWidth=2;ctx.beginPath();run.samples.forEach((s,j)=>{const x=44+s.time/maxTime*(w-58),y=22+(1-s.speed*3.6/maxSpeed)*(h-48);if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillText(i?'ABS 켬':'ABS 끔',w-155,14+i*16);});
}
function showComparison(){
 $('#results').hidden=!comparison;if(!comparison)return;
 const explanation=describeComparison(comparison);$('#comparison-headline').textContent=explanation.headline;$('#comparison-detail').textContent=explanation.detail;$('#comparison-summary').dataset.direction=explanation.direction;
 $('#comparison-energy').textContent=describeComparisonEnergy(comparison);
 $('#result-rows').replaceChildren(...[['ABS 끔',comparison.withoutAbs],['ABS 켬',comparison.withAbs]].map(([label,run])=>{const row=document.createElement('tr');const s=run.summary;for(const value of [label,s.stopped?number(s.stopDistance,2)+' m':'미완료',s.stopped?number(s.stopTime,2)+' s':'미완료',number(s.lockTime,2)+' s',number(s.peakTemperatureC)+' °C']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;}));
 const resultSettings=comparison.settings,completed=comparison.withoutAbs.summary.stopped&&comparison.withAbs.summary.stopped,differs=Object.keys(defaultSettings).some(key=>key!=='abs'&&JSON.stringify(settings[key])!==JSON.stringify(resultSettings[key]));$('#comparison-note').textContent='보관 당시 조건'+(differs?' (현재 조건과 다름)':'')+' · '+number(resultSettings.speedKmh,0)+' km/h · '+number(resultSettings.pressureBar,0)+' bar · '+({high:'높은',medium:'중간',low:'낮은'}[resultSettings.road]||'')+' 합성 접지 · '+(resultSettings.caliper==='fixed'?'고정 대향':'플로팅')+' · 패드 μ '+number(resultSettings.padFriction,3)+' · 반경 '+number(resultSettings.padMeanRadius*1000,1)+' mm · 배분 질량 '+number(resultSettings.mass,0)+' kg · '+(completed?'거리 차이 '+number(comparison.difference.stopDistance,2)+' m (켬 − 끔)':'기록된 시간 안에 정지하지 못했습니다. 거리·시간 비교는 미완료입니다.');drawTrace();
}
function runComparison(){window.brakeDesktop?.setBusy(true);try{comparison=compareAbs(settings);showComparison();persist();$('#results').scrollIntoView({block:'start',behavior:'auto'});$('#comparison-summary').focus({preventScroll:true});toast('비교 결과를 보관했습니다. 조건을 바꾸어 다시 비교해 보세요.','comparison');return structuredClone(comparison);}catch(error){toast(error.message);throw error;}finally{window.brakeDesktop?.setBusy(false);}}
function loadProject(text){const parsed=parseProject(text,view);settings=parsed.settings;comparison=parsed.comparison;view={...view,...parsed.view};reset();syncInputs();updateParts();showComparison();persist();return true;}
function download(contents,name,type='application/json'){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function saveProject(){try{const contents=JSON.stringify(project(),null,2);if(window.brakeDesktop?.isDesktop){const result=await window.brakeDesktop.saveProject({contents,name:'브레이크 실험.brake.json'});if(!result.canceled)toast('실험 파일을 저장했습니다.');}else download(contents,'브레이크 실험.brake.json');}catch(error){toast(error.message);}}
async function openProject(){try{if(window.brakeDesktop?.isDesktop){const result=await window.brakeDesktop.openProject();if(result.canceled)return;loadProject(result.content);toast('조건과 저장된 비교 결과를 복원했습니다.');}else $('#project-file').click();}catch(error){toast(error.message);}}
function toggleFocus(value=!focused){focused=value;if(value)dismissComparisonNotice();document.body.classList.toggle('scene-focus',value);$('#focus').textContent=value?'돌아가기':'크게 보기';syncFocusPanel();requestAnimationFrame(()=>scene?.resize());}
try{scene=createBrakeScene($('#scene'),{onSelect:selectPart});}catch(error){$('#scene').textContent='3D 화면을 시작하지 못했습니다. '+error.message;console.error(error);}
all('[data-setting]').forEach(el=>el.addEventListener(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',()=>setSettings({[el.dataset.setting]:el.type==='checkbox'?el.checked:el.tagName==='SELECT'?el.value:Number(el.value)})));
all('[data-caliper]').forEach(b=>b.onclick=()=>setSettings({caliper:b.dataset.caliper}));
all('[data-mode]').forEach(b=>b.onclick=()=>{view.mode=b.dataset.mode;syncInputs();render();persist();});
all('[data-camera]').forEach(b=>b.onclick=()=>{view.camera=b.dataset.camera;scene?.setCamera(view.camera);});
$('#explode').oninput=e=>{view.explode=Number(e.target.value);render();persist();};$('#labels').onchange=e=>{view.labels=e.target.checked;render();persist();};$('#focus').onclick=()=>toggleFocus();$('#start').onclick=togglePlayback;$('#reset').onclick=reset;$('#playback-rate').onchange=e=>{rate=Number(e.target.value);last=performance.now();syncFocusPanel();};$('#compare-abs').onclick=runComparison;$('#clear-results').onclick=()=>{comparison=null;showComparison();persist();};$('#help').onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=()=>$('#help-dialog').close();$('#save-project').onclick=saveProject;$('#open-project').onclick=openProject;$('#project-file').onchange=async e=>{const sequence=++loadSequence;try{const file=e.target.files?.[0];if(!file)return;if(file.size>10*1024*1024)throw new Error('실험 파일은 10 MiB 이하로 열어 주세요.');const text=await file.text();if(sequence!==loadSequence)return;loadProject(text);toast('조건과 저장된 비교 결과를 복원했습니다.');}catch(error){if(sequence===loadSequence)toast(error.message);}finally{if(sequence===loadSequence)e.target.value='';}};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!event.repeat)toggleFocus(false);return;}if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,select,textarea,button,[contenteditable=true]')||$('#help-dialog').open)return;if(event.key.toLowerCase()==='f'){event.preventDefault();if(!event.repeat)toggleFocus();}if(event.code==='Space'){event.preventDefault();if(!event.repeat)$('#start').click();}});
window.brakeDesktop?.onCommand(command=>{if(command==='save-project')void saveProject();else if(command==='open-project')void openProject();else if(command==='toggle-running')$('#start').click();else if(command==='focus')toggleFocus();else if(command==='help')$('#help-dialog').showModal();else if(command==='new-project'){comparison=null;setSettings(defaultSettings);showComparison();persist();}});
$('#storage-recovery').hidden=recoveryOriginal===null;$('#recover-original').onclick=()=>{if(recoveryOriginal===null)return;download(recoveryOriginal,'이전 브레이크 저장 원문.txt','text/plain;charset=utf-8');toast('이전 저장 원문을 파일로 저장하기 시작했습니다.');};
document.addEventListener('visibilitychange',()=>{last=performance.now();});window.addEventListener('resize',()=>{scene?.resize();drawTrace();});
$('#focus-play').onclick=()=>$('#start').click();$('#focus-part').onchange=event=>selectPart(event.target.value);$('#focus-rate').onchange=event=>{rate=Number(event.target.value);$('#playback-rate').value=String(rate);last=performance.now();syncFocusPanel();};$('#focus-pressure').oninput=event=>setSettings({pressureBar:Number(event.target.value)});
syncInputs();render();updateParts();showComparison();setRunning(false);render();persist();
function frame(now){const elapsed=last?Math.max(0,(now-last)/1000):0;last=now;if(running&&!document.hidden){if(elapsed>1){setRunning(false);toast('화면이 오래 지연되어 일시정지했습니다. '+$('#start').textContent+'을 눌러 이어가세요.');}else advance(elapsed*rate);}requestAnimationFrame(frame);}requestAnimationFrame(frame);
window.brakeLab={getState:()=>({settings:structuredClone(settings),snapshot:structuredClone(snapshot),view:{...view},running,focused,scene:scene?.getDiagnostics(),hasComparison:!!comparison,storageBlocked}),setSettings,reset,advance,runComparison,project,loadProject,selectPart,toggleFocus,scene};
window.advanceTime=ms=>{if(running)advance(ms/1000*rate);else render();};window.render_game_to_text=()=>JSON.stringify({model:MODEL_VERSION,coordinateSystem:'m, s, N, Pa; +Z wheel axle, +Y up; one-wheel straight braking',running,focused,settings,snapshot,view,hasComparison:!!comparison});
