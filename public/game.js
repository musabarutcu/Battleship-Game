const socket = io({ transports: ['websocket'] });
const B = 10, COLS = 'ABCDEFGHIJ'.split('');
let playerIndex = -1, roomCode = '', phase = 'lobby', isMyTurn = false;
let sessionToken = null;
let shipDefs = [], placedShips = [], dragHorizontal = true, opponentNick = '', myNick = '';
let adjHintEnabled = true, gameStartTime = null, myAvatar = 'avatar1.png', soundEnabled = true;
let myBoard = [], myShots = [], myHitsReceived = [];
const sunkOppShips = [];
let totalShipCells = 0;

// ═══ DARK MODE ═══
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('battleship-theme', theme);
  document.querySelectorAll('.theme-toggle').forEach(toggle => {
    toggle.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  });
}
(function initTheme() {
  const saved = localStorage.getItem('battleship-theme') || 'light';
  setTheme(saved);
})();
document.querySelectorAll('.theme-toggle button').forEach(btn => {
  btn.addEventListener('click', () => setTheme(btn.dataset.theme));
});

// In-game theme button (inside battle-helpers)
document.addEventListener('click', e => {
  if (e.target.closest('#btn-theme-game')) {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const icon = document.getElementById('theme-game-icon');
    if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
    const btn = document.getElementById('btn-theme-game');
    if (btn) btn.classList.toggle('active', next === 'dark');
  }
});

const $=id=>document.getElementById(id);
const turnStatus=$('turn-status'), statusMsg=$('status-msg'), shipDock=$('ship-dock');
const dockShipsEl=$('dock-ships'), btnReady=$('btn-ready'), gameOverOverlay=$('game-over-overlay');
const chatPanel=$('chat-panel'), chatMessages=$('chat-messages'), chatInput=$('chat-input');

function resetBoards() {
  myBoard = Array.from({length:B},()=>Array(B).fill(0));
  myShots = Array.from({length:B},()=>Array(B).fill(0));
  myHitsReceived = Array.from({length:B},()=>Array(B).fill(0));
}
resetBoards();

// ═══ AUDIO SYSTEM ═══
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  if (!soundEnabled) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  const t = audioCtx.currentTime;
  if (type === 'miss') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(600, t + 0.05);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.3, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
    osc.start(t); osc.stop(t + 0.08);
  } else if (type === 'hit') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(10, t + 0.15);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.8, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(800, t); filter.frequency.exponentialRampToValueAtTime(100, t + 0.1);
    osc.disconnect(); osc.connect(filter); filter.connect(gain);
    osc.start(t); osc.stop(t + 0.15);
  } else if (type === 'sunk') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(10, t + 0.25);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(1, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
    const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(600, t); filter.frequency.exponentialRampToValueAtTime(50, t + 0.2);
    osc.disconnect(); osc.connect(filter); filter.connect(gain);
    osc.start(t); osc.stop(t + 0.25);
  }
}

// ═══ I18N ═══
const texts = {
  tr: {
    welcome: "Hoş geldin", nickname: "Takma Ad", nicknamePh: "Adını gir...", createRoom: "Oda Oluştur",
    roomCodeLabel: "Oda Kodu", waitingOpponent: "Rakip bekleniyor...", or: "veya", join: "Katıl",
    rematch: "Yeniden Oyna", myFleet: "Kendi Filon", oppFleet: "Rakip Filo", hits: "İsabet",
    misses: "Iska", accuracy: "Oran", time: "Süre", reset: "Sıfırla", random: "Rastgele",
    ready: "Hazırım", adjHint: "Komşu İpucu", sound: "Ses", chat: "Sohbet",
    statusPlace: "Gemilerini Yerleştir", statusWait: "Rakip bekleniyor",
    statusFire: "Rakip tahtaya tıklayarak ateş et", statusOpp: "Rakibin sırası...", 
    win: "Kazandın!", lose: "Kaybettin", winSub: "Tebrikler, tüm düşman gemilerini batırdın!", loseSub: "Tüm gemilerin battı...",
    sunkShip: "Bir gemi batırdın!", hitAgain: "İsabet! Tekrar ateş et", miss: "Iska!",
    oppHit: "Rakip isabet etti!", oppMiss: "Rakip ıskaladı!", oppSunk: "Bir gemin battı!",
    yourTurn: "Senin Sıran", oppTurn: " oynuyor", oppDisc: "⚠️ Rakip bağlantısı koptu.", discWait: "Bağlantı Koptu",
    readyOpp: "Rakip hazır!", roomLabel: "Oda: ",
    codeInputPh: "5 haneli kod", enterCodeError: "5 haneli kod girin.",
    inviteDetected: "Davet linki algılandı — adını gir ve Katıl'a bas!",
    turnLabel: "Durum", theme: "Tema",
    copyLinkTitle: "Linki kopyala", cancelTitle: "İptal et",
    adjHintTitle: "Vurduğun gemilerin yanındaki kareleri işaretle", soundTitle: "Ses efektlerini aç/kapat",
    rematchWaitTitle: "Rakip Bekleniyor", rematchWaitSub: "Rakibin de \"Yeniden Oyna\" butonuna basması bekleniyor...",
    oppReconnected: "Rakip geri bağlandı!", scanQr: "Telefonla taramak için karekod",
    errRoomNotFound: "Oda bulunamadı.", errRoomFull: "Oda dolu.", errGameStarted: "Oyun başlamış.",
    errInvalidState: "Geçersiz durum.", errAlreadyReady: "Zaten yerleştirildi.", errInvalidPlacement: "Geçersiz yerleşim.",
    errInvalid: "Geçersiz.", errNotYourTurn: "Sıra sende değil.", errInvalidCoord: "Geçersiz koordinat.",
    errAlreadyFired: "Zaten ateş edildi."
  },
  en: {
    welcome: "Welcome", nickname: "Nickname", nicknamePh: "Enter your name...", createRoom: "Create Room",
    roomCodeLabel: "Room Code", waitingOpponent: "Waiting for opponent...", or: "or", join: "Join",
    rematch: "Rematch", myFleet: "Your Fleet", oppFleet: "Enemy Fleet", hits: "Hits",
    misses: "Misses", accuracy: "Accuracy", time: "Time", reset: "Reset", random: "Random",
    ready: "Ready", adjHint: "Adj Hint", sound: "Sound", chat: "Chat",
    statusPlace: "Place Your Ships", statusWait: "Waiting for opponent",
    statusFire: "Click enemy board to fire", statusOpp: "Opponent's turn...", 
    win: "You Won!", lose: "You Lost", winSub: "Congratulations, you sank all enemy ships!", loseSub: "All your ships sank...",
    sunkShip: "You sank a ship!", hitAgain: "Hit! Fire again", miss: "Miss!",
    oppHit: "Opponent hit!", oppMiss: "Opponent missed!", oppSunk: "Your ship sank!",
    yourTurn: "Your Turn", oppTurn: " is playing", oppDisc: "⚠️ Opponent disconnected.", discWait: "Disconnected",
    readyOpp: "Opponent is ready!", roomLabel: "Room: ",
    codeInputPh: "5-digit code", enterCodeError: "Please enter a 5-digit code.",
    inviteDetected: "Invite link detected — enter your name and Join!",
    turnLabel: "Status", theme: "Theme",
    copyLinkTitle: "Copy link", cancelTitle: "Cancel",
    adjHintTitle: "Mark the cells around your hits", soundTitle: "Toggle sound effects",
    rematchWaitTitle: "Waiting for Opponent", rematchWaitSub: "Waiting for your opponent to hit \"Rematch\" too...",
    oppReconnected: "Opponent reconnected!", scanQr: "Scan with your phone",
    errRoomNotFound: "Room not found.", errRoomFull: "Room is full.", errGameStarted: "Game already started.",
    errInvalidState: "Invalid state.", errAlreadyReady: "Already placed.", errInvalidPlacement: "Invalid placement.",
    errInvalid: "Invalid.", errNotYourTurn: "Not your turn.", errInvalidCoord: "Invalid coordinate.",
    errAlreadyFired: "Already fired."
  }
};
function errText(code){ return (texts[lang] && texts[lang][code]) || code; }
let lang = 'tr';
function setLang(l) {
  lang = l;
  $('btn-lang-tr').classList.toggle('active', l === 'tr'); $('btn-lang-en').classList.toggle('active', l === 'en');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = texts[l][el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = texts[l][el.dataset.i18nPlaceholder]; });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = texts[l][el.dataset.i18nTitle]; });
  if (phase === 'placement') turnStatus.innerHTML = '<img src="logo-icon.png" alt="Logo" style="width:36px; vertical-align:middle;">';
  else if (phase === 'battle') turnStatus.textContent = isMyTurn ? texts[lang].yourTurn : `${opponentNick}${texts[lang].oppTurn}`;

  if ($('room-code-small').textContent) $('room-code-small').textContent = texts[lang].roomLabel + roomCode;
  
  const currentMsg = statusMsg.textContent;
  let foundKey = null;
  for (const k in texts['tr']) { if (texts['tr'][k] === currentMsg) foundKey = k; }
  for (const k in texts['en']) { if (texts['en'][k] === currentMsg) foundKey = k; }
  if (foundKey) statusMsg.textContent = texts[lang][foundKey];
}
$('btn-lang-tr').addEventListener('click', () => setLang('tr'));
$('btn-lang-en').addEventListener('click', () => setLang('en'));

function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active')}
function setStatus(msg,hl){statusMsg.textContent=msg;statusMsg.className='status-msg'+(hl?' highlight':'')}

// ═══ GRID ═══
function buildGrid(cid, handler){
  const c=$(cid); c.innerHTML='';
  const corner=document.createElement('div'); corner.className='grid-header'; c.appendChild(corner);
  for(let i=0;i<B;i++){const h=document.createElement('div');h.className='grid-header';h.textContent=COLS[i];c.appendChild(h)}
  for(let r=0;r<B;r++){
    const rh=document.createElement('div');rh.className='grid-header';rh.textContent=r+1;c.appendChild(rh);
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
document.querySelectorAll('.avatar-option').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    myAvatar = el.dataset.avatar;
  });
});

$('btn-sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('btn-sound').classList.toggle('active', soundEnabled);
  $('sound-icon').textContent = soundEnabled ? '🔊' : '🔇';
});

function saveSession(){
  try{ sessionStorage.setItem('battleship-session', JSON.stringify({token:sessionToken, nickname:myNick, avatar:myAvatar})); }catch(e){}
}
function clearSession(){
  try{ sessionStorage.removeItem('battleship-session'); }catch(e){}
}

function renderInviteQr(url){
  const el=$('qr-code');
  if(!el||typeof qrcode==='undefined')return;
  el.innerHTML='';
  const qr=qrcode(0,'M');
  qr.addData(url);
  qr.make();
  el.innerHTML=qr.createSvgTag({cellSize:4,margin:4});
}

$('btn-create').addEventListener('click',()=>{
  myNick=($('nickname-input').value.trim()||'Oyuncu');
  socket.emit('create-room',{nickname:myNick, avatar:myAvatar},(res)=>{
    if(res.success){
      roomCode=res.code;playerIndex=res.playerIndex;sessionToken=res.token;saveSession();
      $('room-code-display').textContent=roomCode;
      $('waiting-section').classList.add('visible');
      $('lobby-error').textContent='';
      // Build invite link
      const url=`${location.origin}${location.pathname}?join=${roomCode}`;
      $('invite-link-input').value=url;
      renderInviteQr(url);
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
  if(code.length!==5){$('lobby-error').textContent=texts[lang].enterCodeError;return}
  myNick=($('nickname-input').value.trim()||'Oyuncu');
  socket.emit('join-room',{code,nickname:myNick, avatar:myAvatar},(res)=>{
    if(res.success){roomCode=res.code;playerIndex=res.playerIndex;sessionToken=res.token;saveSession();$('lobby-error').textContent=''}
    else $('lobby-error').textContent=errText(res.error);
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
    $('lobby-error').textContent=texts[lang].inviteDetected;
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
  // Ship lock-in animation
  for(let i=0;i<size;i++){
    const cx=horiz?x+i:x,cy=horiz?y:y+i;
    const cell=getCell('my-grid',cx,cy);
    if(cell){cell.classList.add('ship-lock');setTimeout(()=>cell.classList.remove('ship-lock'),400)}
  }
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

// ═══ PREMIUM ANIMATIONS ═══
function animateHit(gridId, x, y, isHit){
  const cell=getCell(gridId,x,y);
  if(!cell)return;
  cell.classList.add(isHit?'hit-new':'miss-new');
  setTimeout(()=>{cell.classList.remove('hit-new','miss-new')},250);
}

function animateSinking(gridId, ship){
  const cells=shipCells(ship);
  cells.forEach(([cx,cy],i)=>{
    setTimeout(()=>{
      const cell=getCell(gridId,cx,cy);
      if(!cell)return;
      cell.classList.add('sinking');
      setTimeout(()=>cell.classList.remove('sinking'),300);
    },i*80);
  });
}

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
    if(res.success){shipDock.classList.remove('visible');setStatus(texts[lang].statusWait,false)}
    else setStatus(errText(res.error),false);
  });
});

// ═══ BATTLE ═══
function handleOppGridClick(x,y){
  if(phase!=='battle'||!isMyTurn)return;if(myShots[y][x]!==0)return;
  socket.emit('fire',{x,y},res=>{
    if(!res.success){setStatus(errText(res.error),false);return}
    myShots[y][x]=res.hit?2:1;
    animateHit('opp-grid',x,y,res.hit);
    playSound(res.hit ? (res.sunkShip ? 'sunk' : 'hit') : 'miss');
    if(res.sunkShip){
      sunkOppShips.push(res.sunkShip);
      setTimeout(()=>animateSinking('opp-grid',res.sunkShip),200);
      setStatus(texts[lang].sunkShip,true);updateFleetStatus('opp-fleet',sunkOppShips);
    } else setStatus(res.hit?texts[lang].hitAgain:texts[lang].miss,res.hit);
    if(!res.gameOver){
      isMyTurn=res.currentTurn===playerIndex;
      turnStatus.textContent=isMyTurn?texts[lang].yourTurn:`${opponentNick}${texts[lang].oppTurn}`;
      if(!isMyTurn)setTimeout(()=>setStatus(texts[lang].statusOpp,false),800);
      updateBoardGlow();
    }
    renderOppBoard();applyAdjHints();updateHPBars();
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

// ═══ CHAT UNREAD NOTIFICATION (mobile) ═══
let chatUnread=0;
const chatFab=$('chat-fab'), chatFabBadge=$('chat-fab-badge');
function isChatInView(){
  const r=chatPanel.getBoundingClientRect();
  return r.top<(window.innerHeight||document.documentElement.clientHeight)&&r.bottom>0;
}
function clearChatUnread(){
  chatUnread=0;
  if(chatFab)chatFab.style.display='none';
  if(chatFabBadge)chatFabBadge.textContent='0';
}
function bumpChatUnread(){
  chatUnread++;
  if(chatFabBadge)chatFabBadge.textContent=chatUnread>9?'9+':chatUnread;
  if(chatFab)chatFab.style.display='flex';
}
window.addEventListener('scroll',()=>{ if(chatUnread&&isChatInView())clearChatUnread(); },{passive:true});
if(chatFab)chatFab.addEventListener('click',()=>{
  chatPanel.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(clearChatUnread,400);
});

socket.on('chat-message',data=>{
  const div=document.createElement('div');
  div.className='chat-msg'+(data.playerIndex===playerIndex?' own':'');
  div.innerHTML=`<span class="chat-author">${data.nickname}:</span><span class="chat-text">${escHtml(data.message)}</span>`;
  chatMessages.appendChild(div);chatMessages.scrollTop=chatMessages.scrollHeight;
  if(data.playerIndex!==playerIndex&&!isChatInView())bumpChatUnread();
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
    shipDefs=data.ships;    if(data.players)setPlayerInfo(data.players);
    showScreen('game-screen');buildGrid('my-grid',handleMyGridClick);buildGrid('opp-grid',handleOppGridClick);
    setupBoardInteraction();initPlacement();
    $('room-code-small').textContent=texts[lang].roomLabel + roomCode;
    turnStatus.innerHTML='<img src="logo-icon.png" alt="Logo" style="width:36px; vertical-align:middle;">';
    $('in-game-stats').style.display='none';
    setStatus('',false);
  }
  if(phase==='battle'){
    if(data.players)setPlayerInfo(data.players);
    isMyTurn=data.currentTurn===playerIndex;
    turnStatus.textContent=isMyTurn?texts[lang].yourTurn:`${opponentNick}${texts[lang].oppTurn}`;
    setStatus(isMyTurn?texts[lang].statusFire:texts[lang].statusOpp,isMyTurn);
    shipDock.classList.remove('visible');
    chatPanel.classList.add('visible');
    $('battle-helpers').style.display='flex';
    buildFleetStatus('my-fleet',shipDefs);buildFleetStatus('opp-fleet',shipDefs);
    $('my-fleet').classList.add('visible');$('opp-fleet').classList.add('visible');
    gameStartTime=Date.now();
    // Calculate total ship cells for HP bars
    totalShipCells=0;shipDefs.forEach(s=>totalShipCells+=s.size);
    updateHPBars();
    renderOppBoard();updateBoardGlow();
    if(window.innerWidth<=860)$('mobile-tabs').querySelectorAll('button')[1].click();
  }
});

socket.on('opponent-ready',()=>setStatus(texts[lang].readyOpp,false));

socket.on('opponent-fired',data=>{
  myHitsReceived[data.y][data.x]=data.hit?2:1;
  animateHit('my-grid',data.x,data.y,data.hit);
  playSound(data.hit ? (data.sunkShip ? 'sunk' : 'hit') : 'miss');
  if(data.sunkShip){
    for(const s of placedShips)if(s.x===data.sunkShip.x&&s.y===data.sunkShip.y&&s.size===data.sunkShip.size)s.sunk=true;
    setTimeout(()=>animateSinking('my-grid',data.sunkShip),200);
    setStatus(texts[lang].oppSunk,false);updateFleetStatus('my-fleet',placedShips.filter(s=>s.sunk));
  } else setStatus(data.hit?texts[lang].oppHit:texts[lang].oppMiss,false);
  renderMyBoard();updateHPBars();
  if(!data.gameOver){
    isMyTurn=data.currentTurn===playerIndex;
    turnStatus.textContent=isMyTurn?texts[lang].yourTurn:`${opponentNick}${texts[lang].oppTurn}`;
    if(isMyTurn)setTimeout(()=>setStatus(texts[lang].yourTurn+'!',true),600);
    renderOppBoard();updateBoardGlow();
  }
});

socket.on('game-over',data=>{
  phase='finished';const won=data.winner===playerIndex;
  // Calculate stats
  let hits=0,misses=0;
  for(let r=0;r<B;r++)for(let c=0;c<B;c++){if(myShots[r][c]===2)hits++;else if(myShots[r][c]===1)misses++;}
  const total=hits+misses;
  const accuracy=total>0?Math.round(hits/total*100):0;
  const elapsed=gameStartTime?Math.floor((Date.now()-gameStartTime)/1000):0;
  const mm=Math.floor(elapsed/60),ss=String(elapsed%60).padStart(2,'0');
  $('stat-hits').textContent='0';
  $('stat-misses').textContent='0';
  $('stat-accuracy').textContent='0%';
  $('stat-time').textContent=mm+':'+ss;
  $('ig-stat-hits').textContent='0';
  $('ig-stat-misses').textContent='0';
  $('ig-stat-accuracy').textContent='0%';
  $('ig-stat-time').textContent=mm+':'+ss;
  // Count-up animations
  setTimeout(()=>{
    animateCountUp($('stat-hits'),hits,'');
    animateCountUp($('stat-misses'),misses,'');
    animateCountUp($('stat-accuracy'),accuracy,'%');
    animateCountUp($('ig-stat-hits'),hits,'');
    animateCountUp($('ig-stat-misses'),misses,'');
    animateCountUp($('ig-stat-accuracy'),accuracy,'%');
  },200);
  if (myAvatar.includes('.png')) {
    $('go-icon').innerHTML = `<img src="${myAvatar}" alt="Avatar">`;
  } else {
    $('go-icon').textContent=won?'🏆':'💀';
  }
  $('go-title').textContent=won?texts[lang].win:texts[lang].lose;
  $('go-title').className='game-over-title '+(won?'win':'lose');
  $('go-sub').textContent=won?texts[lang].winSub:texts[lang].loseSub;
  
  // Reveal opponent unhit ships
  if (data.ships) {
    const oppIdx = playerIndex === 0 ? 1 : 0;
    const oppShips = data.ships[oppIdx];
    if (oppShips) {
      for (const s of oppShips) {
        if (!s.sunk) {
          const cells = shipCells(s);
          for (const [cx, cy] of cells) {
            const cell = getCell('opp-grid', cx, cy);
            if (cell && myShots[cy][cx] === 0) cell.classList.add('opp-ship-revealed');
          }
        }
      }
    }
  }

  gameOverOverlay.classList.add('visible');
  setTimeout(()=>{
    gameOverOverlay.classList.remove('visible');
    $('rematch-container').style.display = 'block';
    $('in-game-stats').style.display = 'grid';
  }, 4500);
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
socket.on('opponent-disconnected',()=>{setStatus(texts[lang].oppDisc,false);turnStatus.textContent=texts[lang].discWait});

socket.on('opponent-reconnected',()=>{
  setStatus(texts[lang].oppReconnected,true);
  if(phase==='placement')turnStatus.innerHTML='<img src="logo-icon.png" alt="Logo" style="width:36px; vertical-align:middle;">';
  else if(phase==='battle')turnStatus.textContent=isMyTurn?texts[lang].yourTurn:`${opponentNick}${texts[lang].oppTurn}`;
});

// ═══ RECONNECT / SESSION RESTORE ═══
function attemptRejoin(){
  socket.emit('rejoin-room',sessionToken,res=>{
    if(!res||!res.success){sessionToken=null;clearSession();return}
    roomCode=res.code;playerIndex=res.playerIndex;
    restoreFromRejoin(res);
  });
}

function restoreFromRejoin(res){
  phase=res.phase;
  shipDefs=res.ships;
  if(res.players)setPlayerInfo(res.players);

  if(phase==='waiting'){
    showScreen('lobby-screen');
    $('room-code-display').textContent=roomCode;
    $('waiting-section').classList.add('visible');
    const url=`${location.origin}${location.pathname}?join=${roomCode}`;
    $('invite-link-input').value=url;
    renderInviteQr(url);
    return;
  }

  showScreen('game-screen');
  buildGrid('my-grid',handleMyGridClick);buildGrid('opp-grid',handleOppGridClick);
  setupBoardInteraction();

  resetBoards();
  placedShips=(res.myShips||[]).map(s=>({...s}));
  rebuildMyBoard();
  myShots=res.myShots||myShots;
  myHitsReceived=res.myHitsReceived||myHitsReceived;
  placedShips.forEach(s=>{ s.sunk=shipCells(s).every(([cx,cy])=>myHitsReceived[cy][cx]===2); });
  sunkOppShips.length=0;
  (res.oppSunkShips||[]).forEach(s=>sunkOppShips.push(s));

  $('room-code-small').textContent=texts[lang].roomLabel+roomCode;

  if(phase==='placement'){
    chatPanel.classList.add('visible');
    $('battle-helpers').style.display='none';
    $('my-fleet').classList.remove('visible');$('opp-fleet').classList.remove('visible');
    $('in-game-stats').style.display='none';
    turnStatus.innerHTML='<img src="logo-icon.png" alt="Logo" style="width:36px; vertical-align:middle;">';
    if(res.myReady){
      shipDock.classList.remove('visible');
      setStatus(texts[lang].statusWait,false);
    } else {
      dragHorizontal=true;
      buildDockShips();updateDockMarks();
      shipDock.classList.add('visible');
      btnReady.disabled=true;
      setStatus('',false);
    }
    renderMyBoard();
  } else if(phase==='battle'){
    isMyTurn=res.currentTurn===playerIndex;
    turnStatus.textContent=isMyTurn?texts[lang].yourTurn:`${opponentNick}${texts[lang].oppTurn}`;
    setStatus(isMyTurn?texts[lang].statusFire:texts[lang].statusOpp,isMyTurn);
    shipDock.classList.remove('visible');
    chatPanel.classList.add('visible');
    $('battle-helpers').style.display='flex';
    buildFleetStatus('my-fleet',shipDefs);buildFleetStatus('opp-fleet',shipDefs);
    updateFleetStatus('my-fleet',placedShips.filter(s=>s.sunk));
    updateFleetStatus('opp-fleet',sunkOppShips);
    $('my-fleet').classList.add('visible');$('opp-fleet').classList.add('visible');
    gameStartTime=gameStartTime||Date.now();
    totalShipCells=0;shipDefs.forEach(s=>totalShipCells+=s.size);
    renderMyBoard();renderOppBoard();applyAdjHints();updateHPBars();updateBoardGlow();
    if(window.innerWidth<=860)$('mobile-tabs').querySelectorAll('button')[0].click();
  }
}

socket.on('connect',()=>{
  if(sessionToken){attemptRejoin();return}
  try{
    const raw=sessionStorage.getItem('battleship-session');
    if(raw){
      const s=JSON.parse(raw);
      if(s&&s.token){
        sessionToken=s.token;
        if(s.nickname)myNick=s.nickname;
        if(s.avatar)myAvatar=s.avatar;
        attemptRejoin();
      }
    }
  }catch(e){}
});

function setPlayerInfo(players){
  const renderAvatar = p => p.avatar && p.avatar.includes('.png') ? `<img src="${p.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (p.avatar || p.nickname[0].toUpperCase());
  $('p1-name').textContent=players[0].nickname;$('p1-avatar').innerHTML=renderAvatar(players[0]);
  $('p2-name').textContent=players[1].nickname;$('p2-avatar').innerHTML=renderAvatar(players[1]);
  opponentNick=playerIndex===0?players[1].nickname:players[0].nickname;
}

// ═══ HP BARS ═══
function updateHPBars(){
  if(!totalShipCells)return;
  // My HP = my ship cells not hit
  let myHits=0,oppHits=0;
  for(let r=0;r<B;r++)for(let c=0;c<B;c++){if(myHitsReceived[r][c]===2)myHits++;if(myShots[r][c]===2)oppHits++}
  const myPct=Math.max(0,Math.round((totalShipCells-myHits)/totalShipCells*100));
  const oppPct=Math.max(0,Math.round((totalShipCells-oppHits)/totalShipCells*100));
  const myBar=playerIndex===0?$('p1-hp'):$('p2-hp');
  const oppBar=playerIndex===0?$('p2-hp'):$('p1-hp');
  myBar.style.width=myPct+'%';
  oppBar.style.width=oppPct+'%';
  myBar.className='hp-bar-fill'+(myPct<=20?' danger':myPct<=50?' warning':'');
  oppBar.className='hp-bar-fill'+(oppPct<=20?' danger':oppPct<=50?' warning':'');
}

// ═══ COUNT-UP ANIMATION ═══
function animateCountUp(el,target,suffix){
  suffix=suffix||'';
  const dur=800,steps=30;
  let step=0;
  const isTime=suffix==='' && target.toString().includes(':');
  if(isTime){el.textContent=target;return}
  const num=parseInt(target)||0;
  const interval=setInterval(()=>{
    step++;
    const val=Math.round(num*(step/steps));
    el.textContent=val+suffix;
    if(step>=steps){clearInterval(interval);el.textContent=target+suffix}
  },dur/steps);
}
