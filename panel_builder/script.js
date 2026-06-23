// ── CONSTANTS (Fixed 1920x1080 resolution) ──
const V_WIDTH  = 1920;
const V_HEIGHT = 1080;

// ── REFS ──
const canvasWrap = document.getElementById('canvas-wrap');
const gridSvg    = document.getElementById('grid-svg');
const snapSvg    = document.getElementById('snap-svg');
const sceneOut   = document.getElementById('scene-output');
const propsBar   = document.getElementById('props-bar');
const btnPaste   = document.getElementById('btn-paste-panel');
const btnCopyP   = document.getElementById('btn-copy-panel');
const btnDel     = document.getElementById('btn-del');
const btnUndo    = document.getElementById('btn-undo');
const btnRedo    = document.getElementById('btn-redo');
const bgImg      = document.getElementById('canvas-bg-img');
const btnClearBg = document.getElementById('btn-clear-bg');
const toastEl    = document.getElementById('toast');

// ── STATE ──
let panels     = [];
let selectedId = null;
let clipboard  = null;
let idCounter  = 0;
let undoStack  = [];
let redoStack  = [];

let dragging  = null, resizing  = null, resizeSide = null;
let dragOX, dragOY, dragPX, dragPY;
let resizeOX, resizeOY, resizePX, resizePY, resizePW, resizePH;

const SNAP_THRESH = 0.013;
const GRID_STEP   = 0.05;
const PASTE_OFF   = 0.03;
const DW = 0.3, DH = 0.1;

const CW = () => canvasWrap.offsetWidth;
const CH = () => canvasWrap.offsetHeight;

// ── TOAST ──
let _toastTid;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(_toastTid);
  _toastTid = setTimeout(() => toastEl.classList.remove('on'), 1700);
}

// ── UNDO / REDO ──
function snapshot() {
  undoStack.push(JSON.parse(JSON.stringify(panels)));
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  syncUndoBtn();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.parse(JSON.stringify(panels)));
  panels = undoStack.pop();
  if (!panels.find(p => p.id === selectedId)) selectedId = null;
  syncUndoBtn(); renderAll(); showProps();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(panels)));
  panels = redoStack.pop();
  if (!panels.find(p => p.id === selectedId)) selectedId = null;
  syncUndoBtn(); renderAll(); showProps();
}
function syncUndoBtn() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

// ── HELPERS ──
function hexToRatColor(hex, alpha) {
  return '#' + hex.slice(1).toUpperCase() + Math.round(alpha).toString(16).padStart(2,'0').toUpperCase();
}
function rgbaCss(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${(alpha/255).toFixed(2)})`;
}

// ── GRID ──
function drawGrid() {
  const cw=CW(), ch=CH(), ns='http://www.w3.org/2000/svg';
  gridSvg.innerHTML = '';
  const mkLine = (x1,y1,x2,y2) => {
    const l = document.createElementNS(ns,'line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1);
    l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke', '#a19181'); l.setAttribute('stroke-width','0.5');
    l.setAttribute('opacity','0.15');
    gridSvg.appendChild(l);
  };
  for (let v=GRID_STEP; v<1.0; v+=GRID_STEP) mkLine(v*cw, 0, v*cw, ch);
  for (let v=GRID_STEP; v<1.0; v+=GRID_STEP) mkLine(0, v*ch, cw, v*ch);
}

// ── SNAP COMPUTE ──
function computeSnap(moving, others) {
  const lines=[];
  let dx=null, dy=null;

  for (const o of others) {
    const mPts = { x:[moving.x, moving.x+moving.w, moving.x+moving.w/2], y:[moving.y, moving.y+moving.h, moving.y+moving.h/2] };
    const oPts = { x:[o.x, o.x+o.w, o.x+o.w/2],                         y:[o.y, o.y+o.h, o.y+o.h/2] };
    
    for (const oa of oPts.x) for (const ma of mPts.x) {
      if (Math.abs(ma-oa) < SNAP_THRESH) {
        if (dx===null || Math.abs(oa-ma)<Math.abs(dx)) dx = oa-ma;
        lines.push({type:'v', x:oa, color:'#c8a840'});
      }
    }
    for (const oa of oPts.y) for (const ma of mPts.y) {
      if (Math.abs(ma-oa) < SNAP_THRESH) {
        if (dy===null || Math.abs(oa-ma)<Math.abs(dy)) dy = oa-ma;
        lines.push({type:'h', y:oa, color:'#c8a840'});
      }
    }
  }

  const tx = moving.x + (dx || 0);
  const ty = moving.y + (dy || 0);

  if (others.length >= 2) {
    const mx1 = tx, mx2 = tx + moving.w, my1 = ty, my2 = ty + moving.h;

    for (let i = 0; i < others.length; i++) {
      for (let j = 0; j < others.length; j++) {
        if (i === j) continue;
        const A = others[i], B = others[j];
        if (A.y + A.h <= B.y) {
          const gapExisting = B.y - (A.y + A.h);
          if (gapExisting <= 0) continue;

          if (Math.abs(my1 - (B.y + B.h) - gapExisting) < SNAP_THRESH) {
            if (dy === null) dy = (B.y + B.h) + gapExisting - moving.y;
            lines.push({type:'gap-v', y1:A.y+A.h, y2:B.y, x:(A.x+A.w/2), color:'#a19181'});
            lines.push({type:'gap-v', y1:B.y+B.h, y2:B.y+B.h+gapExisting, x:(B.x+B.w/2), color:'#c8a840'});
          }
          if (Math.abs((A.y - moving.h) - my1 - gapExisting) < SNAP_THRESH) {
            if (dy === null) dy = (A.y - gapExisting - moving.h) - moving.y;
            lines.push({type:'gap-v', y1:A.y+A.h, y2:B.y, x:(A.x+A.w/2), color:'#a19181'});
            lines.push({type:'gap-v', y1:A.y-gapExisting, y2:A.y, x:(A.x+A.w/2), color:'#c8a840'});
          }
        }
      }
    }

    for (let i = 0; i < others.length; i++) {
      for (let j = 0; j < others.length; j++) {
        if (i === j) continue;
        const A = others[i], B = others[j];
        if (A.x + A.w <= B.x) {
          const gapExisting = B.x - (A.x + A.w);
          if (gapExisting <= 0) continue;

          if (Math.abs(mx1 - (B.x + B.w) - gapExisting) < SNAP_THRESH) {
            if (dx === null) dx = (B.x + B.w) + gapExisting - moving.x;
            lines.push({type:'gap-h', x1:A.x+A.w, x2:B.x, y:(A.y+A.h/2), color:'#a19181'});
            lines.push({type:'gap-h', x1:B.x+B.w, x2:B.x+B.w+gapExisting, y:(B.y+B.h/2), color:'#c8a840'});
          }
          if (Math.abs((A.x - moving.w) - mx1 - gapExisting) < SNAP_THRESH) {
            if (dx === null) dx = (A.x - gapExisting - moving.w) - moving.x;
            lines.push({type:'gap-h', x1:A.x+A.w, x2:B.x, y:(A.y+A.h/2), color:'#a19181'});
            lines.push({type:'gap-h', x1:B.x+B.w, x2:B.x+B.w+gapExisting, y:(B.y+B.h/2), color:'#c8a840'});
          }
        }
      }
    }
  }

  if (lines.length === 0) {
    for (const o of others) {
      const mx1=tx, mx2=tx+moving.w, my1=ty, my2=ty+moving.h;
      const ox1=o.x,      ox2=o.x+o.w,           oy1=o.y,      oy2=o.y+o.h;
      const vertOvlp  = my1 < oy2 && my2 > oy1;
      const horizOvlp = mx1 < ox2 && mx2 > ox1;

      const gR = mx1 - ox2, gL = ox1 - mx2;
      const gB = my1 - oy2, gA = oy1 - my2;

      if (gR > -SNAP_THRESH && gR < SNAP_THRESH * 3 && vertOvlp) {
        lines.push({type:'gap-h', x1:ox2, x2:mx1, y:(Math.max(my1,oy1)+Math.min(my2,oy2))/2, color:'#a19181'});
      }
      if (gL > -SNAP_THRESH && gL < SNAP_THRESH * 3 && vertOvlp) {
        lines.push({type:'gap-h', x1:mx2, x2:ox1, y:(Math.max(my1,oy1)+Math.min(my2,oy2))/2, color:'#a19181'});
      }
      if (gB > -SNAP_THRESH && gB < SNAP_THRESH * 3 && horizOvlp) {
        lines.push({type:'gap-v', y1:oy2, y2:my1, x:(Math.max(mx1,ox1)+Math.min(mx2,ox2))/2, color:'#a19181'});
      }
      if (gA > -SNAP_THRESH && gA < SNAP_THRESH * 3 && horizOvlp) {
        lines.push({type:'gap-v', y1:my2, y2:oy1, x:(Math.max(mx1,ox1)+Math.min(mx2,ox2))/2, color:'#a19181'});
      }
    }
  }

  return {lines, dx:dx||0, dy:dy||0};
}

// ── RESIZE SNAP COMPUTE ──
function computeResizeSnap(p, side, others) {
  let deltaX = 0, deltaY = 0;
  const lines = [];

  if (side === 'r') {
    const rX = p.x + p.w;
    for (const o of others) {
      const targets = [o.x, o.x + o.w, o.x + o.w/2];
      for (const t of targets) {
        if (Math.abs(rX - t) < SNAP_THRESH) { deltaX = t - rX; lines.push({type: 'v', x: t, color: '#c8a840'}); break; }
      }
      if (deltaX !== 0) break;
    }
  } else if (side === 'l') {
    const lX = p.x;
    for (const o of others) {
      const targets = [o.x, o.x + o.w, o.x + o.w/2];
      for (const t of targets) {
        if (Math.abs(lX - t) < SNAP_THRESH) { deltaX = t - lX; lines.push({type: 'v', x: t, color: '#c8a840'}); break; }
      }
      if (deltaX !== 0) break;
    }
  } else if (side === 'b') {
    const bY = p.y + p.h;
    for (const o of others) {
      const yTargets = [o.y, o.y + o.h, o.y + o.h/2];
      for (const t of yTargets) {
        if (Math.abs(bY - t) < SNAP_THRESH) { deltaY = t - bY; lines.push({type: 'h', y: t, color: '#c8a840'}); break; }
      }
      if (deltaY !== 0) break;
    }
  } else if (side === 't') {
    const tY = p.y;
    for (const o of others) {
      const yTargets = [o.y, o.y + o.h, o.y + o.h/2];
      for (const t of yTargets) {
        if (Math.abs(tY - t) < SNAP_THRESH) { deltaY = t - tY; lines.push({type: 'h', y: t, color: '#c8a840'}); break; }
      }
      if (deltaY !== 0) break;
    }
  }
  return {deltaX, deltaY, lines};
}

// ── DRAW SNAP LINES ──
function drawSnapLines(lines) {
  const cw=CW(), ch=CH(), ns='http://www.w3.org/2000/svg';
  snapSvg.innerHTML='';
  const drawn=new Set();
  for (const l of lines) {
    if (l.type==='v') {
      const k=`v${l.x.toFixed(4)}`; if(drawn.has(k))continue; drawn.add(k);
      const e=document.createElementNS(ns,'line');
      e.setAttribute('x1',l.x*cw);e.setAttribute('x2',l.x*cw);
      e.setAttribute('y1',0);e.setAttribute('y2',ch);
      e.setAttribute('stroke',l.color);e.setAttribute('stroke-width','1');
      e.setAttribute('stroke-dasharray','3,3');e.setAttribute('opacity','0.8');
      snapSvg.appendChild(e);
    } else if (l.type==='h') {
      const k=`h${l.y.toFixed(4)}`; if(drawn.has(k))continue; drawn.add(k);
      const e=document.createElementNS(ns,'line');
      e.setAttribute('x1',0);e.setAttribute('x2',cw);
      e.setAttribute('y1',l.y*ch);e.setAttribute('y2',l.y*ch);
      e.setAttribute('stroke',l.color);e.setAttribute('stroke-width','1');
      e.setAttribute('stroke-dasharray','3,3');e.setAttribute('opacity','0.8');
      snapSvg.appendChild(e);
    } else if (l.type==='gap-h') {
      const x1=l.x1*cw, x2=l.x2*cw, y=l.y*ch;
      if (Math.abs(x2-x1)<1) continue;
      const g=document.createElementNS(ns,'g');
      const ln=document.createElementNS(ns,'line');
      ln.setAttribute('x1',x1);ln.setAttribute('x2',x2);
      ln.setAttribute('y1',y);ln.setAttribute('y2',y);
      ln.setAttribute('stroke',l.color);ln.setAttribute('stroke-width','1.5');
      g.appendChild(ln);
      
      const edge1=document.createElementNS(ns,'line');
      edge1.setAttribute('x1',x1);edge1.setAttribute('x2',x1);edge1.setAttribute('y1',y-4);edge1.setAttribute('y2',y+4);
      edge1.setAttribute('stroke',l.color);edge1.setAttribute('stroke-width','1.5');
      g.appendChild(edge1);
      const edge2=document.createElementNS(ns,'line');
      edge2.setAttribute('x1',x2);edge2.setAttribute('x2',x2);edge1.setAttribute('y1',y-4);edge1.setAttribute('y2',y+4);
      edge2.setAttribute('stroke',l.color);edge2.setAttribute('stroke-width','1.5');
      g.appendChild(edge2);

      const txt=document.createElementNS(ns,'text');
      txt.setAttribute('x',(x1+x2)/2);txt.setAttribute('y',y-6);
      txt.setAttribute('fill',l.color==='#c8a840'? 'var(--gold2)': 'var(--text2)');
      txt.setAttribute('font-size','10'); txt.setAttribute('font-weight','bold');
      txt.setAttribute('font-family','monospace');txt.setAttribute('text-anchor','middle');
      
      const pxVal = Math.round(Math.abs(l.x2 - l.x1) * V_WIDTH);
      txt.textContent = pxVal + 'px';
      g.appendChild(txt);
      snapSvg.appendChild(g);
    } else if (l.type==='gap-v') {
      const y1=l.y1*ch, y2=l.y2*ch, x=l.x*cw;
      if (Math.abs(y2-y1)<1) continue;
      const g=document.createElementNS(ns,'g');
      const ln=document.createElementNS(ns,'line');
      ln.setAttribute('x1',x);ln.setAttribute('x2',x);
      ln.setAttribute('y1',y1);ln.setAttribute('y2',y2);
      ln.setAttribute('stroke',l.color);ln.setAttribute('stroke-width','1.5');
      g.appendChild(ln);

      const edge1=document.createElementNS(ns,'line');
      edge1.setAttribute('x1',x-4);edge1.setAttribute('x2',x+4);edge1.setAttribute('y1',y1);edge1.setAttribute('y2',y1);
      edge1.setAttribute('stroke',l.color);edge1.setAttribute('stroke-width','1.5');
      g.appendChild(edge1);
      const edge2=document.createElementNS(ns,'line');
      edge2.setAttribute('x1',x-4);edge2.setAttribute('x2',x+4);edge1.setAttribute('y1',y2);edge1.setAttribute('y2',y2);
      edge2.setAttribute('stroke',l.color);edge2.setAttribute('stroke-width','1.5');
      g.appendChild(edge2);

      const txt=document.createElementNS(ns,'text');
      txt.setAttribute('x',x+6);txt.setAttribute('y',(y1+y2)/2+4);
      txt.setAttribute('fill',l.color==='#c8a840'? 'var(--gold2)': 'var(--text2)');
      txt.setAttribute('font-size','10'); txt.setAttribute('font-weight','bold');
      txt.setAttribute('font-family','monospace');
      
      const pxVal = Math.round(Math.abs(l.y2 - l.y1) * V_HEIGHT);
      txt.textContent = pxVal + 'px';
      g.appendChild(txt);
      snapSvg.appendChild(g);
    }
  }
}
function clearSnapLines() { snapSvg.innerHTML=''; }

// ── RENDER ──
function renderAll() {
  canvasWrap.querySelectorAll('.panel-el').forEach(e=>e.remove());
  panels.forEach(p=>renderPanel(p));
  updateOutput();
  btnCopyP.disabled = !selectedId;
  btnDel.disabled   = !selectedId;
  drawGrid();
}

function renderPanel(p) {
  const cw=CW(), ch=CH();
  const el=document.createElement('div');
  let cls='panel-el';
  if (selectedId===p.id)              cls+=' selected';
  if (p.func==='Selectable')          cls+=' sel-type';
  if (p.func==='SelectableNoBorder')  cls+=' sel-nb';
  el.className=cls; el.dataset.id=p.id;
  el.style.left=(p.x*cw)+'px'; el.style.top=(p.y*ch)+'px';
  el.style.width=(p.w*cw)+'px'; el.style.height=(p.h*ch)+'px';
  el.style.background=rgbaCss(p.hexcol, p.alpha);

  const dot=document.createElement('div'); dot.className='pen-dot'; el.appendChild(dot);
  if (p.text1) {
    const l1=document.createElement('div'); l1.className='p-l1';
    l1.textContent=p.text1; l1.style.textAlign=p.align1.toLowerCase(); el.appendChild(l1);
  }
  if (p.text2) {
    const l2=document.createElement('div'); l2.className='p-l2'; l2.textContent=p.text2; el.appendChild(l2);
  }

  const edges = ['t', 'b', 'l', 'r'];
  edges.forEach(side => {
    const edge = document.createElement('div');
    edge.className = `edge-h edge-${side}`;
    edge.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      selectPanel(p.id);
      resizing = p; resizeSide = side;
      resizeOX = e.clientX; resizeOY = e.clientY;
      resizePX = p.x; resizePY = p.y;
      resizePW = p.w; resizePH = p.h;
      edge.setPointerCapture(e.pointerId);
    });
    el.appendChild(edge);
  });

  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('edge-h')) return;
    e.preventDefault();
    selectPanel(p.id);
    dragging=p; dragOX=e.clientX; dragOY=e.clientY; dragPX=p.x; dragPY=p.y;
    el.setPointerCapture(e.pointerId);
  });
  canvasWrap.insertBefore(el, gridSvg);
}

function selectPanel(id) { selectedId=id; renderAll(); showProps(); }

// ── PROPS BAR ──
function showProps() {
  const p=panels.find(p=>p.id===selectedId);
  if (!p) {
    propsBar.innerHTML=`<span class="lbl" style="color:var(--text3)">— パネルを選択してプロパティ編集 | Ctrl+C コピー &nbsp;Ctrl+V 貼付け &nbsp;Delete 削除 &nbsp;Ctrl+Z Undo &nbsp;Ctrl+Y Redo —</span>`;
    btnCopyP.disabled=true; btnDel.disabled=true; return;
  }
  btnCopyP.disabled=false; btnDel.disabled=false;
  const sel=(id,opts,val)=>`<select id="${id}">${opts.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join('')}</select>`;
  propsBar.innerHTML=`
    <span class="lbl">位置X</span><input type="number" id="pp-x" value="${p.x.toFixed(3)}" step="0.005" min="0" max="1" style="width:62px">
    <span class="lbl">位置Y</span><input type="number" id="pp-y" value="${p.y.toFixed(3)}" step="0.005" min="0" max="1" style="width:62px">
    <span class="lbl">幅W</span><input type="number" id="pp-w" value="${p.w.toFixed(3)}" step="0.005" min="0.01" max="1" style="width:62px">
    <span class="lbl">高H</span><input type="number" id="pp-h" value="${p.h.toFixed(3)}" step="0.005" min="0.01" max="1" style="width:62px">
    <div class="sep"></div>
    <span class="lbl">機能</span>${sel('pp-func',['','Selectable','SelectableNoBorder'],p.func)}
    <span class="lbl">アンカー</span><input type="text" id="pp-anchor" value="${p.anchor}" placeholder="#tag" style="width:64px">
    <div class="sep"></div>
    <span class="lbl">文字1</span><input type="text" id="pp-t1" value="${p.text1}" style="width:78px">
    <span class="lbl">揃え</span>${sel('pp-a1',['Left','Center','Right'],p.align1)}
    <span class="lbl">文字2</span><input type="text" id="pp-t2" value="${p.text2}" style="width:68px">
    <div class="sep"></div>
    <span class="lbl">色</span><input type="color" id="pp-col" value="${p.hexcol}" style="width:30px;height:22px">
    <span class="lbl">不透明度</span><input type="range" id="pp-alpha" min="0" max="255" value="${p.alpha}" style="width:50px">
  `;
  const ids=['pp-x','pp-y','pp-w','pp-h','pp-func','pp-anchor','pp-t1','pp-a1','pp-t2','pp-col','pp-alpha'];
  ids.forEach(id => {
    document.getElementById(id)?.addEventListener('input',()=>{
      p.x=parseFloat(document.getElementById('pp-x').value);
      p.y=parseFloat(document.getElementById('pp-y').value);
      p.w=parseFloat(document.getElementById('pp-w').value);
      p.h=parseFloat(document.getElementById('pp-h').value);
      p.func=document.getElementById('pp-func').value;
      p.anchor=document.getElementById('pp-anchor').value;
      p.text1=document.getElementById('pp-t1').value;
      p.align1=document.getElementById('pp-a1').value;
      p.text2=document.getElementById('pp-t2').value;
      p.hexcol=document.getElementById('pp-col').value;
      p.alpha=parseInt(document.getElementById('pp-alpha').value);
      renderAll();
    });
    document.getElementById(id)?.addEventListener('change',()=>snapshot());
  });
}

function updatePropsXY() {
  const p=panels.find(p=>p.id===selectedId); if(!p) return;
  [['pp-x',p.x],['pp-y',p.y],['pp-w',p.w],['pp-h',p.h]].forEach(([id,v])=>{
    const el=document.getElementById(id); if(el) el.value=v.toFixed(3);
  });
}

// ── DRAG / RESIZE ──
window.addEventListener('pointermove', e=>{
  const cw=CW(), ch=CH();
  if (dragging) {
    const ddx=(e.clientX-dragOX)/cw, ddy=(e.clientY-dragOY)/ch;
    let nx=dragPX+ddx;
    let ny=dragPY+ddy;
    
    const others=panels.filter(p=>p.id!==dragging.id);
    const snap=computeSnap({...dragging,x:nx,y:ny},others);
    
    if (snap.dx && Math.abs(snap.dx) < SNAP_THRESH) nx += snap.dx;
    if (snap.dy && Math.abs(snap.dy) < SNAP_THRESH) ny += snap.dy;
    
    dragging.x=Math.max(0,Math.min(1-dragging.w, nx));
    dragging.y=Math.max(0,Math.min(1-dragging.h, ny));
    renderAll(); updatePropsXY();
    drawSnapLines(computeSnap({...dragging},others).lines);
  }
  if (resizing) {
    const ddx=(e.clientX-resizeOX)/cw, ddy=(e.clientY-resizeOY)/ch;
    const minW = 0.02, minH = 0.02;
    const others = panels.filter(p => p.id !== resizing.id);

    let tx = resizePX, ty = resizePY, tw = resizePW, th = resizePH;

    if (resizeSide === 'r') { tw = Math.max(minW, Math.min(1 - resizePX, resizePW + ddx)); }
    else if (resizeSide === 'l') {
      tx = resizePX + ddx; tw = resizePW - ddx;
      if (tw < minW) { tx = resizePX + resizePW - minW; tw = minW; }
      if (tx < 0) { tw += tx; tx = 0; }
    } else if (resizeSide === 'b') { th = Math.max(minH, Math.min(1 - resizePY, resizePH + ddy)); }
    else if (resizeSide === 't') {
      ty = resizePY + ddy; th = resizePH - ddy;
      if (th < minH) { ty = resizePY + resizePH - minH; th = minH; }
      if (ty < 0) { th += ty; ty = 0; }
    }

    const snap = computeResizeSnap({x:tx, y:ty, w:tw, h:th}, resizeSide, others);

    if (resizeSide === 'r')       { resizing.w = Math.max(minW, tw + snap.deltaX); }
    else if (resizeSide === 'l')  { resizing.x = tx + snap.deltaX; resizing.w = Math.max(minW, tw - snap.deltaX); }
    else if (resizeSide === 'b')  { resizing.h = Math.max(minH, th + snap.deltaY); }
    else if (resizeSide === 't')  { resizing.y = ty + snap.deltaY; resizing.h = Math.max(minH, th - snap.deltaY); }

    renderAll(); updatePropsXY();
    drawSnapLines(snap.lines);
  }
});
window.addEventListener('pointerup',()=>{
  if (dragging||resizing) { clearSnapLines(); snapshot(); }
  dragging=null; resizing=null; resizeSide=null;
});

// ── COPY / PASTE ──
function copySelected() {
  const p=panels.find(p=>p.id===selectedId); if(!p) return;
  clipboard={...p}; btnPaste.disabled=false;
  showToast(`コピー: "${p.text1||'(無題)'}"`);
}
function pastePanel() {
  if(!clipboard) return;
  snapshot();
  const p={...clipboard, id:++idCounter,
    x:Math.min(0.95,clipboard.x+PASTE_OFF),
    y:Math.min(0.95,clipboard.y+PASTE_OFF)};
  panels.push(p); selectedId=p.id; clipboard={...p};
  renderAll(); showProps();
}

// ── MAKE PANEL ──
function makePanel(x,y) {
  return { id:++idCounter, x, y, w:DW, h:DH,
    func:   document.getElementById('tb-func').value,
    text1:  document.getElementById('tb-text1').value||'',
    align1: document.getElementById('tb-align1').value,
    text2:  document.getElementById('tb-text2').value||'',
    align2: 'Left',
    hexcol: document.getElementById('tb-bgcolor').value,
    alpha:  parseInt(document.getElementById('tb-alpha').value),
    anchor: document.getElementById('tb-anchor').value||'' };
}

// ── OUTPUT ──
function updateOutput() {
  if (!panels.length) { sceneOut.value='// パネルを追加してください'; return; }
  const lines=[];
  panels.forEach(p=>{
    lines.push(`SetPen,${p.x.toFixed(2)},${p.y.toFixed(2)}`);
    const args=[p.func||'',p.anchor||'',p.text1||'',p.align1||'Left',p.text2||'','','',hexToRatColor(p.hexcol,p.alpha),p.w.toFixed(2),p.h.toFixed(2)];
    while(args.length>4&&args[args.length-1]==='') args.pop();
    lines.push(`SetPanel,${args.join(',')}`);
  });
  lines.push('Stop');
  sceneOut.value=lines.join('\n');
}

// ── BACKGROUND IMAGE ──
document.getElementById('btn-load-bg').addEventListener('click',()=>document.getElementById('file-bg').click());
document.getElementById('file-bg').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  bgImg.src=URL.createObjectURL(f); bgImg.style.display='block';
  btnClearBg.style.display='inline-flex'; e.target.value='';
  showToast('背景画像を設定しました');
});
btnClearBg.addEventListener('click',()=>{
  bgImg.src=''; bgImg.style.display='none'; btnClearBg.style.display='none';
});

// ── BUTTON EVENTS ──
document.getElementById('btn-add').addEventListener('click',()=>{
  snapshot();
  const last=panels.length?panels[panels.length-1]:null;
  const nx=last?last.x:0.12;
  const ny=last?Math.min(0.88,last.y+last.h+0.02):0.21;
  const p=makePanel(nx,ny); panels.push(p); selectedId=p.id;
  renderAll(); showProps();
});
document.getElementById('btn-copy-panel').addEventListener('click',copySelected);
document.getElementById('btn-paste-panel').addEventListener('click',pastePanel);
document.getElementById('btn-del').addEventListener('click',()=>{
  if(!selectedId) return; snapshot();
  panels=panels.filter(p=>p.id!==selectedId);
  selectedId=panels.length?panels[panels.length-1].id:null;
  renderAll(); showProps();
});
document.getElementById('btn-clear').addEventListener('click',()=>{
  if(!panels.length) return; snapshot();
  panels=[]; selectedId=null; clipboard=null; btnPaste.disabled=true;
  renderAll(); showProps();
});
btnUndo.addEventListener('click',undo);
btnRedo.addEventListener('click',redo);
document.getElementById('btn-copy-scene').addEventListener('click',()=>{
  navigator.clipboard.writeText(sceneOut.value).then(()=>showToast('Scene をコピーしました'));
});
canvasWrap.addEventListener('click',e=>{
  if(e.target===canvasWrap||e.target===gridSvg||e.target===snapSvg) {
    selectedId=null; renderAll(); showProps();
  }
});

// ── KEYBOARD ──
document.addEventListener('keydown',e=>{
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||e.key==='Y')){e.preventDefault();redo();}
  if((e.ctrlKey||e.metaKey)&&e.key==='c'){e.preventDefault();copySelected();}
  if((e.ctrlKey||e.metaKey)&&e.key==='v'){e.preventDefault();pastePanel();}
  if(e.key==='Delete'||e.key==='Backspace'){
    if(!selectedId) return; snapshot();
    panels=panels.filter(p=>p.id!==selectedId);
    selectedId=panels.length?panels[panels.length-1].id:null;
    renderAll(); showProps();
  }
});

// ── RESIZE OBSERVER ──
new ResizeObserver(()=>renderAll()).observe(canvasWrap);

// ── INIT ──
panels=[
  {id:++idCounter, x:0.10, y:0.08, w:0.30, h:0.10, func:'',           anchor:'',        text1:'◆見出し', align1:'Left', text2:'', align2:'Left', hexcol:'#222244', alpha:200},
  {id:++idCounter, x:0.12, y:0.21, w:0.30, h:0.10, func:'Selectable', anchor:'#select1', text1:'選択肢①', align1:'Left', text2:'', align2:'Left', hexcol:'#223355', alpha:210},
  {id:++idCounter, x:0.12, y:0.33, w:0.30, h:0.10, func:'Selectable', anchor:'#select2', text1:'選択肢②', align1:'Left', text2:'', align2:'Left', hexcol:'#223355', alpha:210}
];
selectedId=null; renderAll(); showProps();