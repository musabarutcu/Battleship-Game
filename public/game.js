const socket = io({ transports: ['websocket'] });
const B = 10, COLS = 'ABCDEFGHIJ'.split('');
let playerIndex = -1, roomCode = '', phase = 'lobby', isMyTurn = false;
let shipDefs = [], placedShips = [], dragHorizontal = true, opponentNick = '', myNick = '';
let adjHintEnabled = true;
let myBoard = [], myShots = [], myHitsReceived = [];
const sunkOppShips = [];

function resetBoards() {
  myBoard = Array.from({length:B},()=>Array(B).fill(0));
  myShots = Array.from({length:B},()=>Array(B).fill(0));
  myHitsReceived = Array.from({length:B},()=>Array(B).fill(0));
}
resetBoards();

const $=id=>document.getElementById(id);
const turnStatus=$('turn-status'), statusMsg=$('status-msg'), shipDock=$('ship-dock');
const dockShipsEl=$('dock-ships'), btnReady=$('btn-ready'), gameOverOverlay=$('game-over-overlay');
const chatPanel=$('chat-panel'), chatMessages=$('chat-messages'), chatInput=$('chat-input');

function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active')}
function setStatus(msg,hl){statusMsg.textContent=msg;statusMsg.className='status-msg'+(hl?' highlight':'')}

// ═══ GRID ═══
function buildGrid(cid, handler){
  const c=$(cid); c.innerHTML='';
  const corner=document.createElement('div'); corner.className='grid-header'; c.appendChild(corner);
  for(let i=0;i<B;i++){const h=document.createElement('div');h.className='grid-header';h.textContent=i+1;c.appendChild(h)}
  for(let r=0;r<B;r++){
    const rh=document.createElement('div');rh.className='grid-header';rh.textContent=COLS[r];c.appendChild(rh);
    for(let col=0;col<B;col++){
      const cell=document.createElement('div');cell.className='grid-cell';cell.dataset.x=col;cell.dataset.y=r;
      if(handler)cell.addEventListener('click',()=>handler(col,r));
      c.appendChild(cell);
    }
  }
}

function getCell(cid,x,y){return $(cid).children[(B+1)+y*(B+1)+1+x]}

function isSunkCell(x,y,list){for(const s of list)for(let i=0;i<s.size;i++){const cx=s.horizontal?s.x+i:s.x,cy=s.horizontal?s.y:s.y+i;if(cx===x&&cy===y)return true}return false}

function renderMyBoard(){
  for(let r=0;r<B;r++)for(let c=0;c<B;c++){
    const cell=getCell('my-grid',c,r);cell.className='grid-cell';
    const ship=myBoard[r][c]===1,h=myHitsReceived[r][c];
    if(ship&&h===2)cell.classList.add(isSunkCell(c,r,placedShips.filter(s=>s.sunk))?'ship-sunk':'ship-hit');
    else if(!ship&&h===1)cell.classList.add('water-miss');
    else if(ship)cell.classList.add('ship');
  }
}

function renderOppBoard(){
  for(let r=0;r<B;r++)for(let c=0;c<B;c++){
    const cell=getCell('opp-grid',c,r);cell.className='grid-cell';
    if(myShots[r][c]===2)cell.classList.add(isSunkCell(c,r,sunkOppShips)?'sunk':'hit');
    else if(myShots[r][c]===1)cell.classList.add('miss');
    else if(phase==='battle'&&isMyTurn)cell.classList.add('target');
  }
}

// ═══ ADJACENCY CHECK ═══
function shipCells(s){const c=[];for(let i=0;i<s.size;i++)c.push([s.horizontal?s.x+i:s.x,s.horizontal?s.y:s.y+i]);return c}

function canPlace(x,y,size,horiz,excludeIdx){
  for(let i=0;i<size;i++){const cx=horiz?x+i:x,cy=horiz?y:y+i;if(cx<0||cx>=B||cy<0||cy>=B)return false}
  const newShip={x,y,size,horizontal:horiz};
  const newCells=shipCells(newShip);
  for(let si=0;si<placedShips.length;si++){
    if(si===excludeIdx)continue;
    const oCells=shipCells(placedShips[si]);
    for(const[nx,ny]of newCells)for(const[ox,oy]of oCells)if(Math.abs(nx-ox)<=1&&Math.abs(ny-oy)<=1)return false;
  }
  return true;
}

function rebuildMyBoard(){
  myBoard=Array.from({length:B},()=>Array(B).fill(0));
  for(const s of placedShips)for(let i=0;i<s.size;i++){const cx=s.horizontal?s.x+i:s.x,cy=s.horizontal?s.y:s.y+i;myBoard[cy][cx]=1}
}

// ═══ LOBBY ═══
$('btn-create').addEventListener('click',()=>{
  myNick=($('nickname-input').value.trim()||'Oyuncu');
  socket.emit('create-room',{nickname:myNick},(res)=>{
    if(res.success){
      roomCode=res.code;playerIndex=res.playerIndex;
      $('room-code-display').textContent=roomCode;
      $('waiting-section').classList.add('visible');
      $('lobby-error').textContent='';
      // Build invite link
      const url=`${location.origin}${location.pathname}?join=${roomCode}`;
      $('invite-link-input').value=url;
    }
  });
});

$('btn-copy-link').addEventListener('click',()=>{
  const val=$('invite-link-input').value;
  if(!val)return;
  navigator.clipboard.writeText(val).then(()=>{
    const c=$('copy-confirm');
    c.classList.add('visible');
    setTimeout(()=>c.classList.remove('visible'),2000);
  }).catch(()=>{
    $('invite-link-input').select();
    document.execCommand('copy');
    const c=$('copy-confirm');
    c.classList.add('visible');
    setTimeout(()=>c.classList.remove('visible'),2000);
  });
});

$('btn-join').addEventListener('click',()=>{
  const code=$('code-input').value.trim().toUpperCase();
  if(code.length!==5){$('lobby-error').textContent='5 haneli kod girin.';return}
  myNick=($('nickname-input').value.trim()||'Oyuncu');
  socket.emit('join-room',{code,nickname:myNick},(res)=>{
    if(res.success){roomCode=res.code;playerIndex=res.playerIndex;$('lobby-error').textContent=''}
    else $('lobby-error').textContent=res.error;
  });
});

// ═══ AUTO-JOIN FROM URL ═══
(function(){
  const params=new URLSearchParams(location.search);
  const joinCode=params.get('join');
  if(joinCode&&joinCode.length===5){
    $('code-input').value=joinCode.toUpperCase();
    // Clean URL without reload
    history.replaceState(null,'',location.pathname);
    // Show a subtle hint
    $('lobby-error').style.color='var(--blue)';
    $('lobby-error').textContent='Davet linki algılandı — adını gir ve Katıl\'a bas!';
  }
})();

// ═══ SHIP PLACEMENT ═══
let dragState=null, boardDragState=null;

function initPlacement(){
  placedShips=[];sunkOppShips.length=0;dragHorizontal=true;resetBoards();
  btnReady.disabled=true;buildDockShips();shipDock.classList.add('visible');
  chatPanel.classList.add('visible');
  $('battle-helpers').style.display='none';
  $('my-fleet').classList.remove('visible');$('opp-fleet').classList.remove('visible');
}

function buildFleetStatus(containerId, ships){
  const el=$(containerId);el.innerHTML='';
  ships.forEach(s=>{
    const d=document.createElement('div');d.className='fleet-ship';d.dataset.name=s.name;d.dataset.size=s.size;
    for(let i=0;i<s.size;i++){const b=document.createElement('div');b.className='fb';d.appendChild(b)}
    el.appendChild(d);
  });
}

function updateFleetStatus(containerId, sunkList){
  const el=$(containerId);
  el.querySelectorAll('.fleet-ship').forEach(f=>{
    const name=f.dataset.name;
    const isSunk=sunkList.some(s=>s.name===name);
    f.classList.toggle('sunk',isSunk);
  });
}

function buildDockShips(){
  dockShipsEl.innerHTML='';
  shipDefs.forEach((ship,idx)=>{
    const el=document.createElement('div');el.className='dock-ship';el.dataset.idx=idx;
    el.innerHTML=`<div class="ship-blocks">${'<div></div>'.repeat(ship.size)}</div>`;
    el.addEventListener('mousedown',e=>{if(!el.classList.contains('placed'))startDockDrag(idx,e.clientX,e.clientY,e)});
    el.addEventListener('touchstart',e=>{if(!el.classList.contains('placed')){const t=e.touches[0];startDockDrag(idx,t.clientX,t.clientY,e)}},{passive:false});
    dockShipsEl.appendChild(el);
  });
}

function getCellSize(){const c=getCell('my-grid',0,0);return c?c.offsetWidth:36}

function createGhost(size, horiz){
  const g=document.createElement('div');g.className='drag-ghost';
  const cs=getCellSize();
  for(let i=0;i<size;i++){const b=document.createElement('div');b.style.width=cs+'px';b.style.height=cs+'px';g.appendChild(b)}
  g.style.flexDirection=(horiz!==undefined?horiz:dragHorizontal)?'row':'column';
  document.body.appendChild(g);return g;
}

function startDockDrag(idx,cx,cy,e){
  if(placedShips.find(s=>s._dockIdx===idx))return;e.preventDefault();
  const ghost=createGhost(shipDefs[idx].size,dragHorizontal);
  ghost.style.left=(cx-getCellSize()/2)+'px';ghost.style.top=(cy-getCellSize()/2)+'px';
  dragState={shipIdx:idx,ghost,size:shipDefs[idx].size,name:shipDefs[idx].name,fromBoard:false,horiz:dragHorizontal};
  document.addEventListener('mousemove',onDragMove);document.addEventListener('mouseup',onDragEnd);
  document.addEventListener('touchmove',onDragMoveT,{passive:false});document.addEventListener('touchend',onDragEndT);
}

function startBoardDrag(shipIdx,cx,cy,e){
  e.preventDefault();
  const s=placedShips[shipIdx];
  // Keep ship's current orientation for drag
  dragHorizontal=s.horizontal;
  boardDragState={shipIdx,origX:s.x,origY:s.y,origH:s.horizontal};
  removePlacedShip(shipIdx);
  const ghost=createGhost(s.size,s.horizontal);
  ghost.style.left=(cx-getCellSize()/2)+'px';ghost.style.top=(cy-getCellSize()/2)+'px';
  dragState={shipIdx:s._dockIdx,ghost,size:s.size,name:s.name,fromBoard:true,boardIdx:shipIdx,orig:boardDragState,horiz:s.horizontal};
  document.addEventListener('mousemove',onDragMove);document.addEventListener('mouseup',onDragEnd);
  document.addEventListener('touchmove',onDragMoveT,{passive:false});document.addEventListener('touchend',onDragEndT);
}

function removePlacedShip(idx){
  placedShips.splice(idx,1);rebuildMyBoard();renderMyBoard();
  btnReady.disabled=true;
  // Un-mark dock ship
  updateDockMarks();
}

function updateDockMarks(){
  const dockEls=dockShipsEl.children;
  for(let i=0;i<dockEls.length;i++){
    const placed=placedShips.find(s=>s._dockIdx===i);
    dockEls[i].classList.toggle('placed',!!placed);
  }
}

function onDragMove(e){moveDrag(e.clientX,e.clientY)}
function onDragMoveT(e){e.preventDefault();moveDrag(e.touches[0].clientX,e.touches[0].clientY)}
function onDragEnd(e){endDrag(e.clientX,e.clientY);document.removeEventListener('mousemove',onDragMove);document.removeEventListener('mouseup',onDragEnd)}
function onDragEndT(e){const t=e.changedTouches[0];endDrag(t.clientX,t.clientY);document.removeEventListener('touchmove',onDragMoveT);document.removeEventListener('touchend',onDragEndT)}

function moveDrag(cx,cy){
  if(!dragState)return;const cs=getCellSize();
  dragState.ghost.style.left=(cx-cs/2)+'px';dragState.ghost.style.top=(cy-cs/2)+'px';
  clearPreviews();
  const pos=gridPosFromPoint(cx,cy);
  if(pos)showPreview(pos.x,pos.y,dragState.size,dragState.horiz!==undefined?dragState.horiz:dragHorizontal,-1);
}

function endDrag(cx,cy){
  if(!dragState)return;clearPreviews();
  const pos=gridPosFromPoint(cx,cy);
  const useH=dragState.horiz!==undefined?dragState.horiz:dragHorizontal;
  let placed=false;
  if(pos&&canPlace(pos.x,pos.y,dragState.size,useH,-1)){
    addShip(pos.x,pos.y,dragState.size,dragState.name,useH,dragState.shipIdx);
    placed=true;
  } else if(dragState.fromBoard&&dragState.orig){
    // Revert to original position
    const o=dragState.orig;
    if(canPlace(o.origX,o.origY,dragState.size,o.origH,-1)){
      addShip(o.origX,o.origY,dragState.size,dragState.name,o.origH,dragState.shipIdx);
    }
    if(!placed)shakeBoard();
  }
  dragState.ghost.remove();dragState=null;boardDragState=null;
}

function addShip(x,y,size,name,horiz,dockIdx){
  placedShips.push({x,y,size,name,horizontal:horiz,_dockIdx:dockIdx});
  rebuildMyBoard();renderMyBoard();updateDockMarks();
  if(placedShips.length>=shipDefs.length)btnReady.disabled=false;
}

function gridPosFromPoint(cx,cy){
  const els=document.elementsFromPoint(cx,cy);
  for(const el of els)if(el.classList.contains('grid-cell')&&el.closest('#my-grid'))return{x:+el.dataset.x,y:+el.dataset.y};
  return null;
}

function showPreview(x,y,size,horiz,excludeIdx){
  const valid=canPlace(x,y,size,horiz,excludeIdx);
  for(let i=0;i<size;i++){const cx=horiz?x+i:x,cy=horiz?y:y+i;if(cx<B&&cy<B){const c=getCell('my-grid',cx,cy);c.classList.add(valid?'ship-preview':'ship-invalid')}}
}

function clearPreviews(){for(let r=0;r<B;r++)for(let c=0;c<B;c++)getCell('my-grid',c,r).classList.remove('ship-preview','ship-invalid','adj-zone')}

function shakeBoard(){$('my-board-panel').classList.add('shake');setTimeout(()=>$('my-board-panel').classList.remove('shake'),400)}

// Click on placed ship to rotate
function getShipAt(x,y){for(let i=0;i<placedShips.length;i++){const s=placedShips[i];for(let j=0;j<s.size;j++){const cx=s.horizontal?s.x+j:s.x,cy=s.horizontal?s.y:s.y+j;if(cx===x&&cy===y)return i}}return-1}

let mouseDownInfo=null;

function handleMyGridClick(x,y){
  if(phase!=='placement')return;
  // This handles click-to-rotate (non-drag clicks)
}

function setupBoardInteraction(){
  const grid=$('my-grid');
  grid.addEventListener('mousedown',e=>{
    if(phase!=='placement')return;
    const cell=e.target.closest('.grid-cell');if(!cell)return;
    const x=+cell.dataset.x,y=+cell.dataset.y;
    const si=getShipAt(x,y);if(si===-1)return;
    mouseDownInfo={x:e.clientX,y:e.clientY,time:Date.now(),shipIdx:si,cellX:x,cellY:y};
    e.preventDefault();
  });
  grid.addEventListener('mouseup',e=>{
    if(!mouseDownInfo)return;
    const dist=Math.sqrt((e.clientX-mouseDownInfo.x)**2+(e.clientY-mouseDownInfo.y)**2);
    const dur=Date.now()-mouseDownInfo.time;
    if(dist<8&&dur<400){rotateShipOnBoard(mouseDownInfo.shipIdx)}
    mouseDownInfo=null;
  });
  grid.addEventListener('mousemove',e=>{
    if(!mouseDownInfo||dragState)return;
    const dist=Math.sqrt((e.clientX-mouseDownInfo.x)**2+(e.clientY-mouseDownInfo.y)**2);
    if(dist>8){startBoardDrag(mouseDownInfo.shipIdx,e.clientX,e.clientY,e);mouseDownInfo=null}
  });
  // Touch
  grid.addEventListener('touchstart',e=>{
    if(phase!=='placement')return;
    const t=e.touches[0];const cell=document.elementFromPoint(t.clientX,t.clientY);
    if(!cell||!cell.classList.contains('grid-cell'))return;
    const x=+cell.dataset.x,y=+cell.dataset.y;const si=getShipAt(x,y);if(si===-1)return;
    mouseDownInfo={x:t.clientX,y:t.clientY,time:Date.now(),shipIdx:si};e.preventDefault();
  },{passive:false});
  grid.addEventListener('touchend',e=>{
    if(!mouseDownInfo)return;const t=e.changedTouches[0];
    const dist=Math.sqrt((t.clientX-mouseDownInfo.x)**2+(t.clientY-mouseDownInfo.y)**2);
    if(dist<8)rotateShipOnBoard(mouseDownInfo.shipIdx);
    mouseDownInfo=null;
  });
  grid.addEventListener('touchmove',e=>{
    if(!mouseDownInfo||dragState)return;const t=e.touches[0];
    const dist=Math.sqrt((t.clientX-mouseDownInfo.x)**2+(t.clientY-mouseDownInfo.y)**2);
    if(dist>12){startBoardDrag(mouseDownInfo.shipIdx,t.clientX,t.clientY,e);mouseDownInfo=null}
  },{passive:false});
}

function rotateShipOnBoard(idx){
  const s=placedShips[idx];
  const newH=!s.horizontal;
  const saved={...s};
  placedShips.splice(idx,1);rebuildMyBoard();
  if(canPlace(saved.x,saved.y,saved.size,newH,-1)){
    saved.horizontal=newH;dragHorizontal=newH;
    placedShips.splice(idx,0,saved);rebuildMyBoard();renderMyBoard();return;
  }
  for(let r=1;r<=5;r++){
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
      const nx=saved.x+dx,ny=saved.y+dy;
      if(canPlace(nx,ny,saved.size,newH,-1)){
        saved.x=nx;saved.y=ny;saved.horizontal=newH;dragHorizontal=newH;
        placedShips.splice(idx,0,saved);rebuildMyBoard();renderMyBoard();return;
      }
    }
  }
  placedShips.splice(idx,0,saved);rebuildMyBoard();renderMyBoard();
  const cells=shipCells(saved);
  cells.forEach(([cx,cy])=>{const c=getCell('my-grid',cx,cy);c.classList.add('ship-error')});
  shakeBoard();
  setTimeout(()=>cells.forEach(([cx,cy])=>{const c=getCell('my-grid',cx,cy);c.classList.remove('ship-error')}),600);
}

// ═══ RANDOM PLACEMENT ═══
function placeShipsRandomly(){
  // Clear all placed ships first
  placedShips=[];rebuildMyBoard();updateDockMarks();btnReady.disabled=true;
  for(let di=0;di<shipDefs.length;di++){
    const {size,name}=shipDefs[di];
    let placed=false;
    for(let attempt=0;attempt<500&&!placed;attempt++){
      const horiz=Math.random()<0.5;
      const x=Math.floor(Math.random()*(horiz?B-size+1:B));
      const y=Math.floor(Math.random()*(horiz?B:B-size+1));
      if(canPlace(x,y,size,horiz,-1)){
        placedShips.push({x,y,size,name,horizontal:horiz,_dockIdx:di});
        rebuildMyBoard();
        placed=true;
      }
    }
  }
  renderMyBoard();updateDockMarks();
  if(placedShips.length>=shipDefs.length)btnReady.disabled=false;
}
$('btn-random').addEventListener('click',placeShipsRandomly);

$('btn-reset').addEventListener('click',()=>{placedShips=[];resetBoards();btnReady.disabled=true;buildDockShips();renderMyBoard();dragHorizontal=true});

btnReady.addEventListener('click',()=>{
  const data=placedShips.map(s=>({x:s.x,y:s.y,size:s.size,name:s.name,horizontal:s.horizontal}));
  socket.emit('place-ships',data,res=>{
    if(res.success){shipDock.classList.remove('visible');setStatus('Rakip gemilerini yerleştiriyor...',false)}
    else setStatus(res.error,false);
  });
});

// ═══ BATTLE ═══
function handleOppGridClick(x,y){
  if(phase!=='battle'||!isMyTurn)return;if(myShots[y][x]!==0)return;
  socket.emit('fire',{x,y},res=>{
    if(!res.success){setStatus(res.error,false);return}
    myShots[y][x]=res.hit?2:1;
    if(res.sunkShip){sunkOppShips.push(res.sunkShip);setStatus(`Bir gemi batırdın!`,true);updateFleetStatus('opp-fleet',sunkOppShips)}
    else setStatus(res.hit?'İsabet! Tekrar ateş et':'Iska!',res.hit);
    if(!res.gameOver){
      isMyTurn=res.currentTurn===playerIndex;
      turnStatus.textContent=isMyTurn?'Senin Sıran':`${opponentNick} oynuyor`;
      if(!isMyTurn)setTimeout(()=>setStatus('Rakibin sırası...',false),800);
      updateBoardGlow();
    }
    renderOppBoard();applyAdjHints();
  });
}

function updateBoardGlow(){
  $('opp-board-panel').classList.toggle('active-turn-glow',phase==='battle'&&isMyTurn);
  $('my-board-panel').classList.toggle('active-turn-glow',phase==='battle'&&!isMyTurn);
  $('opp-board-panel').classList.remove('glow');
  $('my-board-panel').classList.remove('glow');
}

// ═══ CHAT ═══
function sendChat(msg){
  msg=msg.trim();if(!msg)return;
  socket.emit('chat-message',msg);chatInput.value='';
}
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat(chatInput.value)});
$('chat-send').addEventListener('click',()=>sendChat(chatInput.value));
document.querySelectorAll('.chat-quick button').forEach(btn=>{
  btn.addEventListener('click',()=>sendChat(btn.dataset.msg));
});

socket.on('chat-message',data=>{
  const div=document.createElement('div');
  div.className='chat-msg'+(data.playerIndex===playerIndex?' own':'');
  div.innerHTML=`<span class="chat-author">${data.nickname}:</span><span class="chat-text">${escHtml(data.message)}</span>`;
  chatMessages.appendChild(div);chatMessages.scrollTop=chatMessages.scrollHeight;
});

function escHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// ═══ MOBILE TABS ═══
$('mobile-tabs').addEventListener('click',e=>{
  const btn=e.target.closest('button');if(!btn)return;
  $('mobile-tabs').querySelectorAll('button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  $('my-board-panel').classList.toggle('hidden-mobile',btn.dataset.tab!=='my');
  $('opp-board-panel').classList.toggle('hidden-mobile',btn.dataset.tab!=='opp');
});

// ═══ SOCKET EVENTS ═══
socket.on('phase-change',data=>{
  phase=data.phase;
  if($('rematch-wait-overlay'))$('rematch-wait-overlay').classList.remove('visible');
  if(phase==='placement'){
    shipDefs=data.ships;if(data.players)setPlayerInfo(data.players);
    showScreen('game-screen');buildGrid('my-grid',handleMyGridClick);buildGrid('opp-grid',handleOppGridClick);
    setupBoardInteraction();initPlacement();
    $('room-code-small').textContent=`Oda: ${roomCode}`;
    turnStatus.innerHTML='<img src="logo-icon.png" alt="Logo" style="width:36px; vertical-align:middle;">';
    setStatus('',false);
  }
  if(phase==='battle'){
    if(data.players)setPlayerInfo(data.players);
    isMyTurn=data.currentTurn===playerIndex;
    turnStatus.textContent=isMyTurn?'Senin Sıran':`${opponentNick} oynuyor`;
    setStatus(isMyTurn?'Rakip tahtaya tıklayarak ateş et':'Rakibin sırası...',isMyTurn);
    shipDock.classList.remove('visible');
    chatPanel.classList.add('visible');
    $('battle-helpers').style.display='flex';
    buildFleetStatus('my-fleet',shipDefs);buildFleetStatus('opp-fleet',shipDefs);
    $('my-fleet').classList.add('visible');$('opp-fleet').classList.add('visible');
    renderOppBoard();updateBoardGlow();
    if(window.innerWidth<=860)$('mobile-tabs').querySelectorAll('button')[1].click();
  }
});

socket.on('opponent-ready',()=>setStatus('Rakip hazır!',false));

socket.on('opponent-fired',data=>{
  myHitsReceived[data.y][data.x]=data.hit?2:1;
  if(data.sunkShip){for(const s of placedShips)if(s.x===data.sunkShip.x&&s.y===data.sunkShip.y&&s.size===data.sunkShip.size)s.sunk=true;setStatus(`Bir gemin battı!`,false);updateFleetStatus('my-fleet',placedShips.filter(s=>s.sunk))}
  else setStatus(data.hit?'Rakip isabet etti!':'Rakip ıskaladı!',false);
  renderMyBoard();
  if(!data.gameOver){
    isMyTurn=data.currentTurn===playerIndex;
    turnStatus.textContent=isMyTurn?'Senin Sıran':`${opponentNick} oynuyor`;
    if(isMyTurn)setTimeout(()=>setStatus('Senin sıran!',true),600);
    renderOppBoard();updateBoardGlow();
  }
});

socket.on('game-over',data=>{
  phase='finished';const won=data.winner===playerIndex;
  $('go-icon').textContent=won?'🏆':'💀';
  $('go-title').textContent=won?'Kazandın!':'Kaybettin';
  $('go-title').className='game-over-title '+(won?'win':'lose');
  $('go-sub').textContent=won?'Tebrikler, tüm düşman gemilerini batırdın!':'Tüm gemilerin battı...';
  gameOverOverlay.classList.add('visible');
  setTimeout(()=>{
    gameOverOverlay.classList.remove('visible');
    $('rematch-container').style.display = 'block';
  }, 3000);
});

$('btn-rematch-top').addEventListener('click',()=>{
  $('rematch-container').style.display = 'none';
  resetBoards();sunkOppShips.length=0;socket.emit('rematch');
});
socket.on('waiting-rematch',()=>{
  if($('rematch-wait-overlay'))$('rematch-wait-overlay').classList.add('visible');
});
$('btn-rematch-cancel').addEventListener('click',()=>{
  $('rematch-wait-overlay').classList.remove('visible');
  $('rematch-container').style.display='block';
});

// ═══ ADJACENCY HINT TOGGLE ═══
function renderOppBoardWithHints(){
  renderOppBoard();
  if(!adjHintEnabled)return;
  // Mark adjacent cells around sunk ships on opp board
  for(const s of sunkOppShips){
    const cells=shipCells(s);
    for(const[cx,cy]of cells){
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=cx+dx,ny=cy+dy;
        if(nx<0||nx>=B||ny<0||ny>=B)continue;
        if(myShots[ny][nx]!==0)continue; // already shot
        const cell=getCell('opp-grid',nx,ny);
        cell.classList.add('adj-hint');
      }
    }
  }
}
const _origRenderOpp=renderOppBoard;
// Override renderOppBoard to apply hints
window._renderOppBoard=renderOppBoard;

$('btn-adj-hint').addEventListener('click',()=>{
  adjHintEnabled=!adjHintEnabled;
  $('btn-adj-hint').classList.toggle('active',adjHintEnabled);
  $('adj-hint-icon').textContent=adjHintEnabled?'✓':'✕';
  applyAdjHints();
});

function applyAdjHints(){
  // Clear existing hints
  for(let r=0;r<B;r++)for(let c=0;c<B;c++){const cell=getCell('opp-grid',c,r);if(cell)cell.classList.remove('adj-hint');}
  if(!adjHintEnabled)return;
  for(const s of sunkOppShips){
    const cells=shipCells(s);
    for(const[cx,cy]of cells){
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=cx+dx,ny=cy+dy;
        if(nx<0||nx>=B||ny<0||ny>=B)continue;
        if(myShots[ny][nx]!==0)continue;
        const cell=getCell('opp-grid',nx,ny);
        if(cell)cell.classList.add('adj-hint');
      }
    }
  }
}
socket.on('opponent-disconnected',()=>{setStatus('⚠️ Rakip bağlantısı koptu.',false);turnStatus.textContent='Bağlantı Koptu'});

function setPlayerInfo(players){
  $('p1-name').textContent=players[0].nickname;$('p1-avatar').textContent=players[0].nickname[0].toUpperCase();
  $('p2-name').textContent=players[1].nickname;$('p2-avatar').textContent=players[1].nickname[0].toUpperCase();
  opponentNick=playerIndex===0?players[1].nickname:players[0].nickname;
}
