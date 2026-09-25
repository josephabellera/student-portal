const API_BASE = "https://rmmc-clearance-worker.abellera-rmmcgensan.workers.dev";

let token = null, student = null, years = [], currentYear = null, currentSemester = null, lastData = null, currentScope = 'institutional';

const loginView = document.getElementById('loginView');
const dashView = document.getElementById('dashView');
const loginErr = document.getElementById('loginErr');
const loginBtn = document.getElementById('loginBtn');
const yearSelect = document.getElementById('yearSelect');
const semesterSelect = document.getElementById('semesterSelect');
const eventsWrap = document.getElementById('eventsWrap');

function showError(msg){
  loginErr.textContent = msg;
  loginErr.style.display = 'block';
}
function hideError(){ loginErr.style.display = 'none'; }

async function api(path, opts = {}){
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    const err = new Error(data.error || ('Request failed (' + res.status + ')'));
    err.status = res.status;
    throw err;
  }
  return data;
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('lastName').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('studentNo').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('pwToggle').addEventListener('click', () => {
  const input = document.getElementById('lastName');
  const btn = document.getElementById('pwToggle');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Hide' : 'Show';
  btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
});

let turnstileLoginToken = null;
function onTurnstileLoginSuccess(token){ turnstileLoginToken = token; }
window.onTurnstileLoginSuccess = onTurnstileLoginSuccess;

async function doLogin(){
  hideError();
  const studentNo = document.getElementById('studentNo').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  if (!studentNo || !lastName){ showError('Please enter both your student number and password.'); return; }
  if (!turnstileLoginToken){ showError('Please complete the verification check above before continuing.'); return; }
  loginBtn.disabled = true; loginBtn.textContent = 'Checking…';
  try{
    // `lastName` kept alongside `password` until the Worker update is deployed
    const data = await api('/student-login', { method:'POST', body: JSON.stringify({ studentNo, password: lastName, lastName, turnstileToken: turnstileLoginToken }) });
    token = data.token;
    student = data.student;
    student.mustChangePassword = !!data.mustChangePassword;
    sessionStorage.setItem('sp_token', token);
    sessionStorage.setItem('sp_student', JSON.stringify(student));
    if (student.mustChangePassword){
      pendingTempPw = lastName;
      loginView.style.display = 'none';
      openPwModal(true);
      return;
    }
    await enterDashboard();
  }catch(e){
    showError(e.message || 'Something went wrong. Please try again.');
    if(typeof turnstile !== 'undefined') turnstile.reset('#turnstile-login');
    turnstileLoginToken = null;
  }finally{
    loginBtn.disabled = false; loginBtn.textContent = 'View My Record';
  }
}

document.getElementById('logoutBtn').addEventListener('click', doLogout);
function doLogout(){
  stopLive();
  hideIdCodeModal();
  closePwModal();
  pendingTempPw = null;
  lastData = null; lastDataJson = ''; lastPulse = null;
  token = null; student = null;
  sessionStorage.removeItem('sp_token'); sessionStorage.removeItem('sp_student');
  dashView.classList.remove('active');
  loginView.style.display = 'block';
  document.getElementById('studentNo').value = '';
  document.getElementById('lastName').value = '';
  turnstileLoginToken = null;
  if(typeof turnstile !== 'undefined') turnstile.reset('#turnstile-login');
}

yearSelect.addEventListener('change', () => {
  currentYear = yearSelect.value;
  loadRecords();
});

semesterSelect.addEventListener('change', () => {
  currentSemester = semesterSelect.value;
  loadRecords();
});

document.querySelectorAll('.scope-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    currentScope = btn.dataset.scope;
    document.querySelectorAll('.scope-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderForCurrentScope();
  });
});

async function enterDashboard(){
  loginView.style.display = 'none';
  dashView.classList.add('active');
  document.getElementById('studName').textContent = student.name || student.studentNo;
  document.getElementById('studNo').textContent = student.studentNo;
  document.getElementById('studMeta').textContent = '· ' + [student.program, student.yearLevel].filter(Boolean).join(' · ');

  try{
    const yrData = await api('/academic-years');
    years = yrData.years || [];
    yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    currentYear = years[0] || '';
    if (currentYear) yearSelect.value = currentYear;
    currentSemester = semesterSelect.value || '1st Sem';
    await loadRecords();
    startLive();
  }catch(e){
    eventsWrap.innerHTML = `<div class="empty">Couldn't load academic years: ${e.message}</div>`;
  }
}

document.getElementById('pdfBtn').addEventListener('click', generatePDF);

/* ---------- My ID Code (barcode) — for the gate/cashier when a physical ID barcode won't scan ---------- */
function renderIdCodeBarcode(){
  if (typeof JsBarcode === 'undefined' || !student) return false;
  try{
    JsBarcode('#idCodeBarcodeSvg', student.studentNo, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 16,
      height: 70,
      margin: 8,
      background: '#ffffff',
      lineColor: '#000000'
    });
    return true;
  }catch(e){
    return false;
  }
}
function showIdCodeModal(){
  if (!student) return;
  document.getElementById('idCodeModalName').textContent = student.name || student.studentNo;
  document.getElementById('idCodeModalMeta').textContent = [student.studentNo, student.program, student.yearLevel].filter(Boolean).join(' · ');
  if (!renderIdCodeBarcode()){
    alert('The barcode tool didn\'t load. Please refresh the page and try again, or use your physical ID.');
    return;
  }
  document.getElementById('idCodeModal').style.display = 'flex';
}
function hideIdCodeModal(){
  document.getElementById('idCodeModal').style.display = 'none';
}
document.getElementById('idCodeBtn').addEventListener('click', showIdCodeModal);
document.getElementById('idCodeCloseBtn').addEventListener('click', hideIdCodeModal);
document.getElementById('idCodeModal').addEventListener('click', e => { if (e.target.id === 'idCodeModal') hideIdCodeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideIdCodeModal(); });

/* ---------- Password change (forced on temporary password, or voluntary) ---------- */
let pendingTempPw = null, pwForced = false, pwOkTimer = null;
const PW_SPECIAL_RE = /[^A-Za-z0-9\s]/;

function pwChecks(){
  const n = document.getElementById('pwNew').value;
  const c = document.getElementById('pwConfirm').value;
  return { len: n.length >= 8, special: PW_SPECIAL_RE.test(n), match: n.length > 0 && n === c };
}
function renderPwRules(){
  const r = pwChecks();
  document.querySelectorAll('#pwRules li').forEach(li => li.classList.toggle('ok', !!r[li.dataset.rule]));
}
function showPwError(msg){
  const el = document.getElementById('pwErr');
  el.textContent = msg; el.style.display = 'block';
}
function openPwModal(forced){
  pwForced = forced;
  clearTimeout(pwOkTimer);
  ['pwCurrent','pwNew','pwConfirm'].forEach(id => { const el = document.getElementById(id); el.value = ''; el.type = 'password'; });
  document.querySelectorAll('#pwModal .pw-toggle').forEach(b => { b.textContent = 'Show'; });
  document.getElementById('pwErr').style.display = 'none';
  document.getElementById('pwOk').style.display = 'none';
  const hideCurrent = forced && !!pendingTempPw;
  document.getElementById('pwCurrentField').style.display = hideCurrent ? 'none' : '';
  document.getElementById('pwModalTitle').textContent = forced ? 'Set Your New Password' : 'Change Password';
  document.getElementById('pwModalSub').textContent = forced
    ? 'You are using a temporary password (your last name). For the security of your records, please set a new password before continuing.'
    : 'Enter your current password, then choose a new one.';
  document.getElementById('pwCancelBtn').textContent = forced ? 'Sign out' : 'Cancel';
  const saveBtn = document.getElementById('pwSaveBtn');
  saveBtn.disabled = false; saveBtn.textContent = 'Save New Password';
  renderPwRules();
  document.getElementById('pwModal').classList.add('open');
  setTimeout(() => document.getElementById(hideCurrent ? 'pwNew' : 'pwCurrent').focus(), 50);
}
function closePwModal(){
  clearTimeout(pwOkTimer);
  document.getElementById('pwModal').classList.remove('open');
}

async function savePassword(){
  document.getElementById('pwErr').style.display = 'none';
  const current = (pwForced && pendingTempPw) ? pendingTempPw : document.getElementById('pwCurrent').value;
  const next = document.getElementById('pwNew').value;
  const r = pwChecks();
  if (!current){ showPwError('Please enter your current password.'); return; }
  if (!r.len || !r.special){ showPwError('Your new password must be at least 8 characters and include at least 1 special character.'); return; }
  if (!r.match){ showPwError('New password and confirmation do not match.'); return; }
  if (next === current){ showPwError('Your new password must be different from your current password.'); return; }

  const saveBtn = document.getElementById('pwSaveBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  const wasForced = pwForced;
  try{
    const data = await api('/student-change-password', { method:'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    if (data.token){ token = data.token; sessionStorage.setItem('sp_token', token); }
    pendingTempPw = null;
    student.mustChangePassword = false;
    sessionStorage.setItem('sp_student', JSON.stringify(student));
    if (wasForced){
      closePwModal();
      await enterDashboard();
    }else{
      const ok = document.getElementById('pwOk');
      ok.textContent = 'Your password has been changed.';
      ok.style.display = 'block';
      saveBtn.textContent = 'Saved';
      pwOkTimer = setTimeout(closePwModal, 1500);
    }
  }catch(e){
    saveBtn.disabled = false; saveBtn.textContent = 'Save New Password';
    if (e.status === 401){ closePwModal(); sessionExpired(); return; }
    showPwError(e.message || 'Could not change your password. Please try again.');
  }
}

document.getElementById('changePwBtn').addEventListener('click', () => openPwModal(false));
document.getElementById('pwSaveBtn').addEventListener('click', savePassword);
document.getElementById('pwCancelBtn').addEventListener('click', () => {
  if (pwForced){ closePwModal(); doLogout(); } else closePwModal();
});
document.getElementById('pwModal').addEventListener('click', e => {
  if (e.target.id === 'pwModal' && !pwForced) closePwModal();
});
['pwCurrent','pwNew','pwConfirm'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', renderPwRules);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') savePassword(); });
});
document.querySelectorAll('#pwModal .pw-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    btn.textContent = hidden ? 'Hide' : 'Show';
  });
});
// Saves the barcode as a PNG, in whichever way actually works on the device:
// - Native share sheet (navigator.share) when available — the one reliable
//   "Save Image" path on iPhone (iOS 15+), and it works on Android too.
// - iOS fallback: open the image in a new tab so the student can long-press
//   it and choose "Add to Photos" — the `download` attribute on <a> is not
//   honored by Safari on many iOS versions, so it can't be trusted alone.
// - Android/desktop fallback: the standard <a download> link.
function saveIdCodeBlob(blob, filename){
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (navigator.canShare && typeof File !== 'undefined'){
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })){
      navigator.share({ files: [file], title: filename }).catch(err => {
        // AbortError = student cancelled the share sheet themselves — leave it at that.
        if (err && err.name === 'AbortError') return;
        saveIdCodeBlobFallback(blob, filename, isIOS);
      });
      return;
    }
  }
  saveIdCodeBlobFallback(blob, filename, isIOS);
}
function saveIdCodeBlobFallback(blob, filename, isIOS){
  const url = URL.createObjectURL(blob);
  if (isIOS){
    const w = window.open(url, '_blank');
    if (!w) alert('Please allow pop-ups to save the barcode, or take a screenshot instead.');
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const idCodeSaveBtn = document.getElementById('idCodeSaveBtn');
if (idCodeSaveBtn) idCodeSaveBtn.addEventListener('click', () => {
  if (!student) return;
  const svgEl = document.getElementById('idCodeBarcodeSvg');
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    // Rasterize at a higher pixel scale than the on-screen SVG so the saved
    // image stays crisp for scanning even after zooming in on a phone.
    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (!blob){ alert('Could not prepare the image for saving. Please try again, or use Print instead.'); return; }
      saveIdCodeBlob(blob, `ID-Code-${student.studentNo}.png`);
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Could not prepare the image for saving. Please try again, or use Print instead.');
  };
  img.src = url;
});
document.getElementById('idCodePrintBtn').addEventListener('click', () => {
  if (!student) return;
  const svgHtml = document.getElementById('idCodeBarcodeSvg').outerHTML;
  const name = escHtml(student.name || student.studentNo);
  const meta = escHtml([student.studentNo, student.program, student.yearLevel].filter(Boolean).join(' · '));
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<html><head><title>ID Code — ${name}</title></head><body style="text-align:center; font-family:Arial, sans-serif; padding:40px;">
    <div style="font-weight:700; font-size:18px;">${name}</div>
    <div style="font-size:13px; color:#555; margin-bottom:20px;">${meta}</div>
    ${svgHtml}
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
});

function drawWatermark(doc, text){
  // Once per page only — autoTable's willDrawPage also fires on the page the
  // table STARTS on, which would re-stamp the watermark over the logo/header.
  const pageNo = doc.internal.getCurrentPageInfo().pageNumber;
  doc.__wmPages = doc.__wmPages || {};
  if (doc.__wmPages[pageNo]) return;
  doc.__wmPages[pageNo] = true;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  try{
    // Large, faint, diagonal, staggered rows covering the whole page — drawn
    // first so every logo, text and table sits on top of it.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(235, 237, 246); // lighter (was 226, 229, 242)
    const textW = doc.getTextWidth(text);
    const rad = 35 * Math.PI / 180;
    const ux = Math.cos(rad), uy = -Math.sin(rad);   // along the text (up-right)
    const vx = Math.sin(rad), vy =  Math.cos(rad);   // across the lines (down-right)
    const along = textW + 28;   // gap between repeats on the same line
    const across = 40;          // gap between diagonal lines
    const cx = pageWidth / 2, cy = pageHeight / 2;
    const reach = Math.hypot(pageWidth, pageHeight);
    let line = 0;
    for(let k = -reach; k <= reach; k += across, line++){
      const shift = (line % 2) ? along / 2 : 0;   // stagger alternate lines
      for(let t = -reach - shift; t <= reach; t += along){
        doc.text(text, cx + k * vx + t * ux, cy + k * vy + t * uy, { angle: 35 });
      }
    }
  }catch(e){ /* watermark is decorative — never block the PDF over it */ }
}

// Entrance fee line for PDFs. jsPDF's built-in font has no peso sign, so amounts print as "PHP".
function pdfPeso(n){
  const v = Number(n) || 0;
  return 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: (v % 1) ? 2 : 0, maximumFractionDigits: 2 });
}
function pdfFeeLine(f){
  if(!f) return null;
  if(f.paid){
    const when = f.paidAt ? formatTimestampNice(f.paidAt) : '';
    return { color: [30,130,76], text: `Entrance fee ${pdfPeso(f.paidAmount != null ? f.paidAmount : f.amount)} \u2014 PAID${when ? ' ' + when : ''}${f.receiptNo ? ' \u00b7 OR ' + f.receiptNo : ''}` };
  }
  return { color: [200,60,60], text: `Entrance fee ${pdfPeso(f.amount)} \u2014 NOT PAID (pay at the SSO; required for clearance)` };
}

function generatePDF(){
  if (!lastData || !student) return;
  const scope = currentScope;
  const scopeLabel = scope === 'college' ? 'College/Departmental' : 'Institutional';
  const scoped = getScopedData(lastData, scope);
  const btn = document.getElementById('pdfBtn');
  btn.disabled = true; const oldLabel = btn.textContent; btn.textContent = 'Preparing…';

  if (!window.jspdf || !window.jspdf.jsPDF){
    btn.disabled = false; btn.textContent = oldLabel;
    alert('The PDF tool didn\'t load (this can happen on a school network that blocks cdnjs.cloudflare.com, or a slow/offline connection). Please check your internet connection and try again.');
    return;
  }

  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    if (typeof doc.autoTable !== 'function'){
      throw new Error('PDF table plugin did not load.');
    }
    const marginX = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 40;

    drawWatermark(doc, 'STUDENT SERVICES OFFICE');

    const logoSrc = document.querySelector('.seal img').src;
    try{ doc.addImage(logoSrc, 'PNG', marginX, y, 46, 46); }catch(e){}
    const ssoLogoEl = document.getElementById('ssoLogo');
    let logoBlockWidth = 46;
    if(ssoLogoEl && ssoLogoEl.src){
      try{ doc.addImage(ssoLogoEl.src, 'PNG', marginX + 52, y + 3, 40, 40); logoBlockWidth = 52 + 40; }catch(e){}
    }

    const textX = marginX + logoBlockWidth + 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20,20,20);
    doc.text('RAMON MAGSAYSAY MEMORIAL COLLEGES, INC.', textX, y + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(130,130,130);
    doc.text('Pioneer Avenue, General Santos City', textX, y + 25);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(20,20,20);
    doc.text(`Activity Attendance and Clearance \u2014 ${scopeLabel}`, textX, y + 42);

    y += 66;
    doc.setDrawColor(215,215,215);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20,20,20);
    doc.text(`Academic Year: ${currentYear || '\u2014'}  \u00b7  Semester: ${currentSemester || '\u2014'}`, marginX, y);
    y += 20;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    doc.text(`Student Name: ${student.name || ''}`, marginX, y);
    doc.text(`Program: ${student.program || '—'}`, marginX + 290, y);
    y += 16;
    doc.text(`Student No.: ${student.studentNo || ''}`, marginX, y);
    doc.text(`Year Level: ${student.yearLevel || '—'}`, marginX + 290, y);
    y += 24;

    const decision = scoped.decision;
    const statusLabel = scoped.wholeScopeExemption ? 'EXEMPTED' : !decision ? 'PENDING REVIEW' : decision.status === 'cleared' ? 'CLEARED' : 'NOT CLEARED';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(`Clearance Status: ${statusLabel}`, marginX, y);
    y += 24;
    if (scoped.wholeScopeExemption){
      const ex = scoped.wholeScopeExemption;
      const exReason = ex.reason_category === 'Other' ? (ex.reason_note || 'Other') : ex.reason_category;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90,90,90);
      doc.text(`Exempted from all ${scopeLabel} required events \u2014 ${exReason}`, marginX, y);
      doc.setTextColor(30,30,30);
      y += 20;
    }
    // Removed: this duplicated the per-event fee line below (e.g. under
    // "PALARO 2026") that already states NOT PAID in the same red text.


    const events = scoped.events, logs = scoped.logs, remarks = scoped.remarks;
    const pdfStudent = scoped.student;
    const { scheduleByKey, relevantKeys: plannedKeys } = getEventPlan(events, logs, scoped.schedules, scoped.requiredEvents, pdfStudent.year_level, pdfStudent.program);
    const feesByKeyLower = scoped.feesByKeyLower || {};
    const relevantKeys = plannedKeys.slice();
    Object.values(feesByKeyLower).forEach(f => {
      if(!relevantKeys.some(k => String(k).toLowerCase() === f._key.toLowerCase())) relevantKeys.push(f._key);
    });

    if (relevantKeys.length === 0){
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110,110,110);
      doc.text(`No ${scopeLabel} activity records found for this student.`, marginX, y);
      y += 20;
    }

    relevantKeys.forEach(key => {
      const ev = events.find(e => e.event_key === key) || {};
      const schedule = scheduleByKey[key];
      const rows = buildGridRows(key, schedule, logs, pdfStudent.year_level, pdfStudent.program);

      let range = '';
      const rowDates = [...new Set(rows.map(r => r.date).filter(Boolean))].sort();
      if (rowDates.length){
        range = rowDates.length > 1
          ? `(${formatShortDate(rowDates[0])} \u2013 ${formatShortDate(rowDates[rowDates.length - 1])})`
          : `(${formatShortDate(rowDates[0])})`;
      }

      if (y > 720){ doc.addPage(); y = 40; drawWatermark(doc, 'STUDENT SERVICES OFFICE'); }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20,20,20);
      doc.text(`${(ev.name || key).toUpperCase()}${range ? '  ' + range : ''}`, marginX, y);
      y += 14;

      const fee = pdfFeeLine(feesByKeyLower[String(key).toLowerCase()]);
      if (fee){
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...fee.color);
        doc.text(fee.text, marginX, y);
        doc.setTextColor(30,30,30);
        y += 14;
      }

      const isElection = isElectionEvent(key, events);
      if (isElection && rows.length === 0){
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(200,60,60);
        doc.text('Did not vote in this election.', marginX, y);
        y += 24;
      } else if (rows.length === 0){
        if (fee){ y += 10; }
        else {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110,110,110);
          doc.text('No scans on file, and no schedule synced for this event.', marginX, y);
          y += 24;
        }
      } else if (isSimpleEvent(key, schedule, logs, events)) {
        const body = logs.filter(l => l.event_key === key).map(l => {
          const rowRemarks = remarks
            .filter(rm => rm.event_key === key && rm.date === l.date && rm.session === l.session)
            .map(rm => rm.text).join('; ');
          return ['Voted', formatTimestampNice(l.time_stamp || l.date), rowRemarks];
        });
        doc.autoTable({
          startY: y,
          margin: { left: marginX, right: marginX },
          head: [['Status', 'Date & Time', 'Remarks']],
          body,
          theme: 'plain',
          styles: { fontSize: 9, cellPadding: 6, textColor: [30,30,30], lineColor: [230,230,235], lineWidth: 0.5, fillColor: false },
          headStyles: { fillColor: [55,58,72], textColor: [255,255,255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: false },
          willDrawPage: () => drawWatermark(doc, 'STUDENT SERVICES OFFICE'),
        });
        y = doc.lastAutoTable.finalY + 26;
      } else {
        const body = rows.map(r => {
          const rowRemarks = remarks
            .filter(rm => rm.event_key === key && rm.date === r.date && rm.session === r.session)
            .map(rm => rm.text).join('; ');
          const statusText = r.status === 'complete' ? 'Complete' : r.status === 'partial' ? 'Partial' : 'Absent';
          return [r.date || '—', r.session || '—', (r.inTime ? formatClockTime(r.inTime) : (r.inRequired===false ? 'Not required' : '—')), (r.outTime ? formatClockTime(r.outTime) : (r.outRequired===false ? 'Not required' : '—')), statusText, rowRemarks];
        });

        doc.autoTable({
          startY: y,
          margin: { left: marginX, right: marginX },
          head: [['Date', 'Session', 'IN', 'OUT', 'Status', 'Remarks']],
          body,
          theme: 'plain',
          styles: { fontSize: 9, cellPadding: 6, textColor: [30,30,30], lineColor: [230,230,235], lineWidth: 0.5, fillColor: false },
          headStyles: { fillColor: [55,58,72], textColor: [255,255,255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: false },
          willDrawPage: () => drawWatermark(doc, 'STUDENT SERVICES OFFICE'),
        });
        y = doc.lastAutoTable.finalY + 26;
      }
    });

    // ---- Verification QR ----
    // Anyone can edit a downloaded PDF, so the file itself proves nothing on its
    // own. This QR points to a public page that checks the LIVE record instead —
    // if the PDF was altered, it won't match what the QR shows.
    if (y > 640){ doc.addPage(); y = 40; drawWatermark(doc, 'STUDENT SERVICES OFFICE'); }
    y += 10;
    doc.setDrawColor(222,224,236);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 24;

    const verifyUrl = `${location.origin}${location.pathname}?verify=${encodeURIComponent(student.studentNo)}&ay=${encodeURIComponent(currentYear)}&sem=${encodeURIComponent(currentSemester)}`;
    let qrDataUrl = null;
    try{
      const qrTarget = document.getElementById('pdfQrTarget');
      qrTarget.innerHTML = '';
      new QRCode(qrTarget, { text: verifyUrl, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
      const canvas = qrTarget.querySelector('canvas');
      if(canvas) qrDataUrl = canvas.toDataURL('image/png');
    }catch(e){ /* QR is a bonus check — a missing QR shouldn't block the PDF */ }

    if(qrDataUrl){
      try{ doc.addImage(qrDataUrl, 'PNG', marginX, y, 64, 64); }catch(e){}
    }
    const verifyTextX = marginX + (qrDataUrl ? 78 : 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20,20,20);
    doc.text('Verify this document', verifyTextX, y + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110,110,110);
    doc.text('This reflects live system records at the moment it was generated. Scan the QR code', verifyTextX, y + 27);
    doc.text('or visit the link below to confirm it against the current record \u2014 the system,', verifyTextX, y + 39);
    doc.text('not this file, is always the source of truth.', verifyTextX, y + 51);
    doc.setTextColor(59, 79, 214);
    doc.textWithLink(verifyUrl, verifyTextX, y + 66, { url: verifyUrl });
    y += 90;

    const now = new Date();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150,150,150);
    doc.text(`Generated ${now.toLocaleDateString('en-US')}, ${now.toLocaleTimeString('en-US')}`, marginX, doc.internal.pageSize.getHeight() - 24);

    doc.save(`${student.studentNo}-${scope}-attendance-record-${currentYear}-${(currentSemester||'').replace(/\s+/g,'-')}.pdf`);
  } catch(err){
    console.error('PDF generation failed:', err);
    alert('Could not generate the PDF: ' + (err && err.message ? err.message : 'unknown error') + '\n\nPlease try again, or take a screenshot of this message if it keeps happening.');
  } finally {
    btn.disabled = false; btn.textContent = oldLabel;
  }
}

let lastDataJson = '';
async function loadRecords(silent){
  if(!silent) eventsWrap.innerHTML = '<div class="loading">Loading your records…</div>';
  try{
    // Ask for the change fingerprint first, so anything that changes while we load is caught by the next check.
    let pulse = null;
    try{ pulse = (await api(pulsePath())).pulse; }catch(e){ if(e.status === 401) throw e; }
    const data = await api(`/student-portal/${encodeURIComponent(student.studentNo)}?academicYear=${encodeURIComponent(currentYear)}&semester=${encodeURIComponent(currentSemester)}`);
    const json = JSON.stringify(data);
    const changed = json !== lastDataJson;
    lastData = data;
    lastDataJson = json;
    lastPulse = pulse;
    lastFullAt = Date.now();
    if(!silent || changed) renderForCurrentScope();
    markUpdated();
  }catch(e){
    if(e.status === 401 && silent){ sessionExpired(); return; }
    if(!silent) eventsWrap.innerHTML = `<div class="empty">Couldn't load your records: ${e.message}</div>`;
    else setLiveStatus('Reconnecting…', 'warn');
  }
}

// Institutional and College/Departmental events, schedules, required-events,
// and clearance decisions are tagged with `scope` by the Worker — filtering
// happens entirely client-side against the already-fetched data, so switching
// tabs is instant and needs no extra request.
function buildEventScopeMap(events){
  const map = {};
  (events||[]).forEach(e => { if(e.event_key) map[e.event_key.toLowerCase()] = e.scope || 'institutional'; });
  return map;
}
function getScopedData(data, scope){
  const eventScopeMap = buildEventScopeMap(data.events);
  const scopedEvents = (data.events||[]).filter(e => (e.scope||'institutional')===scope);
  const scopedLogs = (data.logs||[]).filter(l => (eventScopeMap[(l.event_key||'').toLowerCase()]||'institutional')===scope);
  const scopedSchedules = (data.schedules||[]).filter(s => (s.scope||'institutional')===scope);
  const reqByScope = data.requiredEventsByScope || (data.requiredEvents||[]).map(k => ({eventKey:k, scope:'institutional'}));
  const scopedRequiredEvents = reqByScope.filter(r => (r.scope||'institutional')===scope).map(r => r.eventKey);
  const decision = data.decisions ? data.decisions[scope] : (scope==='institutional' ? data.decision : null);
  const scopedExemptions = (data.exemptions||[]).filter(e => (e.scope||'institutional')===scope);
  const wholeScopeExemption = scopedExemptions.find(e => (e.event_key||'')==='') || null;
  const eventExemptions = scopedExemptions.filter(e => (e.event_key||'')!=='');
  const exemptedEventKeysLower = new Set(eventExemptions.map(e => e.event_key.toLowerCase()));
  // Entrance fees go with their event: same scope, shown inside that event's card,
  // and an unpaid fee is listed as missing for clearance.
  const feesByKeyLower = {};
  (data.entranceFees||[]).forEach(f => {
    const k = String(f.eventKey || f.eventName || '').trim();
    if(!k) return;
    if((eventScopeMap[k.toLowerCase()]||'institutional') !== scope) return;
    feesByKeyLower[k.toLowerCase()] = Object.assign({ _key: k }, f);
  });
  const unpaidFees = Object.values(feesByKeyLower).filter(f => !f.paid);
  return { events: scopedEvents, logs: scopedLogs, remarks: data.remarks||[], schedules: scopedSchedules, requiredEvents: scopedRequiredEvents, decision, student: data.student||{}, wholeScopeExemption, eventExemptions, exemptedEventKeysLower, feesByKeyLower, unpaidFees };
}
function renderForCurrentScope(){
  if(!lastData) return;
  // Fees now show inside their own event card (see renderEvents), so the separate section stays hidden.
  renderFees([]);
  const scoped = getScopedData(lastData, currentScope);
  renderRecordSummary(scoped);
  renderEvents(scoped.events, scoped.logs, scoped.remarks, scoped.schedules, scoped.requiredEvents, scoped.student.year_level, scoped.student.program, scoped.feesByKeyLower, scoped.wholeScopeExemption, scoped.exemptedEventKeysLower);
}

function renderStatus(decision, wholeScopeExemption){
  const pill = document.getElementById('statusPill');
  const label = document.getElementById('statusLabel');
  pill.className = 'status-pill';
  if (wholeScopeExemption){
    pill.classList.add('status-exempt');
    label.textContent = 'Exempted';
    return;
  }
  if (!decision){
    pill.classList.add('status-pending');
    label.textContent = 'Pending Review';
  } else if (decision.status === 'cleared'){
    pill.classList.add('status-cleared');
    label.textContent = 'Cleared';
  } else {
    pill.classList.add('status-not');
    label.textContent = 'Not Cleared';
  }
}

function renderRecordSummary(data){
  const { events = [], logs = [], remarks = [], schedules = [], requiredEvents = [], decision, student: dataStudent = {}, wholeScopeExemption = null, exemptedEventKeysLower = new Set(), unpaidFees = [] } = data;
  renderStatus(decision, wholeScopeExemption);
  const yearLevel = dataStudent.year_level || '';
  const program = dataStudent.program || '';
  const applicableRequiredEvents = requiredEvents.filter(key => scheduleAppliesToStudent(key, schedules, yearLevel, program));

  const trackedCount = applicableRequiredEvents.length || events.length;
  document.getElementById('recordSummary').innerHTML =
    `On record for <b>${trackedCount}</b> event${trackedCount === 1 ? '' : 's'} in <b>${currentYear || '—'} \u00b7 ${currentSemester || '—'}</b>`;

  // Required-event pass/fail, exemption, and fee status now show per-event
  // in the attendance list below (see renderEvents), so this summary row
  // of chips is no longer needed.
  document.getElementById('chipsWrap').innerHTML = '';
  document.getElementById('missingNote').textContent = '';

  const decisionNote = document.getElementById('decisionNote');
  decisionNote.textContent = decision
    ? `Marked ${decision.status === 'cleared' ? 'CLEARED' : 'NOT CLEARED'} by ${decision.decided_by} on ${formatDate(decision.updated_at)}`
    : 'Clearance decision pending.';
}

function dayAppliesToStudent(day, yearLevel, program){
  const yl = (yearLevel||'').toLowerCase();
  const pr = (program||'').toLowerCase();
  const ylMatch = !day.yearLevels || day.yearLevels.length===0 || day.yearLevels.some(y=>y.toLowerCase()===yl);
  const progMatch = !day.programs || day.programs.length===0 || day.programs.some(p=>p.toLowerCase()===pr);
  return ylMatch && progMatch;
}
function scheduleAppliesToStudent(eventKey, schedules, yearLevel, program){
  const sched = (schedules||[]).find(s => s.eventKey === eventKey);
  if(!sched || !sched.days || sched.days.length===0) return true; // no schedule info — don't restrict
  return sched.days.some(day => dayAppliesToStudent(day, yearLevel, program));
}
function formatTimestampNice(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  if(isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-PH', {timeZone:'Asia/Manila', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'});
}
function isSimpleEvent(eventKey, schedule, logs, events){
  if(schedule && schedule.days && schedule.days.length) return false; // has a real AM/PM schedule — not a simple presence event
  const evLogs = logs.filter(l => l.event_key === eventKey);
  if(evLogs.length > 0) return evLogs.every(l => !l.session && !l.mode);
  const meta = (events||[]).find(e => e.event_key && e.event_key.toLowerCase() === eventKey.toLowerCase());
  return !!(meta && meta.source === 'election');
}
function isElectionEvent(eventKey, events){
  const meta = (events||[]).find(e => e.event_key && e.event_key.toLowerCase() === eventKey.toLowerCase());
  return !!(meta && meta.source === 'election');
}
function buildGridRows(eventKey, schedule, logs, yearLevel, program){
  const evLogs = logs.filter(l => l.event_key === eventKey);
  let combos = [];
  if (schedule && schedule.days && schedule.days.length){
    const applicableDays = schedule.days.filter(day => dayAppliesToStudent(day, yearLevel, program));
    applicableDays.forEach(day => {
      const sessions = (day.sessions && day.sessions.length) ? day.sessions : ['—'];
      sessions.forEach(session => combos.push({ date: day.date, session, sessionModes: day.sessionModes || {} }));
    });
  } else {
    const seen = new Set();
    evLogs.forEach(l => {
      const k = `${l.date || ''}|${l.session || ''}`;
      if (!seen.has(k)){ seen.add(k); combos.push({ date: l.date, session: l.session, sessionModes: {} }); }
    });
    combos.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.session || '').localeCompare(b.session || ''));
  }
  return combos.map(c => {
    const inLog = evLogs.find(l => l.date === c.date && l.session === c.session && l.mode === 'IN');
    const outLog = evLogs.find(l => l.date === c.date && l.session === c.session && l.mode === 'OUT');
    const requiredModes = (c.sessionModes[c.session] && c.sessionModes[c.session].length) ? c.sessionModes[c.session] : ['IN','OUT'];
    const present = [];
    if (inLog) present.push('IN');
    if (outLog) present.push('OUT');
    const missing = requiredModes.filter(m => !present.includes(m));
    let status;
    if (missing.length === 0) status = 'complete';
    else if (missing.length === requiredModes.length) status = 'absent';
    else status = 'partial';
    return { date: c.date, session: c.session, inTime: inLog ? inLog.time_stamp : null, outTime: outLog ? outLog.time_stamp : null, status, inRequired: requiredModes.includes('IN'), outRequired: requiredModes.includes('OUT') };
  });
}

function getEventPlan(events, logs, schedules, requiredEvents, yearLevel, program){
  events = events || []; logs = logs || [];
  schedules = schedules || []; requiredEvents = requiredEvents || [];
  const applicableRequiredEvents = requiredEvents.filter(key => scheduleAppliesToStudent(key, schedules, yearLevel, program));
  const scheduleByKey = {};
  schedules.forEach(s => { scheduleByKey[s.eventKey] = s; });
  const relevantKeys = events
    .map(e => e.event_key)
    .filter(key => {
      if(!scheduleAppliesToStudent(key, schedules, yearLevel, program)) return false;
      return applicableRequiredEvents.includes(key) || logs.some(l => l.event_key === key) || scheduleByKey[key];
    });
  return { scheduleByKey, relevantKeys, applicableRequiredEvents };
}

function renderEventFeeLine(f){
  if(!f) return '';
  const wrap = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid rgba(22,27,103,.08);';
  const meta = 'font-size:12.5px;color:#777;';
  if(f.paid){
    return `<div class="event-fee" style="${wrap}"><b style="font-size:13px;">Entrance fee ${escHtml(peso(f.paidAmount != null ? f.paidAmount : f.amount))}</b><span class="fee-badge fee-badge-paid">✓ PAID</span><span style="${meta}">${escHtml(formatTimestampNice(f.paidAt))}${f.receiptNo ? ' · OR ' + escHtml(f.receiptNo) : ''}</span></div>`;
  }
  return `<div class="event-fee" style="${wrap}"><b style="font-size:13px;">Entrance fee ${escHtml(peso(f.amount))}</b><span class="fee-badge fee-badge-unpaid">✗ NOT PAID</span><span style="${meta}">Please pay at the SSO — required for your clearance.</span></div>`;
}

// Blue gradient event headers with high-contrast text. Injected here so it always
// loads after style.css; move it into style.css whenever convenient.
function ensureEventHeaderStyles(){
  if(document.getElementById('eventHeaderStyles')) return;
  const st = document.createElement('style');
  st.id = 'eventHeaderStyles';
  st.textContent = `
    .event-card .event-head{background:linear-gradient(90deg,#151B6B 0%,#3B4FD6 100%) !important;color:#fff;}
    .event-card .event-head:hover{background:linear-gradient(90deg,#1B2280 0%,#4A5DE0 100%) !important;}
    .event-card .event-head h4{color:#fff !important;}
    .event-card .event-head .event-range{color:rgba(255,255,255,.78) !important;}
    .event-card .event-head .progress-label{color:#fff !important;}
    .event-card .event-head .progress-bar{background:rgba(255,255,255,.25) !important;}
    .event-card .event-head .progress-bar span{background:#5EE08F !important;}
    .event-card .event-head .head-fee-pill{box-shadow:0 0 0 1px rgba(255,255,255,.35);white-space:nowrap;}
    .event-card .event-head .fee-badge-unpaid{background:#FDE3E1 !important;color:#B3261E !important;}
    .event-card .event-head .fee-badge-paid{background:#DDF6E6 !important;color:#1E7A45 !important;}
    .event-card .event-progress{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    .event-card thead th{background:#F4F5FD;color:#151B6B;}
  `;
  document.head.appendChild(st);
}

function renderEvents(events, logs, remarks, schedules, requiredEvents, yearLevel, program, feesByKeyLower, wholeScopeExemption, exemptedEventKeysLower){
  ensureEventHeaderStyles();
  events = events || []; logs = logs || []; remarks = remarks || [];
  schedules = schedules || []; requiredEvents = requiredEvents || [];
  feesByKeyLower = feesByKeyLower || {};
  exemptedEventKeysLower = exemptedEventKeysLower || new Set();

  const { scheduleByKey, relevantKeys: plannedKeys } = getEventPlan(events, logs, schedules, requiredEvents, yearLevel, program);
  // An event with a fee always gets a card, even with no attendance yet.
  const relevantKeys = plannedKeys.slice();
  Object.values(feesByKeyLower).forEach(f => {
    if(!relevantKeys.some(k => String(k).toLowerCase() === f._key.toLowerCase())) relevantKeys.push(f._key);
  });

  if (relevantKeys.length === 0){
    const scopeLabel = currentScope === 'college' ? 'College/Departmental' : 'Institutional';
    eventsWrap.innerHTML = `<div class="empty">No ${scopeLabel} activities recorded yet for this term.</div>`;
    return;
  }

  const cards = relevantKeys.map(key => {
    const ev = events.find(e => e.event_key === key) || {};
    const feeObj = feesByKeyLower[String(key).toLowerCase()];
    const feeLine = renderEventFeeLine(feeObj);
    const feePill = !feeObj ? '' : feeObj.paid
      ? `<span class="fee-badge fee-badge-paid head-fee-pill">✓ FEE PAID</span>`
      : `<span class="fee-badge fee-badge-unpaid head-fee-pill">✗ FEE NOT PAID ${escHtml(peso(feeObj.amount))}</span>`;
    const schedule = scheduleByKey[key];
    const rows = buildGridRows(key, schedule, logs, yearLevel, program);
    // Only count IN/OUT slots that are actually required for that session —
    // a "Not required" slot shouldn't drag the fraction down or read as missing.
    const recorded = rows.reduce((n, r) => n + ((r.inRequired !== false && r.inTime) ? 1 : 0) + ((r.outRequired !== false && r.outTime) ? 1 : 0), 0);
    const total = rows.reduce((n, r) => n + (r.inRequired !== false ? 1 : 0) + (r.outRequired !== false ? 1 : 0), 0);
    const isExempt = !!wholeScopeExemption || exemptedEventKeysLower.has(String(key).toLowerCase());
    // Single overall status word for the list row — replaces the progress bar.
    const overallStatus = isExempt ? 'exempt' : total === 0 ? null : recorded === 0 ? 'absent' : recorded < total ? 'partial' : 'complete';
    const overallLabel = overallStatus === 'exempt' ? '● Exempted'
      : overallStatus === 'complete' ? '✓ Complete'
      : overallStatus === 'partial' ? `△ Incomplete (${recorded}/${total})`
      : overallStatus === 'absent' ? '✗ Absent' : '';
    const overallClass = overallStatus === 'exempt' ? 'status-exempt'
      : overallStatus === 'complete' ? 'status-complete'
      : overallStatus === 'partial' ? 'status-partial'
      : overallStatus === 'absent' ? 'status-absent' : '';

    let range = '';
    const rowDates = [...new Set(rows.map(r => r.date).filter(Boolean))].sort();
    if (rowDates.length){
      range = rowDates.length > 1
        ? `(${formatShortDate(rowDates[0])} – ${formatShortDate(rowDates[rowDates.length - 1])})`
        : `(${formatShortDate(rowDates[0])})`;
    }

    const evRemarks = remarks.filter(r => r.event_key === key);
    const simple = isSimpleEvent(key, schedule, logs, events);
    const voted = simple && rows.length > 0;
    const renderRemark = (rm) => rm.author === 'Election Sync'
      ? `<div class="row-remark">${rm.text}</div>`
      : `<div class="row-remark"><b>${rm.author || 'Staff'}</b> (${formatShortDate(rm.updated_at)}): ${rm.text}</div>`;

    const bodyRows = simple ? logs.filter(l => l.event_key === key).map(l => {
      const rowRemarks = evRemarks.filter(rm => rm.date === l.date && rm.session === l.session);
      const remarkHtml = rowRemarks.map(renderRemark).join('');
      return `
        <tr>
          <td><span class="status-badge status-complete">✓ Voted</span></td>
          <td class="mono">${formatTimestampNice(l.time_stamp || l.date)}</td>
          <td>${remarkHtml || '<span class="dash">—</span>'}</td>
        </tr>`;
    }).join('') : (rows.length ? rows.map(r => {
      const rowRemarks = evRemarks.filter(rm => rm.date === r.date && rm.session === r.session);
      const remarkHtml = rowRemarks.map(renderRemark).join('');
      const statusLabel = r.status === 'complete' ? '✓ Complete' : r.status === 'partial' ? '△ Partial' : '✗ Absent';
      const statusClass = r.status === 'complete' ? 'status-complete' : r.status === 'partial' ? 'status-partial' : 'status-absent';
      return `
        <tr>
          <td class="mono">${r.date || '—'}</td>
          <td>${r.session || '—'}</td>
          <td class="mono">${r.inTime ? formatClockTime(r.inTime) : (r.inRequired===false ? '<span class="dash not-required">Not required</span>' : '<span class="dash">—</span>')}</td>
          <td class="mono">${r.outTime ? formatClockTime(r.outTime) : (r.outRequired===false ? '<span class="dash not-required">Not required</span>' : '<span class="dash">—</span>')}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td>${remarkHtml || '<span class="dash">—</span>'}</td>
        </tr>`;
    }).join('') : '');

    // Simple (vote-style) events show every remark inside the single row above —
    // there's no separate "general" remark concept for them, so skip this section
    // entirely to avoid showing the same confirmation code twice.
    const generalRemarks = simple ? '' : evRemarks.filter(rm => !rm.date && !rm.session)
      .map(renderRemark).join('');

    return `
      <div class="event-card">
        <div class="event-head" data-key="${String(key).replace(/"/g, '&quot;')}" onclick="toggleEventCard(this)">
          <div class="ehl">
            <h4>${ev.name || key}</h4>
            <span class="event-range">${range}</span>
          </div>
          <div class="event-progress">
            ${feePill}
            ${isExempt ? `<span class="status-badge ${overallClass}">${overallLabel}</span>` : simple ? `<span class="progress-label">${voted ? 'Voted' : 'Did not vote'}</span>` : (total === 0 && feeLine) ? '' : `<span class="status-badge ${overallClass}">${overallLabel}</span>`}
          </div>
        </div>
        <div class="event-body${collapsedEventKeys.has(key) ? ' collapsed' : ''}">
          ${feeLine}
          ${bodyRows ? `<div class="table-scroll"><table>
            <thead><tr>${simple ? '<th>Status</th><th>Date &amp; Time</th><th>Remarks</th>' : '<th>Date</th><th>Session</th><th>In</th><th>Out</th><th>Status</th><th>Remarks</th>'}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table></div>` : (simple ? '<div class="empty" style="color:#c0392b;">Did not vote in this election.</div>' : (feeLine ? '' : '<div class="empty">No attendance logged yet.</div>'))}
          ${generalRemarks}
        </div>
      </div>`;
  }).join('');

  eventsWrap.innerHTML = cards;
}

function formatDate(iso){
  if (!iso) return '';
  try{
    return new Date(iso).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' });
  }catch{ return iso; }
}

function formatShortDate(dateStr){
  if (!dateStr) return '';
  try{
    return new Date(dateStr).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
  }catch{ return dateStr; }
}

/* ---------- Entrance fee ---------- */
function peso(n){
  const v = Number(n) || 0;
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: (v % 1) ? 2 : 0, maximumFractionDigits: 2 });
}
function escHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Shows for each event that charges an entrance fee: PAID (with when) or NOT PAID (with where to pay).
function renderFees(fees){
  const el = document.getElementById('feeSection');
  if(!el) return;
  if(!Array.isArray(fees) || fees.length === 0){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = '<div class="section-title">Entrance Fee</div>' + fees.map(f => {
    if(f.paid){
      const when = formatTimestampNice(f.paidAt);
      return `<div class="fee-card fee-paid">
        <div class="fee-main"><div class="fee-event">${escHtml(f.eventName)}</div><div class="fee-sub">Entrance fee ${escHtml(peso(f.paidAmount != null ? f.paidAmount : f.amount))}</div></div>
        <div class="fee-side"><span class="fee-badge fee-badge-paid">✓ PAID</span><div class="fee-when">${escHtml(when)}${f.receiptNo ? ' · OR ' + escHtml(f.receiptNo) : ''}</div></div>
      </div>`;
    }
    return `<div class="fee-card fee-unpaid">
      <div class="fee-main"><div class="fee-event">${escHtml(f.eventName)}</div><div class="fee-sub">Entrance fee ${escHtml(peso(f.amount))}</div></div>
      <div class="fee-side"><span class="fee-badge fee-badge-unpaid">✗ NOT PAID</span><div class="fee-when">Please pay at the SSO. Your record updates here right away.</div></div>
    </div>`;
  }).join('');
}

// Attendance times are stored as UTC timestamps — show them as a normal clock time in Manila.
function formatClockTime(ts){
  if(!ts) return '—';
  const s = String(ts);
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)){
    const d = new Date(s);
    if(!isNaN(d.getTime())) return d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return s; // older uploads already hold a readable time
}

const collapsedEventKeys = new Set();
function toggleEventCard(head){
  const body = head.nextElementSibling;
  const nowCollapsed = body.classList.toggle('collapsed');
  const key = head.getAttribute('data-key');
  if(nowCollapsed) collapsedEventKeys.add(key); else collapsedEventKeys.delete(key);
}

/* ---------- Live updates ---------- */
// Every few seconds the page asks the server one tiny question — "has anything changed for me?" — and only
// reloads the record when the answer is yes (or every couple of minutes as a safety net). It pauses while the
// browser tab is hidden and catches up the moment the student comes back.
const LIVE_PULSE_MS = 8000;                  // how often the page wakes up to decide whether to check
const LIVE_FULL_REFRESH_MS = 120000;
// So thousands of students can keep the page open without overloading the server: checks every 8 seconds while the
// student is actively looking (and for 3 minutes after), then every 30 seconds, and none at all after 20 idle minutes.
const LIVE_FAST_WINDOW_MS = 3 * 60 * 1000;
const LIVE_SLOW_EVERY_MS = 30000;
const LIVE_IDLE_STOP_MS = 20 * 60 * 1000;
let livePulseTimer = null, lastPulse = null, lastFullAt = 0, liveBusy = false, lastInteraction = Date.now(), lastPollAt = 0;

function pulsePath(){
  return `/student-portal/${encodeURIComponent(student.studentNo)}/pulse?academicYear=${encodeURIComponent(currentYear)}&semester=${encodeURIComponent(currentSemester)}`;
}
function setLiveStatus(text, cls){
  const el = document.getElementById('liveStatus');
  if(!el) return;
  el.className = 'live-status' + (cls ? ' ' + cls : '');
  el.textContent = text;
}
function markUpdated(){
  setLiveStatus('Live · updated ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
}
function sessionExpired(){
  doLogout();
  showError('Your session ended. Please sign in again to see your latest record.');
}
async function livePoll(){
  if(liveBusy || !token || !student || !currentYear) return;
  if(document.visibilityState !== 'visible') return;
  const idleFor = Date.now() - lastInteraction;
  if(idleFor > LIVE_IDLE_STOP_MS){ setLiveStatus('Paused — tap anywhere to refresh', 'warn'); return; }
  if(idleFor > LIVE_FAST_WINDOW_MS && Date.now() - lastPollAt < LIVE_SLOW_EVERY_MS) return;
  lastPollAt = Date.now();
  liveBusy = true;
  try{
    const p = await api(pulsePath());
    if(p.pulse !== lastPulse || Date.now() - lastFullAt > LIVE_FULL_REFRESH_MS) await loadRecords(true);
    else markUpdated();
  }catch(e){
    if(e.status === 401) sessionExpired();
    else if(e.status === 404 && Date.now() - lastFullAt > 20000){
      // The server hasn't been updated with the change-check yet — fall back to reloading every 20 seconds.
      await loadRecords(true);
    }
    else if(e.status !== 404) setLiveStatus('Reconnecting…', 'warn');
  }finally{
    liveBusy = false;
  }
}
function startLive(){
  stopLive();
  livePulseTimer = setInterval(livePoll, LIVE_PULSE_MS);
}
function stopLive(){
  if(livePulseTimer){ clearInterval(livePulseTimer); livePulseTimer = null; }
}
function noteInteraction(){
  const wasPaused = Date.now() - lastInteraction > LIVE_IDLE_STOP_MS;
  lastInteraction = Date.now();
  if(wasPaused) livePoll();
}
['click', 'touchstart', 'keydown', 'scroll', 'mousemove'].forEach(ev => document.addEventListener(ev, noteInteraction, { passive: true }));
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible'){ lastInteraction = Date.now(); livePoll(); } });
window.addEventListener('focus', () => { lastInteraction = Date.now(); livePoll(); });
window.addEventListener('online', livePoll);

/* ---------- Public document verification (what a PDF's QR code links to — no login) ---------- */
function statusLabelFor(s){
  return s === 'cleared' ? 'CLEARED' : s === 'exempted' ? 'EXEMPTED' : s === 'not_cleared' ? 'NOT CLEARED' : 'PENDING REVIEW';
}
function statusClassFor(s){
  return s === 'cleared' ? 'status-cleared' : s === 'exempted' ? 'status-exempt' : s === 'not_cleared' ? 'status-not' : 'status-pending';
}
// Shows just enough of the ID to confirm a match against the document in hand,
// without putting the full student number in the open on a page anyone with
// the link (not just the student) could load.
function maskStudentNo(id){
  const s = String(id || '');
  if(s.length <= 4) return s;
  return s.slice(0, 2) + '\u2022'.repeat(s.length - 4) + s.slice(-2);
}
function renderVerifyEventTable(logs, scope){
  const scoped = logs.filter(l => (l.scope || 'institutional') === scope);
  if(scoped.length === 0) return `<div class="empty" style="padding:14px 0;">No ${scope === 'college' ? 'College/Departmental' : 'Institutional'} attendance on file.</div>`;
  const byEvent = {};
  scoped.forEach(l => { (byEvent[l.eventName] = byEvent[l.eventName] || []).push(l); });
  return Object.entries(byEvent).map(([name, rows]) => `
    <div style="margin-top:14px;">
      <div style="font-weight:800; font-size:12.5px; color:var(--navy); text-transform:uppercase; letter-spacing:.02em; margin-bottom:6px;">${escHtml(name)}</div>
      <div class="table-scroll"><table>
        <thead><tr><th>Date</th><th>Session</th><th>Mode</th><th>Time</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${escHtml(formatShortDate(r.date) || r.date || '\u2014')}</td>
          <td>${r.session === 'PM' ? 'Afternoon' : 'Morning'}</td>
          <td>${r.mode === 'OUT' ? 'Time Out' : 'Time In'}</td>
          <td class="mono">${escHtml(formatTimestampNice(r.timeStamp) || '\u2014')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('');
}
async function showVerifyView(studentNo, academicYear, semester){
  document.getElementById('loginView').style.display = 'none';
  const view = document.getElementById('verifyView');
  const body = document.getElementById('verifyBody');
  view.style.display = 'block';
  try{
    const qs = new URLSearchParams({ studentNo, academicYear, semester: semester || '1st Sem' });
    const res = await fetch(API_BASE + '/verify?' + qs.toString());
    const data = await res.json().catch(() => ({}));
    if(!res.ok || !data.ok){
      body.innerHTML = `<div class="empty">${data.error || 'Record not found — this link may be out of date.'}</div>`;
      return;
    }
    const s = data.student;
    const logs = data.logs || [];
    body.innerHTML = `
      <div style="text-align:left;">
        <div style="font-weight:800; font-size:18px; color:var(--navy);">${escHtml(s.name || s.studentNo)}</div>
        <div class="id-meta" style="margin:2px 0 14px;"><span class="sno">${escHtml(maskStudentNo(s.studentNo))}</span> · ${escHtml([s.program, s.yearLevel].filter(Boolean).join(' · '))}</div>
        <div style="font-size:12.5px; color:var(--text-dim); font-weight:600; margin-bottom:10px;">${escHtml(data.academicYear)} · ${escHtml(data.semester)}</div>
        <div class="chips" style="margin-bottom:0;">
          <span class="status-pill ${statusClassFor(data.status.institutional)}" style="display:inline-flex;">Institutional: ${statusLabelFor(data.status.institutional)}</span>
          <span class="status-pill ${statusClassFor(data.status.college)}" style="display:inline-flex;">College/Departmental: ${statusLabelFor(data.status.college)}</span>
        </div>
        <div class="section-title" style="margin-top:22px;">Institutional Attendance</div>
        ${renderVerifyEventTable(logs, 'institutional')}
        <div class="section-title" style="margin-top:22px;">College/Departmental Attendance</div>
        ${renderVerifyEventTable(logs, 'college')}
      </div>`;
  }catch(e){
    body.innerHTML = '<div class="empty">Could not reach the server — check your internet connection.</div>';
  }
}

// Resume session if still valid
(function init(){
  const params = new URLSearchParams(location.search);
  const verifyStudentNo = params.get('verify');
  if(verifyStudentNo){
    showVerifyView(verifyStudentNo, params.get('ay') || '', params.get('sem') || '');
    return; // public verify view — never touch login/session state
  }
  const t = sessionStorage.getItem('sp_token');
  const s = sessionStorage.getItem('sp_student');
  if (t && s){
    token = t; student = JSON.parse(s);
    if (student.mustChangePassword){
      loginView.style.display = 'none';
      openPwModal(true);   // temp password isn't kept, so the Current Password field shows
      return;
    }
    enterDashboard().catch(() => {
      sessionStorage.removeItem('sp_token'); sessionStorage.removeItem('sp_student');
    });
  }
})();
