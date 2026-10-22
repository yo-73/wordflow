'use strict';
const STORAGE_KEY='wordflow-state-v1'; // stable key: preserve v1-v3 learning records
const DEFAULT_STATE={custom:[],overrides:{},hidden:[],history:[],activeSession:null,ui:{mode:'random',size:20,scope:'all',level:'all'}};
const MODES={
  random:{icon:'⤨',name:'ランダム',desc:'好きな枚数をシャッフル'},
  mistakes:{icon:'↺',name:'間違い復習',desc:'間違いが多い順に優先'},
  idioms:{icon:'✧',name:'熟語集中',desc:'準1級以上の熟語だけ'},
  conversation:{icon:'◉',name:'会話表現',desc:'入試で問われる自然な返答'},
  new:{icon:'◇',name:'未学習',desc:'まだ見たことのない表現'},
  due:{icon:'◷',name:'復習タイミング',desc:'もう一度確認したいカード'}
};
const $=id=>document.getElementById(id);
const isConversation=e=>Array.isArray(e.tags)&&e.tags.includes('会話表現');
const displayType=e=>isConversation(e)?'CONVERSATION / 会話表現':(e.kind==='idiom'?'IDIOM / 熟語':'VOCABULARY / 単語');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey=d=>new Date(d).toLocaleDateString('sv-SE');
let builtin=[],state=loadState(),page='home',reviewTab='active',reviewVisibleLimit=80,libraryFilter='all',libraryQuery='',libraryVisibleLimit=80,lastDrag=0,toastTimeout=0;

function loadState(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(!parsed||typeof parsed!=='object')return structuredClone(DEFAULT_STATE);
    return {
      ...structuredClone(DEFAULT_STATE), ...parsed,
      custom:Array.isArray(parsed.custom)?parsed.custom:[],
      overrides:parsed.overrides&&typeof parsed.overrides==='object'?parsed.overrides:{},
      hidden:Array.isArray(parsed.hidden)?parsed.hidden:[],
      history:Array.isArray(parsed.history)?parsed.history:[],
      activeSession:parsed.activeSession||null,
      ui:{...DEFAULT_STATE.ui,...(parsed.ui||{})}
    };
  }catch(e){console.warn('保存データを読み込めませんでした',e);return structuredClone(DEFAULT_STATE);}
}
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){toast('保存容量の問題で記録を保存できません。バックアップしてください。');console.error(e);}}
// Hide imported copies of now-builtin entries without deleting user data.
// Older imported card IDs are aliased to canonical builtin IDs for review metrics.
function oldImportAliases(){
  const builtinByTerm=new Map(builtin.map(c=>[c.term.trim().toLocaleLowerCase(),c.id]));
  return new Map(state.custom.filter(c=>c&&c.id&&c.term).map(c=>[c.id,builtinByTerm.get(c.term.trim().toLocaleLowerCase())]).filter(([,id])=>id));
}
function allCards({includeHidden=false}={}){
  const seed=builtin.map(c=>state.overrides[c.id]||c);
  const termSet=new Set(seed.map(c=>c.term.trim().toLocaleLowerCase()));
  const uniqueCustom=state.custom.filter(c=>c&&c.term&&!termSet.has(c.term.trim().toLocaleLowerCase()));
  return [...(includeHidden?seed:seed.filter(c=>!state.hidden.includes(c.id))),...uniqueCustom];
}
function getCard(id){
  const canonical=oldImportAliases().get(id)||id;
  return allCards({includeHidden:true}).find(c=>c.id===canonical);
}
function metrics(){
  const map=new Map(),aliases=oldImportAliases();
  for(const h of state.history){
    if(!h||!h.id)continue;
    const id=aliases.get(h.id)||h.id;
    let s=map.get(id);
    if(!s){s={total:0,known:0,missed:0,correctSinceMiss:0,active:false,streak:0,last:0,lastMiss:0,due:0};map.set(id,s);}
    s.total++;s.last=h.at;
    if(h.correct){
      s.known++;s.streak++;
      if(s.active){s.correctSinceMiss++;if(s.correctSinceMiss>=2)s.active=false;}
      const days=[1,3,7,14,30,60][Math.min(s.streak-1,5)];
      s.due=h.at+days*86400000;
    }else{
      s.missed++;s.lastMiss=h.at;s.correctSinceMiss=0;s.active=true;s.streak=0;
      s.due=h.at+12*3600000;
    }
  }
  return map;
}
function activeMisses(){const m=metrics();return allCards().filter(c=>m.get(c.id)?.active).sort((a,b)=>m.get(b.id).lastMiss-m.get(a.id).lastMiss);}
function currentDay(){const d=dateKey(Date.now());const arr=state.history.filter(h=>dateKey(h.at)===d);return {total:arr.length,correct:arr.filter(h=>h.correct).length};}
function studyStreak(){
  const days=new Set(state.history.map(h=>dateKey(h.at)));let cursor=new Date();
  if(!days.has(dateKey(cursor)))cursor.setDate(cursor.getDate()-1);
  let streak=0;
  while(days.has(dateKey(cursor))){streak++;cursor.setDate(cursor.getDate()-1);}return streak;
}
function toast(message){const el=$('toast');if(!el)return;clearTimeout(toastTimeout);el.textContent=message;el.classList.add('visible');toastTimeout=setTimeout(()=>el.classList.remove('visible'),2400);}
function setPage(next){page=next;render();window.scrollTo({top:0,behavior:'instant'});}
function render(){
  const studying=page==='study';
  $('bottomNav').style.display=studying?'none':'';
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===page));
  $('header-note').textContent=studying?'集中する時間。':page==='home'?'通学時間を、積み重ねに。':'小さく続ける、毎日の英語。';
  switch(page){case 'home':$('main').innerHTML=renderHome();break;
    case 'study':$('main').innerHTML=renderStudy();attachSwipe();break;
    case 'review':$('main').innerHTML=renderReview();break;
    case 'library':$('main').innerHTML=renderLibrary();break;
    case 'settings':$('main').innerHTML=renderSettings();break;}
}
const metricNumber=(a,b)=>`<div class="metric"><div class="metric-num">${a}</div><div class="metric-label">${b}</div></div>`;
function renderHome(){
  const today=currentDay(),count=activeMisses().length;
  const all=allCards();
  return `<div class="hero"><div class="eyebrow">YOUR DAILY VOCABULARY</div><h1>通学の20枚が、<br>英語力を変える。</h1><p class="desc">タップで意味を確認。左にスワイプで「まだ」、右にスワイプで「覚えた」。</p></div>
  <div class="metrics">${metricNumber(today.total,'今日の学習')}${metricNumber(count,'復習待ち')}${metricNumber(studyStreak()+'日','連続学習')}</div>
  ${state.activeSession&&state.activeSession.index<state.activeSession.ids.length?`<div class="hint-box">中断した学習があります（${state.activeSession.index}/${state.activeSession.ids.length}枚）<button data-action="resume" class="plain-btn">再開する →</button></div>`:''}
  <div class="section-title"><h2>今日の学び方</h2><span class="side">モードを選択</span></div>
  <div class="mode-grid">${Object.entries(MODES).map(([id,m])=>`<button class="mode-card ${state.ui.mode===id?'selected':''}" data-mode="${id}"><div class="mode-top">${m.icon}</div><div class="mode-name">${m.name}</div><div class="mode-description">${m.desc}</div></button>`).join('')}</div>
  <div class="section-title"><h2>出題設定</h2><span class="side">${all.length}項目を収録</span></div>
  <div class="config-card">
    <div class="form-group"><span class="form-label">1回の出題数</span><div class="pill-group">${[10,20,30,50].map(n=>`<button data-size="${n}" class="pill ${Number(state.ui.size)===n?'selected':''}">${n}問</button>`).join('')}</div></div>
    <div class="form-group"><span class="form-label">出題する種類</span><div class="pill-group">${[['all','すべて'],['word','英単語'],['idiom','熟語'],['conversation','会話表現']].map(([v,t])=>`<button data-scope="${v}" class="pill ${state.ui.scope===v?'selected':''}">${t}</button>`).join('')}</div></div>
    <div class="form-group"><label class="form-label" for="levelSelection">難易度の目安</label><select id="levelSelection" data-setting="level" class="select"><option value="all" ${state.ui.level==='all'?'selected':''}>すべて</option><option value="準1級" ${state.ui.level==='準1級'?'selected':''}>英検準1級目安</option><option value="1級初歩" ${state.ui.level==='1級初歩'?'selected':''}>英検1級初歩目安</option><option value="入試会話" ${state.ui.level==='入試会話'?'selected':''}>大学入試・会話表現</option></select></div>
    <p class="small subtle mt-18">「熟語集中」は準1級以上の熟語のみ、「会話表現」は入試で問われる口語表現のみを出題します。難易度は学習用の目安です。</p>
    <button class="primary-btn mt-18" data-action="start">${esc(MODES[state.ui.mode]?.name||'ランダム')}を${state.ui.size}問スタート <span>→</span></button>
  </div>
  <p class="tiny subtle" style="padding:15px 2px 0">すべての学習履歴はこの端末内に保存されます。定期的なバックアップをおすすめします。</p>`;
}
function poolFor(mode){
  const entries=allCards();const stat=metrics();
  let candidates;
  if(mode==='conversation')candidates=entries.filter(isConversation);
  else if(mode==='idioms')candidates=entries.filter(e=>e.kind==='idiom'&&!isConversation(e)&&(state.ui.level==='all'||e.level===state.ui.level));
  else {
    candidates=entries.filter(e=>state.ui.level==='all'||e.level===state.ui.level);
    if(state.ui.scope==='conversation')candidates=candidates.filter(isConversation);
    else if(state.ui.scope==='idiom')candidates=candidates.filter(e=>e.kind==='idiom'&&!isConversation(e));
    else if(state.ui.scope!=='all')candidates=candidates.filter(e=>e.kind===state.ui.scope);
  }
  if(mode==='mistakes')candidates=candidates.filter(e=>stat.get(e.id)?.active);
  if(mode==='new')candidates=candidates.filter(e=>!stat.has(e.id));
  if(mode==='due')candidates=candidates.filter(e=>stat.has(e.id)&&stat.get(e.id).due<=Date.now());
  return candidates;
}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
function startSession(mode=state.ui.mode){
  const pool=poolFor(mode);
  if(!pool.length){toast(mode==='mistakes'?'復習する単語はありません':'この条件に合う単語がありません。設定を変更してください。');return;}
  if(state.activeSession&&state.activeSession.index<state.activeSession.ids.length){if(!confirm('途中の学習を終了して、新しい学習を始めますか？'))return;}
  // In targeted modes, prefer high-priority cards instead of reshuffling everything.
  const stat=metrics();
  const ordered=(mode==='mistakes')?pool.slice().sort((a,b)=>{
    const x=stat.get(a.id),y=stat.get(b.id);
    const score=t=>(t?.missed||0)*5-(t?.correctSinceMiss||0)*2+(t?.due<=Date.now()?3:0);
    return score(y)-score(x)||(x?.lastMiss||0)-(y?.lastMiss||0);
  }):(mode==='due')?pool.slice().sort((a,b)=>(stat.get(a.id)?.due||0)-(stat.get(b.id)?.due||0)):shuffle(pool.slice());
  state.activeSession={ids:ordered.slice(0,Number(state.ui.size)||20).map(c=>c.id),index:0,answers:[],mode,startedAt:Date.now(),flipped:false};
  save();setPage('study');
}
function renderStudy(){
  const session=state.activeSession;
  if(!session)return `<div class="empty"><p>学習がまだ開始されていません。</p><button class="primary-btn" data-action="end">ホームへ戻る</button></div>`;
  if(session.index>=session.ids.length)return renderResult(session);
  const entry=getCard(session.ids[session.index]);
  if(!entry){session.index++;save();return renderStudy();}
  const pct=Math.round(session.index/session.ids.length*100);
  return `<div class="study-top"><button class="back-btn" data-action="pause">← 中断して戻る</button><span class="status-pill">${esc(MODES[session.mode]?.name||'学習中')}</span></div>
    <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="progress-label"><span>${session.index+1} / ${session.ids.length} 枚目</span><span>${pct}%</span></div>
    <div class="flash-zone"><div class="flashcard" id="flashCard" tabindex="0" role="button" aria-label="英単語カード。タップして意味を表示。左右にスワイプして判定します。">
      <span id="stampLeft" class="swipe-float left">まだ覚えてない</span><span id="stampRight" class="swipe-float right">覚えた！</span>
      <div class="flash-body">${session.flipped?cardBack(entry):`<span class="card-type">${displayType(entry)}</span><div class="term ${entry.term.length>13?'long':''}">${esc(entry.term)}</div><div class="tap-hint">TAP TO REVEAL · タップで意味を見る</div>`}</div>
    </div></div>
    <div class="gesture-guide"><span class="gesture-side bad">← まだ覚えてない</span><span class="gesture-small">SWIPE</span><span class="gesture-side good">覚えた！ →</span></div>
    <div class="study-helper"><button class="plain-btn" data-action="undo" ${session.answers.length?'':'disabled'}>↶ 直前の判定を取り消す</button></div>
    <p class="tiny subtle" style="text-align:center;margin-top:11px">まずタップで答えを表示。その後、左＝まだ／右＝覚えたで判定。キーボードは左右キー。</p>`;
}
function cardBack(entry){
  return `<div class="card-back"><div class="card-type">${displayType(entry)} ・ ${esc(entry.level||'未分類')}</div>
  <div class="term ${entry.term.length>14?'long':''}">${esc(entry.term)}</div>
  <div class="reveal-heading">品詞と意味</div>
  ${(entry.senses||[]).map(s=>`<div class="sense"><span class="pos">${esc(s.pos||entry.pos||'—')}</span>${esc(s.meaning)}</div>`).join('')}
  ${(entry.patterns||[]).length?`<div class="reveal-heading">よく使う形</div>${entry.patterns.map(p=>`<div class="pattern">${esc(p)}</div>`).join('')}`:''}
  ${entry.example?`<div class="reveal-heading">例文</div><p class="example">${esc(entry.example)}</p><p class="translation">${esc(entry.translation)}</p>`:''}
  ${entry.extraExamples?.length?entry.extraExamples.map(e=>`<p class="example extra-example">${esc(e.en)}</p><p class="translation">${esc(e.ja)}</p>`).join(''):''}
  ${entry.note?`<div class="reveal-heading">語法・ニュアンス</div><p class="translation">${esc(entry.note)}</p>`:''}
  </div>`;
}
function attachSwipe(){
  const el=$('flashCard');if(!el)return;
  let start=null,dragged=false,grading=false;
  el.addEventListener('pointerdown',ev=>{
    if(ev.button!==0||grading)return;
    start={x:ev.clientX,y:ev.clientY,id:ev.pointerId};dragged=false;
  });
  el.addEventListener('pointermove',ev=>{
    if(!start||ev.pointerId!==start.id||grading)return;
    const dx=ev.clientX-start.x,dy=ev.clientY-start.y;
    if(Math.abs(dx)<7)return;
    if(Math.abs(dy)>Math.abs(dx)*1.3&&!dragged)return;
    if(!dragged){try{el.setPointerCapture(ev.pointerId);}catch(e){/* unsupported */}}dragged=true;el.classList.add('dragging');
    el.style.transform=`translateX(${Math.max(-170,Math.min(170,dx))}px) rotate(${dx*.042}deg)`;
    $('stampLeft').style.opacity=dx<0?Math.min(1,Math.abs(dx)/100):0;
    $('stampRight').style.opacity=dx>0?Math.min(1,Math.abs(dx)/100):0;
  });
  el.addEventListener('pointerup',ev=>{
    if(!start||ev.pointerId!==start.id)return;
    const dx=ev.clientX-start.x,dy=ev.clientY-start.y;start=null;
    if(Math.abs(dx)>=85&&Math.abs(dx)>Math.abs(dy)*1.1){
      // Reveal before rating, to avoid accidental marks and enforce the study workflow.
      if(!state.activeSession?.flipped){
        el.classList.remove('dragging');el.style.transform='';
        $('stampLeft').style.opacity=0;$('stampRight').style.opacity=0;
        lastDrag=Date.now();toast('カードをタップして、意味と例文を確認してください');return;
      }
      grading=true;lastDrag=Date.now();el.classList.remove('dragging');el.classList.add(dx<0?'out-left':'out-right');
      setTimeout(()=>grade(dx>0),185);
    }else{
      el.classList.remove('dragging');el.style.transform='';$('stampLeft').style.opacity=0;$('stampRight').style.opacity=0;
      if(dragged)lastDrag=Date.now();
    }
  });
  el.addEventListener('pointercancel',()=>{start=null;el.classList.remove('dragging');el.style.transform='';});
  el.addEventListener('click',()=>{
    if(Date.now()-lastDrag<300||grading)return;
    const s=state.activeSession;if(!s||s.index>=s.ids.length)return;
    s.flipped=!s.flipped;save();render();
  });
}
function grade(correct){
  const s=state.activeSession;if(!s||s.index>=s.ids.length)return;
  if(!s.flipped){toast('先にタップして答えを確認してください');return;}
  const id=s.ids[s.index],eventId=`h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const event={uid:eventId,id,correct,at:Date.now()};state.history.push(event);
  s.answers.push(eventId);s.index++;s.flipped=false;save();render();
  if(!correct&&s.index<s.ids.length)toast('復習リストに自動で追加しました');
}
function undo(){
  const s=state.activeSession;if(!s||!s.answers.length){toast('取り消せる判定はありません');return;}
  const uid=s.answers.pop();state.history=state.history.filter(h=>h.uid!==uid);s.index=Math.max(0,s.index-1);s.flipped=true;save();render();toast('直前の判定を取り消しました');
}
function renderResult(s){
  const byId=new Set(s.answers),events=state.history.filter(h=>byId.has(h.uid));
  const ok=events.filter(h=>h.correct).length,ng=events.length-ok;
  const pct=events.length?Math.round(ok/events.length*100):0;
  return `<div class="result-illustration">✦</div><div class="eyebrow" style="text-align:center">SESSION COMPLETE</div><h1 style="text-align:center;margin:10px 0">今日の学習、おつかれさま！</h1><div class="result-score">${pct}<span style="font-size:26px">%</span></div><div class="score-label">覚えていた割合</div>
  <div class="result-grid"><div class="result-cell"><strong style="color:var(--accent)">${ok}</strong><span>覚えた</span></div><div class="result-cell"><strong style="color:var(--pink)">${ng}</strong><span>まだ覚えてない</span></div></div>
  <p class="small subtle mb-20">「まだ覚えてない」と判定したカードは自動的に復習リストへ入ります。その後、右スワイプを2回続けると復習待ちから卒業します。</p>
  <button class="primary-btn" data-action="end">ホームに戻る →</button><button class="secondary-btn mt-18" style="width:100%" data-action="undo" ${s.answers.length?'':'disabled'}>最後の1枚をやり直す</button>`;
}
function reviewList(){const m=metrics();return allCards().filter(c=>m.get(c.id)?.missed).sort((a,b)=>m.get(b.id).lastMiss-m.get(a.id).lastMiss);}
function renderReview(){
  const total=activeMisses().length,seen=reviewList(),list=reviewTab==='active'?activeMisses():reviewTab==='graduated'?seen.filter(e=>!metrics().get(e.id)?.active):seen;
  return `<div class="eyebrow">REVIEW LIBRARY</div><h1 style="margin:6px 0 10px">間違えた単語を、<br>自分の力に。</h1><p class="small subtle">左スワイプしたカードは自動登録。その後、右スワイプを2回続けると「克服済み」になります。</p>
  <div class="metrics" style="grid-template-columns:1fr 1fr">${metricNumber(total,'復習待ち')}${metricNumber(seen.length-total,'克服済み')}</div>
  <div class="tabs">${[['active','復習待ち'],['graduated','克服済み'],['all','間違えた履歴']].map(([id,label])=>`<button class="tab ${reviewTab===id?'active':''}" data-review-tab="${id}">${label}</button>`).join('')}</div>
  ${reviewTab==='active'&&total?`<button class="primary-btn mb-20" data-action="start-review">復習を始める（最大${Math.min(total,Number(state.ui.size)||20)}問） →</button>`:''}
  <div class="list-head"><h3>${reviewTab==='active'?'復習待ちのカード':reviewTab==='graduated'?'克服済み':'間違えたことがあるカード'}</h3><span class="list-count">${Math.min(list.length,reviewVisibleLimit)} / ${list.length} 件</span></div>
  ${list.length?`<div class="entry-list">${list.slice(0,reviewVisibleLimit).map(c=>entryRow(c)).join('')}</div>${list.length>reviewVisibleLimit?`<button class="secondary-btn mt-18" style="width:100%" data-action="more-review">さらに表示（残り${list.length-reviewVisibleLimit}件）</button>`:''}`:`<div class="empty"><div class="illustration">${reviewTab==='active'?'✦':'⌁'}</div><h3>ここにはまだカードがありません</h3><p>${reviewTab==='active'?'すべて覚えられています。ランダム学習を続けましょう。':'学習を重ねると履歴が表示されます。'}</p><button class="secondary-btn" data-action="go-home">ホームへ</button></div>`}`;
}
function entryRow(c){const meaning=c.senses?.map(s=>s.meaning).join('／')||'';return `<button class="entry-item" data-detail="${esc(c.id)}"><span style="min-width:0"><span class="entry-name">${esc(c.term)}</span> <span class="tag ${c.kind==='idiom'?'green':''}">${isConversation(c)?'会話':(c.kind==='idiom'?'熟語':'単語')}</span><div class="entry-meaning">${esc(meaning)}</div></span><span class="entry-right">›</span></button>`;}
function renderLibrary(){const entries=allCards();return `<div class="eyebrow">YOUR VOCABULARY</div><h1 style="margin:6px 0 10px">自分だけの単語帳。</h1><p class="small subtle mb-20">収録単語や熟語を検索・追加・編集できます。追加した単語もそのまま出題に使われます。</p>
  <div class="metrics" style="grid-template-columns:1fr 1fr">${metricNumber(entries.length,'登録された表現')}${metricNumber(entries.filter(c=>c.kind==='idiom'&&!isConversation(c)).length,'熟語・句動詞')}</div>
  <div class="section-title"><h2>登録リスト</h2><button class="plain-btn" data-action="add-entry">＋ 単語を追加</button></div>
  <input id="librarySearch" type="search" class="input search-input" placeholder="英語・訳から検索" autocomplete="off" value="${esc(libraryQuery)}" aria-label="単語を検索">
  <div class="tabs">${[['all','すべて'],['word','単語'],['idiom','熟語'],['conversation','会話'],['custom','自分で追加']].map(([id,label])=>`<button class="tab ${libraryFilter===id?'active':''}" data-library-filter="${id}">${label}</button>`).join('')}</div>
  <div id="libraryList"></div>`;}
function renderLibraryList(){
  const el=$('libraryList');if(!el)return;
  const q=libraryQuery.toLocaleLowerCase().trim();
  const list=allCards().filter(c=>(libraryFilter==='all'||(libraryFilter==='custom'?c.id.startsWith('u-'):libraryFilter==='conversation'?isConversation(c):(c.kind===libraryFilter&&(libraryFilter!=='idiom'||!isConversation(c)))))&&(!q||[c.term,c.pos,c.senses?.map(s=>s.meaning).join(' '),...c.patterns].join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>a.term.localeCompare(b.term,'en'));
  const visible=list.slice(0,libraryVisibleLimit);
  el.innerHTML=`<div class="list-head"><span class="small subtle">検索結果</span><span class="list-count">${list.length} 件中 ${visible.length} 件表示</span></div>${list.length?`<div class="entry-list">${visible.map(entryRow).join('')}</div>${visible.length<list.length?`<button class="secondary-btn mt-18" style="width:100%" data-action="more-entries">さらに表示（残り${list.length-visible.length}件）</button>`:''}`:`<div class="empty"><p>条件に合うカードがありません。</p><button class="secondary-btn" data-action="add-entry">新しく追加する</button></div>`}`;
}
function renderSettings(){
  return `<div class="eyebrow">SETTINGS & DATA</div><h1 style="margin:6px 0 10px">設定・データ管理。</h1><p class="small subtle mb-20">単語や学習の記録を自分で管理できます。</p>
  <div class="section-title"><h2>データの追加・移行</h2></div>
  <div class="settings-group">
    <button class="settings-button" data-action="add-entry"><span><strong>＋ 単語・熟語を追加</strong><span>意味・品詞・よく使う形・例文を入力</span></span><span class="arrow">›</span></button>
    <button class="settings-button" data-action="import"><span><strong>⇥ 単語データを取り込む</strong><span>JSON / CSV を読み込んで登録・更新</span></span><span class="arrow">›</span></button>
    <button class="settings-button" data-action="example"><span><strong>↓ CSVテンプレートを保存</strong><span>ChatGPTに追加データを作ってもらうときにも便利</span></span><span class="arrow">›</span></button>
  </div>
  <div class="section-title"><h2>バックアップ</h2></div>
  <div class="settings-group">
    <button class="settings-button" data-action="backup"><span><strong>↓ 全データをバックアップ</strong><span>学習履歴・追加単語・編集内容をJSON保存</span></span><span class="arrow">›</span></button>
    <button class="settings-button" data-action="restore"><span><strong>↑ バックアップを復元</strong><span>保存したバックアップからこの端末に復元</span></span><span class="arrow">›</span></button>
  </div>
  <div class="section-title"><h2>学習ルール</h2></div>
  <div class="panel"><p class="small"><strong>答えを見て左にスワイプ：</strong> 復習待ちに追加</p><p class="small" style="margin-top:5px"><strong>答えを見て右にスワイプ：</strong> 覚えたと記録</p><p class="small" style="margin-top:5px"><strong>その後2回連続正解：</strong> 復習待ちから卒業</p><p class="small" style="margin-top:5px"><strong>復習タイミング：</strong> 間違い後約12時間、正解後1・3・7・14・30日…を目安に再出題</p></div>
  <div class="section-title"><h2>その他</h2></div>
  <div class="settings-group">
    ${state.hidden.length?`<button class="settings-button" data-action="unhide"><span><strong>非表示の標準単語を戻す</strong><span>${state.hidden.length} 件を再表示</span></span><span class="arrow">›</span></button>`:''}
    <button class="settings-button" data-action="clear-history"><span><strong class="danger">学習履歴だけを削除</strong><span>単語データは残ります</span></span><span class="arrow">›</span></button>
  </div>
  <div class="backup-note">このバージョンはクラウド同期していません。アプリの削除やSafariのサイトデータ削除などで記録が失われることがあります。バックアップを定期的に保存してください。</div>
  <p class="version">WordFlow v4.0 ・1,500項目収録 ・データは端末内に保存・追加課金なし</p>
  <input id="importFile" type="file" accept=".json,.csv,application/json,text/csv" hidden>
  <input id="restoreFile" type="file" accept=".json,application/json" hidden>`;
}
function detailDialog(id){
  const c=getCard(id);if(!c)return;
  const isCustom=c.id.startsWith('u-');
  showDialog(`<div class="dialog-head"><h3>単語の詳細</h3><button class="close-x" data-action="close-dialog" aria-label="閉じる">×</button></div><div class="dialog-content"><div class="detail-term">${esc(c.term)}</div><div class="tiny subtle">${isConversation(c)?'会話表現':(c.kind==='idiom'?'熟語':'英単語')} ・ ${esc(c.level)}</div>
    ${cardBack(c)}<div class="dialog-actions"><button class="secondary-btn" data-action="edit-entry" data-entry-id="${esc(c.id)}">編集</button><button class="secondary-btn" data-action="remove-entry" data-entry-id="${esc(c.id)}">${isCustom?'削除':'非表示'}</button></div></div>`);
}
function showDialog(html){
  let old=$('appDialog');if(old)old.remove();
  const d=document.createElement('dialog');d.id='appDialog';d.innerHTML=html;document.body.appendChild(d);
  d.addEventListener('click',ev=>{if(ev.target===d)d.close();});
  d.addEventListener('close',()=>d.remove());d.showModal();
}
function closeDialog(){const d=$('appDialog');if(d)d.close();}
function addEditDialog(id=null){
  const c=id?getCard(id):null;
  const means=c?.senses?.map(s=>`${s.pos}：${s.meaning}`).join('; ')||'';
  showDialog(`<div class="dialog-head"><h3>${c?'単語を編集':'単語・熟語を追加'}</h3><button class="close-x" data-action="close-dialog" aria-label="閉じる">×</button></div>
  <div class="dialog-content"><form id="entryForm" data-id="${esc(id||'')}">
    <div class="form-group"><label class="form-label">英語の見出し語 *</label><input class="input" name="term" required maxlength="100" value="${esc(c?.term||'')}" placeholder="例：impose"></div>
    <div class="two-cols form-group"><div><label class="form-label">種類</label><select class="select" name="kind"><option value="word" ${c?.kind==='idiom'?'':'selected'}>英単語</option><option value="idiom" ${c?.kind==='idiom'?'selected':''}>熟語・句動詞</option></select></div><div><label class="form-label">難易度</label><select class="select" name="level"><option ${c?.level==='準1級'?'selected':''}>準1級</option><option ${c?.level==='1級初歩'?'selected':''}>1級初歩</option><option ${c?.level==='入試会話'?'selected':''}>入試会話</option><option ${c?.level==='その他'?'selected':''}>その他</option></select></div></div>
    <div class="form-group"><label class="form-label">品詞（自・他・自他・名・形・副・熟など）</label><input class="input" name="pos" required value="${esc(c?.pos||'他')}" placeholder="他"></div>
    <div class="form-group"><label class="form-label">日本語の意味 *</label><textarea class="textarea" name="meanings" required placeholder="課す／押し付ける">${esc(means)}</textarea><div class="form-help">複数品詞なら「自：〜; 他：〜」のように入力できます。</div></div>
    <div class="form-group"><label class="form-label">よく使う形</label><input class="input" name="patterns" value="${esc(c?.patterns?.join('; ')||'')}" placeholder="impose A on B"><div class="form-help">複数あるときは「; 」で区切ります。</div></div>
    <div class="form-group"><label class="form-label">英語の例文 *</label><textarea class="textarea" name="example" required placeholder="The government imposed a tax on imports.">${esc(c?.example||'')}</textarea></div>
    <div class="form-group"><label class="form-label">例文の日本語訳 *</label><textarea class="textarea" name="translation" required placeholder="政府は輸入品に税を課した。">${esc(c?.translation||'')}</textarea></div>
    <div class="form-group"><label class="form-label">自分用メモ（任意）</label><textarea class="textarea" name="note">${esc(c?.note||'')}</textarea></div>
    <div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close-dialog">キャンセル</button><button class="primary-btn" type="submit">保存する →</button></div>
  </form></div>`);
}
function createSenses(pos,raw){
  const input=String(raw||'').trim();if(!input)throw new Error('日本語の意味を入力してください');
  if(input.includes('：')){
    const parts=input.split(/;\s*/).map(s=>s.trim()).filter(Boolean);
    if(parts.every(p=>p.includes('：')))return parts.map(p=>{const i=p.indexOf('：');return {pos:p.slice(0,i).trim(),meaning:p.slice(i+1).trim()};});
  }
  return [{pos:pos||'熟',meaning:input.replace(/^(?:自|他|自他|名|形|副|熟)：/,'')}];
}
function cleanEntry(v,id){
  const term=String(v.term||'').trim();if(!term)throw new Error('英語の見出し語がありません');
  const pos=String(v.pos||'熟');
  let senses;
  if(Array.isArray(v.senses)&&v.senses.length)senses=v.senses.map(x=>({pos:String(x.pos||pos).trim(),meaning:String(x.meaning||'').trim()}));
  else senses=createSenses(pos,v.meanings||v.meaning||'');
  if(senses.some(s=>!s.meaning))throw new Error(`${term}: 意味が空です`);
  const patterns=Array.isArray(v.patterns)?v.patterns.map(String):String(v.patterns||v.pattern||'').split(/;\s*/).map(s=>s.trim()).filter(Boolean);
  const extraExamples=Array.isArray(v.extraExamples)?v.extraExamples.filter(x=>x&&x.en&&x.ja).map(x=>({en:String(x.en),ja:String(x.ja)})):[];
  return {id,term,kind:v.kind==='idiom'?'idiom':'word',level:['準1級','1級初歩','入試会話','その他'].includes(v.level)?v.level:'その他',pos,senses,patterns,example:String(v.example||'').trim(),translation:String(v.translation||'').trim(),extraExamples,tags:Array.isArray(v.tags)?v.tags.map(String):(typeof v.tags==='string'&&v.tags.trim()?v.tags.split(/[;,、]/).map(x=>x.trim()).filter(Boolean):['追加']),note:String(v.note||'')};
}
function saveEntry(form){
  const fd=new FormData(form),obj=Object.fromEntries(fd.entries()),id=form.dataset.id;
  const existing=id?getCard(id):null;
  const card=cleanEntry(obj,id||`u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`);
  if(existing?.extraExamples?.length)card.extraExamples=existing.extraExamples;
  if(!card.example||!card.translation)throw new Error('例文と日本語訳を入力してください');
  if(!existing){
    const same=allCards({includeHidden:true}).find(c=>c.term.toLowerCase()===card.term.toLowerCase());
    if(same)throw new Error(`「${card.term}」は既に登録されています。編集から更新してください。`);
    state.custom.push(card);
  }else if(existing.id.startsWith('u-')){
    state.custom=state.custom.map(x=>x.id===id?card:x);
  }else{state.overrides[id]=card;}
  save();closeDialog();render();toast(existing?'カードを更新しました':'新しいカードを登録しました');
}
function removeEntry(id){const c=getCard(id);if(!c)return;
  if(!confirm(c.id.startsWith('u-')?`「${c.term}」を削除しますか？（学習履歴は残ります）`:`標準カード「${c.term}」を非表示にしますか？（設定から復元できます）`))return;
  if(c.id.startsWith('u-'))state.custom=state.custom.filter(e=>e.id!==id);
  else if(!state.hidden.includes(id))state.hidden.push(id);
  save();closeDialog();render();toast('単語帳を更新しました');
}
function downloadBlob(filename,body,type='application/json;charset=utf-8'){
  const blob=new Blob([body],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function downloadBackup(){downloadBlob(`wordflow-backup-${dateKey(Date.now())}.json`,JSON.stringify({app:'WordFlow',version:1,exportedAt:new Date().toISOString(),state},null,2));toast('バックアップをダウンロードしました');}
function downloadTemplate(){
  const header='term,kind,level,pos,meanings,patterns,example,translation,tags';
  const ex='"impose","word","準1級","他","課す／押し付ける","impose A on B","The government imposed a tax on imports.","政府は輸入品に税を課した。","社会"';
  downloadBlob('wordflow-import-template.csv','\uFEFF'+header+'\r\n'+ex+'\r\n','text/csv;charset=utf-8');toast('CSVテンプレートを保存しました');
}
function parseCSV(csv){
  const rows=[],cur=[];let field='',quoted=false;
  for(let i=0;i<csv.length;i++){
    const c=csv[i];if(c==='"'){
      if(quoted&&csv[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
    }else if(c===','&&!quoted){cur.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;cur.push(field);field='';if(cur.some(Boolean))rows.push(cur.slice());cur.length=0;}
    else field+=c;
  }
  if(quoted)throw new Error('CSVの引用符が閉じていません');cur.push(field);if(cur.some(Boolean))rows.push(cur);
  if(!rows.length)throw new Error('CSVが空です');
  const head=rows.shift().map(s=>s.trim().replace(/^\uFEFF/,''));
  if(!head.includes('term')||!head.includes('meanings'))throw new Error('CSVには term と meanings の列が必要です');
  return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]||''])));
}
function importEntries(entries){
  if(!Array.isArray(entries)||!entries.length)throw new Error('追加するデータがありません');
  if(entries.length>10000)throw new Error('一度に取り込めるのは1万件までです');
  const nextCustom=state.custom.slice(),nextOverrides={...state.overrides};let added=0,updated=0;
  for(const input of entries){
    if(!input||typeof input!=='object')throw new Error('正しいカードデータではありません');
    const term=String(input.term||'').trim();
    const existing=[...builtin.map(c=>nextOverrides[c.id]||c),...nextCustom].find(c=>c.term.toLowerCase()===term.toLowerCase());
    const id=existing?.id||`u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,11)}`;
    const item=cleanEntry(input,id);
    if(!item.example||!item.translation)throw new Error(`${item.term}: 例文と訳が必要です`);
    if(existing){updated++;if(id.startsWith('u-'))nextCustom.splice(nextCustom.findIndex(c=>c.id===id),1,item);else nextOverrides[id]=item;}
    else{added++;nextCustom.push(item);}
  }
  state.custom=nextCustom;state.overrides=nextOverrides;save();render();toast(`${added}件追加・${updated}件更新しました`);
}
async function readDataFile(file,type){
  if(!file)return;
  try{
    if(file.size>5*1024*1024)throw new Error('ファイルサイズは5MB以下にしてください');
    const raw=(await file.text()).replace(/^\uFEFF/,'');
    if(type==='restore'){
      const payload=JSON.parse(raw);
      if(payload.app!=='WordFlow'||!payload.state||!Array.isArray(payload.state.history)||!Array.isArray(payload.state.custom))throw new Error('WordFlowのバックアップではありません');
      if(!confirm('現在の端末の学習履歴・追加単語をバックアップの内容に置き換えます。よろしいですか？'))return;
      state={...structuredClone(DEFAULT_STATE),...payload.state,ui:{...DEFAULT_STATE.ui,...(payload.state.ui||{})}};save();setPage('home');toast('バックアップから復元しました');return;
    }
    const entries=file.name.toLowerCase().endsWith('.csv')?parseCSV(raw):JSON.parse(raw);
    if(entries?.app==='WordFlow'&&entries?.state)throw new Error('バックアップファイルは「バックアップを復元」から読み込んでください');
    importEntries(Array.isArray(entries)?entries:entries.entries);
  }catch(e){alert('読み込みに失敗しました。\n'+e.message);}finally{const el=type==='restore'?$('restoreFile'):$('importFile');if(el)el.value='';}
}
function resetHistory(){if(!confirm('すべての学習履歴・復習記録を削除します。元に戻せません。バックアップを取っていますか？'))return;state.history=[];state.activeSession=null;save();render();toast('学習履歴を削除しました');}
function handleAction(el){const action=el.dataset.action;
  switch(action){
    case 'start':startSession();break;
    case 'more-entries':libraryVisibleLimit+=80;renderLibraryList();break;
    case 'more-review':reviewVisibleLimit+=80;render();break;
    case 'resume':setPage('study');break;
    case 'pause':setPage('home');break;
    case 'undo':undo();break;
    case 'end':state.activeSession=null;save();setPage('home');break;
    case 'go-home':setPage('home');break;
    case 'start-review':startSession('mistakes');break;
    case 'add-entry':addEditDialog();break;
    case 'close-dialog':closeDialog();break;
    case 'edit-entry':{const id=el.dataset.entryId;closeDialog();addEditDialog(id);break;}
    case 'remove-entry':removeEntry(el.dataset.entryId);break;
    case 'backup':downloadBackup();break;
    case 'restore':$('restoreFile')?.click();break;
    case 'import':$('importFile')?.click();break;
    case 'example':downloadTemplate();break;
    case 'clear-history':resetHistory();break;
    case 'unhide':state.hidden=[];save();render();toast('標準カードを再表示しました');break;
  }
}
document.addEventListener('click',ev=>{
  const nav=ev.target.closest('[data-nav]');if(nav){setPage(nav.dataset.nav);return;}
  const mode=ev.target.closest('[data-mode]');if(mode){state.ui.mode=mode.dataset.mode;save();render();return;}
  const size=ev.target.closest('[data-size]');if(size){state.ui.size=Number(size.dataset.size);save();render();return;}
  const scope=ev.target.closest('[data-scope]');if(scope){state.ui.scope=scope.dataset.scope;save();render();return;}
  const tab=ev.target.closest('[data-review-tab]');if(tab){reviewTab=tab.dataset.reviewTab;reviewVisibleLimit=80;render();return;}
  const filt=ev.target.closest('[data-library-filter]');if(filt){libraryFilter=filt.dataset.libraryFilter;libraryVisibleLimit=80;render();return;}
  const detail=ev.target.closest('[data-detail]');if(detail){detailDialog(detail.dataset.detail);return;}
  const action=ev.target.closest('[data-action]');if(action)handleAction(action);
});
document.addEventListener('change',ev=>{
  if(ev.target.matches('[data-setting="level"]')){state.ui.level=ev.target.value;save();render();}
  if(ev.target.id==='importFile')readDataFile(ev.target.files[0],'import');
  if(ev.target.id==='restoreFile')readDataFile(ev.target.files[0],'restore');
});
document.addEventListener('input',ev=>{
  if(ev.target.id==='librarySearch'){libraryQuery=ev.target.value;libraryVisibleLimit=80;renderLibraryList();}
});
document.addEventListener('submit',ev=>{
  if(ev.target.id==='entryForm'){
    ev.preventDefault();try{saveEntry(ev.target);}catch(e){alert(e.message);}
  }
});
document.addEventListener('keydown',ev=>{
  if(page!=='study'||document.querySelector('dialog[open]'))return;
  if(ev.key==='ArrowLeft'){ev.preventDefault();grade(false);}
  else if(ev.key==='ArrowRight'){ev.preventDefault();grade(true);}
  else if(ev.code==='Space'&&ev.target.tagName!=='BUTTON'){
    ev.preventDefault();const s=state.activeSession;if(s&&s.index<s.ids.length){s.flipped=!s.flipped;save();render();}
  }
});
async function init(){
  try{
    const resp=await fetch('./cards.json',{cache:'no-cache'});
    if(!resp.ok)throw new Error('単語データの読み込みに失敗しました: '+resp.status);
    builtin=await resp.json();if(!Array.isArray(builtin)||!builtin.length)throw new Error('単語データが空です');
    render();if(page==='library')renderLibraryList();
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }catch(e){$('main').innerHTML=`<div class="empty"><h3>単語データを読み込めませんでした</h3><p>${esc(e.message)}<br>このPWAはHTTPSのWebサイトとして公開するか、ローカルサーバーから開いてください。</p></div>`;}
}
const oldRender=render;
render=function(){oldRender();if(page==='library')renderLibraryList();};
init();
