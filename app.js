/* 프로토타입 – 인디 메이커 스토어 (Supabase 정식 버전) */
"use strict";
const CFG = window.APP_CONFIG || {};
const BASE = (CFG.BASE_PATH || "/").replace(/\/?$/, "/");
const KINDS = {game:"게임", app:"앱", web:"웹서비스", portfolio:"학생 포트폴리오"};
const CAT_KIND = {all:"전체", game:"게임", app:"앱", web:"웹서비스", portfolio:"학생 포트폴리오"};
const PLATFORMS = ["웹","안드로이드","iOS","PC","피그마 프로토타입"];
const TAG_SUGGEST = ["퍼즐","캐주얼","스토리","멀티플레이","생산성","라이프스타일","교육","유학생","소셜","AI","헬스케어","로컬","서비스디자인"];
const REPORT_REASONS = {spam:"스팸·광고", inappropriate:"부적절한 내용", copyright:"저작권 침해", abuse:"욕설·괴롭힘", broken:"링크가 안 열려요", other:"기타"};

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const S = {
  user:null, profile:null, projects:[], scores:{}, profiles:{}, wish:new Set(), notes:[], channel:null,
  loaded:false, collections:[], colItems:[], route:{name:"home"}, kind:"all", tag:null, q:"", sort:"new", libTab:"mine"
};

/* ---------- helpers ---------- */
function h(tag, props, ...kids){
  const e = document.createElement(tag);
  if (props) for (const [k,v] of Object.entries(props)){
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()){
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
const $ = s => document.querySelector(s);
const str = (v,n) => String(v ?? "").slice(0, n || 3000);
const arr = v => Array.isArray(v) ? v : [];
function setStatus(t){ $("#status").textContent = t || ""; }
function safeUrl(u){ try{ const x = new URL(String(u||"")); return (x.protocol==="https:"||x.protocol==="http:") ? x.href : null; }catch(e){ return null; } }
function date(v){ if (!v) return ""; const d = new Date(v); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`; }
function ago(v){ const s = (Date.now() - new Date(v).getTime())/1000; if (s < 60) return "방금"; if (s < 3600) return Math.floor(s/60)+"분 전"; if (s < 86400) return Math.floor(s/3600)+"시간 전"; if (s < 86400*7) return Math.floor(s/86400)+"일 전"; return date(v); }
function hue(s){ let x = 0; for (const c of String(s)) x = (x*31 + c.charCodeAt(0)) % 360; return x; }
function mediaUrl(path){ return path ? `${CFG.SUPABASE_URL}/storage/v1/object/public/media/${path.split("/").map(encodeURIComponent).join("/")}` : null; }
const byNew = (a,b) => new Date(b.created_at) - new Date(a.created_at);
let toastTimer = null;
function toast(msg){
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = h("div",{class:"toast", role:"status"}, msg); document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2600);
}
function errMsg(e){
  const m = String(e && (e.message || e.error_description || e) || "");
  if (/JWT|not signed|auth/i.test(m)) return "로그인이 필요해요. 다시 로그인해 주세요.";
  if (/row-level security|permission|not allowed/i.test(m)) return "이 작업을 할 권한이 없어요.";
  if (/duplicate key|unique/i.test(m)) return "이미 등록되어 있어요.";
  if (/check constraint/i.test(m)) return "입력한 내용의 길이나 형식을 확인해 주세요.";
  if (/Payload too large|exceeded the maximum/i.test(m)) return "이미지가 너무 커요. 10MB 이하로 올려 주세요.";
  if (/mime type/i.test(m)) return "PNG, JPG, WEBP, GIF 이미지만 올릴 수 있어요.";
  if (/fetch|network/i.test(m)) return "인터넷 연결을 확인해 주세요.";
  return "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}
function go(hash){ if (location.hash === hash) route(); else location.hash = hash; }
function requireLogin(reason){ if (S.user) return true; openLogin(reason); return false; }
function field(id, lbl, input, hint){ return h("div",{class:"field"}, h("label",{for:id}, lbl), input, hint ? h("small",null,hint) : null); }

/* ---------- data ---------- */
async function loadCollections(){
  const [c, i] = await Promise.all([
    sb.from("collections").select("*").order("sort_order").order("created_at",{ascending:false}),
    sb.from("collection_items").select("*").order("position")
  ]);
  S.collections = c.data || []; S.colItems = i.data || [];
}
async function loadProjects(){
  const [p, s] = await Promise.all([
    sb.from("projects").select("*").order("created_at",{ascending:false}).limit(1000),
    sb.from("project_scores").select("*"),
    loadCollections().catch(() => {})
  ]);
  if (p.error) throw p.error;
  S.projects = p.data || [];
  S.scores = Object.fromEntries((s.data || []).map(r => [r.project_id, r]));
  await loadProfiles(S.projects.map(x => x.owner_id));
  S.loaded = true;
}
async function loadProfiles(ids){
  const need = [...new Set(ids)].filter(id => id && !S.profiles[id]);
  if (!need.length) return;
  for (let i = 0; i < need.length; i += 150){
    const { data } = await sb.from("profiles").select("id,display_name,avatar_url,bio").in("id", need.slice(i, i+150));
    (data || []).forEach(p => S.profiles[p.id] = p);
  }
}
async function refreshScore(pid){
  const { data } = await sb.from("project_scores").select("*").eq("project_id", pid).maybeSingle();
  if (data) S.scores[pid] = data;
}
function nameOf(uid){ const p = S.profiles[uid]; const n = p && p.display_name || "크리에이터"; return uid && S.user && uid === S.user.id ? n + " (나)" : n; }
const AXES = [["design","디자인"],["usability","사용성"],["creativity","창의성"],["content","완성도"]];
function scoreOf(pid){
  const sc = S.scores[pid] || {};
  const axes = AXES.map(([k]) => sc["avg_"+k] == null ? null : Number(sc["avg_"+k]));
  const have = axes.filter(v => v != null);
  return {axes, overall: have.length === 4 ? have.reduce((s,v) => s+v, 0) / 4 : null, count: Number(sc.scored_count) || 0};
}
const fmt = v => v == null ? "–" : v.toFixed(1);
function ring(v, size){
  return h("div",{class:"ring", style:`--p:${v == null ? 0 : Math.round(v*10)};--s:${size||88}px`, role:"img", "aria-label": v == null ? "아직 점수 없음" : `평균 ${v.toFixed(1)}점 (10점 만점)`},
    h("span",{class:"num"}, fmt(v)), h("small",null,"/ 10"));
}
function scoreBars(sc){
  return h("div",{class:"bars"}, AXES.map(([k,l],i) => h("div",{class:"barrow"},
    h("span",null,l), h("div",{class:"track"}, h("i",{style:`width:${(sc.axes[i]||0)*10}%`})), h("b",{class:"num"}, fmt(sc.axes[i])))));
}
function todayKST(){ return new Date(Date.now() + 9*3600e3).toISOString().slice(0,10); }
function kindOf(p){ return KINDS[p.kind] ? p.kind : "app"; }
function summary(pid){
  const sc = S.scores[pid] || {review_count:0, up_count:0};
  const n = Number(sc.review_count)||0, up = Number(sc.up_count)||0;
  if (!n) return {n, up, pct:0, label:"아직 리뷰 없음", cls:"none"};
  const pct = Math.round(up/n*100);
  let label, cls;
  if (n >= 10 && pct >= 95){ label = "압도적으로 긍정적"; cls = "pos"; }
  else if (pct >= 80){ label = n >= 5 ? "매우 긍정적" : "긍정적"; cls = "pos"; }
  else if (pct >= 70){ label = "대체로 긍정적"; cls = "pos"; }
  else if (pct >= 40){ label = "복합적"; cls = "mixed"; }
  else if (pct >= 20){ label = "대체로 부정적"; cls = "neg"; }
  else { label = "부정적"; cls = "neg"; }
  return {n, up, pct, label, cls};
}
function revLabel(pid, withCount){
  const s = summary(pid);
  return h("span",{class:"rev " + s.cls}, s.label, withCount && s.n ? h("span",{class:"num", style:"font-weight:500;color:var(--muted)"}, ` (${s.n})`) : null);
}
const isMaker = p => !!S.user && p.owner_id === S.user.id;
const isPublic = p => p.status === "approved" && !p.hidden;
const STATUS_LABEL = {pending:"심사 중", approved:"공개 중", rejected:"반려됨"};
function statusChip(p){ if (p.hidden) return h("span",{class:"hiddenmark"},"숨김"); if (p.status === "approved") return null; return h("span",{class:"chip-st " + p.status}, STATUS_LABEL[p.status] || p.status); }
function shortUrl(p){ return p.slug ? location.origin + BASE + "a/" + p.slug : location.origin + BASE + "#/p/" + p.id; }
let viewLogged = new Set();
function logEvent(p, type){
  if (!p || !isPublic(p) || isMaker(p)) return;
  if (type === "view"){ const k = "v_" + p.id; try{ if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k,"1"); }catch(e){ if (viewLogged.has(k)) return; viewLogged.add(k); } }
  let ref = null; try{ if (document.referrer){ const r = new URL(document.referrer); if (r.host !== location.host) ref = r.host.replace(/^www\./,""); } }catch(e){}
  sb.rpc("log_event", {p_id:p.id, p_type:type, p_ref:ref}).then(() => {}, () => {});
}
const isAdmin = () => !!(S.profile && S.profile.is_admin);
function topTags(n){
  const c = {};
  S.projects.filter(isPublic).forEach(p => arr(p.tags).forEach(t => { t = str(t,20); if (t) c[t] = (c[t]||0)+1; }));
  return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,n).map(x=>x[0]);
}

/* ---------- covers & capsules ---------- */
function cover(p, path){
  const pth = path === undefined ? p.cover_path : path;
  const c = h("div",{class:"cover"});
  if (pth) c.append(h("img",{src:mediaUrl(pth), alt:str(p.title,80)+" 화면", loading:"lazy"}));
  else {
    const x = hue(p.title || p.id);
    c.style.background = `linear-gradient(140deg, hsl(${x} 70% 86%), hsl(${(x+40)%360} 65% 72%))`;
    c.append(h("div",{class:"gen"}, h("b",null, str(p.title,60) || "제목 없음")));
  }
  c.append(h("span",{class:"kind"}, KINDS[kindOf(p)]));
  if (p.pod_date && path === undefined) c.append(h("span",{class:"pod-flag"},"오늘의 프로토타입"));
  if (p.icon_path && path === undefined) c.append(h("img",{class:"appicon", src:mediaUrl(p.icon_path), alt:"", loading:"lazy"}));
  return c;
}
function capsule(p){
  const sc = scoreOf(p.id), sm = summary(p.id);
  const right = statusChip(p) || (sc.overall != null ? h("span",{class:"score-chip num", title:"평균 점수"}, sc.overall.toFixed(1))
    : sm.n ? h("span",{class:"mini-rev " + sm.cls}, `👍 ${sm.pct}%`) : h("span",{class:"mini-new"},"평가 대기"));
  return h("a",{class:"card", href:"#/p/"+p.id, "aria-label":str(p.title,80)+" 작품 페이지"},
    h("div",{class:"card-media"}, cover(p)),
    h("div",{class:"card-meta"},
      h("div",{class:"card-title"}, p.icon_path ? h("img",{class:"appicon-xs", src:mediaUrl(p.icon_path), alt:"", loading:"lazy"}) : null, h("h3",null, str(p.title,80) || "제목 없음")),
      right),
    h("div",{class:"card-sub"}, nameOf(p.owner_id), " · ", KINDS[kindOf(p)], sm.n ? ` · 리뷰 ${sm.n}` : ""));
}
/* ---------- header, bell, login ---------- */
function renderHeader(){
  const r = $("#hdr-right"); r.textContent = "";
  const up = h("a",{class:"btn primary pill", href:"#/upload"},"작품 제출");
  if (!S.user){
    r.append(h("button",{class:"loginbtn", type:"button", onclick:()=>openLogin()},"로그인"), up);
    return;
  }
  const unread = S.notes.filter(n => !n.read_at).length;
  const bell = h("button",{class:"iconbtn", type:"button", "aria-label":`알림 ${unread}개`, onclick:toggleNotes}, "🔔", unread ? h("span",{class:"dot"}, unread > 99 ? "99+" : unread) : null);
  const p = S.profile || {};
  const av = h("a",{class:"avatar", href:"#/library", "aria-label":"내 라이브러리"}, p.avatar_url ? h("img",{src:p.avatar_url, alt:"", referrerpolicy:"no-referrer"}) : (str(p.display_name,1) || "나"));
  r.append(bell, av, up);
}
function closeLayer(){ $("#layer").textContent = ""; }
let AUTH_SET = null;
async function authSettings(){
  if (AUTH_SET) return AUTH_SET;
  try{
    const r = await fetch(CFG.SUPABASE_URL + "/auth/v1/settings", {headers:{apikey:CFG.SUPABASE_KEY}});
    AUTH_SET = r.ok ? await r.json() : {};
  }catch(e){ AUTH_SET = {}; }
  return AUTH_SET;
}
async function openLogin(reason){
  const L = CFG.LOGIN || {};
  const set = await authSettings(), ext = set.external || {};
  const known = Object.keys(ext).length > 0;
  const on = p => L[p] !== false && (!known || ext[p] === true);
  const sign = async provider => {
    try{
      try{ sessionStorage.setItem("after_login", location.hash || "#/"); }catch(e){}
      const { error } = await sb.auth.signInWithOAuth({ provider, options:{ redirectTo: location.origin + BASE } });
      if (error) throw error;
    }catch(e){ toast("로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요."); }
  };
  const socials = [
    on("kakao") ? h("button",{class:"k", type:"button", onclick:()=>sign("kakao")}, h("b",{class:"ic"},"K"), "카카오로 계속하기") : null,
    L.naver === true ? h("button",{class:"n", type:"button", onclick:()=>sign(CFG.NAVER_PROVIDER || "custom:naver")}, h("b",{class:"ic"},"N"), "네이버로 계속하기") : null,
    on("google") ? h("button",{class:"g", type:"button", onclick:()=>sign("google")}, h("img",{class:"ic-img", src:"google.png", alt:"", width:"20", height:"20"}), "Google로 계속하기") : null
  ].filter(Boolean);
  const emailForm = null; // 이메일 로그인은 쓰지 않아요 (소셜 로그인만)
  const back = h("div",{class:"modal-back", onclick:e => { if (e.target === back) closeLayer(); }},
    h("div",{class:"modal", role:"dialog", "aria-modal":"true", "aria-labelledby":"login-title"},
      h("h2",{id:"login-title"},"prototype. 시작하기"),
      h("p",{class:"note"}, reason || "로그인하면 작품을 올리고, 리뷰를 쓰고, 알림을 받을 수 있어요."),
      socials.length ? h("div",{class:"social"}, socials) : null,
      emailForm,
      !socials.length && !emailForm ? h("p",{class:"warn"},"지금은 로그인을 준비하고 있어요. 잠시 후 다시 시도해 주세요.") : null,
      h("p",{class:"fine"},"계속하면 ", h("a",{href:"terms.html", target:"_blank"},"이용약관"), "과 ", h("a",{href:"privacy.html", target:"_blank"},"개인정보처리방침"), "에 동의하는 것으로 봐요."),
      h("button",{class:"btn small", type:"button", onclick:closeLayer},"닫기")));
  closeLayer(); $("#layer").append(back);
  (back.querySelector(".social button") || emailIn)?.focus();
}
function welcome(){
  let seen = false; try{ seen = localStorage.getItem("welcomed_" + S.user.id) === "1"; localStorage.setItem("welcomed_" + S.user.id, "1"); }catch(e){}
  if (seen || $(".modal")) return;
  const pick = async role => { await sb.from("profiles").update({role}).eq("id", S.user.id); if (S.profile) S.profile.role = role; closeLayer(); go(role === "maker" ? "#/upload" : "#/"); };
  modal(`환영해요, ${str(S.profile && S.profile.display_name,20)}님!`,
    h("p",{class:"note"},"주로 어떻게 쓰실 건가요? 나중에 프로필에서 바꿀 수 있어요."),
    h("div",{class:"social"},
      h("button",{class:"g", type:"button", onclick:() => pick("tester")}, "🧪 테스터로 새 작품 써 보기"),
      h("button",{class:"k", type:"button", onclick:() => pick("maker")}, "🛠 메이커로 내 작품 올리기")));
}
function toggleNotes(){
  if ($(".notepanel")){ closeLayer(); return; }
  const list = h("div");
  if (!S.notes.length) list.append(h("p",{class:"note", style:"padding:16px"},"아직 알림이 없어요. 리뷰가 달리거나 찜한 작품이 업데이트되면 여기로 알려 드려요."));
  S.notes.slice(0,50).forEach(n => list.append(h("button",{class:"note-item" + (n.read_at ? "" : " unread"), type:"button", onclick:async () => {
    closeLayer();
    if (!n.read_at){ n.read_at = new Date().toISOString(); renderHeader(); await sb.from("notifications").update({read_at:n.read_at}).eq("id", n.id); }
    if (n.project_id) go("#/p/"+n.project_id);
  }}, str(n.message,200), h("small",null, ago(n.created_at)))));
  const allRead = h("button",{class:"textlink", type:"button", onclick:async () => {
    const now = new Date().toISOString();
    S.notes.forEach(n => { if (!n.read_at) n.read_at = now; });
    renderHeader(); closeLayer();
    await sb.from("notifications").update({read_at:now}).eq("user_id", S.user.id).is("read_at", null);
  }},"모두 읽음");
  const panel = h("div",{class:"notepanel", role:"dialog", "aria-label":"알림"}, h("header",null, h("b",null,"알림"), allRead), list);
  const back = h("div",{style:"position:fixed;inset:0;z-index:39", onclick:closeLayer});
  closeLayer(); $("#layer").append(back, panel);
}
async function setUser(user){
  if ((user && user.id) === (S.user && S.user.id)) return;
  S.user = user || null; S.profile = null; S.wish = new Set(); S.notes = [];
  if (S.channel){ sb.removeChannel(S.channel); S.channel = null; }
  if (S.user){
    const uid = S.user.id;
    const [pr, w, n] = await Promise.all([
      sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
      sb.from("wishlists").select("project_id").eq("user_id", uid),
      sb.from("notifications").select("*").eq("user_id", uid).order("created_at",{ascending:false}).limit(50)
    ]);
    S.profile = pr.data || null;
    if (S.profile) S.profiles[uid] = S.profile;
    if (S.profile && Date.now() - new Date(S.profile.created_at).getTime() < 10*60*1000) setTimeout(welcome, 400);
    S.wish = new Set((w.data || []).map(x => x.project_id));
    S.notes = n.data || [];
    S.channel = sb.channel("notes-"+uid).on("postgres_changes", {event:"INSERT", schema:"public", table:"notifications", filter:`user_id=eq.${uid}`}, payload => {
      S.notes.unshift(payload.new); renderHeader(); toast("🔔 " + str(payload.new.message, 80));
    }).subscribe();
  }
  renderHeader();
}

/* ---------- categories ---------- */
function renderCatbar(){
  const bar = $("#catbar"); bar.textContent = "";
  const R = S.route.name;
  const link = (label, active, fn, cls) => {
    const a = h("a",{href: fn ? "#/browse" : "#/", class:cls||null, "aria-current": active ? "page" : null}, label);
    if (fn) a.addEventListener("click", e => { e.preventDefault(); fn(); });
    return a;
  };
  bar.append(link("홈", R === "home", null));
  Object.entries(CAT_KIND).forEach(([k,l]) => bar.append(link(l, R === "browse" && S.kind === k && !S.tag && !S.q, () => goBrowse({kind:k}))));
  const tags = topTags(8);
  if (tags.length){
    bar.append(h("span",{class:"sep","aria-hidden":"true"}));
    tags.forEach(t => bar.append(link("#"+t, R === "browse" && S.tag === t, () => goBrowse({tag:t}), "t")));
  }
}
function goBrowse(o){
  S.kind = o.kind || "all"; S.tag = o.tag || null; S.q = o.q || ""; S.sort = o.sort || "new";
  if (!o.keepSearch) $("#search").value = S.q;
  go("#/browse");
}

/* ---------- router ---------- */
async function slugToId(slug){
  if (!/^[a-z0-9]{4,12}$/.test(slug)) return null;
  const hit = S.projects.find(p => p.slug === slug); if (hit) return hit.id;
  const { data } = await sb.from("projects").select("*").eq("slug", slug).maybeSingle();
  if (data){ S.projects.push(data); return data.id; }
  return null;
}
async function route(){
  closeLayer();
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/");
  const r = parts[0] || "";
  if (r === "p" && parts[1]) S.route = {name:"project", id:parts[1]};
  else if (r === "edit" && parts[1]) S.route = {name:"edit", id:parts[1]};
  else if (r === "u" && parts[1]) S.route = {name:"user", id:parts[1]};
  else if (r === "stats" && parts[1]) S.route = {name:"stats", id:parts[1]};
  else if (r === "a" && parts[1]){ const id = await slugToId(parts[1]); if (id){ history.replaceState(null, "", BASE + "#/p/" + id); S.route = {name:"project", id}; } else S.route = {name:"missing"}; }
  else if (r === "c" && parts[1]) S.route = {name:"collection", slug:decodeURIComponent(parts[1])};
  else if (["browse","upload","library","guide","nominees","collections","creators","for-orgs","pricing"].includes(r)) S.route = {name:r};
  else S.route = {name:"home"};
  renderCatbar();
  $(".catbar-wrap").hidden = !["home","browse"].includes(S.route.name);
  document.querySelectorAll(".mainnav a").forEach(a => a.dataset.nav === S.route.name ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current"));
  const m = $("#main"); m.textContent = "";
  window.scrollTo(0,0);
  try{
    if (S.route.name === "home") renderHome(m);
    else if (S.route.name === "browse") renderBrowse(m);
    else if (S.route.name === "upload") renderUpload(m);
    else if (S.route.name === "library") await renderLibrary(m);
    else if (S.route.name === "project") await renderProject(m, S.route.id);
    else if (S.route.name === "edit") await renderEdit(m, S.route.id);
    else if (S.route.name === "user") await renderUser(m, S.route.id);
    else if (S.route.name === "stats") await renderStats(m, S.route.id);
    else if (S.route.name === "guide") renderGuide(m);
    else if (S.route.name === "nominees") renderNominees(m);
    else if (S.route.name === "collections") renderCollections(m);
    else if (S.route.name === "collection") await renderCollection(m, S.route.slug);
    else if (S.route.name === "creators") renderCreators(m);
    else if (S.route.name === "for-orgs") renderForOrgs(m);
    else if (S.route.name === "pricing") renderPricing(m);
    else if (S.route.name === "missing") m.append(h("div",{class:"empty"},"작품을 찾을 수 없어요. 주소를 다시 확인해 주세요. ", h("a",{href:"#/"},"홈으로")));
  }catch(e){ console.error(e); m.append(h("div",{class:"empty"}, errMsg(e))); }
}

/* ---------- home ---------- */
function shelf(title, sub, list, more){
  if (!list.length) return null;
  const head = h("div",{class:"shelf-head"}, h("div",null, h("h2",null,title), sub ? h("p",null,sub) : null));
  if (more){ const a = h("a",{href:"#/browse"},"전체 보기 ›"); a.addEventListener("click", e => { e.preventDefault(); goBrowse(more); }); head.append(a); }
  return h("section",{class:"shelf"}, head, h("div",{class:"rowscroll"}, list.slice(0,10).map(capsule)));
}
function heroList(){
  const vis = S.projects.filter(isPublic);
  const picks = vis.filter(p => p.featured).sort(byNew);
  if (picks.length) return picks.slice(0,6);
  const score = p => (Number(S.scores[p.id]?.review_count)||0)*3 + new Date(p.created_at).getTime()/864e5/30;
  return [...vis].filter(p => p.cover_path).sort((a,b) => score(b)-score(a)).slice(0,4);
}
function onboarding(){
  let off = false; try{ off = localStorage.getItem("onboard_off") === "1"; }catch(e){}
  if (off) return null;
  const box = h("div",{class:"onboard"},
    h("div",{class:"s"}, h("b",{class:"n"},"1"), h("div",null, h("b",null,"써 보기"), h("span",null,"마음에 드는 작품을 눌러 바로 테스트해요"))),
    h("div",{class:"s"}, h("b",{class:"n"},"2"), h("div",null, h("b",null,"리뷰 남기기"), h("span",null,"👍/👎와 한 줄이면 충분해요"))),
    h("div",{class:"s"}, h("b",{class:"n"},"3"), h("div",null, h("b",null,"내 작품 올리기"), h("span",null,"무료로 올리고 피드백을 받아요"))),
    h("button",{class:"x", type:"button", "aria-label":"안내 닫기", onclick:() => { try{ localStorage.setItem("onboard_off","1"); }catch(e){} box.remove(); }},"×"));
  return box;
}
function podProject(){
  const P = S.projects.filter(isPublic), t = todayKST();
  const pods = P.filter(p => p.pod_date && p.pod_date <= t).sort((a,b) => b.pod_date.localeCompare(a.pod_date));
  if (pods.length) return pods[0];
  const f = P.filter(p => p.featured).sort(byNew); if (f.length) return f[0];
  return [...P].sort((a,b) => (Number(S.scores[b.id]?.review_count)||0) - (Number(S.scores[a.id]?.review_count)||0) || byNew(a,b))[0];
}
function sectionHead(title, sub, more){
  let link = null;
  if (more){ link = h("a",{class:"more", href: more.href || "#/browse"}, more.label || "전체 보기 →"); if (more.browse) link.addEventListener("click", e => { e.preventDefault(); goBrowse(more.browse); }); }
  return h("div",{class:"sec-head"}, h("div",null, h("h2",{class:"sec-title"}, title), sub ? h("p",{class:"sec-sub"}, sub) : null), link);
}
function collectionItems(c){ return S.colItems.filter(i => i.collection_id === c.id).map(i => S.projects.find(p => p.id === i.project_id)).filter(p => p && isPublic(p)); }
function collectionCard(c){
  const items = collectionItems(c);
  return h("a",{class:"col-card", href:"#/c/"+encodeURIComponent(c.slug)},
    h("div",{class:"col-mosaic"}, items.length ? items.slice(0,3).map(p => cover(p)) : h("div",{class:"cover col-empty"}, h("span",null,"준비 중"))),
    h("div",{class:"col-meta"}, h("span",{class:"eyebrow"}, c.org_name || "큐레이션"), h("h3",null, str(c.title,60)), h("span",{class:"sec-sub num"}, `작품 ${items.length}개`, c.is_published ? "" : " · 비공개")));
}
function creatorRows(){
  const P = S.projects.filter(isPublic), by = {};
  P.forEach(p => { const o = by[p.owner_id] ||= {uid:p.owner_id, works:0, reviews:0, sum:0, n:0, kinds:{}}; o.works++; o.reviews += Number(S.scores[p.id]?.review_count)||0; const sc = scoreOf(p.id); if (sc.overall != null){ o.sum += sc.overall; o.n++; } o.kinds[kindOf(p)] = (o.kinds[kindOf(p)]||0)+1; });
  return Object.values(by).map(o => ({...o, avg: o.n ? o.sum/o.n : null, kind: KINDS[Object.entries(o.kinds).sort((a,b)=>b[1]-a[1])[0][0]]}))
    .sort((a,b) => b.reviews - a.reviews || b.works - a.works);
}
function creatorTable(rows){
  return h("div",{class:"dir-wrap"}, h("table",{class:"dir"},
    h("thead",null, h("tr",null, h("th",null,"크리에이터"), h("th",{class:"r"},"작품"), h("th",{class:"r"},"받은 리뷰"), h("th",{class:"r"},"평균 점수"), h("th",{class:"hide-s"},"주 분야"))),
    h("tbody",null, rows.map(o => { const pr = S.profiles[o.uid] || {}; return h("tr",null,
      h("td",null, h("a",{class:"who", href:"#/u/"+o.uid}, h("span",{class:"avatar sm"}, pr.avatar_url ? h("img",{src:pr.avatar_url, alt:"", referrerpolicy:"no-referrer"}) : str(pr.display_name,1) || "?"), nameOf(o.uid))),
      h("td",{class:"r num"}, o.works), h("td",{class:"r num"}, o.reviews), h("td",{class:"r num"}, fmt(o.avg)), h("td",{class:"hide-s"}, h("span",{class:"tag-l"}, o.kind))); }))));
}
function orgBand(){
  return h("section",{class:"band"},
    h("div",null, h("p",{class:"eyebrow inv"},"학교 · 창업지원기관"), h("h2",{class:"band-title"},"학생 작품을 한 학기 동안", h("br"), "진짜 사용자에게 검증받으세요."),
      h("p",{class:"band-sub"},"학기 전시관을 열면 외부 테스터의 점수와 리뷰가 모이고, 학기 말엔 성과 리포트가 나와요.")),
    h("div",{class:"band-cta"}, h("a",{class:"btn invert lg", href:"#/for-orgs"},"기관용 전시관 알아보기 →"), h("a",{class:"band-link", href:"#/pricing"},"메이커 플랜 보기")));
}
function renderHome(m){
  m.append(h("section",{class:"intro"},
    h("h1",{class:"mega"}, "만들고, 써 보고,", h("br"), h("em",null,"함께 키우는"), " 곳."),
    h("div",{class:"intro-side"},
      h("p",{class:"lede"},"인디 메이커와 학생이 만든 게임·앱·포트폴리오를 직접 써 보고, 점수와 리뷰로 다음 버전을 함께 만들어요."),
      h("div",{class:"intro-cta"}, h("a",{class:"btn primary lg", href:"#/upload"},"작품 제출하기"), h("a",{class:"btn lg", href:"#/nominees"},"평가하러 가기")))));
  if (!S.loaded){ m.append(h("div",{class:"empty"},"불러오는 중이에요…")); return; }
  const P = S.projects.filter(isPublic);
  if (!P.length){ m.append(h("div",{class:"empty"},"아직 공개된 작품이 없어요. ", h("a",{href:"#/upload"},"첫 작품 제출하기")), orgBand()); return; }
  const hero = podProject(), sc = scoreOf(hero.id), isPod = !!hero.pod_date;
  m.append(h("section",{class:"pod"},
    h("div",{class:"pod-label"}, h("span",{class:"pill-pod"}, isPod ? "오늘의 프로토타입" : "주목할 작품"), isPod ? h("span",{class:"num sec-sub"}, date(hero.pod_date)) : null),
    h("div",{class:"pod-grid"},
      h("a",{class:"pod-media", href:"#/p/"+hero.id, "aria-label":str(hero.title,60)}, cover(hero)),
      h("div",{class:"pod-info"},
        h("h2",{class:"display"}, h("a",{href:"#/p/"+hero.id}, str(hero.title,60))),
        hero.tagline ? h("p",{class:"lede"}, str(hero.tagline,140)) : null,
        h("p",{class:"byline"}, "by ", h("a",{href:"#/u/"+hero.owner_id}, nameOf(hero.owner_id)), " · ", KINDS[kindOf(hero)]),
        h("div",{class:"pod-score"}, ring(sc.overall, 104), scoreBars(sc)),
        h("p",{class:"sec-sub"}, sc.count ? `${sc.count}명이 평가했어요 · ` : "아직 점수가 없어요 · ", summary(hero.id).label),
        h("a",{class:"btn primary", href:"#/p/"+hero.id},"써 보고 평가하기 →")))));
  const sm = Object.fromEntries(P.map(p => [p.id, summary(p.id)]));
  const grid = (list, n) => h("div",{class:"grid"}, list.slice(0, n || 8).map(capsule));
  const nominees = P.filter(p => sm[p.id].n < 3 && p.id !== hero.id).sort(byNew);
  if (nominees.length) m.append(h("section",{class:"sec"}, sectionHead("노미니","리뷰 3개가 모이기 전의 작품이에요. 첫 평가자가 되어 주세요.", {href:"#/nominees"}), grid(nominees, 8)));
  const scored = P.filter(p => scoreOf(p.id).overall != null).sort((a,b) => scoreOf(b.id).overall - scoreOf(a.id).overall);
  if (scored.length >= 2) m.append(h("section",{class:"sec"}, sectionHead("높은 점수","디자인·사용성·창의성·완성도 평균이 높은 작품", {browse:{sort:"score"}}), grid(scored, 4)));
  m.append(h("section",{class:"sec"}, sectionHead("새로 올라온 작품", null, {browse:{sort:"new"}}), grid([...P].sort(byNew), 8)));
  const cols = S.collections.filter(c => c.is_published);
  if (cols.length) m.append(h("section",{class:"sec"}, sectionHead("컬렉션","학교·기관 전시관과 큐레이션 모음", {href:"#/collections"}), h("div",{class:"col-grid"}, cols.slice(0,3).map(collectionCard))));
  const pf = P.filter(p => kindOf(p) === "portfolio").sort(byNew);
  if (pf.length) m.append(h("section",{class:"sec"}, sectionHead("학생 포트폴리오","수업과 프로젝트에서 나온 프로토타입", {browse:{kind:"portfolio"}}), grid(pf, 4)));
  const cr = creatorRows();
  if (cr.length) m.append(h("section",{class:"sec"}, sectionHead("크리에이터","리뷰를 가장 많이 받은 메이커", {href:"#/creators"}), creatorTable(cr.slice(0,5))));
  m.append(orgBand());
}
function renderNominees(m){
  const P = S.projects.filter(isPublic).filter(p => summary(p.id).n < 3)
    .sort((a,b) => summary(a.id).n - summary(b.id).n || byNew(a,b));
  m.append(h("section",{class:"page-head"}, h("p",{class:"eyebrow"},"노미니"), h("h1",{class:"display"},"평가를 기다리는 작품"),
    h("p",{class:"lede"},"리뷰가 3개 모이면 '높은 점수' 순위에 오를 수 있어요. 써 보고 디자인·사용성·창의성·완성도를 10점 만점으로 매겨 주세요.")),
    !S.loaded ? h("div",{class:"empty"},"불러오는 중이에요…") : P.length ? h("div",{class:"grid"}, P.map(capsule)) : h("div",{class:"empty"},"지금은 평가를 기다리는 작품이 없어요. ", h("a",{href:"#/browse"},"전체 작품 보기")));
}
function renderCollections(m){
  const cols = S.collections.filter(c => c.is_published || isAdmin());
  m.append(h("section",{class:"page-head"}, h("p",{class:"eyebrow"},"컬렉션"), h("h1",{class:"display"},"전시관과 큐레이션"),
    h("p",{class:"lede"},"학교·기관의 학기 전시관, 그리고 운영자가 고른 주제별 모음이에요.")),
    cols.length ? h("div",{class:"col-grid"}, cols.map(collectionCard)) : h("div",{class:"empty"},"아직 공개된 컬렉션이 없어요."),
    orgBand());
}
async function renderCollection(m, slug){
  let c = S.collections.find(x => x.slug === slug);
  if (!c){ const { data } = await sb.from("collections").select("*").eq("slug", slug).maybeSingle(); c = data; }
  if (!c){ m.append(h("div",{class:"empty"},"컬렉션을 찾을 수 없어요. ", h("a",{href:"#/collections"},"컬렉션 목록"))); return; }
  const items = collectionItems(c);
  const reviews = items.reduce((s,p) => s + (Number(S.scores[p.id]?.review_count)||0), 0);
  const ups = items.reduce((s,p) => s + (Number(S.scores[p.id]?.up_count)||0), 0);
  const scs = items.map(p => scoreOf(p.id).overall).filter(v => v != null);
  const avg = scs.length ? scs.reduce((s,v) => s+v, 0) / scs.length : null;
  m.append(h("section",{class:"page-head"}, h("p",{class:"eyebrow"}, c.org_name || "큐레이션"), h("h1",{class:"display"}, str(c.title,60)),
      c.description ? h("p",{class:"lede"}, str(c.description,600)) : null,
      c.is_published ? null : h("p",{class:"warn"},"비공개 컬렉션이에요. 관리자만 볼 수 있어요.")),
    h("div",{class:"stats4"},
      h("div",null, h("b",{class:"num"}, items.length), h("span",null,"전시 작품")),
      h("div",null, h("b",{class:"num"}, reviews), h("span",null,"외부 리뷰")),
      h("div",null, h("b",{class:"num"}, reviews ? Math.round(ups/reviews*100) + "%" : "–"), h("span",null,"추천 비율")),
      h("div",null, h("b",{class:"num"}, fmt(avg)), h("span",null,"평균 점수 / 10"))),
    items.length ? h("div",{class:"grid"}, items.map(capsule)) : h("div",{class:"empty"},"아직 전시된 작품이 없어요."));
  if (isAdmin()) m.append(h("div",{class:"panel", style:"margin-top:24px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"}, h("b",null,"관리자"),
    h("button",{class:"btn small", type:"button", onclick:async () => { const { error } = await sb.from("collections").update({is_published:!c.is_published}).eq("id", c.id); if (error) return toast(errMsg(error)); await loadCollections(); route(); }}, c.is_published ? "비공개로 전환" : "공개하기"),
    h("span",{class:"sec-sub"},"작품은 작품 페이지의 관리자 도구에서 추가해요.")));
}
function renderCreators(m){
  const rows = creatorRows();
  m.append(h("section",{class:"page-head"}, h("p",{class:"eyebrow"},"크리에이터"), h("h1",{class:"display"},"메이커 디렉토리"),
    h("p",{class:"lede"},"작품을 올린 메이커와 학생들이에요. 받은 리뷰가 많은 순서로 보여요.")),
    rows.length ? creatorTable(rows) : h("div",{class:"empty"},"아직 공개된 작품이 없어요."));
}
function inquiryForm(kind, interests, cta){
  const v = id => ($("#"+id)?.value || "").trim();
  const err = h("p",{class:"err", role:"alert"}), ok = h("p",{class:"okmsg", role:"status"});
  const btn = h("button",{class:"btn primary", type:"submit"}, cta || "문의 보내기");
  const form = h("form",{class:"form inq", novalidate:true},
    h("div",{class:"two"}, field("iq-name","이름", h("input",{type:"text", id:"iq-name", maxlength:"60", value:(S.profile && S.profile.display_name) || ""})),
      field("iq-org", kind === "org" ? "기관·학교명" : "팀·작품명 (선택)", h("input",{type:"text", id:"iq-org", maxlength:"80"}))),
    h("div",{class:"two"}, field("iq-email","이메일", h("input",{type:"email", id:"iq-email", maxlength:"120", value:(S.user && S.user.email) || ""})),
      field("iq-phone","연락처 (선택)", h("input",{type:"text", id:"iq-phone", maxlength:"30"}))),
    field("iq-interest","관심 있는 상품", h("select",{id:"iq-interest"}, interests.map(x => h("option",{value:x}, x)))),
    field("iq-msg","남길 말 (선택)", h("textarea",{id:"iq-msg", maxlength:"1000", placeholder: kind === "org" ? "학생 수, 진행 학기, 원하는 일정을 적어 주세요" : "어떤 작품인지, 언제 쓰고 싶은지 적어 주세요"})),
    h("label",{class:"check"}, h("input",{type:"checkbox", id:"iq-agree"}), h("span",null,"상담을 위한 개인정보(이름·이메일·연락처) 수집·이용에 동의해요. ", h("a",{href:"privacy.html", target:"_blank"},"자세히"))),
    err, ok, h("div",null, btn));
  form.addEventListener("submit", async ev => {
    ev.preventDefault(); err.textContent = ""; ok.textContent = "";
    if (!v("iq-name")) return err.textContent = "이름을 적어 주세요.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("iq-email"))) return err.textContent = "연락받을 이메일을 정확히 적어 주세요.";
    if (!$("#iq-agree").checked) return err.textContent = "개인정보 수집·이용에 동의해 주세요.";
    btn.disabled = true;
    const { error } = await sb.from("inquiries").insert({ kind, user_id: S.user ? S.user.id : null, name:v("iq-name"), org:v("iq-org")||null, email:v("iq-email"), phone:v("iq-phone")||null, interest:v("iq-interest"), message:v("iq-msg")||null });
    btn.disabled = false;
    if (error) return err.textContent = errMsg(error);
    form.reset(); ok.textContent = kind === "org" ? "문의가 접수됐어요. 2영업일 안에 이메일로 연락드릴게요." : "사전 신청이 완료됐어요. 출시되면 가장 먼저 알려 드릴게요.";
  });
  return form;
}
function planCard(name, price, unit, lines, note, main){
  return h("div",{class:"plan" + (main ? " main" : "")}, h("span",{class:"eyebrow"}, name), h("div",{class:"plan-price"}, h("b",{class:"num"}, price), unit ? h("span",null, unit) : null),
    h("ul",null, lines.map(l => h("li",null,l))), note ? h("p",{class:"sec-sub"}, note) : null);
}
function renderForOrgs(m){
  m.append(h("section",{class:"page-head"}, h("p",{class:"eyebrow"},"기관용 · 학교 · 창업지원기관"), h("h1",{class:"mega sm"},"학생 작품에", h("br"), h("em",null,"진짜 사용자"), "를 붙여 드려요."),
      h("p",{class:"lede"},"학기 전시관을 열면 학생 작품이 프로토타입 스토어에 공개되고, 외부 테스터의 점수·리뷰·방문 통계가 쌓여요. 학기 말에는 교육 성과 보고에 바로 쓸 수 있는 리포트를 드려요.")),
    h("section",{class:"sec"}, h("div",{class:"why3"},
      h("div",null, h("b",{class:"num"},"01"), h("h3",null,"외부 피드백"), h("p",null,"같은 반 친구가 아닌 실제 테스터가 디자인·사용성·창의성·완성도를 10점 만점으로 평가해요.")),
      h("div",null, h("b",{class:"num"},"02"), h("h3",null,"성과 증빙"), h("p",null,"작품 수, 리뷰 수, 추천 비율, 평균 점수, 방문 수를 전시관 페이지와 리포트로 정리해요.")),
      h("div",null, h("b",{class:"num"},"03"), h("h3",null,"운영 부담 없음"), h("p",null,"심사·공개·알림·통계를 플랫폼이 처리해요. 담당자는 학생에게 링크만 안내하면 돼요.")))),
    h("section",{class:"sec"}, sectionHead("상품", "가격은 규모와 기간에 따라 조정돼요. 첫 학기는 파일럿으로 함께 설계해요."),
      h("div",{class:"plans"},
        planCard("파일럿","무료","1개 과목",["전시관 페이지 1개","작품 30개까지","기본 성과 요약"],"선착순 기관 대상"),
        planCard("학기 전시관","300~500만 원","/ 학기",["학과·수업 전용 전시관","외부 테스터 모집과 리뷰 운영","학기 말 성과 리포트(PDF)","오늘의 프로토타입 선정 지원"],null,true),
        planCard("데모데이 · 경진대회","500~1,500만 원","/ 행사",["온라인 전시 + 심사위원 평가","대중 투표·리뷰 집계","시상·결과 리포트"],null))),
    h("section",{class:"sec two-col"}, h("div",null, h("h2",{class:"sec-title"},"도입 문의"), h("p",{class:"sec-sub"},"남겨 주시면 2영업일 안에 이메일로 연락드려요.")),
      inquiryForm("org", ["파일럿 (무료)","학기 전시관","데모데이·경진대회","기타"])));
}
function renderPricing(m){
  m.append(h("section",{class:"page-head"}, h("p",{class:"eyebrow"},"메이커 플랜"), h("h1",{class:"display"},"기본은 계속 무료예요."),
      h("p",{class:"lede"},"등록·리뷰·30일 통계는 앞으로도 무료예요. 더 빨리, 더 많은 사람에게 보여 주고 싶을 때 쓰는 옵션을 준비하고 있어요.")),
    h("div",{class:"plans four"},
      planCard("무료","0원",null,["링크 한 줄 등록","리뷰·점수·알림","30일 방문 통계","짧은 주소·QR"],"지금 바로 쓸 수 있어요",true),
      planCard("빠른 심사","9,900원","/ 1회",["24시간 안에 심사 결과"],"출시 예정"),
      planCard("추천 노출","29,000원~","/ 1주",["홈 '주목할 작품' 노출","카테고리 상단 고정"],"출시 예정"),
      planCard("테스터 모집권","90,000원","/ 10명",["조건에 맞는 테스터 10명","상세 리뷰 보장","외국인 테스터 선택 가능"],"출시 예정")),
    h("section",{class:"sec two-col"}, h("div",null, h("h2",{class:"sec-title"},"사전 신청"), h("p",{class:"sec-sub"},"관심 있는 옵션을 알려 주시면 출시할 때 가장 먼저 연락드려요.")),
      inquiryForm("maker_waitlist", ["빠른 심사","추천 노출","테스터 모집권","프로 멤버십 (90일 통계·AI 요약)"], "사전 신청하기")));
}
/* ---------- browse ---------- */
function renderBrowse(m){
  const title = () => S.q ? `"${str(S.q,40)}" 검색 결과` : S.tag ? "#" + S.tag : (CAT_KIND[S.kind] || "전체");
  const seg = h("div",{class:"seg", role:"group", "aria-label":"종류"}, Object.entries(CAT_KIND).map(([k,l]) => {
    const b = h("button",{type:"button","aria-pressed":String(S.kind===k)}, k === "portfolio" ? "포트폴리오" : l);
    b.addEventListener("click", () => { S.kind = k; seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x===b))); $("#browse-title").textContent = title(); renderCatbar(); renderGrid(); });
    return b;
  }));
  const sort = h("select",{id:"sort","aria-label":"정렬"}, h("option",{value:"new"},"신규 출시"), h("option",{value:"top"},"추천 많은 순"), h("option",{value:"score"},"평균 점수 순"), h("option",{value:"need"},"리뷰가 필요한 순"));
  sort.value = S.sort; sort.addEventListener("change", () => { S.sort = sort.value; renderGrid(); });
  const clear = (S.q || S.tag) ? h("button",{class:"btn small", type:"button", onclick:() => goBrowse({kind:S.kind})},"필터 지우기") : null;
  m.append(
    h("div",{class:"browse-head"}, h("p",{class:"eyebrow"}, S.q ? "검색" : S.tag ? "태그" : "카테고리"), h("h2",{id:"browse-title"}, title())),
    h("div",{class:"filters"}, seg, sort, clear),
    h("div",{class:"tagrow", id:"tagrow"}),
    h("p",{class:"note", id:"count", style:"margin:-6px 0 12px"}),
    h("div",{id:"grid"}));
  renderGrid();
}
function renderGrid(){
  const g = $("#grid"); if (!g) return;
  g.textContent = ""; g.className = "grid";
  let list = S.projects.filter(p => isPublic(p) && (S.kind === "all" || kindOf(p) === S.kind));
  const tc = {}; list.forEach(p => arr(p.tags).forEach(t => { tc[t] = (tc[t]||0)+1; }));
  const tr = $("#tagrow");
  if (tr){
    tr.textContent = "";
    Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,16).forEach(([t]) => {
      const b = h("button",{class:"tag", type:"button","aria-pressed":String(S.tag===t)}, "#"+t);
      b.addEventListener("click", () => { S.tag = S.tag === t ? null : t; $("#browse-title").textContent = S.tag ? "#"+S.tag : (S.q ? `"${str(S.q,40)}" 검색 결과` : CAT_KIND[S.kind]); renderCatbar(); renderGrid(); });
      tr.append(b);
    });
  }
  if (S.tag) list = list.filter(p => arr(p.tags).includes(S.tag));
  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(p => [p.title,p.tagline,p.description,arr(p.tags).join(" "),p.school,p.major,KINDS[kindOf(p)],nameOf(p.owner_id)].join(" ").toLowerCase().includes(q));
  const sm = Object.fromEntries(list.map(p => [p.id, summary(p.id)]));
  list.sort((a,b) => S.sort === "score" ? ((scoreOf(b.id).overall ?? -1) - (scoreOf(a.id).overall ?? -1)) || byNew(a,b) : S.sort === "top" ? (sm[b.id].up - sm[a.id].up) || (sm[b.id].pct - sm[a.id].pct)
    : S.sort === "need" ? (sm[a.id].n - sm[b.id].n) || byNew(a,b) : byNew(a,b));
  const cnt = $("#count"); if (cnt) cnt.textContent = S.loaded ? `작품 ${list.length}개` : "";
  if (!S.loaded){ g.className = ""; g.append(h("div",{class:"empty"},"불러오는 중이에요…")); return; }
  if (!list.length){ g.className = ""; g.append(h("div",{class:"empty"}, q || S.tag ? "조건에 맞는 작품이 없어요. 다른 검색어나 카테고리를 골라 보세요." : "이 카테고리에는 아직 작품이 없어요. ", h("a",{href:"#/upload"},"작품 올리기"))); return; }
  list.forEach(p => g.append(capsule(p)));
}

/* ---------- images ---------- */
async function prepImage(file){
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error("mime type");
  if (file.type === "image/gif"){ if (file.size > 10*1024*1024) throw new Error("Payload too large"); return file; }
  try{
    const bmp = await createImageBitmap(file);
    const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width*sc); cv.height = Math.round(bmp.height*sc);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    let blob = await new Promise(r => cv.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.type !== "image/webp") blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
    if (blob) return blob;
  }catch(e){}
  if (file.size > 10*1024*1024) throw new Error("Payload too large");
  return file;
}
async function uploadImage(file){
  const blob = await prepImage(file);
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${S.user.id}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(36).slice(2))}.${ext}`;
  const { error } = await sb.storage.from("media").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert:false, cacheControl:"31536000" });
  if (error) throw error;
  return path;
}

/* ---------- upload (step 1): URL 한 줄 등록 ---------- */
function renderUpload(m){
  m.append(h("div",{class:"steps"}, h("span",{class:"on"},"1. 링크 넣기"), h("span",null,"2. 더 꾸미기 (선택)"), h("span",null,"3. 심사 후 공개")),
    h("h2",{style:"font-size:24px;margin-bottom:6px"},"작품 올리기"),
    h("p",{class:"note", style:"margin-bottom:16px"},"링크만 넣으면 이름·소개·대표 이미지를 자동으로 가져와요. 등록은 무료이고, 보통 1~2일 안에 심사 결과를 알림으로 알려 드려요."));
  if (!S.user){
    m.append(h("div",{class:"empty"},"작품을 올리려면 로그인이 필요해요. ", h("button",{class:"btn small primary", type:"button", onclick:()=>openLogin("로그인하고 첫 작품을 올려 보세요.")},"로그인")));
    return;
  }
  let auto = {cover_path:null, icon_path:null};
  const urlIn = h("input",{type:"url", id:"f-link", required:true, placeholder:"https://내작품.com", inputmode:"url", autocomplete:"url"});
  const fetchBtn = h("button",{class:"btn", type:"button"},"불러오기");
  const fetchNote = h("p",{class:"fine", role:"status"});
  const details = h("div",{class:"form", hidden:true});
  const kind = h("div",{class:"checks", role:"radiogroup", "aria-label":"종류"}, Object.entries(KINDS).map(([k,l],i) => h("label",null, h("input",{type:"radio", name:"kind", value:k, checked:i===0}), l)));
  const titleIn = h("input",{type:"text", id:"f-title", maxlength:"60", required:true, placeholder:"작품 이름"});
  const tagIn = h("input",{type:"text", id:"f-tagline", maxlength:"120", placeholder:"한 줄 소개"});
  const coverIn = h("input",{type:"file", id:"f-cover", accept:"image/png,image/jpeg,image/webp,image/gif"});
  const prev = h("div",{class:"preview-row"});
  const drawPrev = () => {
    prev.textContent = "";
    const f = coverIn.files[0];
    if (f) prev.append(h("figure",null, h("img",{src:URL.createObjectURL(f), alt:"대표 이미지 미리보기"})));
    else if (auto.cover_path) prev.append(h("figure",null, h("img",{src:mediaUrl(auto.cover_path), alt:"자동으로 가져온 대표 이미지"})));
    if (auto.icon_path) prev.append(h("figure",{style:"width:54px;aspect-ratio:1"}, h("img",{src:mediaUrl(auto.icon_path), alt:"앱 아이콘"})));
  };
  coverIn.addEventListener("change", drawPrev);
  let lastFetched = "";
  const doFetch = async () => {
    const link = safeUrl(urlIn.value.trim());
    if (!link){ fetchNote.textContent = "https:// 로 시작하는 주소를 넣어 주세요."; return; }
    details.hidden = false;
    if (link === lastFetched) return;
    lastFetched = link; fetchBtn.disabled = true; fetchNote.textContent = "사이트에서 정보를 가져오는 중이에요…";
    try{
      const { data, error } = await sb.functions.invoke("fetch-meta", { body:{ url:link } });
      if (error) throw error;
      if (!data || data.error){ fetchNote.textContent = "사이트 정보를 자동으로 가져오지 못했어요. 아래 칸을 직접 채워 주세요."; }
      else {
        if (data.title && !titleIn.value) titleIn.value = data.title;
        if (data.description && !tagIn.value) tagIn.value = data.description.slice(0,120);
        auto = {cover_path:data.cover_path || null, icon_path:data.icon_path || null};
        fetchNote.textContent = data.cover_path ? "자동으로 채웠어요. 확인하고 고쳐 주세요." : "이름과 소개를 채웠어요. 대표 이미지는 직접 골라 주세요.";
        drawPrev();
      }
    }catch(e){ fetchNote.textContent = "자동 불러오기에 실패했어요. 아래 칸을 직접 채워 주세요."; }
    fetchBtn.disabled = false; titleIn.focus();
  };
  fetchBtn.addEventListener("click", doFetch);
  urlIn.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); doFetch(); } });
  urlIn.addEventListener("change", doFetch);
  const err = h("p",{class:"err", role:"alert"});
  const btn = h("button",{class:"btn primary", type:"submit"},"심사 신청하기");
  details.append(
    h("div",{class:"field"}, h("span",{class:"legend"},"종류"), kind),
    field("f-title","이름", titleIn),
    field("f-tagline","한 줄 소개", tagIn),
    h("div",{class:"field"}, h("label",{for:"f-cover"},"대표 이미지"), prev, coverIn, h("small",null,"자동으로 가져온 이미지가 마음에 들지 않으면 직접 골라 주세요. 가로형(16:9)이 가장 잘 보여요.")),
    err, h("div",null, btn));
  const form = h("form",{class:"panel form", novalidate:true},
    h("div",{class:"field"}, h("label",{for:"f-link"},"작품 링크"), h("div",{style:"display:flex;gap:8px"}, urlIn, fetchBtn), fetchNote,
      h("small",null,"웹 주소, itch.io, 피그마 프로토타입, 앱스토어·TestFlight·구글플레이 링크 모두 좋아요.")),
    details);
  form.addEventListener("submit", async ev => {
    ev.preventDefault(); err.textContent = "";
    const title = titleIn.value.trim(), link = safeUrl(urlIn.value.trim());
    const k = form.querySelector('input[name="kind"]:checked')?.value || "app";
    if (!link) return err.textContent = "링크는 https:// 로 시작하는 주소로 적어 주세요.";
    if (!title) return err.textContent = "이름을 적어 주세요.";
    if (!coverIn.files[0] && !auto.cover_path) return err.textContent = "대표 이미지를 한 장 골라 주세요. 화면 캡처면 충분해요.";
    btn.disabled = true;
    try{
      let cover_path = auto.cover_path;
      if (coverIn.files[0]){ btn.textContent = "이미지 올리는 중…"; cover_path = await uploadImage(coverIn.files[0]); }
      btn.textContent = "신청하는 중…";
      const { data, error } = await sb.from("projects").insert({ owner_id:S.user.id, kind:k, title, link, cover_path, icon_path:auto.icon_path, tagline:tagIn.value.trim() || null }).select("*").single();
      if (error) throw error;
      S.projects.unshift(data); S.scores[data.id] = {project_id:data.id, review_count:0, up_count:0};
      toast(data.status === "approved" ? "작품이 바로 공개됐어요! 🎉" : "심사 신청 완료! 결과는 알림으로 알려 드릴게요");
      go("#/edit/"+data.id);
    }catch(e){ btn.disabled = false; btn.textContent = "심사 신청하기"; err.textContent = errMsg(e); }
  });
  m.append(form);
}

/* ---------- edit (step 2) ---------- */
async function getProject(id){
  let p = S.projects.find(x => x.id === id);
  if (!p){
    const { data } = await sb.from("projects").select("*").eq("id", id).maybeSingle();
    if (data){ p = data; S.projects.push(p); await refreshScore(id); await loadProfiles([p.owner_id]); }
  }
  return p;
}
async function renderEdit(m, id){
  const p = await getProject(id);
  if (!p){ m.append(h("div",{class:"empty"},"작품을 찾을 수 없어요.")); return; }
  if (!isMaker(p)){ m.append(h("div",{class:"empty"},"내 작품만 수정할 수 있어요.")); return; }
  const v = (id) => ($("#"+id)?.value || "").trim();
  const tagIn = h("input",{type:"text", id:"e-tags", value:arr(p.tags).join(", "), placeholder:"쉼표로 구분 (최대 6개)"});
  const sugg = h("div",{class:"tagrow", style:"margin:4px 0 0"}, TAG_SUGGEST.map(t => h("button",{class:"tag", type:"button", onclick:() => {
    const cur = tagIn.value.split(",").map(s=>s.trim()).filter(Boolean);
    if (!cur.includes(t) && cur.length < 6){ cur.push(t); tagIn.value = cur.join(", "); }
  }}, "+"+t)));
  const plats = h("div",{class:"checks"}, PLATFORMS.map((x,i) => h("label",null, h("input",{type:"checkbox", id:"pl"+i, checked:arr(p.platforms).includes(x)}), x)));
  const kindSel = h("select",{id:"e-kind"}, Object.entries(KINDS).map(([k,l]) => h("option",{value:k, selected:p.kind===k}, l)));
  const pf = h("div",{class:"two", hidden:p.kind !== "portfolio"},
    field("e-school","학교·과정", h("input",{type:"text", id:"e-school", maxlength:"60", value:p.school||""})),
    field("e-major","전공·역할", h("input",{type:"text", id:"e-major", maxlength:"60", value:p.major||""})));
  kindSel.addEventListener("change", () => pf.hidden = kindSel.value !== "portfolio");
  let shots = arr(p.shot_paths).slice(); let coverPath = p.cover_path;
  const shotRow = h("div",{class:"preview-row"});
  const drawShots = () => { shotRow.textContent = ""; shots.forEach((s,i) => shotRow.append(h("figure",null, h("img",{src:mediaUrl(s), alt:`스크린샷 ${i+1}`}), h("button",{type:"button", onclick:() => { shots.splice(i,1); drawShots(); }},"삭제")))); };
  drawShots();
  const shotIn = h("input",{type:"file", id:"e-shots", accept:"image/png,image/jpeg,image/webp,image/gif", multiple:true});
  const coverIn = h("input",{type:"file", id:"e-cover", accept:"image/png,image/jpeg,image/webp,image/gif"});
  const err = h("p",{class:"err", role:"alert"});
  const btn = h("button",{class:"btn primary", type:"submit"},"저장하기");
  const form = h("form",{class:"panel form", novalidate:true},
    h("div",{class:"two"}, field("e-kind","종류", kindSel), field("e-title","이름", h("input",{type:"text", id:"e-title", maxlength:"60", value:p.title}))),
    pf,
    field("e-tagline","한 줄 소개", h("input",{type:"text", id:"e-tagline", maxlength:"120", value:p.tagline||"", placeholder:"캡슐과 배너에 보이는 짧은 소개"})),
    field("e-link","플레이·테스트 링크", h("input",{type:"url", id:"e-link", value:p.link})),
    field("e-mission","테스터에게 부탁하는 미션", h("input",{type:"text", id:"e-mission", maxlength:"160", value:p.mission||"", placeholder:"예: 1스테이지를 깨고 상점까지 가 보기"}), "미션이 있으면 리뷰가 훨씬 구체적이 돼요."),
    h("div",{class:"field"}, h("label",{for:"e-tags"},"태그"), tagIn, sugg),
    h("div",{class:"field"}, h("span",{class:"legend"},"플랫폼"), plats),
    field("e-desc","이 작품에 대하여", h("textarea",{id:"e-desc", maxlength:"3000", placeholder:"만든 이유, 조작법, 특히 의견이 궁금한 부분"}, p.description||"")),
    field("e-cover","대표 이미지 바꾸기", coverIn),
    h("div",{class:"field"}, h("label",{for:"e-shots"},"스크린샷 (최대 5장)"), shotRow, shotIn),
    err, h("div",{style:"display:flex;gap:10px;flex-wrap:wrap"}, btn, h("a",{class:"btn", href:"#/p/"+p.id},"건너뛰고 작품 보기")));
  form.addEventListener("submit", async ev => {
    ev.preventDefault(); err.textContent = "";
    const link = safeUrl(v("e-link"));
    if (!v("e-title")) return err.textContent = "이름을 적어 주세요.";
    if (!link) return err.textContent = "링크는 https:// 로 시작하는 주소로 적어 주세요.";
    const newShots = [...(shotIn.files||[])];
    if (shots.length + newShots.length > 5) return err.textContent = "스크린샷은 최대 5장까지예요.";
    btn.disabled = true;
    try{
      if (coverIn.files[0]){ btn.textContent = "대표 이미지 올리는 중…"; coverPath = await uploadImage(coverIn.files[0]); }
      for (let i=0;i<newShots.length;i++){ btn.textContent = `스크린샷 올리는 중… (${i+1}/${newShots.length})`; shots.push(await uploadImage(newShots[i])); }
      btn.textContent = "저장하는 중…";
      const k = v("e-kind");
      const body = { kind:k, title:v("e-title"), link, tagline:v("e-tagline")||null, mission:v("e-mission")||null, description:v("e-desc")||null,
        tags: v("e-tags").split(",").map(s=>s.trim().replace(/^#/,"")).filter(Boolean).slice(0,6).map(s=>s.slice(0,20)),
        platforms: PLATFORMS.filter((x,i) => $("#pl"+i).checked), cover_path:coverPath, shot_paths:shots,
        school: k === "portfolio" ? (v("e-school")||null) : null, major: k === "portfolio" ? (v("e-major")||null) : null };
      const { data, error } = await sb.from("projects").update(body).eq("id", p.id).select("*").single();
      if (error) throw error;
      Object.assign(p, data); toast("저장했어요"); go("#/p/"+p.id);
    }catch(e){ btn.disabled = false; btn.textContent = "저장하기"; err.textContent = errMsg(e); }
  });
  m.append(h("div",{class:"steps"}, h("span",null,"1. 링크 넣기 ✓"), h("span",{class:"on"},"2. 더 꾸미기"), h("span",null, p.status === "approved" ? "3. 공개 중 ✓" : "3. 심사 후 공개")),
    statusBanner(p),
    h("h2",{style:"font-size:24px;margin-bottom:6px"}, "「", str(p.title,40), "」 꾸미기"),
    h("p",{class:"note", style:"margin-bottom:16px"},"모두 선택이에요. 태그와 미션을 채우면 더 많은 사람에게 보이고 리뷰도 구체적이 돼요."),
    form);
}

/* ---------- project page ---------- */
async function renderProject(m, id){
  m.append(h("div",{class:"empty"},"불러오는 중이에요…"));
  const p = await getProject(id);
  m.textContent = "";
  if (!p){ m.append(h("div",{class:"empty"},"작품을 찾을 수 없어요. 삭제되었거나 숨겨진 작품일 수 있어요. ", h("a",{href:"#/"},"홈으로"))); return; }
  const [rv, up] = await Promise.all([
    sb.from("reviews").select("*").eq("project_id", id).order("created_at",{ascending:false}),
    sb.from("updates").select("*").eq("project_id", id).order("created_at",{ascending:false})
  ]);
  const reviews = rv.data || [], updates = up.data || [];
  let helpful = [];
  if (reviews.length){ const { data } = await sb.from("review_helpful").select("review_id,user_id").in("review_id", reviews.map(r => r.id)); helpful = data || []; }
  await loadProfiles([p.owner_id, ...reviews.map(r => r.author_id)]);
  const maker = isMaker(p), link = safeUrl(p.link);
  logEvent(p, "view");
  const openLink = (cls, label) => h("a",{class:cls, href:link, target:"_blank", rel:"noopener noreferrer", onclick:() => logEvent(p, "open")}, label);
  const imgs = [p.cover_path, ...arr(p.shot_paths)].filter((x,i,a) => x && a.indexOf(x) === i);
  const viewer = h("div");
  viewer.append(cover(p, imgs[0] || null));
  const thumbs = imgs.length > 1 ? h("div",{class:"thumbs"}, imgs.map((x,i) => {
    const b = h("button",{type:"button","aria-label":`이미지 ${i+1}`,"aria-current":String(i===0)}, h("img",{src:mediaUrl(x), alt:"", loading:"lazy"}));
    b.addEventListener("click", () => { thumbs.querySelectorAll("button").forEach((t,j)=>t.setAttribute("aria-current",String(j===i))); viewer.replaceChildren(cover(p, imgs[i])); });
    return b;
  })) : null;
  const wishBtn = h("button",{class:"btn small", type:"button"});
  const paintWish = () => { const on = S.wish.has(p.id); wishBtn.textContent = on ? "♥ 찜함" : "♡ 찜하기"; wishBtn.setAttribute("aria-pressed", String(on)); };
  paintWish();
  wishBtn.addEventListener("click", async () => {
    if (!requireLogin("로그인하면 찜한 작품의 업데이트 소식을 알림으로 받아요.")) return;
    const on = S.wish.has(p.id); wishBtn.disabled = true;
    const q = on ? sb.from("wishlists").delete().eq("user_id", S.user.id).eq("project_id", p.id) : sb.from("wishlists").insert({user_id:S.user.id, project_id:p.id});
    const { error } = await q; wishBtn.disabled = false;
    if (error) return toast(errMsg(error));
    on ? S.wish.delete(p.id) : S.wish.add(p.id); paintWish();
    toast(on ? "찜을 해제했어요" : "찜했어요. 업데이트가 올라오면 알려 드릴게요");
  });
  const shareBtn = h("button",{class:"btn small", type:"button", onclick:async () => {
    const url = shortUrl(p);
    try{ if (navigator.share){ await navigator.share({title:p.title, url}); return; } }catch(e){ return; }
    try{ await navigator.clipboard.writeText(url); toast("링크를 복사했어요"); }catch(e){ toast(url); }
  }},"공유");
  const info = h("dl",{class:"kv"});
  const add = (k,v) => { if (v) info.append(h("dt",null,k), h("dd",null,v)); };
  add("모든 평가", revLabel(p.id, true));
  add("출시일", date(p.created_at));
  add("크리에이터", h("a",{href:"#/u/"+p.owner_id, style:"font-weight:600"}, nameOf(p.owner_id)));
  if (p.kind === "portfolio"){ add("학교·과정", str(p.school,60)); add("전공·역할", str(p.major,60)); }
  add("플랫폼", arr(p.platforms).join(" · "));
  if (p.slug && isPublic(p)) add("짧은 주소", h("button",{class:"linkbtn", type:"button", onclick:async () => { try{ await navigator.clipboard.writeText(shortUrl(p)); toast("짧은 주소를 복사했어요"); }catch(e){ toast(shortUrl(p)); } }}, shortUrl(p).replace(/^https?:\/\//,"")));
  const sm = summary(p.id);
  const revBox = h("div",{class:"form", style:"gap:12px"});
  let rvSort = "helpful";
  const hc = id => helpful.filter(x => x.review_id === id).length;
  const drawReviews = () => {
    revBox.textContent = "";
    const list = [...reviews].sort((a,b) => rvSort === "new" ? byNew(a,b) : (hc(b.id)-hc(a.id)) || byNew(a,b));
    if (!list.length) revBox.append(h("div",{class:"empty"}, maker ? "아직 리뷰가 없어요. '공유' 버튼으로 링크를 친구들에게 보내 보세요." : "아직 리뷰가 없어요. 첫 번째 리뷰어가 되어 주세요!"));
    list.forEach(r => revBox.append(reviewCard(r, p, helpful, drawReviews)));
  };
  drawReviews();
  const sortSeg = h("div",{class:"seg", role:"group","aria-label":"리뷰 정렬"}, [["helpful","가장 도움이 됨"],["new","최신순"]].map(([k,l]) => {
    const b = h("button",{type:"button","aria-pressed":String(rvSort===k)}, l);
    b.addEventListener("click", () => { rvSort = k; sortSeg.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); drawReviews(); });
    return b;
  }));
  const reload = () => route();
  const sc = scoreOf(p.id);
  const tagLinks = arr(p.tags).length ? h("div",{class:"tagrow"}, arr(p.tags).map(t => { const a = h("a",{class:"tag", href:"#/browse"}, "#"+str(t,20)); a.addEventListener("click", e => { e.preventDefault(); goBrowse({tag:t}); }); return a; })) : null;
  m.append(h("article",{class:"pp"},
    h("div",{class:"pp-top"},
      h("span",{class:"crumb"}, h("a",{href:"#/"},"홈"), " / ", KINDS[kindOf(p)], p.pod_date ? [" / ", h("span",{class:"pill-pod"},"오늘의 프로토타입 · " + date(p.pod_date))] : null),
      h("div",{class:"pp-actions"}, shareBtn, wishBtn)),
    statusBanner(p),
    h("div",{class:"pp-head"},
      h("div",{class:"pp-titles"},
        h("h1",{class:"display"}, str(p.title,80)),
        p.tagline ? h("p",{class:"lede"}, str(p.tagline,140)) : null,
        h("p",{class:"byline"}, p.icon_path ? h("img",{class:"appicon-xs", src:mediaUrl(p.icon_path), alt:""}) : null, "by ", h("a",{href:"#/u/"+p.owner_id}, nameOf(p.owner_id)), " · ", date(p.created_at), p.hidden ? h("span",{class:"hiddenmark"},"숨김") : null)),
      h("div",{class:"pp-score"}, ring(sc.overall, 112), h("div",{class:"pp-score-txt"}, h("b",null,"평균 점수"), h("span",{class:"sec-sub"}, sc.count ? `${sc.count}명이 평가` : "아직 점수가 없어요"), revLabel(p.id, true)))),
    h("div",{class:"gallery"}, viewer, thumbs),
    h("div",{class:"buy"},
      h("div",null, h("h2",null,"써 보기"), p.mission ? h("div",{class:"m"}, h("b",null,"미션 "), str(p.mission,160)) : h("div",{class:"m"},"자유롭게 써 보고 점수와 리뷰를 남겨 주세요.")),
      h("div",{style:"display:flex;gap:10px;align-items:center"}, h("span",{class:"free"},"무료"), link ? openLink("btn primary lg","지금 테스트하기 ↗") : null),
      link ? h("div",{class:"buy-extra"},
        h("button",{class:"textlink qr-only", type:"button", onclick:() => openQR(p, link)},"휴대폰으로 열기 (QR)"),
        ["web","app","game"].includes(p.kind) && arr(p.platforms).includes("웹") ? h("button",{class:"textlink", type:"button", onclick:openInstallGuide},"홈 화면에 앱처럼 설치하는 법") : null) : null),
    h("div",{class:"pp-grid"},
      h("div",{class:"pp-main"},
        h("section",{class:"block"}, h("h2",null,"이 작품에 대하여"),
          h("p",{class:"desc"}, str(p.description,3000) || (maker ? "아직 설명이 없어요. '작품 수정'에서 채워 보세요." : "크리에이터가 아직 설명을 쓰지 않았어요.")),
          info, tagLinks),
        h("section",{class:"block"}, h("h2",null,"평가"),
          h("div",{class:"score-panel"}, scoreBars(sc),
            sm.n ? h("div",{class:"rec-sum"}, h("span",null,"추천 ", h("b",{class:"num"}, sm.pct + "%")), h("span",{class:"sec-sub num"}, `👍 ${sm.up} · 👎 ${sm.n-sm.up}`)) : null),
          maker || !isPublic(p) ? null : reviewForm(p, reviews.find(r => S.user && r.author_id === S.user.id), reload),
          reviews.length > 1 ? sortSeg : null,
          revBox)),
      h("aside",{class:"pp-side"},
        h("section",{class:"block"}, h("h2",null,"업데이트 노트"),
          maker ? updateForm(p, reload) : null,
          updates.length ? h("div",{class:"form", style:"gap:10px"}, updates.map(u => h("div",{class:"upd"}, h("b",null, str(u.title,80)), h("small",{class:"num"}, date(u.created_at)), u.body ? h("p",null, str(u.body,1500)) : null,
            maker || isAdmin() ? h("button",{class:"textlink", type:"button", onclick:async () => { const { error } = await sb.from("updates").delete().eq("id", u.id); if (error) toast(errMsg(error)); else reload(); }},"삭제") : null))) : h("p",{class:"note"},"아직 업데이트 노트가 없어요.")),
        ownerTools(p),
        maker ? null : h("div",null, h("button",{class:"textlink", type:"button", onclick:() => openReport("project", p.id)},"이 작품 신고하기")))),
    link ? h("div",{class:"mcta"}, h("span",{class:"t"}, str(p.title,40)), openLink("btn primary","테스트하기 ↗")) : null));
}
function reviewCard(r, p, helpful, redraw){
  const mine = S.user && r.author_id === S.user.id;
  const votes = helpful.filter(x => x.review_id === r.id);
  const voted = S.user && votes.some(x => x.user_id === S.user.id);
  const part = (q, t) => t ? h("div",null, h("span",{class:"q"}, q), h("p",null, str(t,800))) : null;
  const foot = h("div",{class:"rv-foot"});
  if (!mine){
    foot.append(h("span",null,"이 리뷰가 도움이 되었나요?"));
    const b = h("button",{class:"btn small", type:"button","aria-pressed":String(!!voted)}, voted ? "👍 도움이 됨 ✓" : "👍 예");
    b.addEventListener("click", async () => {
      if (!requireLogin()) return;
      b.disabled = true;
      const q = voted ? sb.from("review_helpful").delete().eq("review_id", r.id).eq("user_id", S.user.id) : sb.from("review_helpful").insert({review_id:r.id, user_id:S.user.id});
      const { error } = await q;
      if (error){ b.disabled = false; return toast(errMsg(error)); }
      if (voted){ const i = helpful.findIndex(x => x.review_id === r.id && x.user_id === S.user.id); if (i > -1) helpful.splice(i,1); }
      else helpful.push({review_id:r.id, user_id:S.user.id});
      redraw();
    });
    foot.append(b);
  }
  foot.append(h("span",{class:"num"}, `${votes.length}명에게 도움이 됨`));
  if (!mine) foot.append(h("button",{class:"textlink", type:"button", onclick:() => openReport("review", r.id)},"신고"));
  if (isAdmin()) foot.append(h("button",{class:"textlink", type:"button", onclick:async () => { const { error } = await sb.rpc("admin_set_review_hidden", {r_id:r.id, p_hidden:!r.hidden}); if (error) toast(errMsg(error)); else { toast(r.hidden ? "리뷰를 다시 보이게 했어요" : "리뷰를 숨겼어요"); route(); } }}, r.hidden ? "숨김 해제" : "숨기기(관리자)"));
  return h("article",{class:"rv"},
    h("div",{class:"rv-who"}, h("a",{href:"#/u/"+r.author_id, style:"font-weight:600"}, nameOf(r.author_id)), h("span",{class:"num", style:"color:var(--muted)"}, date(r.created_at)),
      r.mission_done ? h("span",{style:"color:var(--pos)"},"✓ 미션 완료") : null, r.hidden ? h("span",{class:"hiddenmark"},"숨김") : null),
    h("div",{class:"rv-main"},
      h("div",{class:"rv-verdict " + (r.recommend ? "up" : "down")}, h("span",{class:"ic","aria-hidden":"true"}, r.recommend ? "👍" : "👎"), r.recommend ? "추천" : "비추천"),
      h("p",null, str(r.body,800)),
      r.score_design ? h("div",{class:"mini-scores"}, AXES.map(([k,l]) => h("span",null, l, " ", h("b",{class:"num"}, r["score_"+k])))) : null,
      part("막힌 곳", r.stuck), part("이렇게 바뀌면 좋겠어요", r.suggestion),
      foot));
}
function reviewForm(p, mine, done){
  if (!S.user) return h("div",{class:"panel", style:"display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"},
    h("span",null,"써 보셨나요? 👍/👎와 한 줄이면 충분해요."), h("button",{class:"btn primary small", type:"button", onclick:()=>openLogin("로그인하고 첫 리뷰를 남겨 보세요.")},"로그인하고 리뷰 쓰기"));
  let rec = mine ? mine.recommend : null;
  const upB = h("button",{type:"button", class:"up","aria-pressed":String(rec===true)}, "👍 추천해요");
  const dnB = h("button",{type:"button", class:"down","aria-pressed":String(rec===false)}, "👎 아직은 아쉬워요");
  const setRec = v => { rec = v; upB.setAttribute("aria-pressed",String(v===true)); dnB.setAttribute("aria-pressed",String(v===false)); };
  upB.addEventListener("click", () => setRec(true)); dnB.addEventListener("click", () => setRec(false));
  const body = h("input",{type:"text", id:"rv-body", maxlength:"800", value:mine?mine.body:"", placeholder:"한 줄 소감 (예: 분위기는 최고, 조작이 조금 어려워요)"});
  const more = h("details",{class:"more", open: !!(mine && (mine.stuck || mine.suggestion)) || null},
    h("summary",null,"+ 자세히 쓰기 (선택)"),
    h("div",{class:"form", style:"gap:12px"},
      p.mission ? h("label",{class:"check"}, h("input",{type:"checkbox", id:"rv-done", checked: mine ? mine.mission_done : false}), "미션을 끝까지 해 봤어요") : null,
      field("rv-stuck","막힌 곳", h("textarea",{id:"rv-stuck", maxlength:"800", placeholder:"어디서 멈칫하거나 헤맸나요?"}, mine && mine.stuck || "")),
      field("rv-sug","이렇게 바뀌면 좋겠어요", h("textarea",{id:"rv-sug", maxlength:"800", placeholder:"하나만 바꾼다면?"}, mine && mine.suggestion || ""))));
  const scoreVals = {};
  const scoresUI = h("div",{class:"score-inputs"}, h("div",{class:"legend"},"점수 매기기 ", h("span",{class:"sec-sub"},"(선택 · 4개 모두 매기면 평균 점수에 반영돼요)")),
    AXES.map(([k,l]) => {
      const cur = mine && mine["score_"+k];
      if (cur) scoreVals[k] = cur;
      const out = h("output",{class:"num"}, cur || "–");
      const inp = h("input",{type:"range", min:"1", max:"10", step:"1", value:String(cur || 5), "aria-label":l + " 점수 (1~10)"});
      if (!cur) inp.classList.add("unset");
      inp.addEventListener("input", () => { scoreVals[k] = Number(inp.value); out.textContent = inp.value; inp.classList.remove("unset"); });
      return h("label",{class:"score-row"}, h("span",null,l), inp, out);
    }));
  const err = h("p",{class:"err", role:"alert"});
  const btn = h("button",{class:"btn primary", type:"submit"}, mine ? "리뷰 고치기" : "리뷰 올리기");
  const del = mine ? h("button",{class:"textlink", type:"button", onclick:async () => { const { error } = await sb.from("reviews").delete().eq("id", mine.id); if (error) return toast(errMsg(error)); await refreshScore(p.id); toast("리뷰를 지웠어요"); done(); }},"리뷰 지우기") : null;
  const form = h("form",{class:"panel form", novalidate:true},
    h("b",null, mine ? "내 리뷰 (고칠 수 있어요)" : "이 작품을 추천하나요?"),
    h("div",{class:"vote", role:"group","aria-label":"추천 여부"}, upB, dnB),
    body, scoresUI, more, err, h("div",{style:"display:flex;gap:14px;align-items:center"}, btn, del));
  form.addEventListener("submit", async ev => {
    ev.preventDefault(); err.textContent = "";
    if (rec === null) return err.textContent = "추천인지 아닌지 골라 주세요.";
    if (body.value.trim().length < 2) return err.textContent = "한 줄 소감을 적어 주세요.";
    btn.disabled = true;
    const row = { recommend:rec, body:body.value.trim(), stuck:($("#rv-stuck").value.trim()||null), suggestion:($("#rv-sug").value.trim()||null), mission_done:!!$("#rv-done")?.checked,
      ...Object.fromEntries(AXES.map(([k]) => ["score_"+k, scoreVals[k] || null])) };
    const q = mine ? sb.from("reviews").update(row).eq("id", mine.id) : sb.from("reviews").insert({...row, project_id:p.id, author_id:S.user.id});
    const { error } = await q;
    if (error){ btn.disabled = false; return err.textContent = errMsg(error); }
    await refreshScore(p.id); toast(mine ? "리뷰를 고쳤어요" : "리뷰를 올렸어요. 크리에이터에게 알림이 갔어요 🙌"); done();
  });
  return form;
}
function updateForm(p, done){
  const t = h("input",{type:"text", id:"up-t", maxlength:"80", placeholder:"예: v0.2 – 튜토리얼 추가"});
  const b = h("textarea",{id:"up-b", maxlength:"1500", placeholder:"리뷰를 보고 무엇을 고쳤는지 적어 주세요"});
  const err = h("p",{class:"err", role:"alert"});
  const btn = h("button",{class:"btn small primary", type:"submit"},"업데이트 노트 올리기");
  const f = h("form",{class:"panel form", novalidate:true, style:"padding:14px;gap:10px"},
    field("up-t","새 업데이트", t), b, h("p",{class:"fine"},"찜한 사람들에게 알림이 가요."), err, h("div",null,btn));
  f.addEventListener("submit", async ev => {
    ev.preventDefault(); err.textContent = "";
    if (!t.value.trim()) return err.textContent = "제목을 적어 주세요.";
    btn.disabled = true;
    const { error } = await sb.from("updates").insert({project_id:p.id, author_id:S.user.id, title:t.value.trim(), body:b.value.trim()||null});
    if (error){ btn.disabled = false; return err.textContent = errMsg(error); }
    toast("업데이트 노트를 올렸어요"); done();
  });
  return f;
}
function ownerTools(p){
  const maker = isMaker(p), admin = isAdmin();
  if (!maker && !admin) return null;
  const wrap = h("div",{class:"panel", style:"display:grid;gap:12px;margin-top:8px"}, h("b",null, maker ? "크리에이터 도구" : "관리자 도구"));
  if (maker) wrap.append(h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, h("a",{class:"btn small", href:"#/edit/"+p.id},"작품 수정·꾸미기"), h("a",{class:"btn small", href:"#/stats/"+p.id},"📊 방문 통계")));
  if (admin && p.status !== "approved") wrap.append(moderationBox(p));
  if (admin){
    const row = h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},
      h("button",{class:"btn small", type:"button", onclick:async () => { const { error } = await sb.rpc("admin_set_project", {p_id:p.id, p_featured:!p.featured}); if (error) return toast(errMsg(error)); p.featured = !p.featured; toast(p.featured ? "에디터 추천에 올렸어요" : "에디터 추천에서 뺐어요"); route(); }}, p.featured ? "★ 에디터 추천 해제" : "☆ 에디터 추천에 올리기"),
      h("button",{class:"btn small", type:"button", onclick:async () => { const { error } = await sb.rpc("admin_set_project", {p_id:p.id, p_hidden:!p.hidden}); if (error) return toast(errMsg(error)); p.hidden = !p.hidden; toast(p.hidden ? "스토어에서 숨겼어요" : "다시 보이게 했어요"); route(); }}, p.hidden ? "숨김 해제" : "스토어에서 숨기기"));
    wrap.append(row);
    if (isPublic(p)){
      const d = h("input",{type:"date", value:todayKST(), "aria-label":"선정 날짜"});
      wrap.append(h("div",{class:"form", style:"gap:8px"}, h("b",null,"오늘의 프로토타입", p.pod_date ? ` (현재 ${date(p.pod_date)})` : ""),
        h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, d, h("button",{class:"btn small", type:"button", onclick:async () => {
          const { error } = await sb.rpc("admin_set_pod", {p_id:p.id, p_date:d.value}); if (error) return toast(errMsg(error));
          S.projects.forEach(x => { if (x.pod_date === d.value) x.pod_date = null; }); p.pod_date = d.value; toast("오늘의 프로토타입으로 지정했어요. 메이커에게 알림이 갔어요"); route(); }},"🏆 지정하기"))));
      if (S.collections.length){
        const sel = h("select",{"aria-label":"컬렉션"}, S.collections.map(c => h("option",{value:c.id}, c.title + (c.is_published ? "" : " (비공개)"))));
        const inCols = S.colItems.filter(i => i.project_id === p.id).map(i => (S.collections.find(c => c.id === i.collection_id) || {}).title).filter(Boolean);
        wrap.append(h("div",{class:"form", style:"gap:8px"}, h("b",null,"컬렉션에 추가"), inCols.length ? h("span",{class:"sec-sub"}, "포함된 곳: " + inCols.join(", ")) : null,
          h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, sel, h("button",{class:"btn small", type:"button", onclick:async () => {
            const { error } = await sb.from("collection_items").insert({collection_id:sel.value, project_id:p.id}); if (error) return toast(errMsg(error)); await loadCollections(); toast("컬렉션에 추가했어요"); route(); }},"추가"))));
      }
    }
  }
  const del = h("button",{class:"btn small danger", type:"button"},"작품 삭제");
  let armed = false;
  del.addEventListener("click", async () => {
    if (!armed){ armed = true; del.textContent = "한 번 더 누르면 영구 삭제돼요"; return; }
    del.disabled = true;
    const { error } = await sb.from("projects").delete().eq("id", p.id);
    if (error){ del.disabled = false; armed = false; del.textContent = "작품 삭제"; return toast(errMsg(error)); }
    if (maker){ const paths = [p.cover_path, ...arr(p.shot_paths)].filter(Boolean); if (paths.length) sb.storage.from("media").remove(paths); }
    S.projects = S.projects.filter(x => x.id !== p.id); toast("작품을 삭제했어요"); go("#/library");
  });
  wrap.append(h("div",null, del));
  return wrap;
}
function openReport(type, id){
  if (!requireLogin("신고하려면 로그인이 필요해요.")) return;
  const reasons = h("div",{class:"checks", role:"radiogroup", "aria-label":"신고 사유"}, Object.entries(REPORT_REASONS).map(([k,l],i) => h("label",null, h("input",{type:"radio", name:"reason", value:k, checked:i===0}), l)));
  const detail = h("textarea",{id:"rp-detail", maxlength:"500", placeholder:"자세한 내용 (선택)"});
  const err = h("p",{class:"err", role:"alert"});
  const btn = h("button",{class:"btn primary", type:"button"},"신고하기");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const reason = reasons.querySelector("input:checked").value;
    const { error } = await sb.from("reports").insert({reporter_id:S.user.id, target_type:type, target_id:id, reason, detail:detail.value.trim()||null});
    if (error){ btn.disabled = false; return err.textContent = /duplicate|unique/i.test(error.message) ? "이미 신고한 항목이에요. 확인 중이에요." : errMsg(error); }
    closeLayer(); toast("신고가 접수됐어요. 운영자가 확인할게요.");
  });
  const back = h("div",{class:"modal-back", onclick:e => { if (e.target === back) closeLayer(); }},
    h("div",{class:"modal", role:"dialog", "aria-modal":"true", "aria-labelledby":"rp-title"},
      h("h2",{id:"rp-title"}, type === "project" ? "작품 신고" : "리뷰 신고"),
      h("p",{class:"note"},"신고 내용은 운영자만 볼 수 있어요."),
      reasons, detail, err,
      h("div",{style:"display:flex;gap:10px"}, btn, h("button",{class:"btn", type:"button", onclick:closeLayer},"취소"))));
  closeLayer(); $("#layer").append(back);
}

function statusBanner(p){
  if (!(isMaker(p) || isAdmin())) return null;
  if (p.status === "pending") return h("p",{class:"warn"},"🕒 심사 중이에요. 보통 1~2일 안에 결과를 알림으로 알려 드려요. 그동안 '더 꾸미기'로 태그와 스크린샷을 채워 두면 좋아요.");
  if (p.status === "rejected") return h("p",{class:"warn", style:"border-left-color:var(--neg)"},"반려됐어요", p.reject_reason ? `: ${str(p.reject_reason,300)}` : "", ". 내용을 고쳐서 저장하면 자동으로 다시 심사해요.");
  return null;
}
function moderationBox(p){
  const reason = h("input",{type:"text", maxlength:"300", placeholder:"반려 사유 (메이커에게 알림으로 가요)"});
  const run = async st => {
    if (st === "rejected" && !reason.value.trim()){ reason.focus(); return toast("반려 사유를 적어 주세요"); }
    const { error } = await sb.rpc("admin_review_project", {p_id:p.id, p_status:st, p_reason:reason.value.trim() || null});
    if (error) return toast(errMsg(error));
    p.status = st; toast(st === "approved" ? "승인했어요. 메이커에게 알림이 갔어요" : "반려했어요. 메이커에게 사유가 전달됐어요"); route();
  };
  return h("div",{class:"form", style:"gap:8px;border-top:1px solid var(--line);padding-top:12px"},
    h("b",null,"심사 (", STATUS_LABEL[p.status], ")"),
    h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, h("button",{class:"btn small primary", type:"button", onclick:() => run("approved")},"✓ 승인하고 공개"), h("button",{class:"btn small danger", type:"button", onclick:() => run("rejected")},"반려")),
    reason);
}
function modal(titleText, ...kids){
  const back = h("div",{class:"modal-back", onclick:e => { if (e.target === back) closeLayer(); }},
    h("div",{class:"modal", role:"dialog", "aria-modal":"true", "aria-label":titleText}, h("h2",null,titleText), ...kids, h("button",{class:"btn small", type:"button", onclick:closeLayer},"닫기")));
  closeLayer(); $("#layer").append(back);
}
function openQR(p, link){
  let svg = null;
  try{ const q = window.qrcode(0, "M"); q.addData(link); q.make(); svg = q.createSvgTag({cellSize:6, margin:2, scalable:true}); }catch(e){}
  const box = h("div",{class:"qrbox"}); if (svg) box.innerHTML = svg; else box.textContent = link;
  modal("휴대폰으로 열기", h("p",{class:"note"},"휴대폰 카메라로 QR을 찍으면 「", str(p.title,40), "」이 바로 열려요."), box);
  logEvent(p, "open");
}
function openInstallGuide(){
  modal("홈 화면에 앱처럼 설치하기",
    h("p",{class:"note"},"웹앱은 설치 없이도 바로 쓸 수 있지만, 홈 화면에 추가하면 앱처럼 아이콘으로 열 수 있어요."),
    h("div",{class:"form", style:"gap:10px"},
      h("div",null, h("b",null,"아이폰 (Safari)"), h("p",{class:"note"},"작품을 연 뒤 아래 공유 버튼(□↑) → '홈 화면에 추가'를 눌러요.")),
      h("div",null, h("b",null,"안드로이드 (Chrome·삼성 인터넷)"), h("p",{class:"note"},"작품을 연 뒤 오른쪽 위 메뉴(⋮) → '홈 화면에 추가' 또는 '앱 설치'를 눌러요."))));
}

/* ---------- stats (creator console) ---------- */
async function renderStats(m, id){
  const p = await getProject(id);
  if (!p || !(isMaker(p) || isAdmin())){ m.append(h("div",{class:"empty"},"내 작품의 통계만 볼 수 있어요.")); return; }
  const [st, rf] = await Promise.all([sb.rpc("project_stats", {p_id:id, p_days:30}), sb.rpc("project_ref_stats", {p_id:id, p_days:30})]);
  if (st.error){ m.append(h("div",{class:"empty"}, errMsg(st.error))); return; }
  const days = st.data || [], refs = rf.data || [];
  const V = days.reduce((s,d) => s + Number(d.views), 0), O = days.reduce((s,d) => s + Number(d.opens), 0);
  const sm = summary(p.id);
  const max = Math.max(1, ...days.map(d => Number(d.views)));
  const W = 600, H = 160, bw = W / Math.max(days.length,1);
  const bars = days.map((d,i) => {
    const vh = Number(d.views)/max*(H-24), oh = Number(d.opens)/max*(H-24);
    return `<rect x="${(i*bw+1).toFixed(1)}" y="${(H-16-vh).toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${vh.toFixed(1)}" rx="2" fill="var(--sky)" opacity=".55"><title>${d.day} 방문 ${d.views}</title></rect>` +
           `<rect x="${(i*bw+bw*0.25).toFixed(1)}" y="${(H-16-oh).toFixed(1)}" width="${(bw*0.5).toFixed(1)}" height="${oh.toFixed(1)}" rx="2" fill="var(--accent)"><title>${d.day} 열기 ${d.opens}</title></rect>`;
  }).join("");
  const first = days[0] ? String(days[0].day).slice(5).replace("-",".") : "", last = days.length ? String(days[days.length-1].day).slice(5).replace("-",".") : "";
  const chart = h("div",{class:"panel", style:"overflow-x:auto"});
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="최근 30일 방문과 열기 막대 그래프"><line x1="0" y1="${H-16}" x2="${W}" y2="${H-16}" stroke="var(--line)"/>${bars}<text x="0" y="${H-2}" fill="var(--muted)" font-size="11">${first}</text><text x="${W}" y="${H-2}" fill="var(--muted)" font-size="11" text-anchor="end">${last}</text><text x="${W}" y="12" fill="var(--muted)" font-size="11" text-anchor="end">최대 ${max}회/일</text></svg>`;
  m.append(
    h("p",{class:"eyebrow"},"크리에이터 콘솔 · 최근 30일"),
    h("h2",{style:"font-size:24px;margin-bottom:6px"}, str(p.title,60), " 통계"),
    h("p",{class:"note", style:"margin-bottom:16px"},"쿠키 없이 집계해요. 내 방문은 빼고 세요."),
    h("div",{class:"tiles"},
      h("div",{class:"tile"}, h("b",{class:"num"}, V), h("span",null,"작품 페이지 방문")),
      h("div",{class:"tile"}, h("b",{class:"num"}, O), h("span",null,"'테스트하기' 클릭")),
      h("div",{class:"tile"}, h("b",{class:"num"}, V ? Math.round(O/V*100) + "%" : "–"), h("span",null,"방문 → 테스트 전환율")),
      h("div",{class:"tile"}, h("b",{class:"num"}, sm.n), h("span",null,"받은 리뷰"))),
    h("div",{style:"display:flex;gap:14px;font-size:13px;color:var(--muted);margin-bottom:8px"}, h("span",null, h("b",{style:"color:var(--sky)"},"■"), " 방문"), h("span",null, h("b",{style:"color:var(--accent)"},"■"), " 테스트하기 클릭")),
    chart,
    h("div",{class:"section"}, h("h2",null,"어디서 들어왔나요?"),
      refs.length ? h("div",{class:"list"}, refs.map(r => h("div",{class:"rowitem"}, h("span",{class:"t"}, str(r.ref_host,60)), h("span",{class:"num"}, r.visits + "회")))) : h("div",{class:"empty"},"아직 방문 기록이 없어요. 짧은 주소를 SNS에 공유해 보세요.")),
    h("div",{class:"section", style:"display:flex;gap:10px;flex-wrap:wrap"}, h("a",{class:"btn", href:"#/p/"+p.id},"작품 페이지로"),
      p.slug && isPublic(p) ? h("button",{class:"btn", type:"button", onclick:async () => { try{ await navigator.clipboard.writeText(shortUrl(p)); toast("짧은 주소를 복사했어요"); }catch(e){ toast(shortUrl(p)); } }},"짧은 주소 복사") : null));
}

/* ---------- guide (FAQ) ---------- */
function renderGuide(m){
  const qa = [
    ["어떤 작품을 올릴 수 있나요?","직접 만든 게임, 앱, 웹서비스, 수업·프로젝트 포트폴리오라면 무엇이든 좋아요. 완성작이 아니어도 돼요. 피그마 프로토타입처럼 '써 볼 수 있는 링크'만 있으면 올릴 수 있어요."],
    ["어떻게 올리나요?","'+ 올리기'에서 작품 링크를 넣고 '불러오기'를 누르면 이름·소개·대표 이미지를 자동으로 채워요. 확인하고 '심사 신청하기'를 누르면 끝이에요. 태그·스크린샷·미션은 다음 단계에서 천천히 채워도 돼요."],
    ["심사는 얼마나 걸리나요?","보통 1~2일이에요. 승인되면 스토어에 공개되고 알림이 가요. 반려되면 사유를 알려 드리고, 고쳐서 저장하면 자동으로 다시 심사해요. 스팸, 부적절한 내용, 열리지 않는 링크는 반려될 수 있어요."],
    ["테스터는 무엇을 하나요?","마음에 드는 작품을 열어 써 보고 👍/👎와 한 줄 소감을 남기면 돼요. 작품에 '미션'이 있으면 해 보고 막힌 곳을 적어 주면 메이커에게 큰 도움이 돼요. 좋은 리뷰는 다른 사람들의 '도움이 됨'을 받아 위로 올라가요."],
    ["알림은 언제 오나요?","내 작품에 리뷰가 달렸을 때, 내 리뷰가 '도움이 됨'을 받았을 때, 찜한 작품에 업데이트 노트가 올라왔을 때, 심사 결과가 나왔을 때 🔔으로 알려 드려요."],
    ["방문 통계는 어디서 보나요?","내 작품 페이지의 '📊 방문 통계'에서 최근 30일 방문 수, '테스트하기' 클릭 수, 유입 경로를 볼 수 있어요. 쿠키 없이 집계하고, 내 방문은 세지 않아요."],
    ["짧은 주소는 뭔가요?","공개된 작품마다 짧은 주소가 생겨요. 인스타그램, 카카오톡, 포트폴리오에 붙여 넣기 좋아요. 작품 페이지의 '공유' 버튼으로도 복사할 수 있어요."],
    ["사용자는 작품을 어떻게 쓰나요?","'지금 테스트하기'를 누르면 바로 열려요. 웹앱은 홈 화면에 추가해 앱처럼 쓸 수도 있어요. PC에서는 'QR'을 찍어 휴대폰으로 옮길 수 있어요."],
    ["광고 수익을 나눠 주나요?","준비 중이에요. 메이커와 수익을 나누는 방식을 검토하고 있어요. 확정되면 공지와 알림으로 알려 드릴게요."],
    ["점수는 어떻게 매겨지나요?","리뷰를 쓸 때 디자인·사용성·창의성·완성도를 각각 1~10점으로 매길 수 있어요. 네 항목 평균이 작품의 평균 점수가 되고, 점수가 높은 작품은 '높은 점수'와 '오늘의 프로토타입' 후보가 돼요."],
    ["오늘의 프로토타입은 어떻게 뽑나요?","운영자가 점수와 리뷰, 완성도를 보고 매일 한 작품을 골라 홈 맨 위에 소개해요. 선정되면 메이커에게 알림이 가요."],
    ["돈이 드나요?","등록, 리뷰, 30일 통계는 모두 무료예요. 빠른 심사·추천 노출 같은 선택 옵션은 '메이커 플랜'에서 사전 신청을 받고 있어요."]
  ];
  m.append(h("p",{class:"eyebrow"},"가이드"), h("h2",{style:"font-size:26px;margin-bottom:6px"},"프로토타입은 이렇게 써요"),
    h("p",{class:"note", style:"margin-bottom:18px"},"메이커는 작품을 올리고 피드백을 받아요. 테스터는 새로운 작품을 먼저 써 보고 리뷰로 함께 키워요."),
    h("div",{class:"faq"}, qa.map(([q,ans],i) => h("details",{open: i < 2 || null}, h("summary",null,q), h("p",null,ans)))),
    h("div",{class:"section", style:"display:flex;gap:10px;flex-wrap:wrap"}, h("a",{class:"btn primary", href:"#/upload"},"작품 올리기"), h("a",{class:"btn", href:"#/"},"작품 둘러보기")));
}

/* ---------- creator page ---------- */
async function renderUser(m, uid){
  await loadProfiles([uid]);
  const pr = S.profiles[uid];
  if (!pr){ m.append(h("div",{class:"empty"},"크리에이터를 찾을 수 없어요.")); return; }
  const works = S.projects.filter(p => p.owner_id === uid && isPublic(p)).sort(byNew);
  const total = works.reduce((s,p) => s + (Number(S.scores[p.id]?.review_count)||0), 0);
  m.append(h("div",{style:"display:flex;gap:14px;align-items:center;margin-bottom:18px"},
      h("div",{class:"avatar", style:"width:64px;height:64px;font-size:24px;cursor:default"}, pr.avatar_url ? h("img",{src:pr.avatar_url, alt:"", referrerpolicy:"no-referrer"}) : str(pr.display_name,1)),
      h("div",null, h("p",{class:"eyebrow", style:"margin:0"},"크리에이터"), h("h2",{style:"font-size:24px"}, nameOf(uid)), h("p",{class:"note num"}, `작품 ${works.length}개 · 받은 리뷰 ${total}개`))),
    pr.bio ? h("p",{class:"desc", style:"margin-bottom:18px"}, str(pr.bio,300)) : null,
    works.length ? h("div",{class:"grid"}, works.map(capsule)) : h("div",{class:"empty"},"공개된 작품이 없어요."));
}

/* ---------- library ---------- */
async function renderLibrary(m){
  if (!S.user){ m.append(h("div",{class:"empty"},"로그인하면 내 작품, 찜, 리뷰, 알림을 한곳에서 볼 수 있어요. ", h("button",{class:"btn small primary", type:"button", onclick:()=>openLogin()},"로그인"))); return; }
  const tabs = [["mine","내 작품"],["wish","찜"],["reviews","내 리뷰"],["profile","프로필·계정"]];
  if (isAdmin()){ tabs.push(["review","심사 대기"]); tabs.push(["admin","신고 관리"]); tabs.push(["cols","컬렉션 관리"]); tabs.push(["inq","문의"]); }
  const bar = h("div",{class:"subtabs", role:"tablist"}, tabs.map(([k,l]) => h("button",{type:"button","aria-pressed":String(S.libTab===k), onclick:() => { S.libTab = k; route(); }}, l)));
  const body = h("div");
  m.append(h("p",{class:"eyebrow"},"내 라이브러리"), bar, body);
  const T = S.libTab;
  if (T === "mine"){
    const mine = S.projects.filter(p => p.owner_id === S.user.id).sort(byNew);
    body.append(mine.length ? h("div",{class:"list"}, mine.map(p => h("div",{class:"rowitem"},
        h("div",{style:"display:flex;gap:10px;align-items:center;min-width:0"}, p.icon_path ? h("img",{class:"appicon-sm", src:mediaUrl(p.icon_path), alt:""}) : null,
          h("div",null, h("div",{class:"t"}, str(p.title,60), " ", statusChip(p) || h("span",{class:"chip-st approved"},"공개 중")),
            h("div",{class:"s"}, `리뷰 ${summary(p.id).n}개 · ${date(p.created_at)}`, p.status === "rejected" && p.reject_reason ? ` · 반려 사유: ${str(p.reject_reason,80)}` : ""))),
        h("div",{style:"display:flex;gap:6px;flex-wrap:wrap"}, h("a",{class:"btn small", href:"#/p/"+p.id},"보기"), h("a",{class:"btn small", href:"#/edit/"+p.id},"수정"), h("a",{class:"btn small", href:"#/stats/"+p.id},"📊 통계")))))
      : h("div",{class:"empty"},"아직 올린 작품이 없어요. ", h("a",{href:"#/upload"},"첫 작품 올리기")));
  } else if (T === "wish"){
    const list = S.projects.filter(p => S.wish.has(p.id));
    body.append(list.length ? h("div",{class:"grid"}, list.map(capsule)) : h("div",{class:"empty"},"작품 페이지에서 '찜하기'를 누르면 여기에 모이고, 업데이트 소식을 알림으로 받아요."));
  } else if (T === "reviews"){
    const { data } = await sb.from("reviews").select("*").eq("author_id", S.user.id).order("created_at",{ascending:false});
    const list = data || [];
    body.append(list.length ? h("div",{class:"list"}, list.map(r => { const p = S.projects.find(x => x.id === r.project_id);
      return h("div",{class:"rowitem"}, h("div",null, h("div",{class:"t"}, (r.recommend ? "👍 " : "👎 "), p ? str(p.title,60) : "삭제된 작품"), h("div",{class:"s"}, str(r.body,90))), p ? h("a",{class:"btn small", href:"#/p/"+p.id},"보기") : null); }))
      : h("div",{class:"empty"},"작품을 써 보고 첫 리뷰를 남겨 보세요. ", h("a",{href:"#/"},"홈에서 둘러보기")));
  } else if (T === "profile"){
    const pr = S.profile || {};
    const name = h("input",{type:"text", id:"pf-name", maxlength:"30", value:pr.display_name||""});
    const bio = h("textarea",{id:"pf-bio", maxlength:"300", placeholder:"어떤 걸 만드는지 소개해 주세요"}, pr.bio||"");
    const err = h("p",{class:"err", role:"alert"});
    const save = h("button",{class:"btn primary", type:"submit"},"저장하기");
    const roleSeg = h("div",{class:"checks", role:"radiogroup", "aria-label":"주로 어떻게 쓰나요"},
      [["tester","🧪 테스터 – 새 작품을 써 보고 리뷰해요"],["maker","🛠 메이커 – 작품을 올리고 피드백을 받아요"]].map(([k,l]) => h("label",null, h("input",{type:"radio", name:"role", value:k, checked:(pr.role||"tester")===k}), l)));
    const form = h("form",{class:"panel form", novalidate:true}, field("pf-name","닉네임", name, "리뷰와 작품에 보이는 이름이에요."), field("pf-bio","소개", bio), h("div",{class:"field"}, h("span",{class:"legend"},"주로 어떻게 쓰나요?"), roleSeg), err, h("div",null,save));
    form.addEventListener("submit", async ev => {
      ev.preventDefault(); err.textContent = "";
      if (!name.value.trim()) return err.textContent = "닉네임을 적어 주세요.";
      save.disabled = true;
      const role = roleSeg.querySelector("input:checked")?.value || "tester";
      const { data, error } = await sb.from("profiles").update({display_name:name.value.trim(), bio:bio.value.trim()||null, role}).eq("id", S.user.id).select("*").single();
      save.disabled = false;
      if (error) return err.textContent = errMsg(error);
      S.profile = data; S.profiles[data.id] = data; renderHeader(); toast("프로필을 저장했어요");
    });
    const out = h("button",{class:"btn", type:"button", onclick:async () => { await sb.auth.signOut(); toast("로그아웃했어요"); go("#/"); }},"로그아웃");
    const delAcc = h("button",{class:"btn small danger", type:"button"},"회원 탈퇴");
    let armed = false;
    delAcc.addEventListener("click", async () => {
      if (!armed){ armed = true; delAcc.textContent = "한 번 더 누르면 계정과 작품·리뷰가 모두 삭제돼요"; return; }
      delAcc.disabled = true;
      const { error } = await sb.rpc("delete_my_account");
      if (error){ delAcc.disabled = false; armed = false; delAcc.textContent = "회원 탈퇴"; return toast("탈퇴 처리에 실패했어요. 문의해 주세요."); }
      await sb.auth.signOut(); toast("탈퇴가 완료됐어요. 그동안 고마웠어요."); go("#/");
    });
    body.append(form, h("div",{class:"section", style:"display:grid;gap:12px"}, h("h2",null,"계정"), h("p",{class:"note"}, "로그인 계정: ", S.user.email || "이메일 미제공", " · ", (S.user.app_metadata && S.user.app_metadata.provider) || ""), h("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center"}, out, delAcc)));
  } else if (T === "review" && isAdmin()){
    const { data } = await sb.from("projects").select("*").eq("status","pending").order("created_at",{ascending:true});
    const list = data || [];
    await loadProfiles(list.map(p => p.owner_id));
    list.forEach(p => { if (!S.projects.find(x => x.id === p.id)) S.projects.push(p); });
    body.append(h("p",{class:"note", style:"margin-bottom:12px"}, `심사 대기 ${list.length}건 · 오래된 순`),
      list.length ? h("div",{class:"list"}, list.map(p => h("div",{class:"rowitem", style:"align-items:flex-start"},
        h("div",{style:"display:grid;gap:4px;min-width:0;flex:1"}, h("div",{class:"t"}, str(p.title,60), " · ", KINDS[kindOf(p)]),
          h("div",{class:"s"}, `${nameOf(p.owner_id)} · ${date(p.created_at)}`),
          h("a",{href:safeUrl(p.link) || "#", target:"_blank", rel:"noopener noreferrer", style:"font-size:13px;word-break:break-all"}, str(p.link,80))),
        h("a",{class:"btn small primary", href:"#/p/"+p.id},"검토하기")))) : h("div",{class:"empty"},"심사할 작품이 없어요 ✨"));
  } else if (T === "cols" && isAdmin()){
    await loadCollections();
    const v = id => ($("#"+id)?.value || "").trim();
    const err = h("p",{class:"err", role:"alert"});
    const f = h("form",{class:"panel form", novalidate:true},
      h("b",null,"새 컬렉션 · 전시관 만들기"),
      h("div",{class:"two"}, field("cl-title","이름", h("input",{type:"text", id:"cl-title", maxlength:"60", placeholder:"예: BUFS 디자인씽킹 2027-1 전시관"})), field("cl-org","기관명 (선택)", h("input",{type:"text", id:"cl-org", maxlength:"60", placeholder:"예: 부산외대 창업대학원"}))),
      field("cl-slug","주소", h("input",{type:"text", id:"cl-slug", maxlength:"40", placeholder:"예: bufs-2027-1"}), "영어 소문자·숫자·하이픈 3~40자. 사이트주소/#/c/주소 로 열려요."),
      field("cl-desc","소개 (선택)", h("textarea",{id:"cl-desc", maxlength:"600"})), err, h("div",null, h("button",{class:"btn primary", type:"submit"},"만들기 (비공개로 시작)")));
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); err.textContent = "";
      if (!v("cl-title")) return err.textContent = "이름을 적어 주세요.";
      if (!/^[a-z0-9-]{3,40}$/.test(v("cl-slug"))) return err.textContent = "주소는 영어 소문자·숫자·하이픈 3~40자로 적어 주세요.";
      const { error } = await sb.from("collections").insert({title:v("cl-title"), org_name:v("cl-org")||null, slug:v("cl-slug"), description:v("cl-desc")||null, created_by:S.user.id});
      if (error) return err.textContent = errMsg(error);
      toast("컬렉션을 만들었어요. 작품 페이지에서 작품을 추가해 주세요"); route();
    });
    body.append(f, h("div",{class:"list", style:"margin-top:16px"}, S.collections.map(c => h("div",{class:"rowitem"},
      h("div",null, h("div",{class:"t"}, str(c.title,60), " ", h("span",{class:"chip-st " + (c.is_published ? "approved" : "pending")}, c.is_published ? "공개" : "비공개")), h("div",{class:"s"}, `${c.org_name || "큐레이션"} · 작품 ${S.colItems.filter(i => i.collection_id === c.id).length}개 · /c/${c.slug}`)),
      h("div",{style:"display:flex;gap:6px;flex-wrap:wrap"}, h("a",{class:"btn small", href:"#/c/"+encodeURIComponent(c.slug)},"보기"),
        h("button",{class:"btn small", type:"button", onclick:async () => { const { error } = await sb.from("collections").update({is_published:!c.is_published}).eq("id", c.id); if (error) return toast(errMsg(error)); route(); }}, c.is_published ? "비공개로" : "공개하기"))))));
  } else if (T === "inq" && isAdmin()){
    const { data, error } = await sb.from("inquiries").select("*").order("created_at",{ascending:false}).limit(200);
    if (error){ body.append(h("div",{class:"empty"}, errMsg(error))); return; }
    const KIND_L = {org:"기관 문의", maker_waitlist:"메이커 사전 신청", advertiser:"광고 문의"};
    const ST = {new:"새 문의", contacted:"연락함", won:"계약", lost:"보류"};
    body.append((data||[]).length ? h("div",{class:"list"}, data.map(q => {
      const sel = h("select",{"aria-label":"상태"}, Object.entries(ST).map(([k,l]) => h("option",{value:k, selected:q.status===k}, l)));
      sel.addEventListener("change", async () => { const { error } = await sb.from("inquiries").update({status:sel.value}).eq("id", q.id); toast(error ? errMsg(error) : "상태를 바꿨어요"); });
      return h("div",{class:"rowitem", style:"align-items:flex-start"},
        h("div",{style:"display:grid;gap:3px;min-width:0;flex:1"}, h("div",{class:"t"}, KIND_L[q.kind] || q.kind, " · ", str(q.interest,40)),
          h("div",{class:"s"}, `${str(q.name,40)}${q.org ? " · " + str(q.org,60) : ""} · ${str(q.email,120)}${q.phone ? " · " + str(q.phone,30) : ""} · ${date(q.created_at)}`),
          q.message ? h("p",{class:"desc", style:"font-size:14px"}, str(q.message,1000)) : null),
        sel); })) : h("div",{class:"empty"},"아직 문의가 없어요."));
  } else if (T === "admin" && isAdmin()){
    const { data, error } = await sb.from("reports").select("*").order("created_at",{ascending:false}).limit(200);
    if (error){ body.append(h("div",{class:"empty"}, errMsg(error))); return; }
    const list = data || [];
    await loadProfiles(list.map(r => r.reporter_id));
    const open = list.filter(r => r.status === "open");
    body.append(h("p",{class:"note", style:"margin-bottom:12px"}, `처리 대기 ${open.length}건 · 전체 ${list.length}건`),
      list.length ? h("div",{class:"list"}, list.map(r => {
        const p = r.target_type === "project" ? S.projects.find(x => x.id === r.target_id) : null;
        const setStatusTo = async st => { const { error } = await sb.from("reports").update({status:st}).eq("id", r.id); if (error) toast(errMsg(error)); else route(); };
        let link = null;
        if (r.target_type === "project") link = h("a",{class:"btn small", href:"#/p/"+r.target_id},"작품 보기");
        else link = h("button",{class:"btn small", type:"button", onclick:async () => { const { data } = await sb.from("reviews").select("project_id").eq("id", r.target_id).maybeSingle(); if (data) go("#/p/"+data.project_id); else toast("삭제된 리뷰예요"); }},"리뷰 보기");
        return h("div",{class:"rowitem"},
          h("div",null, h("div",{class:"t"}, r.status === "open" ? "🟠 " : "✓ ", r.target_type === "project" ? "작품" : "리뷰", " · ", REPORT_REASONS[r.reason] || r.reason, p ? ` · ${str(p.title,40)}` : ""),
            h("div",{class:"s"}, `${date(r.created_at)} · 신고자 ${nameOf(r.reporter_id)}`, r.detail ? ` · ${str(r.detail,120)}` : "")),
          h("div",{style:"display:flex;gap:6px;flex-wrap:wrap"}, link,
            r.status === "open" ? h("button",{class:"btn small", type:"button", onclick:() => setStatusTo("resolved")},"처리 완료") : null,
            r.status === "open" ? h("button",{class:"btn small", type:"button", onclick:() => setStatusTo("dismissed")},"문제 없음") : null));
      })) : h("div",{class:"empty"},"신고가 없어요. 평화로운 하루예요 🌿"));
  }
}

/* ---------- search ---------- */
$("#search-form").addEventListener("submit", e => { e.preventDefault(); goBrowse({q:$("#search").value.trim(), keepSearch:true}); });
let sTimer = null;
$("#search").addEventListener("input", () => {
  clearTimeout(sTimer);
  sTimer = setTimeout(() => {
    const v = $("#search").value.trim();
    if (!v && S.route.name !== "browse") return;
    S.q = v; S.tag = null;
    if (S.route.name !== "browse"){ S.kind = "all"; go("#/browse"); return; }
    $("#browse-title").textContent = v ? `"${str(v,40)}" 검색 결과` : CAT_KIND[S.kind];
    renderCatbar(); renderGrid();
  }, 250);
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLayer(); });
window.addEventListener("hashchange", route);

/* ---------- boot ---------- */
(async () => {
  const contact = $("#contact-link");
  if (CFG.CONTACT_EMAIL){ contact.href = "mailto:" + CFG.CONTACT_EMAIL; contact.title = CFG.CONTACT_EMAIL; } else $("#contact-wrap").remove();
  const pm = location.pathname.slice(BASE.length - 1).match(/^\/a\/([a-z0-9]{4,12})\/?$/);
  if (pm) history.replaceState(null, "", BASE + "#/a/" + pm[1]);
  renderHeader(); renderCatbar();
  sb.auth.onAuthStateChange((ev, session) => { setTimeout(() => setUser(session && session.user), 0); });
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if (/[?&](code|error)=/.test(location.search) || /error_description=/.test(location.hash)){
      let back = "#/"; try{ back = sessionStorage.getItem("after_login") || "#/"; sessionStorage.removeItem("after_login"); }catch(e){}
      const errDesc = new URLSearchParams(location.search).get("error_description") || new URLSearchParams(location.hash.replace(/^#/,"")).get("error_description");
      history.replaceState(null, "", BASE + back);
      if (errDesc) toast("로그인하지 못했어요: " + errDesc.slice(0,80));
    }
    await setUser(session && session.user);
  }catch(e){ console.error(e); }
  route();
  try{ await loadProjects(); setStatus(""); }
  catch(e){ console.error(e); setStatus("작품을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요."); S.loaded = true; }
  if (["home","browse"].includes(S.route.name)) route(); else renderCatbar();
})();
