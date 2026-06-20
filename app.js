const RAT_BROWSER_VERSION='2026.06.21.26';
const MOBILE_BUILD=true;

function initStartupSplash(){
  const splash=document.getElementById('startup-splash');
  const version=document.getElementById('startup-version');
  if(!splash||!version)return;
  version.textContent='ver. '+RAT_BROWSER_VERSION;
  requestAnimationFrame(()=>splash.classList.add('ready'));
  setTimeout(()=>splash.classList.add('hidden'),1600);
}
initStartupSplash();

function repairStaticUi(){
  const util=document.getElementById('util');
  if(util){
    util.innerHTML=[
      '<button class="ubtn" id="u-save" title="Save / Load"><img src="Mods/essential/saveload.png" alt=""></button>',
      '<button class="ubtn" id="u-opts" title="Option"><img src="Mods/essential/options.png" alt=""></button>',
      '<button class="ubtn" id="u-hide" title="Hide message"><img src="Mods/essential/close.png" alt=""></button>'
    ].join('');
  }
  const labels=document.querySelectorAll('#opts .opt-lbl');
  if(labels[0])labels[0].textContent='文字ウェイト';
  if(labels[1])labels[1].textContent='BGM音量';
  if(labels[2])labels[2].textContent='効果音量';
  const controls=document.getElementById('opts-controls');
  if(controls)controls.innerHTML='レース操作<br>画面左半分：押しながらスワイプでシフト<br>画面右半分：押し続けてアクセル';
  const status=document.getElementById('title-status');
  if(status)status.textContent='読み込み中...';
}
repairStaticUi();
'use strict';
// ═══════════════════════════════════════════════════════════════════
//  RAT Browser Engine – complete rewrite
// ═══════════════════════════════════════════════════════════════════

// ── スケーリング ────────────────────────────────────────────
(function(){
  const wrap=document.getElementById('wrap');
  function resize(){
    const viewport=window.visualViewport;
    const width=viewport?viewport.width:innerWidth;
    const height=viewport?viewport.height:innerHeight;
    const offsetLeft=viewport?viewport.offsetLeft:0;
    const offsetTop=viewport?viewport.offsetTop:0;
    const portrait=height>width;
    const s=portrait?Math.min(width/540,height/960):Math.min(width/960,height/540);
    wrap.style.transform=portrait?`rotate(90deg) scale(${s})`:`scale(${s})`;
    wrap.style.left=Math.max(0,Math.round(offsetLeft+(width-(portrait?540:960)*s)/2+(portrait?540*s:0)))+'px';
    wrap.style.top=Math.max(0,Math.round(offsetTop+(height-(portrait?960:540)*s)/2))+'px';
    document.body.classList.toggle('portrait-locked-layout',portrait);
  }
  resize();
  window.addEventListener('resize',resize);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',resize);
    window.visualViewport.addEventListener('scroll',resize);
  }
})();

// ── 設定 ────────────────────────────────────────────────────
const S={
  get(k,d){try{const v=localStorage.getItem('RAT.'+k);return v===null?d:JSON.parse(v);}catch{return d;}},
  set(k,v){try{localStorage.setItem('RAT.'+k,JSON.stringify(v));}catch{}},
};

// ── ファイル IO ─────────────────────────────────────────────
//  3モード: fetch(サーバ) / folder(FileSystem Access API) / zip(JSZip)
let FS_MODE='none';
const MODS='./Mods/';
let zipFiles={};  // key=小文字相対パス "scene/foo.txt"

function decodeText(buf){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf).replace(/^\uFEFF/,'');}
  catch{return new TextDecoder('shift-jis').decode(buf);}
}
async function readText(relPath){
  if(FS_MODE==='fetch'){
    const r=await fetch(MODS+relPath); if(!r.ok)throw new Error(relPath);
    return decodeText(await r.arrayBuffer());
  }
  const e=zipFiles[relPath.toLowerCase()]; if(!e)throw new Error('missing:'+relPath);
  return decodeText(FS_MODE==='zip'?await e.async('arraybuffer'):await e.arrayBuffer());
}
async function readBlob(folder,name,...exts){
  if(!name||name.toLowerCase()==='mute')return null;
  for(const ext of exts){
    const rel=folder+'/'+name+ext;
    if(FS_MODE==='fetch'){
      try{const r=await fetch(MODS+rel);if(r.ok)return await r.blob();}catch{}
    } else {
      const e=zipFiles[rel.toLowerCase()]; if(!e)continue;
      return new Blob([FS_MODE==='zip'?await e.async('arraybuffer'):await e.arrayBuffer()]);
    }
  }
  return null;
}

async function tryFetch(){
  for(const n of['_entrypoint','scene_001']){
    try{const r=await fetch(MODS+'scene/'+n+'.txt',{method:'HEAD'});if(r.ok){FS_MODE='fetch';return true;}}catch{}
  }
  return false;
}
async function pickFolder(){
  if(!window.showDirectoryPicker)return false;
  let root; try{root=await window.showDirectoryPicker();}catch{return false;}
  zipFiles={};
  async function walk(dh,pre){
    for await(const[n,h] of dh.entries()){
      if(h.kind==='directory')await walk(h,pre+n.toLowerCase()+'/');
      else{const f=await h.getFile();zipFiles[pre+n.toLowerCase()]=f;}
    }
  }
  let mh; try{mh=await root.getDirectoryHandle('Mods');}catch{mh=root;}
  await walk(mh,'');
  if(Object.keys(zipFiles).some(k=>k.startsWith('scene/'))){FS_MODE='folder';return true;}
  return false;
}
async function loadZip(buf){
  if(!window.JSZip)return false;
  const zip=await JSZip.loadAsync(buf);
  zipFiles={}; let pre=null;
  zip.forEach((p,f)=>{if(pre!==null||f.dir)return;const i=p.toLowerCase().indexOf('mods/scene/');if(i>=0)pre=p.slice(0,i);});
  if(pre===null)zip.forEach((p,f)=>{if(f.dir)return;if(p.toLowerCase().startsWith('scene/'))pre='';});
  if(pre===null)return false;
  const start=pre.toLowerCase()+(pre?'mods/':'');
  zip.forEach((p,f)=>{if(f.dir)return;const pl=p.toLowerCase();if(pl.startsWith(start)){zipFiles[p.slice(pre.length+(pre?5:0)).toLowerCase()]=f;}});
  if(!Object.keys(zipFiles).some(k=>k.startsWith('scene/')))return false;
  FS_MODE='zip'; return true;
}

// ── 画像キャッシュ ──────────────────────────────────────────
const imgCache={};
async function getImg(folder,name,...exts){
  const key=folder+'|'+name; if(key in imgCache)return imgCache[key];
  imgCache[key]=null;
  const blob=await readBlob(folder,name,...exts); if(!blob)return null;
  const url=URL.createObjectURL(blob);
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;});
  return (imgCache[key]=img);
}
async function getAudio(folder,name,...exts){
  const blob=await readBlob(folder,name,...exts); if(!blob)return null;
  return audioCtx.decodeAudioData(await blob.arrayBuffer()).catch(()=>null);
}

// ── パーサー ────────────────────────────────────────────────
const CMD_SET=new Set(['jump','scene','setbackground','setportrait','moveportrait','clearportrait',
  'hideui','showui','wipein','wipeout','setbgm','sound','setpanel','setpen','movepen',
  'disposeallpanel','disposeallpanels','disposelallpanels','stop','setitem','checkitem',
  'deleteitem','clearitem','racesetup','racestart','setracebackground','moveracebackground',
  'movebackground','seteffect','cleareffect','setracer','driveracer','moveracer','clearracer',
  'setvalue','addvalue','subvalue','multivalue','multvalue','divvalue','checkvalue','rnd',
  'shake','shakeall','loaded','setracerbackground']);

function parse(src){
  const lines=[],anchors={};
  for(let i=0,rows=src.split(/\r?\n/);i<rows.length;i++){
    let r=rows[i]; const ci=r.indexOf('//'); if(ci>=0)r=r.slice(0,ci);
    const t=r.trim(); if(!t)continue;
    if(t[0]==='#'){anchors[t.toLowerCase()]=lines.length;lines.push({tp:'anchor',text:t});continue;}
    const f=r.split(',').map(s=>s.trim());
    if(f.length&&CMD_SET.has(f[0].toLowerCase()))
      lines.push({tp:'cmd',cmd:f[0],args:f.slice(1)});
    else
      lines.push({tp:'dlg',speaker:f[0]||'',pid:f[1]||'',text:f.slice(2).join(',')||''});
  }
  return{lines,anchors};
}

// ── 数値ヘルパー ────────────────────────────────────────────
const F=(v,fb=0)=>{const n=parseFloat(v);return isNaN(n)?fb:n;};
const A=(a,i)=>(a&&i<a.length?a[i]:'');
const CLAMP=(v,a,b)=>Math.max(a,Math.min(b,v));
const LERP=(a,b,t)=>a+(b-a)*CLAMP(t,0,1);

// ── オーディオ ──────────────────────────────────────────────
const audioCtx=new(window.AudioContext||window.webkitAudioContext)();
let bgmNode=null;
const bgmGain=audioCtx.createGain(), sfxGain=audioCtx.createGain(), engGain=audioCtx.createGain();
bgmGain.connect(audioCtx.destination); sfxGain.connect(audioCtx.destination); engGain.connect(audioCtx.destination);
let bgmVol=S.get('bgm',1), sfxVol=S.get('sfx',1);
bgmGain.gain.value=bgmVol; sfxGain.gain.value=sfxVol; engGain.gain.value=sfxVol;

function playBGM(buf){
  if(bgmNode){try{bgmNode.stop();}catch{}bgmNode=null;}
  if(!buf)return;
  bgmNode=audioCtx.createBufferSource(); bgmNode.buffer=buf; bgmNode.loop=true;
  bgmNode.connect(bgmGain); bgmNode.start();
}
function playSFX(buf){if(!buf)return;const n=audioCtx.createBufferSource();n.buffer=buf;n.connect(sfxGain);n.start();}
let engNode=null,engBuf=null,defaultEngBuf=null,engPitch=1;
function startEngine(){
  if(!engBuf||engNode)return;
  engNode=audioCtx.createBufferSource(); engNode.buffer=engBuf; engNode.loop=true;
  engNode.playbackRate.value=engPitch; engNode.connect(engGain); engNode.start();
}
function stopEngine(){if(engNode){try{engNode.stop();}catch{}engNode=null;}}
function setEngPitch(v){engPitch=v;if(engNode)engNode.playbackRate.value=v;}
let gcBuf=null,shiftBuf=null; // gear change SFX

// ── Canvas ──────────────────────────────────────────────────
const cBg  =document.getElementById('c-bg').getContext('2d');
const cFar  =document.getElementById('c-far').getContext('2d');
const cNear =document.getElementById('c-near').getContext('2d');
const cEff  =document.getElementById('c-eff').getContext('2d');
function clr(ctx){ctx.clearRect(0,0,960,540);}
function drawBg(ctx,img,offX=0,tile=false){
  clr(ctx); if(!img)return;
  if(tile){
    ctx.save();
    const pat=ctx.createPattern(img,'repeat');
    pat.setTransform(new DOMMatrix().translate((offX%1)*-960,0));
    ctx.fillStyle=pat; ctx.fillRect(0,0,960,540); ctx.restore();
  } else {
    ctx.drawImage(img,0,0,960,540);
  }
}

// ── ゲーム状態 ──────────────────────────────────────────────
let scene=null, sceneName='', pc=0;
let waiting=false, stopped=false, running=false;
const vars={}, items={}, racerDefs={}, drivenRacers=new Set();
const portraits={}; // pid -> {pid,imgName,x,y}
let penX=0, penY=0;
let msgVisible=true;
let forceHideUi=false;
let curSpeaker='',curPid='',curText='';
let bgName='',nearName='',farName='',bgmName='',effectName='';
let nearOff=0,farOff=0,raceBgSpeed=0;
let effectImg=null,effUX=0,effUY=0,effAlpha=1,effCycle=0,effOX=0,effOY=0;
let bgImg=null,nearImg=null,farImg=null;
let raceSetup={dist:400,win:'',lose:''};
let racing=false;
// theme assets
const gearTex={}, signalTex={}, signalSfx={};
let tachoSrc='',needleSrc='',gearSrc='';
let winTex='',loseTex='',flyingTex='';
let numbersImg=null,gearEffectImg=null;

class SpriteNumbers{
  constructor(parent,name,position,size,scale,suffix,hasDecimal,hasHundredth,custom=null){
    this.root=document.createElement('div');
    this.root.className='sprite-numbers';
    this.root.id=name;
    this.root.style.left=(480+position.x)+'px';
    this.root.style.top=(270-position.y)+'px';
    this.root.style.width=size.x+'px';
    this.root.style.height=size.y+'px';
    this.root.style.transform=`translate(-50%,-50%) scale(${scale})`;
    parent.appendChild(this.root);
    const cfg=Object.assign(this.config(name),custom||{});
    this.suffixName=suffix;
    this.prefixName=cfg.prefixName||'';
    this.prefix=this.prefixName?this.part('prefix',cfg.prefixX,0,192,128):null;
    this.suffix=this.part('suffix',cfg.suffixX,0,192,128);
    this.dm01=hasHundredth?this.part('dm01',cfg.dm01X,0,64,128):null;
    this.dm1=hasDecimal?this.part('dm1',cfg.dm1X,0,64,128):null;
    this.dot=hasDecimal?this.part('dot',cfg.dotX,-16,48,96):null;
    this.d1=this.part('d1',cfg.d1X,0,64,128);
    this.d10=this.part('d10',cfg.d10X,0,64,128);
    this.d100=this.part('d100',cfg.d100X,0,64,128);
    this.d1000=cfg.hasD1000===false?null:this.part('d1000',cfg.d1000X,0,64,128);
    this.setActive(false);
  }
  config(name){
    return {
      suffixX:name==='SpeedDisplay'?167.7:name==='DistanceDisplay'?160:224,
      dm1X:name==='SpeedDisplay'?39.7:32,
      dotX:name==='SpeedDisplay'?-3.6:name==='DistanceDisplay'?-12.1:-11.4,
      d1X:name==='SpeedDisplay'?-47.5:name==='DistanceDisplay'?-56.3:-56.1,
      d10X:name==='SpeedDisplay'?-111.5:name==='DistanceDisplay'?-120.3:-120.1,
      d100X:name==='SpeedDisplay'?-175.5:name==='DistanceDisplay'?-184.3:-184.1,
      d1000X:name==='SpeedDisplay'?-239.5:name==='DistanceDisplay'?-248.3:-248.1,
      dm01X:name==='TimeDisplay'?96:0
    };
  }
  part(name,x,y,w,h){
    const c=document.createElement('canvas');
    c.width=w; c.height=h; c.dataset.part=name;
    c.style.left=(parseFloat(this.root.style.width)/2+x-w/2)+'px';
    c.style.top=(parseFloat(this.root.style.height)/2-y-h/2)+'px';
    c.style.width=w+'px'; c.style.height=h+'px';
    this.root.appendChild(c);
    return c;
  }
  setTexture(img){this.img=img;this.setSuffix();this.setValue(0);}
  draw(c,sx,sy,sw,sh){
    if(!c||!this.img)return;
    const ctx=c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);
    if(sw>0&&sh>0)ctx.drawImage(this.img,sx,sy,sw,sh,0,0,c.width,c.height);
  }
  setSuffix(){
    if(!this.img)return;
    const top=this.suffixName==='m'?128:this.suffixName==='km/h'?256:384;
    this.draw(this.suffix,64.5,top,191.5,128);
    if(this.prefix)this.draw(this.prefix,64.5,this.prefixName==='first'?512:640,191.5,128);
    if(this.dot)this.draw(this.dot,64,0,64,128);
  }
  digit(c,d,hide){if(!c)return;this.draw(c,0,hide?0:d*128,hide?0:64,hide?0:128);}
  setValue(value){
    if(!this.img)return;
    const n=String(Math.floor(CLAMP(value*100,0,999999))).padStart(6,'0');
    this.digit(this.dm01,+n[5],false);
    this.digit(this.dm1,+n[4],false);
    this.digit(this.d1,+n[3],false);
    this.digit(this.d10,+n[2],value<10);
    this.digit(this.d100,+n[1],value<100);
    this.digit(this.d1000,+n[0],value<1000);
  }
  setActive(v){this.root.style.display=v?'block':'none';}
}
const spriteNums={time:null,dist:null,speed:null,first:null,your:null};
function initSpriteNumbers(){
  const hud=document.getElementById('hud');
  if(spriteNums.time)return;
  spriteNums.time=new SpriteNumbers(hud,'TimeDisplay',{x:-246,y:-191.2},{x:512,y:128},.5,'sec',true,true);
  spriteNums.speed=new SpriteNumbers(hud,'SpeedDisplay',{x:281,y:-217.3},{x:323.1,y:80.8},.75,'km/h',true,false);
  spriteNums.dist=new SpriteNumbers(hud,'DistanceDisplay',{x:-169.8,y:-246.6},{x:512,y:128},.3,'m',true,false);
  spriteNums.first=new SpriteNumbers(hud,'FirstTimeDisplay',{x:0,y:64},{x:704,y:128},.4,'sec',true,true,{suffixX:257,dm1X:65,dotX:20.5,d1X:-23,d10X:-87,d100X:-151,dm01X:129,prefixName:'first',prefixX:-279,hasD1000:false});
  spriteNums.your=new SpriteNumbers(hud,'YourTimeDisplay',{x:0,y:0},{x:704,y:128},.4,'sec',true,true,{suffixX:257,dm1X:65,dotX:21.1,d1X:-23.3,d10X:-87.3,d100X:-151.3,dm01X:129,prefixName:'your',prefixX:-279.3,hasD1000:false});
}
function setRaceNumbersActive(v){['time','dist','speed'].forEach(k=>spriteNums[k]&&spriteNums[k].setActive(v));}
function setResultNumbersActive(v){['first','your'].forEach(k=>spriteNums[k]&&spriteNums[k].setActive(v));}
function setSpriteNumbersActive(v){setRaceNumbersActive(v);if(!v)setResultNumbersActive(false);}
function setSpriteNumbersTexture(img){numbersImg=img;Object.values(spriteNums).forEach(n=>n&&n.setTexture(img));}

// ── タイプライター ──────────────────────────────────────────
const msgEl=document.getElementById('message');
const spkEl=document.getElementById('speaker');
let typeTimer=null, typeFull='', typeIdx=0;

function startType(speaker,pid,text){
  spkEl.textContent=speaker;
  typeFull=text.replace(/<br>/gi,'\n');
  // ポートレートdim
  document.querySelectorAll('.portrait').forEach(p=>p.classList.toggle('dim',p.dataset.pid!==pid));
  clearType(); typeIdx=0; msgEl.textContent='';
  const wait=S.get('tw',0.05)*1000/6;
  if(wait<=0){msgEl.textContent=typeFull;return;}
  function step(){
    if(typeIdx>=typeFull.length){typeTimer=null;return;}
    msgEl.textContent=typeFull.slice(0,++typeIdx);
    typeTimer=setTimeout(step,wait);
  }
  step();
}
function clearType(){if(typeTimer){clearTimeout(typeTimer);typeTimer=null;}}
function skipType(){
  if(typeTimer===null)return false; // 既に完了
  clearType(); msgEl.textContent=typeFull; return true;
}

// ── パネル ──────────────────────────────────────────────────
const panelsEl=document.getElementById('panels');
let panelBtns=[],panelRecords=[];

function addPanel(label,a1,sub,a2,bg,w,h,sel,noBorder,cx,cy,cb){
  const PW=Math.max(w>0?w*960:192,sel&&MOBILE_BUILD?280:0);
  const PH=Math.max(h>0?h*540:32,sel&&MOBILE_BUILD?44:0);
  const el=document.createElement('div');
  el.className='panel'+(sel?' sel':'');
  el.style.cssText=`left:${cx*960}px;top:${cy*540}px;width:${PW}px;height:${PH}px;opacity:0;transition:opacity .18s;`;
  // 背景色
  let col=sel?'rgba(14,24,41,.97)':'rgba(0,0,0,.48)';
  if(bg&&bg[0]==='#'){
    const hex=bg.slice(1);
    if(hex.length>=6){
      const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
      const a=hex.length>=8?parseInt(hex.slice(6,8),16)/255:1;
      col=`rgba(${r},${g},${b},${a.toFixed(3)})`;
    }
  }
  el.style.background=col;
  if(sel&&!noBorder)el.style.border='1px solid rgba(97,114,140,.9)';
  const lEl=document.createElement('div');
  lEl.className='panel-left'; lEl.textContent=label;
  lEl.style.textAlign=a1==='Right'?'right':a1==='Center'?'center':'left';
  el.appendChild(lEl);
  if(sub){
    const rEl=document.createElement('div');
    rEl.className='panel-right'; rEl.textContent=sub;
    rEl.style.textAlign=a2==='Left'?'left':a2==='Center'?'center':'right';
    el.appendChild(rEl);
  }
  if(sel){
    el.tabIndex=0;
    let fired=false;
    const go=()=>{if(fired)return;fired=true;cb();};
    el.addEventListener('click',go);
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')go();});
    panelBtns.push(el);
  }
  panelsEl.appendChild(el);
  requestAnimationFrame(()=>el.style.opacity='1');
}
function activePanelBtns(){
  panelBtns=panelBtns.filter(b=>b&&b.isConnected);
  return panelBtns;
}
function clearPanels(){
  if(document.activeElement&&document.activeElement.classList?.contains('panel'))document.activeElement.blur();
  panelsEl.innerHTML='';panelBtns=[];panelRecords=[];focusedBtn=-1;
}

// ── ポートレート DOM ────────────────────────────────────────
const portraitsEl=document.getElementById('portraits');
function renderPortrait(pid,imgEl,x,y){
  let el=portraitsEl.querySelector(`[data-pid="${pid}"]`);
  if(!el){el=document.createElement('div');el.className='portrait';el.dataset.pid=pid;portraitsEl.appendChild(el);}
  if(imgEl){
    el.innerHTML='';
    // imgElはImgタグでもdivでもよいように幅を取得
    const w=Math.round(imgEl.naturalWidth||imgEl.width||0);
    const h=Math.round(imgEl.naturalHeight||imgEl.height||0);
    imgEl.style.width=w+'px'; imgEl.style.height=h+'px';
    el.style.width=w+'px'; el.style.height=h+'px';
    el.appendChild(imgEl);
  }
  const elW=parseFloat(el.style.width)||0;
  el.style.left=(x*960-elW/2)+'px';
  el.style.bottom=(y*540+20)+'px';
  return el;
}

// ── レーサー DOM ────────────────────────────────────────────
const racersEl=document.getElementById('racers');
const racerState={}; // id->{racer,cnv,img}
const RACER_DRAW_SCALE=1;
function initRacerEl(racer,img){
  if(!img)return;
  const frames=Math.max(racer.idleF,racer.driveF);
  const fw=img.naturalWidth/2, fh=img.naturalHeight/frames;
  const dw=Math.round(fw*RACER_DRAW_SCALE), dh=Math.round(fh*RACER_DRAW_SCALE);
  const cnv=document.createElement('canvas');
  cnv.className='racer-canvas'; cnv.width=fw; cnv.height=fh;
  cnv.style.width=dw+'px'; cnv.style.height=dh+'px';
  racersEl.appendChild(cnv);
  racerState[racer.id]={racer,cnv,img,fw,fh,dw,dh};
  posRacer(racer.id,racer.x,racer.y);
  drawRacerFrame(racer.id,false,0);
}
function posRacer(id,x,y){
  const s=racerState[id]; if(!s)return;
  s.racer.x=x; s.racer.y=y;
  s.cnv.style.left=(x*960-s.dw/2)+'px';
  s.cnv.style.bottom=(y*540-s.dh/2)+'px';
  s.cnv.style.top='auto';
}
function drawRacerFrame(id,driving,frame){
  const s=racerState[id]; if(!s||!s.img)return;
  const {cnv,img,fw,fh}=s; const r=s.racer;
  const frames=driving?r.driveF:r.idleF;
  const fi=Math.max(0,Math.min(frame,frames-1));
  const ctx=cnv.getContext('2d');
  ctx.clearRect(0,0,fw,fh);
  ctx.drawImage(img,driving?fw:0,fi*fh,fw,fh,0,0,fw,fh);
}

function playShiftEffect(st){
  playSFX(gcBuf);playSFX(shiftBuf);
  const rs=st&&racerState[st.racer.id];
  if(!gearEffectImg||!rs)return;
  for(let i=0;i<6;i++){
    const c=document.createElement('canvas');c.width=256;c.height=256;
    c.style.cssText='position:absolute;top:auto;width:64px;height:64px;pointer-events:none;z-index:2;transform-origin:center;';
    racersEl.appendChild(c);
    const randomX=(Math.random()*2-1)*28,randomY=(Math.random()*2-1)*28;
    const angle=Math.random()*360,maxScale=.8+Math.random()*2.2,start=performance.now();
    const tick=now=>{
      const elapsed=(now-start)/1000,cell=Math.floor(elapsed/.066);
      if(cell>=6||!c.isConnected){c.remove();return;}
      const ctx=c.getContext('2d');ctx.clearRect(0,0,256,256);
      ctx.drawImage(gearEffectImg,0,gearEffectImg.naturalHeight-(cell+1)*256,256,256,0,0,256,256);
      const left=(parseFloat(rs.cnv.style.left)||0)+rs.dw/2-32+randomX-st.speed*elapsed*18;
      const bottom=(parseFloat(rs.cnv.style.bottom)||0)+rs.dh/2-32+randomY;
      const scale=1+Math.pow(elapsed/(.066*6),2)*maxScale;
      c.style.left=left+'px';c.style.bottom=bottom+'px';c.style.transform=`rotate(${angle}deg) scale(${scale})`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

let sceneDriveToken=0;
async function playSceneDriveSound(racer,seconds,token){
  if(racing)return;
  engBuf=(racer&&racer.engineBuf)||defaultEngBuf||engBuf;
  if(!engBuf)return;
  startEngine();setEngPitch(1.05);
  engGain.gain.cancelScheduledValues(audioCtx.currentTime);
  engGain.gain.value=sfxVol;
  await new Promise(r=>setTimeout(r,Math.max(50,seconds*720)));
  if(token!==sceneDriveToken||racing)return;
  await anim(700,p=>{if(token===sceneDriveToken&&!racing)engGain.gain.value=LERP(sfxVol,0,p);});
  if(token===sceneDriveToken&&!racing)stopEngine();
  setEngPitch(1);engGain.gain.value=sfxVol;
}
async function moveRacerScene(id,tx,ty,seconds){
  const s=racerState[id];if(!s)return;
  const token=++sceneDriveToken;
  if(drivenRacers.has(id))playSceneDriveSound(s.racer,seconds,token);
  const fl=parseFloat(s.cnv.style.left)||0,fb=parseFloat(s.cnv.style.bottom)||0;
  await anim(seconds*1000,p=>{
    s.cnv.style.left=LERP(fl,(tx*960-s.dw/2),p)+'px';
    s.cnv.style.bottom=LERP(fb,(ty*540-s.dh/2),p)+'px';
  });
  s.racer.x=tx;s.racer.y=ty;
}

// ── エフェクト ──────────────────────────────────────────────
function clearEffect(){effectImg=null;clr(cEff);}

// ── ワイプ ──────────────────────────────────────────────────
const wipeEl=document.getElementById('wipe');
const wipeCtx=wipeEl.getContext('2d');
const wipeMasks={};
function closeWipeImmediately(){
  wipeCtx.globalAlpha=1;wipeCtx.fillStyle='#000';wipeCtx.fillRect(0,0,960,540);
}
function openWipeImmediately(){
  wipeCtx.globalAlpha=1;wipeCtx.clearRect(0,0,960,540);
}
closeWipeImmediately();
function anim(ms,fn){return new Promise(res=>{const s=performance.now();function step(t){const p=CLAMP((t-s)/ms,0,1);fn(p);if(p<1)requestAnimationFrame(step);else res();}requestAnimationFrame(step);});}
async function prepareWipeMask(style){
  const key=(style||'AroundToCenter').toLowerCase();
  if(wipeMasks[key])return wipeMasks[key];
  const img=await getImg('essential',style||'AroundToCenter','.png');
  if(!img)return null;
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0);
  const src=x.getImageData(0,0,c.width,c.height).data;
  const mask=new Float32Array(c.width*c.height);
  const taps=[[0,0,.24],[1,0,.12],[-1,0,.12],[0,1,.12],[0,-1,.12],[1,1,.07],[-1,1,.07],[1,-1,.07],[-1,-1,.07]];
  for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++){
    let value=0;
    for(const[ox,oy,w]of taps){
      const sx=CLAMP(xx+ox*5,0,c.width-1),sy=CLAMP(y+oy*5,0,c.height-1);
      value+=src[(sy*c.width+sx)*4+3]/255*w;
    }
    mask[y*c.width+xx]=value;
  }
  return (wipeMasks[key]={mask,width:c.width,height:c.height,canvas:c,ctx:x,image:x.createImageData(c.width,c.height)});
}
function smoothstep(a,b,v){const t=CLAMP((v-a)/(b-a),0,1);return t*t*(3-2*t);}
function drawWipe(maskData,progress,style){
  if(progress<=0){wipeCtx.clearRect(0,0,960,540);return;}
  if(progress>=1){wipeCtx.fillStyle='#000';wipeCtx.fillRect(0,0,960,540);return;}
  const feather=/^(lefttoright|righttoleft)$/i.test(style)?0.5:0.08;
  const threshold=1+feather-progress*(1+2*feather);
  const out=maskData.image.data;
  for(let i=0;i<maskData.mask.length;i++){
    const a=Math.round(smoothstep(threshold-feather,threshold+feather,maskData.mask[i])*255),p=i*4;
    out[p]=out[p+1]=out[p+2]=0;out[p+3]=a;
  }
  maskData.ctx.putImageData(maskData.image,0,0);
  wipeCtx.clearRect(0,0,960,540);wipeCtx.imageSmoothingEnabled=true;
  wipeCtx.drawImage(maskData.canvas,0,0,960,540);
}
async function runWipe(closed,style,dur){
  style=style||'AroundToCenter';
  const mask=await prepareWipeMask(style);
  const from=closed?0:1,to=closed?1:0;
  if(!mask){await anim(Math.max(10,dur*1000),p=>{wipeCtx.globalAlpha=LERP(from,to,p);wipeCtx.fillStyle='#000';wipeCtx.fillRect(0,0,960,540);wipeCtx.globalAlpha=1;});return;}
  await anim(Math.max(10,dur*1000),p=>drawWipe(mask,LERP(from,to,p),style));
}
async function wipeIn(style,dur){await runWipe(true,style,dur);}
async function wipeOut(style,dur){await runWipe(false,style,dur);}

// ── メッセージ表示/非表示アニメ ────────────────────────────
const msgwEl=document.getElementById('msgwrap');
const msgboxEl=document.getElementById('msgbox');
const utilEl=document.getElementById('util');
const clutchSlowOverlay=document.getElementById('clutch-slow-overlay');
let msgOffY=0;
function setMsgVisible(v){msgVisible=v;}
function animMsg(dt){
  const hidden=forceHideUi||!msgVisible;
  const target=hidden?190:0;
  msgOffY+=(target-msgOffY)*Math.min(1,dt*8);
  const y=Math.round(msgOffY);
  msgwEl.style.transform=`translateY(${y}px)`;
  msgboxEl.style.transform=`translateY(${y}px)`;
  utilEl.style.transform=`translateY(${y}px)`;
  msgwEl.style.display=forceHideUi?'none':'';
  msgboxEl.style.display=forceHideUi?'none':'';
  utilEl.style.display=forceHideUi?'none':'flex';
}

// ── メインループ ────────────────────────────────────────────
let lastT=0;
function loop(t){
  const dt=Math.min((t-lastT)/1000,.1); lastT=t;
  const raceFinished=document.getElementById('hud').classList.contains('race-finished');
  clutchSlowOverlay.classList.toggle('active',!!(racing&&!raceFinished&&clutchSlowdown&&raceClutchActive()));
  if(!racing){
    if(Math.abs(raceBgSpeed)>.0001){
      nearOff=(nearOff+raceBgSpeed*dt)%1;
      farOff=(farOff+raceBgSpeed*.25*dt)%1;
      drawBg(cNear,nearImg,nearOff,true);
      drawBg(cFar,farImg,farOff,true);
    }
    drivenRacers.forEach(id=>{
      const s=racerState[id]; if(!s)return;
      const r=s.racer;
      const frame=Math.floor(t/1000/Math.max(.01,r.driveFrameTime))%Math.max(1,r.driveF);
      drawRacerFrame(id,true,frame);
    });
  }
  if(effectImg){
    effOX=(effOX+effUX*dt)%1; effOY=(effOY+effUY*dt)%1;
    const alpha=CLAMP(effAlpha+Math.max(0,Math.sin(t/1000*Math.PI*effCycle)),0,1);
    clr(cEff);
    cEff.save(); cEff.globalAlpha=alpha;
    const pat=cEff.createPattern(effectImg,'repeat');
    pat.setTransform(new DOMMatrix().translate(effOX*-960,effOY*540));
    cEff.fillStyle=pat; cEff.fillRect(0,0,960,540); cEff.restore();
  }
  animMsg(dt);
  requestAnimationFrame(loop);
}

// ── 変数 ────────────────────────────────────────────────────
const vGet=id=>vars[id.toLowerCase()]||0;
const vSet=(id,v)=>vars[id.toLowerCase()]=v;
function sub(s){return(s||'').replace(/\{%([a-zA-Z0-9_-]+)\}/g,(_,id)=>String(vGet(id)));}
function vSub(v,fb=0){return F(sub(v),fb);}
function cmp(l,op,r){switch(op){case'==':return Math.abs(l-r)<1e-9;case'!=':return Math.abs(l-r)>=1e-9;case'<':return l<r;case'>':return l>r;case'<=':return l<=r;case'>=':return l>=r;}return false;}

// ── シーン実行 ──────────────────────────────────────────────
async function openScene(name){
  sceneName=name.replace(/\.txt$/i,'');
  const src=await readText('scene/'+sceneName+'.txt');
  scene=parse(src); pc=0;
}
function jumpTo(anchor){
  const k=anchor.toLowerCase();
  if(!(k in scene.anchors))throw new Error('anchor not found: '+anchor);
  pc=scene.anchors[k]+1; waiting=false; stopped=false;
}

async function run(){
  if(!scene||waiting||stopped)return;
  while(pc<scene.lines.length&&!waiting&&!stopped){
    const line=scene.lines[pc++];
    if(line.tp==='anchor')continue;
    if(line.tp==='dlg'){
      curSpeaker=sub(line.speaker); curPid=line.pid; curText=sub(line.text);
      startType(curSpeaker,curPid,curText);
      waiting=true; return;
    }
    await execCmd(line);
  }
}
function next(){
  if(waiting){waiting=false;curSpeaker=curPid=curText='';run();}
}
let lastStoryAdvanceAt=0;
function advanceStory(){
  const now=performance.now();
  if(now-lastStoryAdvanceAt<80)return true;
  if(activePanelBtns().length||!waiting)return false;
  lastStoryAdvanceAt=now;
  if(skipType())return true;
  next();
  return true;
}

async function execCmd(line){
  const cmd=line.cmd.toLowerCase(), a=line.args||[];
  try{
  switch(cmd){
    case 'scene': await openScene(A(a,0)); break;
    case 'jump':  jumpTo(A(a,0)); break;

    case 'setbackground':{
      bgName=A(a,0);
      bgImg=await getImg('background',bgName,'.png','.jpg','.jpeg');
      drawBg(cBg,bgImg);
    }break;

    case 'setportrait':{
      const pid=A(a,0),imgN=A(a,1);
      const px=A(a,2),py=A(a,3);
      if(!portraits[pid])portraits[pid]={pid,imgName:'',x:.5,y:0};
      if(imgN)portraits[pid].imgName=imgN;
      if(px!=='')portraits[pid].x=F(px);
      if(py!=='')portraits[pid].y=F(py);
      const p=portraits[pid];
      const img=await getImg('portrait',p.imgName,'.png','.jpg');
      if(!img)break;
      const imgEl=new Image(); imgEl.src=img.src;
      await new Promise(res=>{if(imgEl.complete)res();else imgEl.onload=res;});
      renderPortrait(pid,imgEl,p.x,p.y);
    }break;

    case 'moveportrait':{
      const pid=A(a,0),tx=F(A(a,1)),ty=F(A(a,2)),sec=Math.max(.01,F(A(a,3),.4));
      if(portraits[pid]){portraits[pid].x=tx;portraits[pid].y=ty;}
      const el=portraitsEl.querySelector(`[data-pid="${pid}"]`); if(!el)break;
      const fl=parseFloat(el.style.left)||0, fb=parseFloat(el.style.bottom)||0;
      const w=parseFloat(el.style.width)||0;
      await anim(sec*1000,p=>{el.style.left=LERP(fl,tx*960-w/2,p)+'px';el.style.bottom=LERP(fb,ty*540+20,p)+'px';});
    }break;

    case 'clearportrait':
      portraitsEl.innerHTML=''; Object.keys(portraits).forEach(k=>delete portraits[k]); break;

    case 'hideui': setMsgVisible(false); break;
    case 'showui': setMsgVisible(true);  break;

    case 'wipein':
      await wipeIn(A(a,0)||'AroundToCenter',F(A(a,1),1));
      clearType(); msgEl.textContent=''; spkEl.textContent='';
      curSpeaker=curPid=curText='';
      break;
    case 'wipeout': await wipeOut(A(a,0)||'AroundToCenter',F(A(a,1),1)); break;

    case 'setbgm':{
      bgmName=A(a,0);
      if(bgmName.toLowerCase()==='mute'){playBGM(null);break;}
      const buf=await getAudio('bgm',bgmName,'.ogg','.mp3','.wav');
      playBGM(buf);
    }break;

    case 'sound':{
      const buf=await getAudio('sound',A(a,0),'.wav','.ogg','.mp3');
      playSFX(buf);
    }break;

    case 'setpen':  penX=F(A(a,0)); penY=F(A(a,1)); break;
    case 'movepen': penX+=F(A(a,0)); penY+=F(A(a,1)); break;

    case 'setpanel':{
      const rawSel=A(a,0), sel=rawSel.toLowerCase().startsWith('selectable');
      const noBorder=rawSel.toLowerCase()==='selectablenoborder';
      const target=A(a,1),label=sub(A(a,2)),a1=A(a,3),sub2=sub(A(a,4)),a2=A(a,5);
      const bg=A(a,7), w=F(A(a,8),.2), h=F(A(a,9),0);
      const PH=Math.max(h>0?h*540:32,sel&&MOBILE_BUILD?44:0);
      const cx=penX, cy=penY;
      panelRecords.push({rawSel,target,label,a1,sub:sub2,a2,bg,w,h,cx,cy});
      addPanel(label,a1,sub2,a2,bg,w,h,sel,noBorder,cx,cy,()=>{
        clearPanels(); jumpTo(target); run();
      });
      penY+=PH/540+.005;
    }break;

    case 'disposeallpanel':case 'disposeallpanels':case 'disposelallpanels':
      clearPanels(); break;
    case 'stop': stopped=true; break;

    case 'setvalue':  vSet(A(a,0),F(A(a,1))); break;
    case 'addvalue':  vSet(A(a,0),vGet(A(a,0))+F(A(a,1))); break;
    case 'subvalue':  vSet(A(a,0),vGet(A(a,0))-F(A(a,1))); break;
    case 'multivalue':case 'multvalue': vSet(A(a,0),vGet(A(a,0))*F(A(a,1))); break;
    case 'divvalue':  vSet(A(a,0),vGet(A(a,0))/Math.max(1e-9,F(A(a,1),1))); break;
    case 'rnd':       vSet(A(a,0),Math.floor(Math.random()*Math.max(1,Math.round(F(A(a,1),1))))); break;
    case 'checkvalue': if(cmp(vGet(A(a,0)),A(a,1),F(A(a,2))))jumpTo(A(a,3)); break;

    case 'setitem':{
      const id=A(a,0); const d={};
      for(let i=1;i<a.length;i++){const p=a[i].split('=');if(p.length>=2)d[p[0]]=p.slice(1).join('=');}
      items[id]=d;
    }break;
    case 'checkitem': { const _cid=A(a,0); if(items[_cid]!==undefined)jumpTo(A(a,1)); } break;
    case 'deleteitem': delete items[A(a,0)]; break;
    case 'clearitem':  Object.keys(items).forEach(k=>delete items[k]); break;

    case 'setracebackground':case 'setracerbackground':{
      nearName=A(a,0); farName=A(a,1); nearOff=farOff=0;raceBgSpeed=0;
      nearImg=await getImg('background',nearName,'.png','.jpg');
      farImg =await getImg('background',farName ,'.png','.jpg');
      drawBg(cNear,nearImg,0,true); drawBg(cFar,farImg,0,true);
    }break;
    case 'moveracebackground':case 'movebackground': raceBgSpeed=F(A(a,0)); break;

    case 'seteffect':{
      effectName=A(a,0);
      const camInf=F(A(a,1),0); effUX=F(A(a,2),0); effUY=F(A(a,3),0);
      effAlpha=F(A(a,4),1); effCycle=F(A(a,5),0); effOX=effOY=0;
      effectImg=await getImg('effect',effectName,'.png','.jpg');
    }break;
    case 'cleareffect': effectName=''; clearEffect(); break;

    case 'setracer':{
      const sid=A(a,0); let id=sid,n=2; while(racerDefs[id])id=sid+'#'+n++;
      const r={id,sid,
        idleF:Math.max(1,Math.round(F(A(a,1),1))), idleFrameTime:F(A(a,2),1),
        driveF:Math.max(1,Math.round(F(A(a,3),1))), driveFrameTime:F(A(a,4),.06),
        x:F(A(a,5),.2), y:F(A(a,6),.55), type:A(a,7), trans:A(a,8),
        baseSpeed:vSub(A(a,9),1), shiftTime:vSub(A(a,10),.25),
        texId:sid,
        // 物理パラメータデフォルト
        weight:200,torque:5,maxRpm:10000,minRpm:2000,powerRpm:7500,dropRpm:9500,
        wheelSize:.55,finalGear:5,airDrag:1,gearRatios:[2.5,2,1.5,1.25,1,.8]
      };
      applyItems(r);
      r.engineBuf=await getAudio('racer',r.texId+'_engine','.wav','.ogg','.mp3')||defaultEngBuf;
      racerDefs[r.id]=r;
      if(r.type.toLowerCase()==='player'){
        engBuf=r.engineBuf||defaultEngBuf;
        const gb=await getAudio('essential','gearChangeEffect','.wav','.mp3');
        if(gb)gcBuf=gb;
      }
      const img=await getImg('racer',r.texId,'.png','.jpg');
      initRacerEl(r,img);
    }break;
    case 'clearracer':
      sceneDriveToken++;
      if(!racing){stopEngine();setEngPitch(1);engGain.gain.value=sfxVol;}
      Object.keys(racerDefs).forEach(k=>delete racerDefs[k]);
      drivenRacers.clear();
      Object.keys(racerState).forEach(k=>{try{racerState[k].cnv.remove();}catch{}delete racerState[k];});
    break;
    case 'driveracer': drivenRacers.add(A(a,0)); break;
    case 'moveracer':{
      const id=A(a,0),tx=F(A(a,1)),ty=F(A(a,2)),sec=Math.max(.01,F(A(a,3),1));
      moveRacerScene(id,tx,ty,sec).catch(e=>console.error('MoveRacer error',e));
    }break;

    case 'racesetup': raceSetup={dist:F(A(a,0),400),win:A(a,1),lose:A(a,2)}; break;
    case 'racestart': await doRace(); break;

    case 'shake': await doShake(); break;
    case 'shakeall': await doShake(); break;
    case 'loaded': break; // セーブロード時のみ
    default: console.warn('未対応コマンド:',line.cmd);
  }
  }catch(e){console.error('execCmd error:',line.cmd,e);}
}

function applyItems(r){
  for(const[,d] of Object.entries(items)){
    const tgt=d['Target']||d['target'];
    if(tgt&&tgt.toLowerCase()!==(r.sid||r.id).toLowerCase())continue;
    for(const[k,v] of Object.entries(d)){
      const m=F(v,1);
      switch(k.toLowerCase()){
        case 'texture':r.texId=v;break;
        case 'transmission':r.trans=v;break;
        case 'rpm':case 'maxspeed':r.maxRpm*=m;r.minRpm*=m;r.powerRpm*=m;r.dropRpm*=m;break;
        case 'gearratio':r.finalGear*=m;break;
        case 'airdrag':r.airDrag*=m;break;
        case 'weight':r.weight*=m;break;
        case 'torque':r.torque*=m;break;
        case 'wheelsize':r.wheelSize*=m;break;
        case 'gear1':r.gearRatios[0]*=m;break;case 'gear2':r.gearRatios[1]*=m;break;
        case 'gear3':r.gearRatios[2]*=m;break;case 'gear4':r.gearRatios[3]*=m;break;
        case 'gear5':r.gearRatios[4]*=m;break;case 'gear6':r.gearRatios[5]*=m;break;
      }
    }
  }
}

async function doShake(){
  const el=msgboxEl;
  for(let i=0;i<8;i++){el.style.marginTop=(i%2?-8:8)+'px';await new Promise(r=>setTimeout(r,35));}
  el.style.marginTop='';
}

// ═══════════════════════════════════════════════════════════════════
//  レースシミュレーション
// ═══════════════════════════════════════════════════════════════════
function gearMax(trans){return trans.endsWith('4')?4:trans.endsWith('5')?5:6;}

function simStep(st,accel,dt){
  const r=st.racer;
  const gr=st.gear>0&&st.gear<=r.gearRatios.length?r.gearRatios[st.gear-1]*r.finalGear:0;
  const vMax=gr>0?r.maxRpm/gr/60*r.wheelSize*Math.PI*r.baseSpeed:0;
  const rpm=vMax>0?CLAMP(st.speed/vMax,0,1):st.rpm;
  const mn=r.minRpm/r.maxRpm,pw=r.powerRpm/r.maxRpm,dr=r.dropRpm/r.maxRpm;
  let curve;
  if(rpm<pw){const t=rpm/Math.max(.001,pw);curve=t*(2-t)*(1-mn)+mn;}
  else if(rpm<dr){curve=1;}
  else{const t=(rpm-dr)/Math.max(.001,1-dr);curve=Math.max(0,1-t*t);}
  let drive=(!accel||st.clutch||gr<=0)?0:r.torque*r.baseSpeed*9.8*gr/(r.wheelSize*.5)/r.weight*curve;
  const drag=Math.pow(st.speed*.046,2)*r.airDrag;
  st.speed=Math.max(0,st.speed+(drive-drag)*dt);
  if(!accel||st.clutch)st.speed*=Math.max(0,1-.05*dt);
  st.distance+=st.speed*dt;
  if(st.gear<=0||st.clutch)st.rpm=CLAMP(st.rpm+(accel?2:-2)*dt,0,1);
  else st.rpm=rpm;
}

// ミッション操作
function shiftMoto(st,dir){
  const mx=gearMax(st.racer.trans);
  if(st.gear===0&&dir!==0)st.gear=1;
  else if(st.gear>0)st.gear=CLAMP(st.gear+dir,1,mx);
}
function shiftCar(st,h,v){
  let g=st.gear;
  if(g===0){if(v>0)g=3;else if(v<0)g=4;else if(h<0)g=-1;else if(h>0)g=-2;}
  else if(g===-1){if(v>0)g=1;else if(v<0)g=2;else if(h>0)g=0;}
  else if(g===-2){if(v>0)g=5;else if(v<0&&gearMax(st.racer.trans)>=6)g=6;else if(h<0)g=0;}
  else if(g===1&&v<0||g===2&&v>0)g=-1;
  else if(g===3&&v<0||g===4&&v>0)g=0;
  else if(g===5&&v<0||g===6&&v>0)g=-2;
  st.gear=g;
}
function shiftInput(st,h,v){
  if(st.racer.trans.toLowerCase().startsWith('car'))shiftCar(st,h,v);
  else if(v!==0)shiftMoto(st,v>0?1:-1);
  if(racing)updateGearHUD(st,document.getElementById('hud-gear'));
}

// 入力状態
const keys={};
const mouse={l:false,r:false,x:0,y:0};
const padInput={accel:false,clutch:false};
let accelLatchUntil=0;
let rightAccelHeld=false;
let leftClutchHeld=false,leftReleaseGuardUntil=0;
let leftMoveReconstructAllowed=true;
let mouseClutchForcedOff=false;
let clutchSlowdown=S.get('clutchSlowdown',false);
let gesture=null,gShifted=false;
let suppressNextStoryClickUntil=0;
function latchAccel(ms=360){accelLatchUntil=Math.max(accelLatchUntil,performance.now()+ms);}
function raceAccelActive(){return rightAccelHeld||mouse.r||performance.now()<accelLatchUntil||keys['KeyZ']||padInput.accel;}
function raceClutchActive(){return (!mouseClutchForcedOff&&leftClutchHeld)||keys['ShiftLeft']||keys['ShiftRight']||padInput.clutch;}
function releaseLeftRaceInput(e){
  const rightStillHeld=rightAccelHeld||mouse.r||(typeof e.buttons==='number'&&!!(e.buttons&2));
  mouseClutchForcedOff=true;leftClutchHeld=false;mouse.l=false;gesture=null;leftReleaseGuardUntil=performance.now()+90;leftMoveReconstructAllowed=true;
  document.getElementById('clutch-slow-overlay').classList.remove('active');
  if(rightStillHeld){rightAccelHeld=true;mouse.r=true;latchAccel(1000);}
  if(!racing)return;
  const st=rStates.find(s=>s.racer.type.toLowerCase()==='player');
  if(st){
    if(st.clutchGear!==st.gear){playShiftEffect(st);st.clutchGear=st.gear;}
    st.clutch=false;
    const gearImg=document.getElementById('hud-gear');
    if(gearImg)updateGearHUD(st,gearImg);
  }
}
function reconcileMouseRelease(e){
  if(typeof e.buttons==='number'){
    const leftStillHeld=!!(e.buttons&1);
    const rightStillHeld=!!(e.buttons&2)||(e.button===0&&rightAccelHeld);
    if(!leftStillHeld&&(leftClutchHeld||mouse.l))releaseLeftRaceInput(e);
    rightAccelHeld=rightStillHeld;mouse.r=rightStillHeld;
    if(rightStillHeld)latchAccel(1000);else accelLatchUntil=0;
    return;
  }
  if(e.button===0)releaseLeftRaceInput(e);
  if(e.button===2){rightAccelHeld=false;mouse.r=false;accelLatchUntil=0;}
}
document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='KeyZ')latchAccel(420);onKey(e);});
document.addEventListener('keyup',e=>delete keys[e.code]);
const stage=document.getElementById('stage');
stage.addEventListener('dragstart',e=>e.preventDefault());
stage.addEventListener('contextmenu',e=>{if(racing)latchAccel(520);e.preventDefault();});
stage.addEventListener('mousedown',e=>{
  if(e.target.closest&&e.target.closest('.race-pad'))return;
  if(e.target.closest&&e.target.closest('button,.panel,#util,#title,#opts,#saves'))return;
  if(e.button===0){mouseClutchForcedOff=false;leftClutchHeld=true;mouse.l=true;leftReleaseGuardUntil=0;}
  if(e.button===2){leftMoveReconstructAllowed=true;rightAccelHeld=true;mouse.r=true;latchAccel(520);}
  mouse.x=e.clientX; mouse.y=e.clientY;
  if(e.button===0&&racing){gesture={x:e.clientX,y:e.clientY};gShifted=false;}
  if(e.button===0&&!racing){
    suppressNextStoryClickUntil=performance.now()+250;
    if(!msgVisible){setMsgVisible(true);return;}
    onStoryClick();
  }
});
stage.addEventListener('mouseup',reconcileMouseRelease);
function handleRaceGestureMove(x,y){
  if(racing&&gesture&&raceClutchActive()){
    const dx=x-gesture.x,dy=y-gesture.y;
    if(Math.max(Math.abs(dx),Math.abs(dy))>=60){
      const ps=rStates.find(s=>s.racer.type.toLowerCase()==='player');
      if(!ps)return;
      const car=ps.racer.trans.toLowerCase().startsWith('car');
      if(!car&&gShifted)return;
      if(Math.abs(dx)>Math.abs(dy))shiftInput(ps,dx>0?1:-1,0);else shiftInput(ps,0,dy<0?1:-1);
      if(car)gesture={x,y};else gShifted=true;
    }
  }
}
stage.addEventListener('mousemove',e=>{
  mouse.x=e.clientX; mouse.y=e.clientY;
  handleRaceGestureMove(e.clientX,e.clientY);
});
function isInsideStagePoint(e){
  const r=stage.getBoundingClientRect();
  return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
}
function syncMouseButtons(e){
  mouse.x=e.clientX; mouse.y=e.clientY;
  if(typeof e.buttons==='number'){
    if(!(e.buttons&1)&&(leftClutchHeld||mouse.l))releaseLeftRaceInput(e);
    if(e.buttons&1&&leftMoveReconstructAllowed&&performance.now()>=leftReleaseGuardUntil){
      if(!mouse.l||!gesture){gesture={x:e.clientX,y:e.clientY};gShifted=false;}
      mouseClutchForcedOff=false;leftMoveReconstructAllowed=false;leftClutchHeld=true;mouse.l=true;
    }
    if(e.buttons&2){rightAccelHeld=true;mouse.r=true;latchAccel(260);}
  }
}
document.addEventListener('pointerdown',e=>{
  if(e.target.closest&&e.target.closest('.race-pad,.mobile-race-zone'))return;
  if(!isInsideStagePoint(e))return;
  syncMouseButtons(e);
  if(racing){
    e.preventDefault();
    try{stage.setPointerCapture(e.pointerId);}catch{}
    if(e.button===0){mouseClutchForcedOff=false;leftClutchHeld=true;mouse.l=true;leftReleaseGuardUntil=0;gesture={x:e.clientX,y:e.clientY};gShifted=false;}
    if(e.button===2){leftMoveReconstructAllowed=true;rightAccelHeld=true;mouse.r=true;latchAccel(520);}
  }
},true);
document.addEventListener('pointermove',e=>{
  if(!racing)return;
  if(e.target.closest&&e.target.closest('.race-pad,.mobile-race-zone'))return;
  syncMouseButtons(e);
  handleRaceGestureMove(e.clientX,e.clientY);
},true);
document.addEventListener('pointerup',e=>{
  mouse.x=e.clientX; mouse.y=e.clientY;
  reconcileMouseRelease(e);
},true);
document.addEventListener('pointercancel',e=>{if(leftClutchHeld||mouse.l)releaseLeftRaceInput(e);mouse.r=false;rightAccelHeld=false;accelLatchUntil=0;gesture=null;},true);
document.addEventListener('mousedown',e=>{
  if(e.target.closest&&e.target.closest('.mobile-race-zone'))return;
  if(!racing||!isInsideStagePoint(e))return;
  mouse.x=e.clientX;mouse.y=e.clientY;
  if(e.button===0){
    mouseClutchForcedOff=false;leftClutchHeld=true;mouse.l=true;leftReleaseGuardUntil=0;
    if(typeof e.buttons==='number'&&(e.buttons&2)){rightAccelHeld=true;mouse.r=true;}
    gesture={x:e.clientX,y:e.clientY};gShifted=false;
    e.preventDefault();
  }
  if(e.button===2){leftMoveReconstructAllowed=true;rightAccelHeld=true;mouse.r=true;latchAccel(520);e.preventDefault();}
},true);
document.addEventListener('mousemove',e=>{
  if(e.target.closest&&e.target.closest('.mobile-race-zone'))return;
  if(!racing||!isInsideStagePoint(e))return;
  syncMouseButtons(e);
  handleRaceGestureMove(e.clientX,e.clientY);
},true);
document.addEventListener('mouseup',reconcileMouseRelease,true);
window.addEventListener('mouseup',reconcileMouseRelease,true);
window.addEventListener('pointerup',reconcileMouseRelease,true);
document.addEventListener('contextmenu',e=>{if(racing&&isInsideStagePoint(e)){latchAccel(700);e.preventDefault();}},true);
window.addEventListener('blur',()=>{if(leftClutchHeld||mouse.l)releaseLeftRaceInput({buttons:0});mouse.r=false;rightAccelHeld=false;accelLatchUntil=0;gesture=null;Object.keys(keys).forEach(k=>delete keys[k]);});
function bindRacePad(id,key){
  const el=document.getElementById(id);
  if(!el)return;
  let pointerId=null,feedback=null;
  const placeFeedback=e=>{
    if(!feedback)return;
    const r=document.getElementById('race-controls').getBoundingClientRect();
    feedback.style.left=((e.clientX-r.left)/r.width*960)+'px';
    feedback.style.top=((e.clientY-r.top)/r.height*540)+'px';
  };
  const set=(v,e)=>{padInput[key]=v;el.classList.toggle('active',v);if(e){e.preventDefault();e.stopPropagation();}};
  el.addEventListener('pointerdown',e=>{
    if(pointerId!==null)return;
    pointerId=e.pointerId;set(true,e);
    try{el.setPointerCapture(pointerId);}catch{}
    feedback=document.createElement('div');feedback.className='touch-feedback '+key;
    document.getElementById('race-controls').appendChild(feedback);placeFeedback(e);
    mouse.x=e.clientX;mouse.y=e.clientY;
    if(key==='clutch'){gesture={x:e.clientX,y:e.clientY};gShifted=false;}
    if(navigator.vibrate)navigator.vibrate(key==='accel'?10:14);
  });
  el.addEventListener('pointermove',e=>{
    if(e.pointerId!==pointerId)return;
    placeFeedback(e);
    mouse.x=e.clientX;mouse.y=e.clientY;
    if(key==='clutch')handleRaceGestureMove(e.clientX,e.clientY);
  });
  const release=e=>{
    if(pointerId===null||e.pointerId!==pointerId)return;
    set(false,e);pointerId=null;if(feedback){feedback.remove();feedback=null;}
    if(key==='clutch'){
      gesture=null;
      const st=rStates.find(s=>s.racer.type.toLowerCase()==='player');
      if(st){if(st.clutchGear!==st.gear){playShiftEffect(st);if(navigator.vibrate)navigator.vibrate(24);st.clutchGear=st.gear;}st.clutch=false;}
    }
  };
  el.addEventListener('pointerup',release);
  el.addEventListener('pointercancel',release);
  el.addEventListener('lostpointercapture',release);
}
bindRacePad('pad-accel','accel');
bindRacePad('pad-clutch','clutch');
function bindMobileRaceZone(id,key){
  const el=document.getElementById(id);if(!el)return;
  let pointerId=null,feedback=null;
  const inputPoint=e=>document.body.classList.contains('portrait-locked-layout')
    ?{x:e.clientY,y:-e.clientX}:{x:e.clientX,y:e.clientY};
  const move=e=>{
    if(!feedback)return;
    feedback.style.left=e.clientX+'px';feedback.style.top=e.clientY+'px';
    if(key==='accel')latchAccel(320);
    if(key==='clutch'){const p=inputPoint(e);handleRaceGestureMove(p.x,p.y);}
  };
  el.addEventListener('pointerdown',e=>{
    if(pointerId!==null)return;
    pointerId=e.pointerId;padInput[key]=true;e.preventDefault();e.stopPropagation();
    if(key==='accel'){rightAccelHeld=true;mouse.r=true;latchAccel(1000);}
    try{el.setPointerCapture(pointerId);}catch{}
    feedback=document.createElement('div');feedback.className='mobile-touch-feedback '+key;
    document.getElementById('mobile-race-input').appendChild(feedback);
    if(key==='clutch'){const p=inputPoint(e);gesture={x:p.x,y:p.y};gShifted=false;}
    if(navigator.vibrate)navigator.vibrate(key==='accel'?10:14);
    move(e);
  });
  el.addEventListener('pointermove',e=>{if(e.pointerId===pointerId)move(e);});
  const release=e=>{
    if(pointerId===null||e.pointerId!==pointerId)return;
    padInput[key]=false;pointerId=null;e.preventDefault();e.stopPropagation();
    if(key==='accel'){rightAccelHeld=false;mouse.r=false;accelLatchUntil=0;}
    if(feedback){feedback.remove();feedback=null;}
    if(key==='clutch'){
      gesture=null;
      const st=rStates.find(s=>s.racer.type.toLowerCase()==='player');
      if(st){if(st.clutchGear!==st.gear){playShiftEffect(st);if(navigator.vibrate)navigator.vibrate(24);st.clutchGear=st.gear;}st.clutch=false;}
    }
  };
  el.addEventListener('pointerup',release);
  el.addEventListener('pointercancel',release);
  el.addEventListener('lostpointercapture',release);
}
bindMobileRaceZone('mobile-clutch-zone','clutch');
bindMobileRaceZone('mobile-accel-zone','accel');
document.addEventListener('click',e=>{
  if(racing||e.button!==0)return;
  if(performance.now()<suppressNextStoryClickUntil)return;
  if(e.target.closest&&e.target.closest('button,.panel,#util,#title,#opts,#saves'))return;
  const r=stage.getBoundingClientRect();
  if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){
    if(!msgVisible){setMsgVisible(true);suppressNextStoryClickUntil=performance.now()+250;return;}
    advanceStory();
  }
},true);

let focusedBtn=-1;
function onKey(e){
  if(racing){
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&(leftClutchHeld||keys['ShiftLeft']||keys['ShiftRight'])){
      const ps=rStates.find(s=>s.racer.type.toLowerCase()==='player');
      if(ps){const h=e.code==='ArrowLeft'?-1:e.code==='ArrowRight'?1:0;const v=e.code==='ArrowUp'?1:e.code==='ArrowDown'?-1:0;shiftInput(ps,h,v);}
      e.preventDefault();
    }
    return;
  }
  const activeBtns=activePanelBtns();
  if(activeBtns.length){
    if(e.code==='ArrowUp'||e.code==='ArrowDown'||e.code==='ArrowLeft'||e.code==='ArrowRight'){
      if(focusedBtn<0)focusedBtn=0;
      else if(e.code==='ArrowUp'||e.code==='ArrowLeft')focusedBtn=(focusedBtn-1+activeBtns.length)%activeBtns.length;
      else focusedBtn=(focusedBtn+1)%activeBtns.length;
      activeBtns.forEach((b,i)=>b.classList.toggle('focus',i===focusedBtn));
      activeBtns[focusedBtn].focus(); e.preventDefault(); return;
    }
    if((e.code==='Enter'||e.code==='KeyZ')&&focusedBtn>=0&&activeBtns[focusedBtn]){activeBtns[focusedBtn].click();return;}
    return;
  }
  if(!waiting)return;
  if(e.code==='Enter'||e.code==='KeyZ'||(e.code==='ControlLeft'&&waiting)){
    advanceStory();
  }
}
function onStoryClick(){
  advanceStory();
}

// ─── レースループ ──────────────────────────────────────────
let rStates=[];

async function doRace(){
  racing=true; forceHideUi=true; setMsgVisible(false); animMsg(1);
  mouseClutchForcedOff=false;
  racersEl.style.display='';
  const hud=document.getElementById('hud'); hud.classList.remove('race-finished');hud.style.display='block';
  initSpriteNumbers();
  setSpriteNumbersActive(true);
  spriteNums.time&&spriteNums.time.setValue(0);
  spriteNums.dist&&spriteNums.dist.setValue(0);
  spriteNums.speed&&spriteNums.speed.setValue(0);
  const raceControls=document.getElementById('race-controls'); if(raceControls)raceControls.classList.add('visible');
  const mobileRaceInput=document.getElementById('mobile-race-input');if(mobileRaceInput)mobileRaceInput.classList.add('visible');
  // ポートレート非表示
  portraitsEl.style.display='none';

  // 状態初期化
  rStates=Object.values(racerDefs).map(r=>({racer:r,speed:0,distance:0,rpm:0,gear:r.type.toLowerCase()==='player'?0:1,clutch:false,clutchGear:0,shiftCD:0,finish:-1}));
  const pSt=rStates.find(s=>s.racer.type.toLowerCase()==='player')||null;

  // HUD要素
  const en=document.getElementById('hud-enemy-name'), et=document.getElementById('hud-enemy-tel');
  const pn=document.getElementById('hud-player-name'), gap=document.getElementById('hud-gap');
  const track=document.getElementById('hud-trackbar'), needle=document.getElementById('hud-needle');
  const tEl=document.getElementById('hud-time'), dEl=document.getElementById('hud-dist'), sEl=document.getElementById('hud-speed');
  const tachoNeedle=document.getElementById('hud-needle-tacho'), gearImg=document.getElementById('hud-gear');
  const tachoImg2=document.getElementById('hud-tacho');
  if(tachoSrc){tachoImg2.src=tachoSrc;tachoImg2.style.display='';}
  if(needleSrc){tachoNeedle.src=needleSrc;tachoNeedle.style.display='';tachoNeedle.style.transform='rotate(-145deg)';}
  if(pSt)updateGearHUD(pSt,gearImg);
  else if(gearSrc){gearImg.src=gearSrc;gearImg.style.display='';}
  const enemy=rStates.find(s=>s!==pSt);
  if(enemy){en.textContent=enemy.racer.sid;pn.textContent=pSt?pSt.racer.sid:'';}
  nearOff=farOff=0;

  startEngine();
  function syncCountdownInput(){
    if(!pSt)return;
    const cl=raceClutchActive();
    if(cl&&!pSt.clutch){pSt.clutchGear=pSt.gear;gShifted=false;}
    if(!cl&&pSt.clutch&&pSt.clutchGear!==pSt.gear)playShiftEffect(pSt);
    pSt.clutch=cl;
    updateGearHUD(pSt,gearImg);
  }
  const sig=document.getElementById('hud-signal');
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const waitMs=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function countdownSignal(value){
    if(signalTex[value]){sig.src=signalTex[value];sig.style.display='block';}
    if(signalSfx[value])playSFX(signalSfx[value]);
    const begun=performance.now();
    while(true){
      syncCountdownInput();
      if(raceAccelActive())return true;
      const elapsed=performance.now()-begun;
      const progress=Math.pow(CLAMP(elapsed/1000*3,0,1),2);
      sig.style.opacity=progress;sig.style.transform=`scale(${LERP(1.1,1,progress)})`;
      if(elapsed>=1000)return false;
      await nextFrame();
    }
  }
  async function showFlyingMotion(){
    if(!pSt){await waitMs(700);return;}
    const rs=racerState[pSt.racer.id];
    const baseLeft=pSt.racer.x*960-(rs?rs.dw/2:0);
    const begun=performance.now();
    while(true){
      const elapsed=performance.now()-begun,progress=CLAMP(elapsed/700,0,1);
      const eased=1-Math.pow(1-progress,2);
      pSt.rpm=LERP(pSt.rpm,1,.18);
      if(rs){
        rs.cnv.style.left=(baseLeft+eased*135)+'px';
        const frame=Math.floor(elapsed/Math.max(20,pSt.racer.driveFrameTime*1000))%Math.max(1,pSt.racer.driveF);
        drawRacerFrame(pSt.racer.id,true,frame);
      }
      setEngPitch(1+pSt.rpm*5);
      if(progress>=1)break;
      await nextFrame();
    }
  }
  // フライング時は車体を飛び出させ、入力を離してから開始位置で再カウントする。
  while(true){
    let flying=false;
    for(let i=3;i>=1;i--){if(await countdownSignal(i)){flying=true;break;}}
    if(!flying)break;
    if(flyingTex)sig.src=flyingTex;
    sig.style.display='block';sig.style.opacity='1';sig.style.transform='scale(1)';
    await showFlyingMotion();
    stopEngine();setEngPitch(1);
    if(pSt){
      pSt.speed=0;pSt.distance=0;pSt.rpm=0;pSt.gear=0;pSt.clutch=false;pSt.clutchGear=0;
      updateGearHUD(pSt,gearImg);
      const rs=racerState[pSt.racer.id];
      if(rs){rs.cnv.style.left=(pSt.racer.x*960-rs.dw/2)+'px';drawRacerFrame(pSt.racer.id,false,0);}
    }
    leftClutchHeld=false;mouse.l=false;gesture=null;gShifted=false;
    sig.style.display='none';
    while(raceAccelActive())await nextFrame();
    rightAccelHeld=false;mouse.r=false;accelLatchUntil=0;
    await waitMs(200);
    startEngine();setEngPitch(1);
  }
  const startSig=document.getElementById('hud-signal');
  if(signalTex[0]){startSig.src=signalTex[0];startSig.style.display='block';}
  if(signalSfx[0])playSFX(signalSfx[0]);
  startSig.style.opacity='1';startSig.style.transform='scale(1)';
  anim(500,p=>{startSig.style.opacity=1-Math.min(1,p*3);startSig.style.transform=`scale(${LERP(1,1.1,Math.min(p*3,1))})`;}).then(()=>{startSig.style.display='none';});

  let raceLastT=performance.now();
  let raceElapsed=0;

  function nextDt(){return new Promise(res=>{requestAnimationFrame(t=>{const dt=Math.min(Math.max((t-raceLastT)/1000,0),.08);raceLastT=t;res(dt);});});}

  // レース本体
  while(rStates.some(s=>s.finish<0)){
    const dt=await nextDt();
    const slowActive=!!(clutchSlowdown&&pSt&&raceClutchActive());
    const simDt=dt*(slowActive?.3:1);
    if(bgmNode)bgmNode.playbackRate.value=slowActive?.75:1;
    raceElapsed+=simDt;
    const elapsed=raceElapsed;
    for(const st of rStates){
      if(st.finish>=0){st.distance+=st.speed*simDt;st.speed*=Math.max(0,1-.1*simDt);continue;}
      const isP=st===pSt;
      const accel=!isP||raceAccelActive();
      if(isP){
        const cl=raceClutchActive();
        if(cl&&!st.clutch){st.clutchGear=st.gear;gesture&&(gesture={x:mouse.x,y:mouse.y});gShifted=false;}
        if(!cl&&st.clutch&&st.clutchGear!==st.gear)playShiftEffect(st);
        st.clutch=cl;
        updateGearHUD(st,gearImg);
      } else {
        if(!st.clutch){
          const shiftRpm=st.racer.powerRpm/st.racer.maxRpm;
          if(st.gear<gearMax(st.racer.trans)&&st.rpm>shiftRpm){st.clutch=true;st.shiftCD=Math.max(.02,st.racer.shiftTime);}
        }
        if(st.clutch){st.shiftCD-=simDt;if(st.shiftCD<=0){st.gear=Math.min(st.gear+1,gearMax(st.racer.trans));st.clutch=false;}}
      }
      simStep(st,accel,simDt);
      if(st.distance>=raceSetup.dist&&st.finish<0)st.finish=elapsed;
    }
    // HUD更新
    const hudElapsed=pSt&&pSt.finish>=0?pSt.finish:elapsed; const ref=pSt||rStates[0];
    tEl.textContent=hudElapsed.toFixed(2)+'sec';
    dEl.textContent=Math.max(0,raceSetup.dist-ref.distance).toFixed(1)+'m';
    sEl.textContent=(ref.speed*3.6).toFixed(1)+'km/h';
    if(spriteNums.time)spriteNums.time.setValue(hudElapsed);
    if(spriteNums.dist)spriteNums.dist.setValue(Math.max(0,raceSetup.dist-ref.distance));
    if(spriteNums.speed)spriteNums.speed.setValue(ref.speed*3.6);
    if(enemy){
      et.textContent=fmtT(enemy.finish>=0?enemy.finish:elapsed)+'  '+Math.floor(enemy.speed*3.6)+' km/h';
      const gapM=ref.distance-enemy.distance;
      gap.textContent=(gapM>.5?'+ ':gapM<-.5?'- ':'± ')+Math.abs(Math.round(gapM))+' m';
      gap.style.color=gapM<0?'#f44':'#fff';
      needle.style.left=CLAMP(142+gapM*2,2,292)+'px';
    }
    // タコ
    tachoNeedle.style.transform=`rotate(${-LERP(145,-60,ref.rpm)}deg)`;
    setEngPitch((1+ref.rpm*5)*(slowActive?.75:1));
    // 背景スクロール
    const finishLead=Math.max(0,(.9-ref.racer.x)*10);
    const cam=Math.min(ref.distance,Math.max(0,raceSetup.dist-finishLead));
    nearOff=(cam*.1)%1; farOff=(cam*.025)%1;
    drawBg(cNear,nearImg,nearOff,true); drawBg(cFar,farImg,farOff,true);
    // レーサー位置
    for(const st of rStates){
      const rs=racerState[st.racer.id]; if(!rs)continue;
      const rx=st.racer.x+(st.distance-cam)/10;
      const drv=st.speed>.2;
      const dur=drv?st.racer.driveFrameTime:st.racer.idleFrameTime;
      const fr=Math.floor(raceLastT/1000/Math.max(.01,dur))%Math.max(1,drv?st.racer.driveF:st.racer.idleF);
      drawRacerFrame(st.racer.id,drv,fr);
      rs.cnv.style.left=(rx*960-rs.dw/2)+'px';
      rs.cnv.style.bottom=(st.racer.y*540-rs.dh/2)+'px';
    }
  }
  // ゴール後も車体を右へ走り抜けさせる。
  for(let t=0;t<.4;){
    const dt=await nextDt();t+=dt;
    rStates.forEach(st=>{st.distance+=st.speed*dt;st.speed*=Math.max(0,1-.08*dt);});
    const ref=pSt||rStates[0];
    const finishLead=Math.max(0,(.9-ref.racer.x)*10);
    const cam=Math.min(ref.distance,Math.max(0,raceSetup.dist-finishLead));
    nearOff=(cam*.1)%1;farOff=(cam*.025)%1;
    drawBg(cNear,nearImg,nearOff,true);drawBg(cFar,farImg,farOff,true);
    for(const st of rStates){
      const rs=racerState[st.racer.id];if(!rs)continue;
      const rx=st.racer.x+(st.distance-cam)/10;
      rs.cnv.style.left=(rx*960-rs.dw/2)+'px';
    }
  }
  stopEngine(); engGain.gain.value=sfxVol;
  if(raceControls)raceControls.classList.remove('visible');
  if(mobileRaceInput)mobileRaceInput.classList.remove('visible');

  // 結果
  let winner=rStates.reduce((a,b)=>(a.finish>=0&&(b.finish<0||a.finish<b.finish))?a:b);
  const won=pSt===null||winner===pSt;
  racersEl.style.display='none';
  hud.classList.add('race-finished');
  clutchSlowOverlay.classList.remove('active');
  if(bgmNode)bgmNode.playbackRate.value=1;
  setRaceNumbersActive(false);
  tachoImg2.style.display='none';
  tachoNeedle.style.display='none';
  gearImg.style.display='none';
  const resEl=document.getElementById('hud-result');
  const waitRaceConfirm=()=>new Promise(res=>{
    let done=false;
    const finish=e=>{
      const accepted=e.type==='keydown'?(e.code==='Enter'||e.code==='KeyZ'):e.button===0;
      if(done||!accepted)return;
      done=true;
      stage.removeEventListener('pointerdown',finish,true);
      document.removeEventListener('mousedown',finish,true);
      document.removeEventListener('keydown',finish,true);
      suppressNextStoryClickUntil=performance.now()+350;
      res();
    };
    stage.addEventListener('pointerdown',finish,true);
    document.addEventListener('mousedown',finish,true);
    document.addEventListener('keydown',finish,true);
  });
  const resultSrc=won?winTex:loseTex;
  if(resultSrc){
    resEl.src=resultSrc;
    try{await resEl.decode();}catch{}
    resEl.style.opacity='1';resEl.style.transform='scale(1)';resEl.style.display='block';
  }
  if(won){
    const fl=document.getElementById('hud-flash');
    fl.style.display='block';fl.style.opacity='1';
    await anim(250,p=>{fl.style.opacity=1-p;});fl.style.display='none';
  }
  await waitMs(350);
  await anim(400,p=>{resEl.style.opacity=1-p;});resEl.style.display='none';
  if(spriteNums.first)spriteNums.first.setValue(winner.finish);
  if(spriteNums.your)spriteNums.your.setValue(pSt?pSt.finish:winner.finish);
  setResultNumbersActive(true);
  await waitRaceConfirm();
  setResultNumbersActive(false);

  // 後片付け
  hud.style.display='none'; setSpriteNumbersActive(false); if(raceControls)raceControls.classList.remove('visible');if(mobileRaceInput)mobileRaceInput.classList.remove('visible');
  padInput.accel=false; padInput.clutch=false;
  clutchSlowOverlay.classList.remove('active');
  if(bgmNode)bgmNode.playbackRate.value=1;
  racing=false; portraitsEl.style.display=''; racersEl.style.display='';
  forceHideUi=false; setMsgVisible(true); focusedBtn=-1;
  if(pSt&&won&&raceSetup.win)jumpTo(raceSetup.win);
  else if(pSt&&!won&&raceSetup.lose)jumpTo(raceSetup.lose);
}

function updateGearHUD(st,el){
  const key=st.racer.trans.toLowerCase()+'_'+st.gear;
  el.dataset.gearKey=key;
  if(gearTex[key]){el.src=gearTex[key];el.style.display='';}
}
function fmtT(v){if(v<0)return '--:--.--';const m=Math.floor(v/60),s=v%60;return String(m).padStart(2,'0')+':'+s.toFixed(2).padStart(5,'0');}

// ═══════════════════════════════════════════════════════════════════
//  セーブ / ロード
// ═══════════════════════════════════════════════════════════════════
function buildSave(){
  const L=[];
  if(bgmName)L.push('SetBGM,'+bgmName);
  L.push('SetBackground,'+(bgName||''));
  L.push('SetRaceBackground,'+(nearName||'')+','+(farName||''));
  if(effectName)L.push('SetEffect,'+effectName+',0,'+effUX+','+effUY+','+effAlpha+','+effCycle);
  if(Math.abs(raceBgSpeed)>.0001)L.push('MoveRaceBackground,'+raceBgSpeed);
  for(const[k,v] of Object.entries(items))L.push('SetItem,'+k+','+Object.entries(v).map(([a,b])=>a+'='+b).join(','));
  for(const[k,v] of Object.entries(vars))L.push('SetValue,'+k+','+v);
  for(const[,r] of Object.entries(racerDefs))L.push(['SetRacer',r.sid,r.idleF,r.idleFrameTime,r.driveF,r.driveFrameTime,r.x,r.y,r.type,r.trans,r.baseSpeed,r.shiftTime].join(','));
  for(const id of drivenRacers)L.push('DriveRacer,'+id);
  for(const[,p] of Object.entries(portraits))L.push('SetPortrait,'+p.pid+','+p.imgName+','+p.x+','+p.y);
  for(const p of panelRecords){
    L.push('SetPen,'+p.cx+','+p.cy);
    L.push(['SetPanel',p.rawSel,p.target,p.label,p.a1,p.sub,p.a2,'',p.bg,p.w,p.h].join(','));
  }
  if(curText)L.push((curSpeaker||'')+','+(curPid||'')+','+(curText||'').replace(/\n/g,'<br>'));
  L.push('Loaded,'+sceneName+','+Math.max(-1,pc-1));
  return L.join('\n');
}
function captureStagePreview(){
  const out=document.createElement('canvas');out.width=960;out.height=540;
  const ctx=out.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,960,540);
  for(const layer of [cBg.canvas,cFar.canvas,cNear.canvas,cEff.canvas])ctx.drawImage(layer,0,0,960,540);
  const stageRect=stage.getBoundingClientRect(),sx=960/stageRect.width,sy=540/stageRect.height;
  for(const el of [...document.querySelectorAll('#portraits img,#racers canvas')]){
    if(getComputedStyle(el).display==='none')continue;
    const r=el.getBoundingClientRect();
    try{ctx.drawImage(el,(r.left-stageRect.left)*sx,(r.top-stageRect.top)*sy,r.width*sx,r.height*sy);}catch{}
  }
  if(msgVisible&&!forceHideUi){
    const g=ctx.createLinearGradient(0,371,0,540);g.addColorStop(0,'rgba(10,16,30,0)');g.addColorStop(.35,'rgba(10,16,30,.88)');g.addColorStop(1,'rgba(10,16,30,.97)');ctx.fillStyle=g;ctx.fillRect(0,371,960,169);
    ctx.fillStyle='#fff';ctx.font='bold 18px Meiryo';ctx.fillText(spkEl.textContent,100,463);
    ctx.font='18px Meiryo';let y=489;for(const line of msgEl.textContent.split('\n').slice(0,3)){ctx.fillText(line,100,y);y+=27;}
  }
  return out.toDataURL('image/jpeg',.72);
}
let SAVE_DB_NAME='RATSaveDB_unconfigured';
const SAVE_DB_VERSION=1;
let saveDbPromise=null,saveMigrationPromise=null;
function hashGameId(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(36);
}
function configureSaveDatabase(){
  let path;
  try{path=decodeURIComponent(location.pathname);}catch{path=location.pathname;}
  path=path.replace(/\/index\.html$/i,'/').replace(/\/+$/,'')||'/';
  const locationKey=location.protocol==='file:'?path:(location.origin+path);
  SAVE_DB_NAME='RATSaveDB_auto-'+hashGameId(locationKey);
}
function openSaveDb(){
  if(saveDbPromise)return saveDbPromise;
  saveDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(SAVE_DB_NAME,SAVE_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('slots'))db.createObjectStore('slots',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return saveDbPromise;
}
async function idbGet(store,key){
  const db=await openSaveDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(store,'readonly').objectStore(store).get(key);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
  });
}
async function idbPut(store,value){
  const db=await openSaveDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
function ensureSaveMigration(){
  if(saveMigrationPromise)return saveMigrationPromise;
  saveMigrationPromise=(async()=>{
    if(await idbGet('meta','legacy-localstorage-v1'))return;
    for(let i=0;i<8;i++){
      if(await idbGet('slots',i))continue;
      const data=localStorage.getItem('RAT.sv'+i);if(!data)continue;
      await idbPut('slots',{id:i,data,timestamp:localStorage.getItem('RAT.st'+i)||'',thumbnail:localStorage.getItem('RAT.thumb'+i)||''});
    }
    await idbPut('meta',{key:'legacy-localstorage-v1',completedAt:Date.now()});
    for(let i=0;i<8;i++)for(const key of ['RAT.sv','RAT.st','RAT.thumb'])localStorage.removeItem(key+i);
  })();
  return saveMigrationPromise;
}
async function saveSlot(i){
  await ensureSaveMigration();
  let thumbnail='';try{thumbnail=captureStagePreview();}catch{}
  await idbPut('slots',{id:i,data:buildSave(),timestamp:new Date().toLocaleString(),thumbnail});
}
async function loadSlot(i){
  await ensureSaveMigration();
  const slot=await idbGet('slots',i),raw=slot&&slot.data;if(!raw)return;
  resetAll();
  openWipeImmediately();
  const parsed=parse(raw);
  let lScene='',lPc=-1,lDlg=null;
  for(const line of parsed.lines){
    if(line.tp==='anchor')continue;
    if(line.tp==='dlg'){lDlg=line;continue;}
    if(line.cmd&&line.cmd.toLowerCase()==='loaded'){lScene=A(line.args,0);lPc=Math.round(F(A(line.args,1),-1));continue;}
    await execCmd(line);
  }
  if(!lScene)return;
  await openScene(lScene); pc=Math.max(0,lPc+1);
  const restoredPanels=panelRecords.length>0;
  running=true;stopped=restoredPanels;
  document.getElementById('title').style.display='none';
  document.getElementById('saves').style.display='none';
  setMsgVisible(true);
  if(lDlg){curSpeaker=sub(lDlg.speaker);curPid=lDlg.pid;curText=sub(lDlg.text);startType(curSpeaker,curPid,curText);waiting=true;}
  else waiting=false;
  if(!restoredPanels)run();
}

async function buildSaveScreen(loadOnly=false){
  const el=document.getElementById('saves');el.innerHTML='';
  await ensureSaveMigration();
  const slots=await Promise.all(Array.from({length:8},(_,i)=>idbGet('slots',i)));
  const heading=document.createElement('div');heading.className='saves-heading';heading.textContent=loadOnly?'LOAD':'SAVE / LOAD';el.appendChild(heading);
  const cb=document.createElement('button');cb.id='saves-close';cb.textContent='×';cb.title='Close';cb.setAttribute('aria-label','Close');
  cb.addEventListener('click',()=>el.style.display='none');el.appendChild(cb);
  const list=document.createElement('div');list.className='save-list';el.appendChild(list);
  const cols=2,W=330,H=112,GX=105,GY=12,SX=420,SY=166;
  for(let i=0;i<8;i++){
    const c=i%cols,row=Math.floor(i/cols);
    const bx=GX+c*SX, by=GY+row*SY;
    const wrap=document.createElement('div');
    wrap.className='slot-wrap'; wrap.style.cssText=`left:${bx}px;top:${by}px;`;
    const box=document.createElement('div');
    box.className='slot-box'; box.style.cssText=`width:${W}px;height:${H}px;`;
    const slot=slots[i],thumb=slot&&slot.thumbnail;
    if(thumb){const preview=document.createElement('img');preview.className='slot-preview';preview.src=thumb;box.appendChild(preview);}
    const lbl=document.createElement('div');
    const st=slot&&slot.timestamp||'';
    lbl.className='slot-lbl'; lbl.textContent=st||'NO DATA';
    box.appendChild(lbl); wrap.appendChild(box);
    const sbtn=document.createElement('button'); sbtn.className='slot-savebtn'; sbtn.textContent='Save';
    sbtn.style.cssText=`left:0;top:${H+6}px;width:158px;`;
    sbtn.disabled=loadOnly;
    sbtn.addEventListener('click',async()=>{if(loadOnly)return;await saveSlot(i);await buildSaveScreen(false);});
    const lbtn=document.createElement('button'); lbtn.className='slot-loadbtn'; lbtn.textContent='Load';
    lbtn.style.cssText=`left:172px;top:${H+6}px;width:158px;`;
    lbtn.disabled=!st;
    lbtn.addEventListener('click',async()=>{el.style.display='none';await loadSlot(i);});
    wrap.appendChild(sbtn); wrap.appendChild(lbtn);
    list.appendChild(wrap);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  テーマ読み込み
// ═══════════════════════════════════════════════════════════════════
async function loadTheme(){
  initSpriteNumbers();
  const ti=await getImg('background','title','.png','.jpg');
  if(ti)document.getElementById('title-bg').src=ti.src;
  const nums=await getImg('essential','numbers','.png'); if(nums)setSpriteNumbersTexture(nums);
  const ta=await getImg('essential','tacometer','.png'); if(ta)tachoSrc=ta.src;
  const tn=await getImg('essential','tacometer_needle','.png'); if(tn)needleSrc=tn.src;
  // ギア画像
  for(const tr of['motorcycle4','motorcycle5','motorcycle6','car4','car5','car6']){
    const mx=tr.endsWith('4')?4:tr.endsWith('5')?5:6;
    const mn=tr.startsWith('car')?(tr==='car4'?-1:-2):0;
    for(let g=mn;g<=mx;g++){const im=await getImg('essential','gear_'+tr+'_'+g,'.png');if(im)gearTex[tr+'_'+g]=im.src;}
  }
  // デフォルトギア表示
  const dg=gearTex['motorcycle5_0']; if(dg)gearSrc=dg;
  // シグナル
  for(let i=0;i<=3;i++){
    const si=await getImg('essential','race_starting_'+i,'.png'); if(si)signalTex[i]=si.src;
    const sb=await getAudio('essential','race_starting_'+i+'_sound','.wav','.ogg'); if(sb)signalSfx[i]=sb;
  }
  const fly=await getImg('essential','race_flying','.png'); if(fly)flyingTex=fly.src;
  const ge=await getImg('essential','gear_effect','.png'); if(ge)gearEffectImg=ge;
  // レース結果
  const rw=await getImg('essential','race_end_win','.png'); if(rw)winTex=rw.src;
  const rl=await getImg('essential','race_end_lose','.png'); if(rl)loseTex=removeWhiteBackground(rl);
  // エンジン音
  const eb=await getAudio('essential','racer_engine','.wav','.ogg'); if(eb){defaultEngBuf=eb;engBuf=eb;}
  const gb=await getAudio('essential','gearChangeEffect','.wav'); if(gb)gcBuf=gb;
  const sb=await getAudio('essential','racer_shift','.wav','.ogg','.mp3'); if(sb)shiftBuf=sb;
}
function removeWhiteBackground(img){
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const x=c.getContext('2d');x.drawImage(img,0,0);const data=x.getImageData(0,0,c.width,c.height),p=data.data;
  for(let i=0;i<p.length;i+=4){
    const a=Math.max(255-p[i],255-p[i+1],255-p[i+2]);
    if(a<=1){p[i]=p[i+1]=p[i+2]=255;p[i+3]=0;continue;}
    const bg=255-a;p[i]=CLAMP(Math.round((p[i]-bg)*255/a),0,255);p[i+1]=CLAMP(Math.round((p[i+1]-bg)*255/a),0,255);p[i+2]=CLAMP(Math.round((p[i+2]-bg)*255/a),0,255);p[i+3]=a;
  }
  x.putImageData(data,0,0);return c.toDataURL('image/png');
}

// ═══════════════════════════════════════════════════════════════════
//  スタート / リセット
// ═══════════════════════════════════════════════════════════════════
function resetAll(){
  Object.keys(vars).forEach(k=>delete vars[k]);
  Object.keys(items).forEach(k=>delete items[k]);
  Object.keys(racerDefs).forEach(k=>delete racerDefs[k]);
  drivenRacers.clear();
  Object.keys(racerState).forEach(k=>{try{racerState[k].cnv.remove();}catch{}delete racerState[k];});
  Object.keys(portraits).forEach(k=>delete portraits[k]);
  portraitsEl.innerHTML='';
  clearPanels(); clearEffect();
  clearType(); msgEl.textContent=''; spkEl.textContent='';
  clr(cBg);clr(cFar);clr(cNear);clr(cEff);
  bgImg=nearImg=farImg=effectImg=null;
  bgName=nearName=farName=bgmName=effectName='';
  nearOff=farOff=raceBgSpeed=0;
  curSpeaker=curPid=curText='';
  penX=penY=0; waiting=stopped=racing=false;
  padInput.accel=padInput.clutch=false;
  document.getElementById('race-controls')?.classList.remove('visible');
  const mobileInput=document.getElementById('mobile-race-input');
  if(mobileInput){mobileInput.classList.remove('visible');mobileInput.querySelectorAll('.mobile-touch-feedback').forEach(el=>el.remove());}
  forceHideUi=false;
  setMsgVisible(true);
  try{if(bgmNode){bgmNode.stop();bgmNode=null;}}catch{}
  stopEngine();
}

async function startGame(){
  requestMobileFullscreen();
  audioCtx.resume();
  resetAll(); running=true;
  closeWipeImmediately();
  document.getElementById('title').style.display='none';
  let entry='scene_001';
  try{await readText('scene/_entrypoint.txt');entry='_entrypoint';}catch{}
  await openScene(entry);
  run();
}

function requestMobileFullscreen(){
  if(!matchMedia('(pointer:coarse)').matches||matchMedia('(display-mode: fullscreen)').matches||matchMedia('(display-mode: standalone)').matches)return;
  const root=document.documentElement;
  if(root.requestFullscreen)root.requestFullscreen({navigationUI:'hide'}).catch(()=>{});
  else if(root.webkitRequestFullscreen)try{root.webkitRequestFullscreen();}catch{}
}

// ═══════════════════════════════════════════════════════════════════
//  Mods 読み込み
// ═══════════════════════════════════════════════════════════════════
const statusEl=document.getElementById('title-status');
const loadingProgress=document.getElementById('loading-progress');
const newBtn=document.getElementById('t-new');
const continueBtn=document.getElementById('t-cont');
const titleOptionBtn=document.getElementById('t-opts');

function setTitleLoading(value){
  newBtn.disabled=value;continueBtn.disabled=value;titleOptionBtn.disabled=value;
}

async function modsOK(){
  setTitleLoading(true);
  statusEl.textContent='Now Loading...';
  loadingProgress.classList.add('active');
  try{
    await configureSaveDatabase();
    await loadTheme();
    statusEl.textContent='';
    setTitleLoading(false);
  }finally{
    loadingProgress.classList.remove('active');
  }
}
async function initMods(){
  statusEl.textContent='Mods/ を確認中...';
  if(await tryFetch()){await modsOK();return;}
  statusEl.innerHTML='📂 <span class="folder-pick-link">Modsフォルダを選択</span>';
  statusEl.style.cursor='pointer';
}

statusEl.addEventListener('click',async()=>{
  if(await pickFolder())await modsOK();
  else statusEl.textContent='Modsフォルダが見つかりません';
});
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',async e=>{
  e.preventDefault();
  const f=[...e.dataTransfer.files].find(f=>f.name.endsWith('.zip'));
  if(!f)return;
  statusEl.textContent='ZIP読み込み中...';
  if(await loadZip(await f.arrayBuffer()))await modsOK();
  else{statusEl.textContent='scene/フォルダが見つかりません';statusEl.className='error';}
});

// ═══════════════════════════════════════════════════════════════════
//  UI配線
// ═══════════════════════════════════════════════════════════════════
document.getElementById('t-new').addEventListener('click',startGame);
document.getElementById('t-cont').addEventListener('click',async()=>{document.getElementById('saves').style.display='block';await buildSaveScreen(true);});
document.getElementById('t-opts').addEventListener('click',()=>document.getElementById('opts').style.display='block');
document.getElementById('u-save').addEventListener('click',async()=>{document.getElementById('saves').style.display='block';await buildSaveScreen(false);});
document.getElementById('u-opts').addEventListener('click',()=>document.getElementById('opts').style.display='block');
function hideMessageUi(e){if(e){e.preventDefault();e.stopPropagation();}setMsgVisible(false);}
document.getElementById('u-hide').addEventListener('click',hideMessageUi);
document.getElementById('opts-close').addEventListener('click',()=>document.getElementById('opts').style.display='none');

// オプションスライダー
const oSpeed=document.getElementById('o-speed'); oSpeed.value=S.get('tw',.05);
oSpeed.addEventListener('input',()=>S.set('tw',parseFloat(oSpeed.value)));
const oBgm=document.getElementById('o-bgm'); oBgm.value=bgmVol;
oBgm.addEventListener('input',()=>{bgmVol=+oBgm.value;bgmGain.gain.value=bgmVol;S.set('bgm',bgmVol);});
const oSfx=document.getElementById('o-sfx'); oSfx.value=sfxVol;
oSfx.addEventListener('input',()=>{sfxVol=+oSfx.value;sfxGain.gain.value=sfxVol;engGain.gain.value=sfxVol;S.set('sfx',sfxVol);});
const oClutchSlow=document.getElementById('o-clutch-slow'); oClutchSlow.checked=clutchSlowdown;
oClutchSlow.addEventListener('change',()=>{clutchSlowdown=oClutchSlow.checked;S.set('clutchSlowdown',clutchSlowdown);});


// JSZip非同期ロード
(()=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';document.head.appendChild(s);})();

// ═══ メイン ═══
lastT=performance.now();
function ensureZipLoader(){
  if(window.JSZip||document.getElementById('jszip-loader'))return;
  const s=document.createElement('script');
  s.id='jszip-loader';
  s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  document.head.appendChild(s);
}
ensureZipLoader();
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
requestAnimationFrame(loop);
initMods();
