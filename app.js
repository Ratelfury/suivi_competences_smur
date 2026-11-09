'use strict';
/* Dossier de compétences : données stockées uniquement sur l'appareil
   (localStorage pour les saisies, IndexedDB pour les justificatifs). */
const KEY = 'dossier-competences.v1';
const APP = 'dossier-competences';
const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const RESULTS = ['Apte','Apte avec restrictions','Inapte temporairement','Inapte'];
const DEFAULT_ITEMS = [
  {id:'visite-annuelle', label:'Visite médicale annuelle', mode:'visit', months:12, r1:60, r2:15},
  {id:'audiometrie', label:'Audiométrie', mode:'visit', months:36, r1:90, r2:30},
  {id:'visite-chauffeur', label:'Visite médicale chauffeur et test oculaire', mode:'visit', months:60, r1:120, r2:60},
  {id:'permis', label:'Permis de conduire (conduite rémunérée)', mode:'validity', months:0, r1:120, r2:60, cats:true},
  {id:'agrement', label:'Agrément SPF', mode:'validity', months:0, r1:180, r2:90}
];

/* ---------- Dates ---------- */
const pad = n => String(n).padStart(2,'0');
const iso = (y,m,d) => `${y}-${pad(m)}-${pad(d)}`;
const todayISO = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth()+1, t.getDate()); };
const parts = s => s.split('-').map(Number);
const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const daysIn = (y,m) => new Date(y,m,0).getDate();
const shiftDay = (s,n) => { const [y,m,d] = parts(s); const t = new Date(y,m-1,d+n); return iso(t.getFullYear(),t.getMonth()+1,t.getDate()); };
function addMonths(s, n){ const [y,m,d] = parts(s); const t = new Date(y, m-1+n, 1); const ty = t.getFullYear(), tm = t.getMonth()+1; return iso(ty, tm, Math.min(d, daysIn(ty,tm))); }
const addYears = (s,n) => addMonths(s, 12*n);
const utc = s => { const [y,m,d] = parts(s); return Date.UTC(y,m-1,d); };
const diffDays = (a,b) => Math.round((utc(b)-utc(a))/86400000);
const frDate = s => { if (!s) return ''; const [y,m,d] = parts(s); return `${pad(d)}/${pad(m)}/${y}`; };
const longDate = s => { const [y,m,d] = parts(s); return `${d} ${MONTHS[m-1]} ${y}`; };
const plural = (n,one,many) => Math.abs(n) > 1 ? many : one;
function inDays(n){
  if (n === 0) return 'aujourd’hui';
  if (n > 0) return n === 1 ? 'demain' : `dans ${n} jours`;
  return `dépassée depuis ${-n} ${plural(-n,'jour','jours')}`;
}
function periodLabel(months){
  if (!months) return '';
  if (months % 12 === 0) { const y = months/12; return `${y} ${plural(y,'an','ans')}`; }
  return `${months} mois`;
}

/* ---------- Heures ---------- */
function parseHours(v){
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g,'');
  if (!s) return null;
  let m = s.match(/^(\d{1,3})(?:h|:)(\d{1,2})?(?:min|m)?$/);
  if (m) { const mm = Number(m[2] || 0); return mm < 60 ? Number(m[1]) + mm/60 : null; }
  m = s.match(/^(\d{1,3})(?:[.,](\d{1,2}))?h?$/);
  if (m) return Number(`${m[1]}.${m[2]||0}`);
  return null;
}
const round2 = n => Math.round(n*100)/100;
function fmtH(n){
  n = round2(n || 0);
  const h = Math.floor(n + 1e-9), mn = Math.round((n - h)*60);
  if (mn === 60) return `${h+1} h`;
  return mn ? `${h} h ${pad(mn)}` : `${h} h`;
}
const hoursInput = n => n === undefined || n === null ? '' : String(round2(n)).replace('.',',');

/* ---------- Stockage ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
function blankItem(def){
  return {id:def.id, label:def.label, mode:def.mode, months:def.months, r1:def.r1, r2:def.r2, number:'', cats:'', hasCats:!!def.cats, builtIn:true, entries:[]};
}
function blank(){
  return {settings:{name:'', profession:'Infirmier', inami:'', minYear:15, min4y:60, trainR:90, theme:'light'},
    trainings:[], items:DEFAULT_ITEMS.map(blankItem), lastBackup:null};
}
const str = (v, max) => typeof v === 'string' ? v.slice(0,max) : '';
const intIn = (v, min, max, def) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };
const fileIds = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.length < 40).slice(0,20) : [];
function sanitizeTraining(t){
  if (!t || typeof t !== 'object' || !isISO(t.date)) return null;
  const hours = Number(t.hours);
  if (!(hours > 0 && hours <= 999)) return null;
  const title = str(t.title,200).trim(); if (!title) return null;
  return {id:str(t.id,40)||uid(), date:t.date, title, org:str(t.org,200).trim(), hours:round2(hours), theme:str(t.theme,100).trim(),
    place:str(t.place,200).trim(), cert:t.cert === true, note:str(t.note,2000), files:fileIds(t.files)};
}
function sanitizeEntry(e){
  if (!e || typeof e !== 'object' || !isISO(e.date)) return null;
  return {id:str(e.id,40)||uid(), date:e.date, issued:isISO(e.issued)?e.issued:'', result:RESULTS.includes(e.result)?e.result:'',
    restr:str(e.restr,500), who:str(e.who,200), note:str(e.note,2000), files:fileIds(e.files)};
}
function sanitizeItem(x){
  if (!x || typeof x !== 'object' || !str(x.label,120).trim()) return null;
  return {id:str(x.id,40)||uid(), label:str(x.label,120).trim(), mode:x.mode==='validity'?'validity':'visit',
    months:intIn(x.months,0,240,12), r1:intIn(x.r1,0,730,60), r2:intIn(x.r2,0,730,0), number:str(x.number,80), cats:str(x.cats,80),
    hasCats:x.hasCats===true, builtIn:x.builtIn===true, entries:(Array.isArray(x.entries)?x.entries:[]).map(sanitizeEntry).filter(Boolean)};
}
function sanitize(o){
  if (!o || typeof o !== 'object') return null;
  const out = blank();
  const st = o.settings || {};
  out.settings.name = str(st.name,100);
  out.settings.profession = typeof st.profession === 'string' ? st.profession.slice(0,80) : 'Infirmier';
  out.settings.inami = str(st.inami,40);
  out.settings.minYear = intIn(st.minYear,0,200,15);
  out.settings.min4y = intIn(st.min4y,0,800,60);
  out.settings.trainR = intIn(st.trainR,0,365,90);
  if (['dark','light','auto'].includes(st.theme)) out.settings.theme = st.theme;
  out.trainings = (Array.isArray(o.trainings)?o.trainings:[]).map(sanitizeTraining).filter(Boolean);
  if (Array.isArray(o.items)) out.items = o.items.map(sanitizeItem).filter(Boolean);
  if (typeof o.lastBackup === 'string') out.lastBackup = o.lastBackup;
  return out;
}
function load(){
  try { const raw = localStorage.getItem(KEY); if (raw) return sanitize(JSON.parse(raw)) || blank(); }
  catch(e){ /* stockage indisponible : on démarre vide et save() préviendra */ }
  return blank();
}
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(S)); askPersist(); return true; }
  catch(e){ toast('Enregistrement impossible : le stockage de Chrome est bloqué ou plein.'); return false; }
}
let S = load();

/* ---------- Justificatifs (IndexedDB) ---------- */
let dbP = null;
function db(){
  if (!dbP) dbP = new Promise((res, rej) => {
    const r = indexedDB.open(APP, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', {keyPath:'id'});
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbP;
}
async function idb(mode, fn){
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('files', mode); const st = tx.objectStore('files');
    const req = fn(st); tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
const fileGet = id => idb('readonly', st => st.get(id));
const filePut = rec => idb('readwrite', st => st.put(rec));
const fileDel = id => idb('readwrite', st => st.delete(id));
const fileAll = () => idb('readonly', st => st.getAll());
const fileClear = () => idb('readwrite', st => st.clear());
const fileMeta = {}; // id -> nom, pour l'affichage
async function loadFileNames(){
  try { for (const f of await fileAll()) fileMeta[f.id] = f.name; } catch(e){}
}
function allFileRefs(extra){
  const set = new Set(extra || []);
  for (const t of S.trainings) t.files.forEach(f => set.add(f));
  for (const it of S.items) for (const e of it.entries) e.files.forEach(f => set.add(f));
  return set;
}
async function gcFiles(keep){
  try {
    const refs = allFileRefs(keep);
    const d = await db();
    const keys = await new Promise((res, rej) => { const r = d.transaction('files').objectStore('files').getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const k of keys) if (!refs.has(k)) { await fileDel(k); delete fileMeta[k]; }
  } catch(e){}
}
async function shrinkImage(file){
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type) || file.size < 400000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width*k); c.height = Math.round(bmp.height*k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch(e){ return file; }
}
async function addFile(file){
  if (file.size > 20e6) { toast('Fichier trop lourd (plus de 20 Mo).'); return null; }
  const blob = await shrinkImage(file);
  const name = blob === file ? file.name : file.name.replace(/\.[^.]+$/,'') + '.jpg';
  const rec = {id:uid(), name:name.slice(0,120), type:blob.type || file.type || 'application/octet-stream', blob};
  try { await filePut(rec); fileMeta[rec.id] = rec.name; askPersist(); return rec.id; }
  catch(e){ toast('Le justificatif n’a pas pu être enregistré (stockage plein ?).'); return null; }
}
async function openFile(id){
  const f = await fileGet(id).catch(() => null);
  if (!f) { toast('Justificatif introuvable sur ce téléphone.'); return; }
  const url = URL.createObjectURL(f.blob);
  const d = $('dialog');
  const close = () => { d.close(); URL.revokeObjectURL(url); };
  d.replaceChildren(
    h('h2',null,f.name),
    f.type.startsWith('image/') ? h('img',{src:url,alt:f.name}) : h('p',{class:'muted small sp'},'Document PDF ou autre : utiliser « Partager » pour l’ouvrir dans une autre application, ou le télécharger.'),
    navigator.canShare ? h('button',{class:'btn',async onclick(){ const r = await shareFile(f.blob,f.name); if (!r) download(f.blob,f.name); }},'Partager') : null,
    h('button',{class:'btn',onclick(){ download(f.blob,f.name); }},'Télécharger'),
    h('button',{class:'btn primary',onclick:close},'Fermer'));
  d.oncancel = () => URL.revokeObjectURL(url);
  d.showModal();
}

/* ---------- Calculs ---------- */
const doneTrainings = (today = todayISO()) => S.trainings.filter(t => t.date <= today);
function yearTotal(y, today = todayISO()){
  return round2(doneTrainings(today).filter(t => t.date.startsWith(y + '-')).reduce((a,t) => a + t.hours, 0));
}
function window4(today = todayISO()){
  const start = shiftDay(addYears(today,-4), 1);
  const list = doneTrainings(today).filter(t => t.date >= start).sort((a,b) => a.date < b.date ? -1 : 1);
  const total = round2(list.reduce((a,t) => a + t.hours, 0));
  const min = S.settings.min4y;
  let drop = null; // date à laquelle le total passera sous le minimum, sans nouvelle formation
  if (total >= min && min > 0) {
    let left = total;
    for (const t of list) { left = round2(left - t.hours); if (left < min) { drop = shiftDay(addYears(t.date,4),0); break; } }
  }
  let st, label;
  if (total < min) { st = 'bad'; label = 'Insuffisant'; }
  else if (drop && diffDays(today, drop) <= S.settings.trainR) { st = 'warn'; label = 'À compléter'; }
  else { st = 'ok'; label = 'En ordre'; }
  return {start, end:today, total, min, drop, st, label};
}
function yearStatus(y, today = todayISO()){
  const total = yearTotal(y, today), min = S.settings.minYear, cy = parts(today)[0];
  if (total >= min) return {total, st:'ok', label:'En ordre'};
  if (y < cy) return {total, st:'bad', label:'Insuffisant'};
  if (y > cy) return {total, st:'info', label:'À venir'};
  const left = diffDays(today, iso(y,12,31));
  if (left <= S.settings.trainR) return {total, st:'warn', label:'À compléter'};
  return {total, st:'info', label:'En cours'};
}
function yearsShown(today = todayISO()){
  const cy = parts(today)[0];
  const ys = new Set([cy, cy-1, cy-2, cy-3, cy-4]);
  S.trainings.forEach(t => ys.add(parts(t.date)[0]));
  return [...ys].filter(y => y <= cy || S.trainings.some(t => t.date.startsWith(y+'-'))).sort((a,b) => b-a);
}
const lastEntry = it => it.entries.reduce((a,e) => !a || e.date > a.date ? e : a, null);
function itemEnd(it, e = lastEntry(it)){
  if (!e) return null;
  return it.mode === 'validity' ? e.date : (it.months ? addMonths(e.date, it.months) : null);
}
function itemStatus(it, today = todayISO()){
  const e = lastEntry(it), end = itemEnd(it, e);
  if (!e) return {st:'none', label:'À encoder', e:null, end:null, days:null};
  if (!end) return {st:'none', label:'Sans échéance', e, end:null, days:null};
  const days = diffDays(today, end);
  if (days < 0) return {st:'bad', label:'Échéance dépassée', e, end, days};
  if (it.r2 && days <= it.r2) return {st:'warn', label:'Rappel urgent', e, end, days, urgent:true};
  if (days <= it.r1) return {st:'warn', label:'Rappel', e, end, days};
  return {st:'ok', label:'Valide', e, end, days};
}
function alerts(today = todayISO()){
  const out = [];
  for (const it of S.items) { const s = itemStatus(it, today); if (s.st === 'bad' || s.st === 'warn') out.push({name:it.label, st:s.st, text:`${s.label} : ${frDate(s.end)} (${inDays(s.days)})`, go:() => openSub({type:'item', id:it.id})}); }
  const cy = parts(today)[0], ys = yearStatus(cy, today), w = window4(today);
  if (ys.st === 'warn') out.push({name:`Formation ${cy}`, st:'warn', text:`${fmtH(ys.total)} sur ${S.settings.minYear} h, il reste ${fmtH(S.settings.minYear - ys.total)} avant le 31/12`, go:() => go('formations')});
  if (w.st !== 'ok') out.push({name:'Formation sur 4 ans', st:w.st, text:w.st==='bad' ? `${fmtH(w.total)} sur ${w.min} h` : `passera sous ${w.min} h le ${frDate(w.drop)}`, go:() => go('formations')});
  return out.sort((a,b) => (a.st==='bad'?0:1) - (b.st==='bad'?0:1));
}

/* ---------- Interface : outils ---------- */
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
let toastTimer;
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4500);
}
function confirmBox(text, yes, no = 'Annuler'){
  return new Promise(res => {
    const d = $('dialog'); d.replaceChildren(
      h('p',null,text),
      h('div',{class:'row'},
        h('button',{class:'btn',onclick(){d.close();res(false);}},no),
        h('button',{class:'btn primary',onclick(){d.close();res(true);}},yes)));
    d.oncancel = () => res(false);
    d.showModal();
  });
}
function applyTheme(){
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#1A2226' : '#F4F6F8';
}
let persistAsked = false;
function askPersist(){
  if (persistAsked) return; persistAsked = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
const chip = (st, label) => h('span',{class:`chip st-${st}`},label);
function choiceBtn(pressed, label, onclick){ return h('button',{class:'choice','aria-pressed':String(!!pressed),type:'button',onclick},label); }
function field(label, input, hint){
  const id = 'f' + Math.random().toString(36).slice(2,8); input.id = id;
  return [h('label',{class:'lab',for:id},label), input, hint ? h('p',{class:'hint'},hint) : null];
}
const inputEl = (attrs) => h('input',Object.assign({class:'field',autocomplete:'off'},attrs));

/* ---------- Navigation ---------- */
const TABS = [['accueil','Accueil'],['formations','Formations'],['echeances','Échéances'],['export','Export'],['reglages','Réglages']];
let tab = 'accueil';
let subs = []; // pile des sous-écrans (fiche, formulaire)
let ignorePop = 0;
let installEvent = null;
const sub = () => subs[subs.length-1] || null;
function go(t){
  const n = subs.length; subs = []; tab = t;
  if (n) { ignorePop++; history.go(-n); }
  render(); window.scrollTo(0,0);
}
function openSub(v){ subs.push(v); history.pushState({sub:subs.length},''); render(); window.scrollTo(0,0); }
function closeSub(){ if (subs.length) history.back(); }
addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; return; }
  if (subs.length) { subs.pop(); render(); window.scrollTo(0,0); }
  gcFiles(subs.flatMap(s => s.draft && s.draft.files ? s.draft.files : [])); // justificatifs d'un formulaire abandonné
});
function render(){
  const s = sub();
  const v = s ? {training:viewTrainingForm, item:viewItem, entry:viewEntryForm, newItem:viewNewItem}[s.type](s)
    : {accueil:viewHome, formations:viewTrainings, echeances:viewItems, export:viewExport, reglages:viewSettings}[tab]();
  $('main').replaceChildren(...[v].flat(Infinity).filter(Boolean));
  const al = alerts();
  const worst = al.some(a => a.st==='bad') ? 'bad' : al.length ? 'warn' : null;
  $('tabs').replaceChildren(...TABS.map(([k,l]) =>
    h('button',{'aria-current':k===tab?'page':null,onclick(){go(k);}},l,
      k==='accueil' && worst ? h('span',{class:`dot st-${worst}`,'aria-label':`${al.length} ${plural(al.length,'alerte','alertes')}`}) : null)));
}
const subHead = title => h('div',{class:'subhead'},h('button',{class:'back','aria-label':'Retour',onclick:closeSub},'‹'),h('h1',null,title));

/* ---------- Écran Accueil ---------- */
function backupDue(){
  if (!S.trainings.length && !S.items.some(i => i.entries.length)) return false;
  if (!S.lastBackup) return true;
  return diffDays(S.lastBackup.slice(0,10), todayISO()) > 30;
}
function backupNotice(){
  if (!backupDue()) return null;
  return h('div',{class:'notice small'},S.lastBackup?'Plus d’un mois sans sauvegarde.':'Aucune sauvegarde créée pour l’instant.',
    h('br'),h('button',{onclick(){go('export');}},'Créer une sauvegarde'));
}
function trainingCard(){
  const today = todayISO(), cy = parts(today)[0], ys = yearStatus(cy), w = window4();
  const minY = S.settings.minYear;
  const pct = (v,m) => m ? Math.min(100, Math.round(v/m*100)) : 100;
  const y4 = yearsShown().filter(y => y <= cy).slice(0,4);
  return h('section',{class:'card'},
    h('div',{class:'cardtop'},h('h2',null,'Formation permanente')),
    h('div',{class:`meter st-${ys.st}`},
      h('div',{class:'lbl'},h('span',null,`Année ${cy}`),chip(ys.st,ys.label)),
      h('div',{class:'lbl sp'},h('b',null,`${fmtH(ys.total)} / ${minY} h`),
        h('span',{class:'muted small'},ys.total >= minY ? 'minimum atteint' : `encore ${fmtH(minY - ys.total)} d’ici le 31/12`)),
      h('div',{class:'bar'},h('i',{style:`width:${pct(ys.total,minY)}%`}))),
    h('div',{class:`meter st-${w.st}`},
      h('div',{class:'lbl'},h('span',null,'4 dernières années'),chip(w.st,w.label)),
      h('div',{class:'lbl sp'},h('b',null,`${fmtH(w.total)} / ${w.min} h`),h('span',{class:'muted small'},`du ${frDate(w.start)} au ${frDate(w.end)}`)),
      h('div',{class:'bar'},h('i',{style:`width:${pct(w.total,w.min)}%`})),
      h('p',{class:'muted small sp'}, w.total < w.min ? `Il manque ${fmtH(w.min - w.total)} sur la période.`
        : w.drop ? `Sans nouvelle formation, le total passera sous ${w.min} h le ${frDate(w.drop)}.` : '')),
    h('div',{class:'years'},y4.map(y => { const s = yearStatus(y); return h('div',{class:`st-${s.st}`},h('b',null,String(y)),fmtH(s.total)); })),
    h('button',{class:'btn primary',onclick(){ openSub({type:'training', id:null}); }},'+ Ajouter une formation'));
}
function itemCard(it){
  const s = itemStatus(it);
  const lines = [];
  if (s.end) lines.push(h('p',{class:'big'},frDate(s.end)), h('p',{class:'small'},`Échéance ${inDays(s.days)}`));
  else lines.push(h('p',{class:'small sp'},it.mode==='validity' ? 'Encoder la date de fin de validité.' : 'Encoder la date de la dernière visite.'));
  const extra = [it.number ? `N° ${it.number}` : '', it.hasCats && it.cats ? `Cat. ${it.cats}` : ''].filter(Boolean).join(' · ');
  if (extra) lines.push(h('p',{class:'small muted sp'},extra));
  return h('button',{class:`card stcard st-${s.st}`,onclick(){ openSub({type:'item', id:it.id}); }},
    h('div',{class:'cardtop'},h('h3',null,it.label),chip(s.st,s.label)), lines);
}
function viewHome(){
  const al = alerts(), st = S.settings;
  return [
    h('header',{class:'apphead'},h('h1',null,'Mon dossier'),
      h('p',{class:'small muted'},st.name || h('button',{class:'linkbtn',onclick(){go('reglages');}},'Indiquer mon nom'),
        st.name && st.profession ? h('br') : null, st.name ? st.profession : null)),
    al.length ? h('div',{class:`notice alert st-${al.some(a=>a.st==='bad')?'bad':'warn'}`},
      h('b',null,`${al.length} ${plural(al.length,'point demande','points demandent')} votre attention`),
      h('ul',{class:'alerts'},al.map(a => h('li',{class:`st-${a.st}`},h('button',{onclick:a.go},h('b',null,a.name),h('br'),a.text))))) : null,
    backupNotice(),
    trainingCard(),
    h('p',{class:'section-title'},'Visites et validités'),
    S.items.map(itemCard)
  ];
}

/* ---------- Formations ---------- */
function viewTrainings(){
  const today = todayISO(), w = window4();
  const byYear = {};
  for (const t of S.trainings) (byYear[parts(t.date)[0]] = byYear[parts(t.date)[0]] || []).push(t);
  const years = Object.keys(byYear).map(Number).sort((a,b) => b-a);
  return [
    h('h1',null,'Formations'),
    h('div',{class:`card stcard st-${w.st}`},
      h('div',{class:'cardtop'},h('h3',null,'4 dernières années'),chip(w.st,w.label)),
      h('p',{class:'big'},`${fmtH(w.total)} / ${w.min} h`),
      h('p',{class:'small'},`Du ${frDate(w.start)} au ${frDate(w.end)}`)),
    h('div',{class:'years'},yearsShown().filter(y => y <= parts(today)[0]).slice(0,4).map(y => { const s = yearStatus(y); return h('div',{class:`st-${s.st}`},h('b',null,String(y)),fmtH(s.total),h('br'),s.label); })),
    h('button',{class:'btn primary',onclick(){ openSub({type:'training', id:null}); }},'+ Ajouter une formation'),
    years.length ? years.map(y => {
      const list = byYear[y].slice().sort((a,b) => a.date < b.date ? 1 : -1);
      const s = yearStatus(y);
      return [h('div',{class:'yearhead'},h('h2',null,String(y)),h('span',null,h('b',null,fmtH(s.total)),' ',chip(s.st,s.label))),
        h('div',{class:'list'},list.map(t => {
          const planned = t.date > today;
          return h('button',{class:'item',onclick(){ openSub({type:'training', id:t.id}); }},
            h('span',{class:'t'},t.title),
            h('span',{class:'r'},fmtH(t.hours)),
            h('span',{class:'m'},[frDate(t.date), t.org].filter(Boolean).join(' · ')),
            h('span',{class:'m2'},planned ? 'Prévue' : t.cert ? 'Attestation ✓' : 'Sans attestation', t.files.length ? ' 📎' : ''));
        }))];
    }) : h('p',{class:'empty',style:'margin-top:16px'},'Aucune formation encodée pour l’instant.')
  ];
}
function filesBlock(draft){
  const list = h('div',{class:'files'},draft.files.map(id => h('div',{class:'file'},
    h('span',null,fileMeta[id] || 'Justificatif'),
    h('button',{type:'button',onclick(){ openFile(id); }},'Voir'),
    h('button',{type:'button',async onclick(){ if (await confirmBox('Retirer ce justificatif ?','Retirer')) { draft.files = draft.files.filter(f => f !== id); render(); } }},'Retirer'))));
  return [h('p',{class:'lab'},'Justificatifs ',h('small',null,'(photo ou PDF de l’attestation)')), list,
    h('label',{class:'btn filebtn'},'+ Joindre un fichier',h('input',{type:'file',accept:'image/*,application/pdf','aria-label':'Joindre un justificatif',async onchange(e){
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const id = await addFile(f); if (id) { draft.files.push(id); const y = window.scrollY; render(); window.scrollTo(0,y); toast('Justificatif ajouté. Penser à enregistrer.'); }
    }}))];
}
function themesUsed(){ return [...new Set(S.trainings.map(t => t.theme).filter(Boolean))].sort((a,b) => a.localeCompare(b,'fr')); }
function viewTrainingForm(s){
  if (!s.draft) {
    const t = s.id ? S.trainings.find(x => x.id === s.id) : null;
    s.draft = t ? JSON.parse(JSON.stringify(t)) : {id:null, date:todayISO(), title:'', org:'', hours:null, theme:'', place:'', cert:false, note:'', files:[]};
    s.hoursText = hoursInput(s.draft.hours);
  }
  const d = s.draft;
  const err = h('p',{class:'err'}); err.hidden = true;
  const hoursHint = h('p',{class:'hint'});
  const showHours = () => { const n = parseHours(s.hoursText); hoursHint.textContent = s.hoursText ? (n ? `= ${fmtH(n)}` : 'Format non reconnu : par exemple 3, 7,5 ou 7h30.') : 'Par exemple 3, 7,5 ou 7h30.'; };
  showHours();
  const dl = h('datalist',{id:'themes'},themesUsed().map(t => h('option',{value:t})));
  const certSw = h('button',{class:'switchrow',type:'button',role:'switch','aria-checked':String(d.cert),onclick(e){ d.cert = !d.cert; e.currentTarget.setAttribute('aria-checked',String(d.cert)); }},
    h('span',{class:'lab',style:'margin:0'},'Attestation reçue'),h('span',{class:'switch'}));
  async function submit(){
    const n = parseHours(s.hoursText);
    const msg = !isISO(d.date) ? 'Indiquer la date.' : !d.title.trim() ? 'Indiquer l’intitulé.' : !(n > 0 && n <= 999) ? 'Indiquer un nombre d’heures valide.' : '';
    if (msg) { err.textContent = msg; err.hidden = false; err.scrollIntoView({block:'center'}); return; }
    d.hours = n;
    const clean = sanitizeTraining(Object.assign({}, d, {id:d.id || uid()}));
    const i = S.trainings.findIndex(x => x.id === clean.id);
    if (i >= 0) S.trainings[i] = clean; else S.trainings.push(clean);
    if (save()) { toast(i >= 0 ? 'Formation mise à jour.' : `Formation ajoutée : ${fmtH(clean.hours)}.`); closeSub(); gcFiles(); }
  }
  return [subHead(s.id ? 'Modifier la formation' : 'Nouvelle formation'),
    field('Date', inputEl({type:'date',value:d.date,onchange(e){ d.date = e.target.value; }}), 'Une date future compte comme formation prévue, pas encore dans les totaux.'),
    field('Intitulé', inputEl({value:d.title,maxlength:'200',oninput(e){ d.title = e.target.value; }})),
    field('Nombre d’heures', inputEl({inputmode:'decimal',value:s.hoursText,oninput(e){ s.hoursText = e.target.value; showHours(); }})), hoursHint,
    field('Organisme', inputEl({value:d.org,maxlength:'200',oninput(e){ d.org = e.target.value; }})),
    field('Thème', inputEl({value:d.theme,maxlength:'100',list:'themes',oninput(e){ d.theme = e.target.value; }}), 'Facultatif. Les thèmes déjà utilisés sont proposés.'), dl,
    field('Lieu', inputEl({value:d.place,maxlength:'200',oninput(e){ d.place = e.target.value; }})),
    certSw,
    filesBlock(d),
    field('Remarque', h('textarea',{class:'field',maxlength:'2000',value:d.note,oninput(e){ d.note = e.target.value; }})),
    err,
    h('button',{class:'btn primary',onclick:submit},'Enregistrer'),
    s.id ? h('button',{class:'btn danger',async onclick(){
      if (!(await confirmBox('Supprimer cette formation et ses justificatifs ?','Supprimer'))) return;
      S.trainings = S.trainings.filter(x => x.id !== s.id); if (save()) { toast('Formation supprimée.'); closeSub(); gcFiles(); }
    }},'Supprimer') : null];
}

/* ---------- Échéances ---------- */
function viewItems(){
  return [h('h1',null,'Échéances'),
    h('p',{class:'muted small',style:'margin-bottom:12px'},'Vert : valide. Jaune : dans la période de rappel. Rouge : échéance dépassée. Touchez un élément pour encoder une date ou régler ses rappels.'),
    S.items.map(itemCard),
    h('button',{class:'btn',onclick(){ openSub({type:'newItem'}); }},'+ Ajouter un autre suivi')];
}
const findItem = id => S.items.find(i => i.id === id);
function numSetting(label, value, unit, onset, hint){
  return field(label, inputEl({inputmode:'numeric',value:String(value),oninput(e){
    const v = e.target.value.replace(/[^0-9]/g,'').slice(0,3); e.target.value = v; onset(v === '' ? 0 : Number(v));
  }}), hint || unit);
}
function viewItem(s){
  const it = findItem(s.id);
  if (!it) return [subHead('Élément introuvable')];
  const st = itemStatus(it);
  const entries = it.entries.slice().sort((a,b) => a.date < b.date ? 1 : -1);
  const saveQuiet = () => { save(); const box = document.getElementById('statusbox'); if (box) box.replaceWith(statusBox()); };
  function statusBox(){
    const x = itemStatus(it);
    const rem = x.end ? [it.r1 ? `Rappel le ${frDate(shiftDay(x.end,-it.r1))}` : '', it.r2 ? `rappel urgent le ${frDate(shiftDay(x.end,-it.r2))}` : ''].filter(Boolean).join(', ') : '';
    return h('div',{id:'statusbox',class:`card stcard st-${x.st}`},
      h('div',{class:'cardtop'},h('h3',null,'Échéance'),chip(x.st,x.label)),
      x.end ? [h('p',{class:'big'},longDate(x.end)),h('p',{class:'small'},inDays(x.days).replace(/^./,c => c.toUpperCase())),
        rem ? h('p',{class:'small muted sp'},rem + '.') : null]
        : h('p',{class:'small sp'},'Aucune date encodée.'));
  }
  const modeLabel = it.mode === 'validity' ? 'Encoder une nouvelle date de validité' : 'Encoder une nouvelle visite';
  return [subHead(it.label),
    statusBox(),
    h('button',{class:'btn primary',onclick(){ openSub({type:'entry', itemId:it.id, id:null}); }},modeLabel),
    st.end ? h('button',{class:'btn',onclick(){ calendarDialog(it); }},'Ajouter les rappels à mon agenda') : null,
    h('p',{class:'section-title'},'Historique'),
    entries.length ? h('div',{class:'list'},entries.map(e => h('button',{class:'item',onclick(){ openSub({type:'entry', itemId:it.id, id:e.id}); }},
      h('span',{class:'t'},(it.mode==='validity' ? 'Valide jusqu’au ' : 'Visite du ') + frDate(e.date)),
      h('span',{class:'r'},e.result ? chip(e.result==='Apte'?'ok':e.result==='Apte avec restrictions'?'warn':'bad', e.result) : ''),
      h('span',{class:'m'},[it.mode==='visit' && itemEnd(it,e) ? `Échéance ${frDate(itemEnd(it,e))}` : '', e.who].filter(Boolean).join(' · ')),
      h('span',{class:'m2'},e.files.length ? '📎' : ''))))
      : h('p',{class:'empty'},'Rien d’encodé pour l’instant.'),
    h('p',{class:'section-title'},'Réglages de ce suivi'),
    field('Nom', inputEl({value:it.label,maxlength:'120',oninput(e){ if (e.target.value.trim()) { it.label = e.target.value.trim(); save(); } }})),
    h('p',{class:'lab'},'Date encodée'),
    h('div',{class:'choices'},
      choiceBtn(it.mode==='visit','Date de visite',() => { it.mode = 'visit'; if (!it.months) it.months = 12; save(); render(); }),
      choiceBtn(it.mode==='validity','Fin de validité',() => { it.mode = 'validity'; save(); render(); })),
    h('p',{class:'hint'},it.mode==='visit' ? 'L’échéance est calculée : date de la visite + périodicité.' : 'La date encodée est directement l’échéance (date de fin de validité).'),
    it.mode==='visit' ? numSetting('Périodicité (en mois)', it.months, '', v => { it.months = Math.min(v,240); saveQuiet(); const p = document.getElementById('perhint'); if (p) p.textContent = `= ${periodLabel(it.months) || 'aucune'}. 12 = 1 an, 36 = 3 ans, 60 = 5 ans.`; }) : null,
    it.mode==='visit' ? h('p',{class:'hint',id:'perhint'},`= ${periodLabel(it.months) || 'aucune'}. 12 = 1 an, 36 = 3 ans, 60 = 5 ans.`) : null,
    h('div',{class:'two'},
      h('div',null,numSetting('Rappel', it.r1, '', v => { it.r1 = Math.min(v,730); saveQuiet(); }, 'jours avant l’échéance')),
      h('div',null,numSetting('Rappel urgent', it.r2, '', v => { it.r2 = Math.min(v,730); saveQuiet(); }, 'jours avant (0 = aucun)'))),
    field(it.id==='agrement' ? 'Numéro d’agrément' : 'Numéro / référence', inputEl({value:it.number,maxlength:'80',oninput(e){ it.number = e.target.value; save(); }}), 'Facultatif.'),
    it.hasCats ? field('Catégories du permis', inputEl({value:it.cats,maxlength:'80',placeholder:'Par exemple B, C1, D1',oninput(e){ it.cats = e.target.value; save(); }})) : null,
    h('button',{class:'btn danger',style:'margin-top:24px',async onclick(){
      if (!(await confirmBox(`Supprimer « ${it.label} » et tout son historique ?`,'Supprimer'))) return;
      S.items = S.items.filter(x => x.id !== it.id); if (save()) { toast('Suivi supprimé.'); closeSub(); gcFiles(); }
    }},'Supprimer ce suivi')];
}
function viewNewItem(s){
  s.draft = s.draft || {label:'', mode:'visit', months:12, r1:60, r2:0};
  const d = s.draft;
  const err = h('p',{class:'err'}); err.hidden = true;
  return [subHead('Nouveau suivi'),
    h('p',{class:'muted small'},'Par exemple : vaccin hépatite B, recyclage secourisme, carte de légitimation…'),
    field('Nom', inputEl({value:d.label,maxlength:'120',oninput(e){ d.label = e.target.value; }})),
    h('p',{class:'lab'},'Date encodée'),
    h('div',{class:'choices'},
      choiceBtn(d.mode==='visit','Date de visite',() => { d.mode = 'visit'; render(); }),
      choiceBtn(d.mode==='validity','Fin de validité',() => { d.mode = 'validity'; render(); })),
    d.mode==='visit' ? numSetting('Périodicité (en mois)', d.months, '', v => { d.months = Math.min(v,240); }, '12 = 1 an, 36 = 3 ans, 60 = 5 ans.') : null,
    h('div',{class:'two'},
      h('div',null,numSetting('Rappel', d.r1, '', v => { d.r1 = Math.min(v,730); }, 'jours avant l’échéance')),
      h('div',null,numSetting('Rappel urgent', d.r2, '', v => { d.r2 = Math.min(v,730); }, 'jours avant (0 = aucun)'))),
    err,
    h('button',{class:'btn primary',onclick(){
      if (!d.label.trim()) { err.textContent = 'Indiquer un nom.'; err.hidden = false; return; }
      if (d.mode==='visit' && !d.months) { err.textContent = 'Indiquer la périodicité.'; err.hidden = false; return; }
      const it = sanitizeItem({id:uid(), label:d.label, mode:d.mode, months:d.months, r1:d.r1, r2:d.r2, entries:[]});
      S.items.push(it);
      if (save()) { subs.pop(); subs.push({type:'item', id:it.id}); render(); toast('Suivi ajouté.'); }
    }},'Créer')];
}
function viewEntryForm(s){
  const it = findItem(s.itemId);
  if (!it) return [subHead('Élément introuvable')];
  if (!s.draft) {
    const e = s.id ? it.entries.find(x => x.id === s.id) : null;
    s.draft = e ? JSON.parse(JSON.stringify(e)) : {id:null, date:'', issued:'', result:'', restr:'', who:'', note:'', files:[]};
  }
  const d = s.draft, isV = it.mode === 'validity';
  const err = h('p',{class:'err'}); err.hidden = true;
  const prev = h('div',{class:'preview'});
  const showPrev = () => {
    prev.className = 'preview';
    if (!isISO(d.date)) { prev.textContent = ''; prev.hidden = true; return; }
    const end = isV ? d.date : addMonths(d.date, it.months);
    const days = diffDays(todayISO(), end);
    const stc = days < 0 ? 'bad' : (it.r2 && days <= it.r2) || days <= it.r1 ? 'warn' : 'ok';
    prev.hidden = false; prev.classList.add('stcard', `st-${stc}`);
    prev.replaceChildren(isV ? 'Échéance : ' : `Prochaine échéance (+ ${periodLabel(it.months)}) : `, h('b',null,frDate(end)), ` – ${inDays(days)}`);
  };
  showPrev();
  async function submit(){
    if (!isISO(d.date)) { err.textContent = isV ? 'Indiquer la date de fin de validité.' : 'Indiquer la date de la visite.'; err.hidden = false; return; }
    const clean = sanitizeEntry(Object.assign({}, d, {id:d.id || uid()}));
    const i = it.entries.findIndex(x => x.id === clean.id);
    if (i >= 0) it.entries[i] = clean; else it.entries.push(clean);
    if (save()) { toast('Enregistré. Nouvelle échéance : ' + frDate(itemEnd(it))); closeSub(); gcFiles(); }
  }
  return [subHead(it.label),
    h('p',{class:'muted small'},s.id ? 'Modifier une date encodée.' : (isV ? 'Nouvelle date de validité.' : 'Nouvelle visite.')),
    field(isV ? 'Date de fin de validité' : 'Date de la visite', inputEl({type:'date',value:d.date,onchange(e){ d.date = e.target.value; showPrev(); },oninput(e){ d.date = e.target.value; showPrev(); }})),
    prev,
    isV ? field('Date de délivrance ou de renouvellement', inputEl({type:'date',value:d.issued,onchange(e){ d.issued = e.target.value; }}), 'Facultatif.') : null,
    !isV ? [h('p',{class:'lab'},'Résultat'),
      h('select',{class:'field','aria-label':'Résultat',onchange(e){ d.result = e.target.value; }},
        h('option',{value:''},'Non précisé'), RESULTS.map(r => { const o = h('option',{value:r},r); if (d.result === r) o.selected = true; return o; }))] : null,
    !isV ? field('Restrictions éventuelles', inputEl({value:d.restr,maxlength:'500',placeholder:'Par exemple : port de lunettes obligatoire',oninput(e){ d.restr = e.target.value; }})) : null,
    field(isV ? 'Organisme' : 'Médecin / service', inputEl({value:d.who,maxlength:'200',oninput(e){ d.who = e.target.value; }}), 'Facultatif.'),
    filesBlock(d),
    field('Remarque', h('textarea',{class:'field',maxlength:'2000',value:d.note,oninput(e){ d.note = e.target.value; }})),
    err,
    h('button',{class:'btn primary',onclick:submit},'Enregistrer'),
    s.id ? h('button',{class:'btn danger',async onclick(){
      if (!(await confirmBox('Supprimer cette date de l’historique ?','Supprimer'))) return;
      it.entries = it.entries.filter(x => x.id !== s.id); if (save()) { toast('Supprimé.'); closeSub(); gcFiles(); }
    }},'Supprimer') : null];
}

/* ---------- Rappels dans l'agenda ---------- */
function reminderEvents(it, today = todayISO()){
  const end = itemEnd(it); if (!end) return [];
  const ev = [];
  if (it.r1) ev.push({kind:'r1', date:shiftDay(end,-it.r1), title:`Rappel : ${it.label}`});
  if (it.r2) ev.push({kind:'r2', date:shiftDay(end,-it.r2), title:`Rappel urgent : ${it.label}`});
  ev.push({kind:'end', date:end, title:`Échéance : ${it.label}`});
  return ev.filter(e => e.date >= today).map(e => Object.assign(e, {details:`Échéance le ${frDate(end)}. Prendre rendez-vous ou renouveler à temps. (Dossier de compétences)`, uid:`${it.id}-${e.kind}-${end}@${APP}`}));
}
const ymd = s => s.replace(/-/g,'');
function gcalLink(e){
  const q = new URLSearchParams({action:'TEMPLATE', text:e.title, dates:`${ymd(e.date)}/${ymd(shiftDay(e.date,1))}`, details:e.details});
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
function icsEsc(s){ return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n'); }
function icsFold(line){ const out = []; let s = line; while (s.length > 72) { out.push(s.slice(0,72)); s = ' ' + s.slice(72); } out.push(s); return out.join('\r\n'); }
function buildIcs(events){
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dossier de competences//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for (const e of events) L.push('BEGIN:VEVENT',`UID:${e.uid}`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${ymd(e.date)}`,`DTEND;VALUE=DATE:${ymd(shiftDay(e.date,1))}`,
    `SUMMARY:${icsEsc(e.title)}`,`DESCRIPTION:${icsEsc(e.details)}`,'TRANSP:TRANSPARENT',
    'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEsc(e.title)}`,'TRIGGER:PT9H','END:VALARM','END:VEVENT');
  L.push('END:VCALENDAR');
  return new Blob([L.map(icsFold).join('\r\n') + '\r\n'], {type:'text/calendar'});
}
function calendarDialog(it){
  const ev = reminderEvents(it);
  const d = $('dialog');
  d.replaceChildren(h('h2',null,'Ajouter à mon agenda'),
    ev.length ? [h('p',{class:'muted small sp'},'Chaque bouton ouvre Google Agenda avec l’événement prérempli : il suffit d’enregistrer. Le téléphone préviendra le jour venu.'),
      ev.map(e => h('a',{class:'btn',href:gcalLink(e),target:'_blank',rel:'noopener'},`${e.kind==='end'?'Échéance':e.kind==='r2'?'Rappel urgent':'Rappel'} du ${frDate(e.date)}`)),
      h('button',{class:'btn',async onclick(){ const b = buildIcs(ev), n = `Rappels_${it.id}.ics`; const r = await shareFile(b,n); if (!r) download(b,n); }},'Fichier agenda (.ics)')]
      : h('p',{class:'sp'},'Toutes les dates de rappel sont déjà passées.'),
    h('button',{class:'btn primary',onclick(){ d.close(); }},'Fermer'));
  d.oncancel = null;
  d.showModal();
}

/* ---------- Export Excel ---------- */
const xesc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const colName = n => { let s=''; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=(n-r-1)/26; } return s; };
const xlDate = s => (utc(s) - Date.UTC(1899,11,30)) / 86400000;
/* Styles : 0 normal, 1 titre, 2 en-tête, 3 texte, 4 date, 5 nombre, 6-10 statuts, 11 discret, 12 total libellé, 13 total nombre, 14 sous-titre */
const XS = {txt:3, date:4, num:5, ok:6, warn:7, bad:8, info:9, none:10, muted:11, totL:12, totN:13, head:2, title:1, sub:14};
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="9">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF1E2A30"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1E2A30"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F5A33"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF6A5100"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF7D2222"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F4A7A"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5D6B73"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="12"/><color rgb="FF2E7D86"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F1F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDF3E4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2C2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBDCDC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBFB"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECEFF1"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFC9D3D8"/></left><right style="thin"><color rgb="FFC9D3D8"/></right><top style="thin"><color rgb="FFC9D3D8"/></top><bottom style="thin"><color rgb="FFC9D3D8"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFC9D3D8"/></left><right style="thin"><color rgb="FFC9D3D8"/></right><top style="medium"><color rgb="FF2E7D86"/></top><bottom style="thin"><color rgb="FFC9D3D8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="0"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
const C = (v, s) => ({v, s}); // cellule
function sheetXml(sh){
  const rows = sh.rows.map((r, ri) => {
    if (!r) return '';
    const cells = r.map((c, ci) => {
      if (c === null || c === undefined) return '';
      const cell = typeof c === 'object' ? c : {v:c, s:XS.txt};
      const ref = colName(ci+1) + (ri+1);
      if (cell.v === '' || cell.v === null || cell.v === undefined) return `<c r="${ref}" s="${cell.s}"/>`;
      if (typeof cell.v === 'number') return `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      return `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t xml:space="preserve">${xesc(cell.v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri+1}">${cells}</row>`;
  }).join('');
  const pane = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze+1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze+1}" sqref="A${sh.freeze+1}"/>` : '';
  const cols = `<cols>${sh.cols.map((w,i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const merges = sh.merges && sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"${sh.active ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${sh.filter ? `<autoFilter ref="${sh.filter}"/>` : ''}${merges}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}
async function writeXlsx(sheets){
  const zip = new JSZip();
  const n = sheets.length;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s,i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/,'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Dossier de compétences</dc:title><dc:creator>${xesc(S.settings.name || 'Dossier de compétences')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`);
  const defs = sheets.map((s,i) => s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xesc(s.name)}'!${s.filter.replace(/([A-Z]+)(\d+)/g,'$$$1$$$2')}</definedName>` : '').join('');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s,i) => `<sheet name="${xesc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s,i) => zip.file(`xl/worksheets/sheet${i+1}.xml`, sheetXml(Object.assign({active:i===0}, s))));
  return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function identityLine(){
  const st = S.settings, ag = S.items.find(i => i.id === 'agrement');
  return [st.name, st.profession, st.inami ? `INAMI ${st.inami}` : '', ag && ag.number ? `Agrément SPF ${ag.number}` : ''].filter(Boolean).join(' – ');
}
function buildWorkbook(){
  const today = todayISO(), st = S.settings, w = window4(today);
  /* Synthèse */
  const R = [];
  R.push([C('Dossier de compétences professionnelles',XS.title)]);
  R.push([C(identityLine() || 'Nom à indiquer dans les réglages de l’application',XS.muted)]);
  R.push([C(`Situation au ${frDate(today)}`,XS.muted)]);
  R.push(null);
  R.push([C('Formation permanente',XS.sub)]);
  R.push([C('Période',XS.head),C('Heures',XS.head),C('Minimum',XS.head),C('Statut',XS.head),C('Commentaire',XS.head)]);
  for (const y of yearsShown(today).filter(y => y <= parts(today)[0])) {
    const s = yearStatus(y, today);
    R.push([C(String(y),XS.txt),C(s.total,XS.num),C(st.minYear,XS.num),C(s.label,XS[s.st]),C(s.total < st.minYear ? `Manque ${fmtH(st.minYear - s.total)}` : '',XS.txt)]);
  }
  R.push([C(`4 dernières années (du ${frDate(w.start)} au ${frDate(w.end)})`,XS.totL),C(w.total,XS.totN),C(w.min,XS.totN),C(w.label,XS[w.st]),
    C(w.total < w.min ? `Manque ${fmtH(w.min - w.total)}` : w.drop ? `Passera sous ${w.min} h le ${frDate(w.drop)} sans nouvelle formation` : '',XS.txt)]);
  const planned = S.trainings.filter(t => t.date > today);
  if (planned.length) R.push([C(`${planned.length} ${plural(planned.length,'formation prévue','formations prévues')} (${fmtH(planned.reduce((a,t)=>a+t.hours,0))}), non comptée${planned.length>1?'s':''} dans les totaux.`,XS.muted)]);
  R.push(null);
  R.push([C('Visites médicales et validités',XS.sub)]);
  R.push([C('Élément',XS.head),C('Dernière date',XS.head),C('Échéance',XS.head),C('Statut',XS.head),C('Jours restants',XS.head),C('Numéro / catégories',XS.head),C('Rappels (jours avant)',XS.head)]);
  for (const it of S.items) {
    const s = itemStatus(it, today);
    R.push([C(it.label,XS.txt), s.e ? C(xlDate(s.e.date),XS.date) : C('',XS.txt), s.end ? C(xlDate(s.end),XS.date) : C('',XS.txt), C(s.label,XS[s.st]),
      s.days === null ? C('',XS.txt) : C(s.days,XS.num), C([it.number, it.hasCats && it.cats ? `Cat. ${it.cats}` : ''].filter(Boolean).join(' – '),XS.txt),
      C([it.r1 ? `${it.r1}` : '', it.r2 ? `urgent ${it.r2}` : ''].filter(Boolean).join(' / '),XS.txt)]);
  }
  R.push(null);
  R.push([C('Vert : valide / en ordre. Jaune : période de rappel. Rouge : échéance dépassée ou minimum non atteint. Bleu : année en cours.',XS.muted)]);
  const syn = {name:'Synthèse', cols:[46,14,14,18,16,22,20], rows:R, landscape:true};
  /* Formations */
  const F = [[C('Registre des formations permanentes',XS.title)],[C(identityLine(),XS.muted)],null,
    ['Date','Année','Intitulé','Organisme','Thème','Lieu','Heures','Statut','Attestation','Justificatif','Remarque'].map(x => C(x,XS.head))];
  const list = S.trainings.slice().sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const t of list) F.push([C(xlDate(t.date),XS.date),C(parts(t.date)[0],XS.num),C(t.title,XS.txt),C(t.org,XS.txt),C(t.theme,XS.txt),C(t.place,XS.txt),
    C(t.hours,XS.num),C(t.date > today ? 'Prévue' : 'Réalisée',XS.txt),C(t.cert ? 'Oui' : 'Non',XS.txt),C(t.files.length ? `${t.files.length} fichier${t.files.length>1?'s':''}` : '',XS.txt),C(t.note.replace(/\s*\n\s*/g,' '),XS.txt)]);
  const done = list.filter(t => t.date <= today);
  F.push([C('Total réalisé',XS.totL),C('',XS.totL),C('',XS.totL),C('',XS.totL),C('',XS.totL),C('',XS.totL),C(round2(done.reduce((a,t)=>a+t.hours,0)),XS.totN),C('',XS.totL),C('',XS.totL),C('',XS.totL),C('',XS.totL)]);
  const form = {name:'Formations', cols:[12,8,40,26,18,18,9,11,12,13,40], rows:F, freeze:4, filter:`A4:K${4+list.length}`, landscape:true};
  /* Historique */
  const V = [[C('Historique des visites et validités',XS.title)],[C(identityLine(),XS.muted)],null,
    ['Élément','Type','Date','Échéance','Délivrance','Résultat','Restrictions','Médecin / organisme','Justificatif','Remarque'].map(x => C(x,XS.head))];
  let nv = 0;
  for (const it of S.items) for (const e of it.entries.slice().sort((a,b) => a.date < b.date ? 1 : -1)) {
    nv++; const end = itemEnd(it, e);
    V.push([C(it.label,XS.txt),C(it.mode==='validity'?'Fin de validité':'Visite',XS.txt),C(xlDate(e.date),XS.date),end ? C(xlDate(end),XS.date) : C('',XS.txt),
      e.issued ? C(xlDate(e.issued),XS.date) : C('',XS.txt),C(e.result,XS.txt),C(e.restr,XS.txt),C(e.who,XS.txt),C(e.files.length ? `${e.files.length} fichier${e.files.length>1?'s':''}` : '',XS.txt),C(e.note.replace(/\s*\n\s*/g,' '),XS.txt)]);
  }
  const vis = {name:'Visites et validités', cols:[36,15,12,12,12,20,26,24,12,36], rows:V, freeze:4, filter:nv ? `A4:J${4+nv}` : null, landscape:true};
  return writeXlsx([syn, form, vis]);
}
function download(blob, name){
  const url = URL.createObjectURL(blob);
  const a = h('a',{href:url,download:name}); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function shareFile(blob, name){
  const file = new File([blob], name, {type: blob.type});
  if (!(navigator.canShare && navigator.canShare({files:[file]}))) return false;
  try { await navigator.share({files:[file], title:name}); return true; }
  catch(e){ return e.name === 'AbortError' ? 'cancelled' : false; }
}

/* ---------- Dossier imprimable (PDF) ---------- */
function printDossier(){
  const today = todayISO(), st = S.settings, w = window4(today);
  const td = (t, cls) => h('td',{class:cls||null},t);
  const stTd = (s,l) => h('td',{class:`st st-${s}`},l);
  const table = (heads, rows) => h('table',null,h('thead',null,h('tr',null,heads.map(x => h('th',null,x)))),h('tbody',null,rows));
  const list = S.trainings.slice().sort((a,b) => a.date < b.date ? -1 : 1);
  const hist = [];
  for (const it of S.items) for (const e of it.entries.slice().sort((a,b) => a.date < b.date ? 1 : -1)) hist.push([it, e]);
  $('print').replaceChildren(...[
    h('h1',null,'Dossier de compétences professionnelles'),
    h('p',{class:'id'},identityLine() || ''),
    h('p',{class:'id'},`Situation au ${frDate(today)}`),
    h('h2',null,'Formation permanente'),
    table(['Période','Heures','Minimum','Statut'], [
      ...yearsShown(today).filter(y => y <= parts(today)[0]).map(y => { const s = yearStatus(y,today); return h('tr',null,td(String(y)),td(fmtH(s.total),'n'),td(`${st.minYear} h`,'n'),stTd(s.st,s.label)); }),
      h('tr',null,td(h('b',null,`4 dernières années (du ${frDate(w.start)} au ${frDate(w.end)})`)),td(h('b',null,fmtH(w.total)),'n'),td(`${w.min} h`,'n'),stTd(w.st,w.label))]),
    h('h2',null,'Visites médicales et validités'),
    table(['Élément','Dernière date','Échéance','Statut','Numéro'], S.items.map(it => { const s = itemStatus(it,today);
      return h('tr',null,td(it.label),td(s.e ? frDate(s.e.date) : '—'),td(s.end ? frDate(s.end) : '—'),stTd(s.st,s.label),td([it.number, it.hasCats && it.cats ? `Cat. ${it.cats}` : ''].filter(Boolean).join(' – '))); })),
    h('h2',null,'Registre des formations'),
    list.length ? table(['Date','Intitulé','Organisme','Heures','Attestation'], list.map(t =>
      h('tr',null,td(frDate(t.date)),td(t.title + (t.date > today ? ' (prévue)' : '')),td(t.org),td(fmtH(t.hours),'n'),td(t.cert ? 'Oui' : 'Non'))))
      : h('p',null,'Aucune formation encodée.'),
    hist.length ? [h('h2',null,'Historique des visites et validités'),
      table(['Élément','Date','Échéance','Résultat','Médecin / organisme'], hist.map(([it,e]) =>
        h('tr',null,td(it.label),td(frDate(e.date)),td(frDate(itemEnd(it,e)) || '—'),td([e.result, e.restr].filter(Boolean).join(' – ')),td(e.who))))] : null,
    h('p',{class:'foot'},`Document généré le ${frDate(today)} par l’application Dossier de compétences.`)].flat(Infinity).filter(Boolean));
  setTimeout(() => { try { window.print(); } catch(e){ toast('Impression indisponible sur cet appareil.'); } }, 50);
}

/* ---------- Écran Export ---------- */
async function blobToDataURL(b){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
async function dataURLToBlob(u){ return (await fetch(u)).blob(); }
function viewExport(){
  const run = async (btn, share) => {
    btn.disabled = true;
    try {
      const blob = await buildWorkbook(), name = `Dossier_competences_${todayISO()}.xlsx`;
      if (share) { const r = await shareFile(blob,name); if (!r) { download(blob,name); toast(`Partage indisponible : ${name} a été téléchargé.`); } }
      else { download(blob,name); toast(`Téléchargement lancé : ${name}`); }
    } catch(e){ toast('Export impossible. Réessayer après avoir fermé puis rouvert l’application.'); }
    btn.disabled = false;
  };
  const allEvents = () => S.items.flatMap(it => reminderEvents(it));
  return [h('h1',null,'Export'),
    h('section',null,h('h2',null,'Fichier Excel'),
      h('p',{class:'muted small sp'},'Trois onglets : synthèse avec statuts en couleur, registre des formations, historique des visites et validités.'),
      h('button',{class:'btn primary',onclick(e){ run(e.currentTarget,false); }},'Télécharger le fichier Excel'),
      navigator.canShare ? h('button',{class:'btn',onclick(e){ run(e.currentTarget,true); }},'Partager le fichier Excel') : null),
    h('section',{class:'group'},h('h2',null,'Dossier PDF'),
      h('p',{class:'muted small sp'},'Ouvre l’impression du téléphone : choisir « Enregistrer au format PDF » comme imprimante.'),
      h('button',{class:'btn',onclick:printDossier},'Créer le dossier PDF')),
    h('section',{class:'group'},h('h2',null,'Rappels dans l’agenda'),
      h('p',{class:'muted small sp'},'Un fichier agenda avec tous les rappels et échéances à venir, notifiés à 9 h le jour même. Pour Google Agenda, il est plus simple d’ajouter les rappels un par un depuis chaque élément de l’onglet Échéances.'),
      h('button',{class:'btn',async onclick(){ const ev = allEvents(); if (!ev.length) { toast('Aucun rappel à venir : encoder d’abord des dates.'); return; }
        const b = buildIcs(ev), n = `Rappels_dossier_${todayISO()}.ics`; const r = await shareFile(b,n); if (!r) download(b,n); }},'Fichier agenda (.ics)')),
    h('section',{class:'group'},h('h2',null,'Sauvegarde'),
      h('p',{class:'muted small'},S.lastBackup?`Dernière sauvegarde : ${frDate(S.lastBackup.slice(0,10))}.`:'Aucune sauvegarde créée pour l’instant.'),
      h('p',{class:'muted small sp'},'À faire chaque mois et après chaque ajout important. Les données ne sont que sur ce téléphone : s’envoyer le fichier par e-mail pour pouvoir les récupérer si le téléphone est perdu. Les justificatifs sont inclus.'),
      h('button',{class:'btn primary',async onclick(e){
        const btn = e.currentTarget; btn.disabled = true;
        try {
          await gcFiles();
          const files = [];
          for (const f of await fileAll().catch(() => [])) files.push({id:f.id, name:f.name, type:f.type, data:await blobToDataURL(f.blob)});
          const now = new Date();
          const payload = {app:APP, version:1, exportedAt:now.toISOString(), data:{settings:S.settings, trainings:S.trainings, items:S.items}, files};
          const blob = new Blob([JSON.stringify(payload)],{type:'application/json'});
          const name = `Sauvegarde_dossier_${todayISO()}.json`;
          const shared = await shareFile(blob,name);
          if (shared === 'cancelled') { toast('Sauvegarde annulée : aucun fichier créé.'); btn.disabled = false; return; }
          if (!shared) download(blob,name);
          S.lastBackup = now.toISOString(); save(); render(); toast('Sauvegarde créée : '+name);
        } catch(err){ toast('Sauvegarde impossible.'); btn.disabled = false; }
      }},'Créer une sauvegarde'),
      h('label',{class:'btn filebtn'},'Restaurer une sauvegarde',h('input',{type:'file',accept:'.json,application/json','aria-label':'Restaurer une sauvegarde',async onchange(e){
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try {
          const raw = JSON.parse(await f.text());
          const o = raw && raw.app === APP ? sanitize(raw.data) : null;
          if (!o) throw new Error('format');
          const n = o.trainings.length;
          if (!(await confirmBox(`Remplacer les données de ce téléphone par cette sauvegarde (${n} ${plural(n,'formation','formations')}) ?`,'Remplacer'))) return;
          await fileClear();
          for (const x of (Array.isArray(raw.files) ? raw.files : [])) {
            if (!x || typeof x.id !== 'string' || typeof x.data !== 'string' || !x.data.startsWith('data:')) continue;
            const blob = await dataURLToBlob(x.data);
            await filePut({id:x.id, name:str(x.name,120)||'Justificatif', type:str(x.type,100)||blob.type, blob});
            fileMeta[x.id] = str(x.name,120) || 'Justificatif';
          }
          o.lastBackup = new Date().toISOString();
          S = o;
          if (save()) { applyTheme(); render(); toast(`Sauvegarde restaurée : ${n} ${plural(n,'formation','formations')}.`); }
        } catch(err){ toast('Ce fichier n’est pas une sauvegarde de cette application.'); }
      }})))
  ];
}

/* ---------- Réglages ---------- */
function viewSettings(){
  const st = S.settings;
  const num = (label, key, max, hint) => field(label, inputEl({inputmode:'numeric',value:String(st[key]),oninput(e){
    const v = e.target.value.replace(/[^0-9]/g,'').slice(0,3); e.target.value = v; if (v !== '') { st[key] = Math.min(Number(v),max); save(); }
  }}), hint);
  return [h('h1',null,'Réglages'),
    h('section',null,h('h2',null,'Identité'),
      field('Nom et prénom', inputEl({maxlength:'100',value:st.name,oninput(e){ st.name = e.target.value; save(); }})),
      field('Profession', inputEl({maxlength:'80',value:st.profession,oninput(e){ st.profession = e.target.value; save(); }})),
      field('Numéro INAMI', inputEl({maxlength:'40',value:st.inami,oninput(e){ st.inami = e.target.value; save(); }}), 'Facultatif. Le numéro d’agrément SPF se règle dans l’élément « Agrément SPF » de l’onglet Échéances.')),
    h('section',{class:'group'},h('h2',null,'Règles de formation permanente'),
      h('div',{class:'two'},h('div',null,num('Minimum par an', 'minYear', 200, 'heures')),h('div',null,num('Minimum sur 4 ans', 'min4y', 800, 'heures'))),
      num('Période de rappel', 'trainR', 365, 'jours avant le 31/12 (heures de l’année) ou avant que le total sur 4 ans ne passe sous le minimum.')),
    h('section',{class:'group'},h('h2',null,'Affichage'),h('div',{class:'choices',style:'margin-top:10px'},
      [['light','Clair'],['dark','Sombre'],['auto','Automatique']].map(([k,l]) => choiceBtn(st.theme===k,l,() => { st.theme=k; save(); applyTheme(); render(); })))),
    installEvent ? h('section',{class:'group'},h('button',{class:'btn primary',async onclick(){ installEvent.prompt(); await installEvent.userChoice; installEvent=null; render(); }},'Installer l’application')) : null,
    h('section',{class:'group'},h('h2',null,'Confidentialité'),h('p',{class:'muted small sp'},'Toutes les saisies et les justificatifs restent dans le stockage de Chrome sur ce téléphone. Ils ne sont envoyés nulle part, sauf si un fichier est partagé. Vider les données de Chrome ou désinstaller l’application peut les effacer : créer des sauvegardes depuis l’onglet Export.'))
  ].filter(Boolean);
}

/* ---------- Démarrage ---------- */
if (history.state && history.state.sub) history.replaceState(null,'');
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme==='auto') applyTheme(); });
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; if (tab==='reglages' && !subs.length) render(); });
addEventListener('appinstalled', () => { installEvent = null; toast('Application installée.'); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !sub()) render(); }); // statuts à jour au retour dans l'app
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('Nouvelle version prête : fermer puis rouvrir l’application.'); });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
loadFileNames().then(() => { gcFiles(); if (sub()) render(); });
