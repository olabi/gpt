/**
 * 빌딩 매니저 v2 — Google Apps Script 백엔드 (비공개 스프레드시트 DB + Drive 첨부)
 * ------------------------------------------------------------------------
 * 설치:
 *  1) 새 Google 스프레드시트 생성 (공유: "제한됨" 유지 — 비공개)
 *  2) 확장 프로그램 → Apps Script → 이 코드 붙여넣기 → SECRET 변경
 *  3) 배포 → 새 배포 → 웹 앱
 *       실행 사용자: 나(시트 소유자)  /  액세스: 모든 사용자
 *  4) 배포 URL(…/exec) + SECRET → 관리자 앱(index.html) 전산관리자 › 시스템
 *  5) 안내앱 링크: resident.html?site=<사업장ID>&gas=<배포URL>  (SECRET 불필요 — 세대/PIN으로 인증)
 *
 * 시트:
 *  _snapshot  전체 JSON (45,000자 단위로 A열에 분할 저장 — 셀 50,000자 제한 대응)
 *  reports / sites / users / residents / forms / events / notices / polls / directives / reqs
 *             사람이 읽는 미러 (대표가 피벗·차트에 사용)
 *  _log       요청 로그
 * Drive: "빌딩매니저_첨부" 폴더에 PDF/사진 저장
 */
const SECRET = 'CHANGE-ME-xY7#pQ';
const CHUNK = 45000;
const ATTACH_FOLDER = '빌딩매니저_첨부';

function doGet(e) { return json_({ ok: true, service: 'building-manager', time: new Date() }); }

function doPost(e) {
  let b; try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    switch (b.action) {
      /* ---- 관리자 앱 (SECRET 필요) ---- */
      case 'loadAll':   if (b.key !== SECRET) return json_({ ok: false, error: 'unauthorized' }); return json_({ ok: true, data: readSnap_() });
      case 'saveAll': { if (b.key !== SECRET) return json_({ ok: false, error: 'unauthorized' }); if (!b.data) return json_({ ok: false, error: 'no data' });
                        delete b.data.settings; writeSnap_(b.data); mirror_(b.data); log_('saveAll', (b.data.reports || []).length + ' reports'); return json_({ ok: true }); }
      case 'uploadFile': { if (b.key !== SECRET) return json_({ ok: false, error: 'unauthorized' });
                        const blob = Utilities.newBlob(Utilities.base64Decode(b.data), b.mime || 'application/octet-stream', b.name || 'file');
                        const f = folder_().createFile(blob);
                        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // 링크 아는 사람만 열람. 더 엄격히 하려면 이 줄 삭제(소유자만)
                        log_('upload', f.getName()); return json_({ ok: true, url: f.getUrl(), id: f.getId() }); }
      /* ---- 안내앱 (세대/PIN 인증, SECRET 불필요) ---- */
      case 'loadPublic':     return json_(publicFor_(readSnap_(), b.site, b.unit, b.pin));
      case 'residentAction': return json_(residentAction_(b));
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } finally { lock.releaseLock(); }
}

/* ---------- 스냅샷 (분할 저장) ---------- */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(n) { return ss_().getSheetByName(n) || ss_().insertSheet(n); }
function readSnap_() {
  const sh = sheet_('_snapshot'); const last = sh.getLastRow(); if (!last) return null;
  const parts = sh.getRange(1, 1, last, 1).getValues().map(r => r[0]).filter(x => x !== '');
  try { return JSON.parse(parts.join('')); } catch (e) { return null; }
}
function writeSnap_(data) {
  const s = JSON.stringify(data); const rows = []; for (let i = 0; i < s.length; i += CHUNK) rows.push([s.slice(i, i + CHUNK)]);
  const sh = sheet_('_snapshot'); sh.clearContents(); sh.getRange(1, 1, rows.length, 1).setValues(rows);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function log_(a, m) { sheet_('_log').appendRow([new Date(), a, m]); }
function folder_() { const it = DriveApp.getFoldersByName(ATTACH_FOLDER); return it.hasNext() ? it.next() : DriveApp.createFolder(ATTACH_FOLDER); }
const today_ = () => Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
const now_ = () => Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
const uid_ = () => Utilities.getUuid().slice(0, 7);

/* ---------- 안내앱: 공개 데이터 (사업장·세대 범위로 제한) ---------- */
function publicFor_(S, siteId, unit, pin) {
  if (!S) return { ok: false, error: 'no_store' };
  const s = (S.sites || []).find(x => x.id === siteId); if (!s) return { ok: false, error: 'no_site' };
  if (s.contractEnd && s.contractEnd < today_()) return { ok: false, error: 'expired' };
  if (!s.announce) return { ok: false, error: 'disabled' };
  const res = (S.residents || []).find(r => r.site === siteId && r.unit === unit && String(r.pin) === String(pin));
  if (!res) return { ok: false, error: 'invalid' };
  if (res.status === 'pending') return { ok: false, error: 'pending' };
  if (res.status !== 'approved') return { ok: false, error: 'revoked' };
  const polls = (S.polls || []).filter(p => p.site === siteId).map(p => ({
    id: p.id, title: p.title, desc: p.desc, options: p.options, closes: p.closes, status: p.status,
    counts: p.options.map((_, i) => Object.values(p.votes || {}).filter(x => x === i).length),
    total: Object.keys(p.votes || {}).length, my: (p.votes || {})[res.id]
  }));
  return { ok: true, data: {
    site: { id: s.id, name: s.name, type: s.type, company: (S.company || {}).name },
    resident: { id: res.id, name: res.name, unit: res.unit },
    notices: (S.notices || []).filter(n => n.site === siteId && (!n.unit || n.unit === unit)),
    polls,
    fees: (S.fees || []).filter(f => f.site === siteId && f.unit === unit),
    board: (S.board || []).filter(b => b.site === siteId),
    reqs: (S.reqs || []).filter(q => q.site === siteId && q.residentId === res.id)
  } };
}

/* ---------- 안내앱: 쓰기 (가입신청 / 투표 / 민원) ---------- */
function residentAction_(b) {
  const S = readSnap_(); if (!S) return { ok: false, error: 'no_store' };
  S.residents = S.residents || []; S.polls = S.polls || []; S.reqs = S.reqs || [];
  const p = b.payload || {};
  if (b.type === 'signup') {
    const s = (S.sites || []).find(x => x.id === p.site); if (!s || s.accessCode !== p.code) return { ok: false, error: 'code' };
    if (s.contractEnd && s.contractEnd < today_()) return { ok: false, error: 'expired' };
    if (S.residents.some(r => r.site === p.site && r.unit === p.unit && r.status !== 'revoked')) return { ok: false, error: 'dup' };
    S.residents.push({ id: 'rs' + uid_(), site: p.site, unit: p.unit, name: p.name, phone: p.phone, pin: String(p.pin), status: 'pending', requestedAt: today_() });
  } else {
    const chk = publicFor_(S, b.site, b.unit, b.pin); if (!chk.ok) return chk;
    const rid = chk.data.resident.id;
    if (b.type === 'vote') {
      const poll = S.polls.find(x => x.id === p.pollId);
      if (!poll || poll.status !== 'open' || poll.closes < today_()) return { ok: false, error: 'closed' };
      poll.votes = poll.votes || {}; if (poll.votes[rid] !== undefined) return { ok: false, error: 'voted' };
      poll.votes[rid] = Number(p.option);
    } else if (b.type === 'request') {
      S.reqs.push({ id: 'q' + uid_(), site: b.site, at: now_(), unit: b.unit, residentId: rid, body: String(p.body || '').slice(0, 500), done: false });
    } else return { ok: false, error: 'unknown type' };
  }
  writeSnap_(S); mirror_(S); log_('resident:' + b.type, (b.unit || p.unit || '')); return { ok: true };
}

/* ---------- 사람이 읽는 미러 탭 ---------- */
function writeTable_(name, header, rows) {
  const sh = sheet_(name); sh.clearContents();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  sh.setFrozenRows(1);
}
function mirror_(d) {
  const siteName = id => ((d.sites || []).find(s => s.id === id) || {}).name || '';
  const userName = id => ((d.users || []).find(u => u.id === id) || {}).name || '';
  const formOf = id => (d.forms || []).find(f => f.id === id) || {};
  writeTable_('sites', ['id', '사업장', '유형', '계약사', 'PM', '계약종료일', '안내앱', '접속코드'],
    (d.sites || []).map(s => [s.id, s.name, s.type, s.client, s.pm, s.contractEnd, s.announce ? 'Y' : 'N', s.accessCode || '']));
  writeTable_('users', ['id', '이름', '역할', '직책', '사업장', '상태', '연락처'],
    (d.users || []).map(u => [u.id, u.name, u.role, u.title, siteName(u.site), u.status, u.phone || '']));
  writeTable_('residents', ['id', '사업장', '세대/호', '이름', '연락처', '상태', '신청일'],
    (d.residents || []).map(r => [r.id, siteName(r.site), r.unit, r.name, r.phone || '', r.status, r.requestedAt || '']));
  writeTable_('forms', ['id', '양식명', '분류', '결재선', '항목(JSON)', '본문템플릿'],
    (d.forms || []).map(f => [f.id, f.name, f.cat, (f.line || []).join('>'), JSON.stringify(f.fields), f.template]));
  const kpiKeys = []; (d.forms || []).forEach(f => (f.fields || []).forEach(x => { if (x.kpi && !kpiKeys.includes(x.k)) kpiKeys.push(x.k); }));
  writeTable_('reports', ['id', '보고일자', '사업장', '양식', '분류', '작성자', '상태', '결재단계', '심각도', '안내앱게시', '제목'].concat(kpiKeys, ['첨부URL', '값(JSON)']),
    (d.reports || []).map(r => { const f = formOf(r.form); const vals = r.vals || {};
      const att = Object.values(vals).filter(v => v && typeof v === 'object' && v.url).map(v => v.url).join(' ');
      const slim = {}; Object.keys(vals).forEach(k => { const v = vals[k]; slim[k] = (v && typeof v === 'object') ? (v.name || '') : v; });
      return [r.id, r.date, siteName(r.site), f.name || '', f.cat || '', userName(r.author), r.status, r.step, vals['심각도'] || '', r.published ? 'Y' : '', r.title]
        .concat(kpiKeys.map(k => (vals[k] !== undefined && vals[k] !== '') ? Number(vals[k]) || 0 : ''))
        .concat([att, JSON.stringify(slim)]); }));
  writeTable_('events', ['id', '일자', '사업장', '일정', '중요', '등록자'],
    (d.events || []).map(e => [e.id, e.date, siteName(e.site), e.title, e.imp ? 'Y' : '', userName(e.by)]));
  writeTable_('notices', ['id', '일시', '사업장', '제목', '유형', '중요', '세대'],
    (d.notices || []).map(n => [n.id, n.at, siteName(n.site), n.title, n.type || '공지', n.imp ? 'Y' : '', n.unit || '']));
  writeTable_('polls', ['id', '사업장', '안건', '마감', '상태', '선택지', '득표', '참여세대'],
    (d.polls || []).map(p => [p.id, siteName(p.site), p.title, p.closes, p.status, (p.options || []).join(' | '),
      (p.options || []).map((_, i) => Object.values(p.votes || {}).filter(x => x === i).length).join(' | '), Object.keys(p.votes || {}).length]));
  writeTable_('directives', ['id', '일시', '사업장', '지시자', '내용', '완료'],
    (d.directives || []).map(x => [x.id, x.at, siteName(x.site), userName(x.by), x.text, x.done ? 'Y' : 'N']));
  writeTable_('reqs', ['id', '일시', '사업장', '세대', '내용', '완료'],
    (d.reqs || []).map(q => [q.id, q.at, siteName(q.site), q.unit, q.body, q.done ? 'Y' : 'N']));
}
