import { listen } from '@tauri-apps/api/event';
import { api, esc, icon, refreshIcons, toast, errText } from '../util.js';
import { t } from '../i18n.js';

/*
 * The launcher's main flow (Longshot's shape): a home screen with one action, and a three-step build -
 * 1 Game files (the dump and what this PC has), 2 Options (NVN-HLE's picture settings, Streamline), 3 Build (the setup
 * engine's steps, live). Everything else lives behind the gear (the full Settings, Mods and About pages).
 */

const STEPS = [
  ['files', 'wiz.step.files'],
  ['options', 'wiz.step.options'],
  ['build', 'wiz.step.build'],
];

let wizStep = null;        // null: home; else 'files' | 'options' | 'build'
let logLines = [];
let showLog = false;

function stepsPill(active) {
  const i = STEPS.findIndex(([id]) => id === active);
  return `<div class="steps-pill">${STEPS.map(([id, key], k) =>
    `<div class="step ${k === i ? 'active' : k < i ? 'done' : ''}"><span class="num">${k < i ? '&#10003;' : k + 1}</span>${esc(t(key))}</div>`).join('')}</div>`;
}

function hero(title, text, actions, sub = '') {
  return `<div class="hero">
    <div class="hero-art"><img src="/icon.png" alt=""></div>
    <h1>${esc(title)}</h1>
    <p>${esc(text)}</p>
    ${actions}
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
  </div>`;
}

export function start(step = 'files') { wizStep = step; }

export async function render(el, ctx) {
  const center = document.getElementById('tb-center');
  const [cfg, ov] = await Promise.all([api('get_config'), api('get_overview')]);
  let status = ov.repo_ok ? await api('setup_status').catch(() => null) : null;
  const built = Boolean(status?.complete && ov.exe_exists);
  if (!wizStep && status?.progress?.state === 'running') wizStep = 'build';
  center.innerHTML = wizStep ? stepsPill(wizStep) : '';

  if (!ov.repo_ok) {
    el.innerHTML = hero(t('home.noRepo.title'), t('home.noRepo.text'), `<button class="btn big" id="open-settings">${icon('settings')}${esc(t('home.openSettings'))}</button>`);
    el.querySelector('#open-settings').addEventListener('click', () => ctx.go('settings'));
    return;
  }
  if (!wizStep) return built ? renderReady(el, ctx) : renderBuildHome(el, ctx);
  if (wizStep === 'files') return renderFiles(el, ctx, cfg, status);
  if (wizStep === 'options') return renderOptions(el, ctx, cfg);
  return renderBuild(el, ctx, status);
}

// ---- home ----------------------------------------------------------------------------------------------------------
function renderBuildHome(el, ctx) {
  el.innerHTML = hero(t('home.build.title'), t('home.build.text'),
    `<button class="btn primary big" id="go-build">${icon('hammer')}${esc(t('home.build.button'))}</button>`,
    t('home.build.sub'));
  el.querySelector('#go-build').addEventListener('click', () => { wizStep = 'files'; ctx.go('home'); });
  refreshIcons();
}

async function renderReady(el, ctx) {
  let status = await api('game_status').catch(() => ({ state: 'idle' }));
  const draw = () => {
    const running = status.state === 'running';
    const note = status.state === 'exited' && status.crashed ? status.message : '';
    el.innerHTML = hero(t('home.ready.title'), note || t('home.ready.text'),
      `<button class="btn primary big" id="play" ${running ? 'disabled' : ''}>${icon(running ? 'loader-circle' : 'play', running ? 'spin' : '')}${esc(running ? t('home.ready.running') : t('home.ready.play'))}</button>
       <div class="links">
         <button class="btn quiet" id="rebuild">${icon('refresh-cw')}${esc(t('home.ready.rebuild'))}</button>
         <button class="btn quiet" id="folder">${icon('folder-open')}${esc(t('home.ready.folder'))}</button>
       </div>`);
    el.querySelector('#play').addEventListener('click', () => api('play').catch((e) => toast(errText(e), 'error')));
    el.querySelector('#rebuild').addEventListener('click', () => { wizStep = 'files'; ctx.go('home'); });
    el.querySelector('#folder').addEventListener('click', () => api('open_game_dir').catch((e) => toast(errText(e), 'error')));
    refreshIcons();
  };
  draw();
  ctx.onStatus((s) => { status = s; draw(); });
}

// ---- 1. game files -----------------------------------------------------------------------------------------------------
async function renderFiles(el, ctx, cfg, status) {
  let path = cfg.dump_dir || '';
  let report = path ? await api('validate_dump', { path }).catch(() => null) : null;
  let busy = '';
  let folders = await api('get_folders').catch(() => null);
  const tools = status?.tools || [];
  const missing = tools.filter((x) => !x.ok);

  const draw = () => {
    const chosen = report?.chosen;
    const req = tools.length === 0
      ? `<div class="tile compact"><span class="dot"></span><span class="title">${esc(t('wiz.files.pkgTitle'))}</span><span class="faint grow">${esc(t('wiz.files.pkgText'))}</span></div>`
      : missing.length === 0
        ? `<div class="tile"><span class="dot"></span><div class="grow"><div class="title">${esc(t('wiz.files.toolsOk'))}</div><div class="detail">${esc(tools.map((x) => x.name).join(' · '))}</div></div></div>`
        : `<div class="tile"><span class="badge bad">${icon('triangle-alert')}</span><div class="grow"><div class="title">${esc(t('wiz.files.toolsMissing'))}</div>${missing.map((x) => `<div class="detail"><b>${esc(x.name)}</b>: ${esc(x.hint)}</div>`).join('')}</div></div>`;
    const sel = busy
      ? `<div class="tile"><span class="badge run">${icon('loader-circle', 'spin')}</span><div class="grow"><div class="title">${esc(t('wiz.files.unpacking'))}</div><div class="detail">${esc(busy)}</div></div></div>`
      : chosen
        ? `<div class="tile"><span class="badge ok">${icon('check')}</span><div class="grow"><div class="title">${esc(t('wiz.files.ready'))}</div><div class="detail">${esc(report.path)}</div>
             <div class="checks">${chosen.checks.map((c) => `<span class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '&#10003;' : '&#10007;'} ${esc(c.label)}</span>`).join('')}
             ${report.dlc?.length ? `<span class="ok">&#10003; ${esc(t('wiz.files.addon'))} ${esc(report.dlc.join(', '))}</span>` : `<span class="bad">&#10007; ${esc(t('wiz.files.noAddon'))}</span>`}</div></div></div>`
        : report
          ? `<div class="tile"><span class="badge bad">${icon('x')}</span><div class="grow"><div class="title">${esc(t('wiz.files.notUsable'))}</div><div class="detail">${esc(report.path)}</div>${(report.errors || []).map((e) => `<div class="detail">${esc(e)}</div>`).join('')}</div></div>`
          : `<div class="tile compact"><span class="faint">${esc(t('wiz.files.none'))}</span></div>`;
    const gb = (n) => (n == null ? '' : t('wiz.folders.free', { size: (n / (1 << 30)).toFixed(0) }));
    // One compact line per folder: name, path, free space, Change (the hint is the row's tooltip)
    const folderRow = (which, f, title, hint) => `<div class="tile compact folder-row" title="${esc(hint)}">${icon(which === 'game' ? 'hard-drive' : 'file-archive')}
        <span class="title">${esc(title)}</span><code class="grow path">${esc(f.path)}</code>
        <span class="${f.need && f.free != null && f.free < f.need ? 'bad-text' : 'faint'}">${f.need ? `${esc(t('wiz.folders.needs', { size: (f.need / (1 << 30)).toFixed(0) }))} · ` : ''}${f.free != null ? esc(gb(f.free)) : ''}</span>
        <button class="btn sm" data-folder="${which}" ${busy ? 'disabled' : ''}>${esc(t('wiz.folders.change'))}</button>
        ${f.is_default ? '' : `<button class="btn quiet sm" data-folder-reset="${which}" ${busy ? 'disabled' : ''}>${esc(t('wiz.folders.reset'))}</button>`}</div>`;
    const foldersHtml = folders
      ? `<div class="section-label">${esc(t('wiz.folders.title'))}</div>
         ${folderRow('game', folders.game, t('wiz.folders.game'), t('wiz.folders.gameHint'))}
         ${folderRow('unpack', folders.unpack, t('wiz.folders.unpack'), t('wiz.folders.unpackHint'))}`
      : '';
    const ok = Boolean(chosen && report.dlc?.length) && missing.length === 0 && !busy;   // XC:DE needs its add-on
    el.innerHTML = `<div class="wiz">
      <h1>${esc(t('wiz.files.title'))}</h1>
      <p class="lead">${esc(t('wiz.files.lead'))}</p>
      ${req}
      ${foldersHtml}
      <div class="section-label">${esc(t('wiz.files.dump'))}</div>
      ${sel}
      <div class="row">
        <button class="btn" id="pick-nup" ${busy ? 'disabled' : ''}>${icon('file-archive')}${esc(t('wiz.files.pickNup'))}</button>
        <button class="btn" id="pick-folder" ${busy ? 'disabled' : ''}>${icon('folder')}${esc(t('wiz.files.pickFolder'))}</button>
      </div>
      <div class="grow"></div>
      <div class="wiz-foot"><span>${esc(ok ? '' : t('wiz.files.hint'))}</span><span class="spacer"></span>
        <button class="btn" id="back">${esc(t('wiz.back'))}</button>
        <button class="btn primary" id="next" ${ok ? '' : 'disabled'}>${esc(t('wiz.next'))}</button></div>
    </div>`;
    el.querySelector('#back').addEventListener('click', () => { wizStep = null; ctx.go('home'); });
    el.querySelector('#next').addEventListener('click', async () => {
      try { await api('save_dump', { path }); wizStep = 'options'; ctx.go('home'); } catch (e) { toast(errText(e), 'error'); }
    });
    el.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', async () => {
      const which = b.dataset.folder;
      const picked = await api('pick_folder', { title: t(which === 'game' ? 'wiz.folders.game' : 'wiz.folders.unpack'), start: null });
      if (!picked) return;
      try {
        if (which === 'game' && folders?.built && !(await window.confirm(t('wiz.folders.moveWarn')))) return;
        folders = await api('set_folder', { which, path: picked });
      } catch (e) { toast(errText(e), 'error'); }
      draw();
    }));
    el.querySelectorAll('[data-folder-reset]').forEach((b) => b.addEventListener('click', async () => {
      try { folders = await api('set_folder', { which: b.dataset.folderReset, path: '' }); } catch (e) { toast(errText(e), 'error'); }
      draw();
    }));
    el.querySelector('#pick-folder').addEventListener('click', async () => {
      const picked = await api('pick_folder', { title: t('wiz.files.pickFolder'), start: path || null });
      if (!picked) return;
      path = picked;
      report = await api('validate_dump', { path }).catch((e) => ({ path, errors: [errText(e)], candidates: [], chosen: null }));
      draw();
    });
    el.querySelector('#pick-nup').addEventListener('click', async () => {
      const picked = await api('pick_nup', { start: null });
      if (!picked) return;
      busy = picked;
      draw();
      const off = await listen('nup-progress', (ev) => {
        const p = ev.payload;
        busy = `${Math.floor((100 * p.done) / Math.max(1, p.total))}%  ${p.file || ''}`;
        const d = el.querySelector('.tile .detail');
        if (d) d.textContent = busy;
      });
      try {
        path = await api('import_nup', { path: picked });
        report = await api('validate_dump', { path });
      } catch (e) {
        toast(errText(e), 'error');
      } finally {
        off();
        busy = '';
        draw();
      }
    });
    refreshIcons();
  };
  draw();
}

// ---- 2. options ---------------------------------------------------------------------------------------------------------
const NH = {
  upscaler: { key: 'upscaler', def: 'console', opts: [['console', 'wiz.opt.up.console'], ['dlss', 'wiz.opt.up.dlss'], ['fsr1', 'wiz.opt.up.fsr1'], ['off', 'wiz.opt.up.off']] },
  dlss_model: { key: 'dlss_model', def: 'K', opts: [['K', 'wiz.opt.model.k'], ['J', 'J'], ['L', 'L'], ['M', 'M'], ['default', 'wiz.opt.model.default']] },
  vsync: { key: 'vsync', def: 'mailbox', opts: [['mailbox', 'wiz.opt.vsync.mailbox'], ['fifo', 'wiz.opt.vsync.fifo'], ['immediate', 'wiz.opt.vsync.immediate']] },
};

async function renderOptions(el, ctx, cfg) {
  const data = await api('read_settings').catch(() => ({ game: {} }));
  const val = (k) => (data.game || {})[`nvnhle.${NH[k].key}`] || NH[k].def;
  const label = (s) => (s.includes('.') ? t(s) : s);
  const select = (k) => `<select id="opt-${k}">${NH[k].opts.map(([v, l]) => `<option value="${v}" ${v === val(k) ? 'selected' : ''}>${esc(label(l))}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="wiz">
    <h1>${esc(t('wiz.opt.title'))}</h1>
    <p class="lead">${esc(t('wiz.opt.lead'))}</p>
    <label class="tile choice"><input type="checkbox" id="opt-sl" ${cfg.no_streamline ? '' : 'checked'}>
      <div class="grow"><div class="title">${esc(t('wiz.opt.sl.title'))}</div><div class="detail">${esc(t('wiz.opt.sl.text'))}</div></div></label>
    <div class="tile"><div class="grow"><div class="title">${esc(t('wiz.opt.up.title'))}</div><div class="detail">${esc(t('wiz.opt.up.text'))}</div></div>${select('upscaler')}</div>
    <div class="tile"><div class="grow"><div class="title">${esc(t('wiz.opt.model.title'))}</div><div class="detail">${esc(t('wiz.opt.model.text'))}</div></div>${select('dlss_model')}</div>
    <div class="tile"><div class="grow"><div class="title">${esc(t('wiz.opt.vsync.title'))}</div><div class="detail">${esc(t('wiz.opt.vsync.text'))}</div></div>${select('vsync')}</div>
    <div class="grow"></div>
    <div class="wiz-foot"><span>${esc(t('wiz.opt.later'))}</span><span class="spacer"></span>
      <button class="btn" id="back">${esc(t('wiz.back'))}</button>
      <button class="btn primary" id="next">${icon('hammer')}${esc(t('wiz.opt.build'))}</button></div>
  </div>`;
  el.querySelector('#back').addEventListener('click', () => { wizStep = 'files'; ctx.go('home'); });
  el.querySelector('#next').addEventListener('click', async () => {
    try {
      const fresh = await api('get_config');
      await api('save_config', { config: { ...fresh, no_streamline: !el.querySelector('#opt-sl').checked } });
      const edits = Object.keys(NH).map((k) => ({ file: 'game', section: 'nvnhle', key: NH[k].key, value: el.querySelector(`#opt-${k}`).value }));
      await api('write_settings', { edits }).catch(() => {});   // nxrt.ini is created by setup; the defaults apply then
      logLines = [];
      await api('start_setup');
      wizStep = 'build';
      ctx.go('home');
    } catch (e) {
      toast(errText(e), 'error');
    }
  });
  refreshIcons();
}

// ---- 3. build -----------------------------------------------------------------------------------------------------------
function renderBuild(el, ctx, status) {
  let st = status;
  const draw = () => {
    const pr = st?.progress || {};
    const steps = st?.steps || [];
    const done = steps.filter((s) => s.state === 'done').length;
    const pct = pr.total ? Math.min(100, (100 * pr.done) / pr.total) : steps.length ? (100 * done) / steps.length : 0;
    const running = pr.state === 'running';
    const finished = st?.complete && !running;
    const failed = pr.state === 'error';
    const badge = (s) => s.state === 'done' ? `<span class="badge ok">${icon('check')}</span>`
      : s.state === 'running' ? `<span class="badge run">${icon('loader-circle', 'spin')}</span>`
      : s.state === 'error' ? `<span class="badge bad">${icon('x')}</span>` : `<span class="badge">${icon('circle')}</span>`;
    el.innerHTML = `<div class="wiz">
      <h1>${esc(finished ? t('wiz.build.done') : failed ? t('wiz.build.failed') : t('wiz.build.title'))}</h1>
      <p class="lead">${esc(failed ? (pr.message || '') : finished ? t('wiz.build.doneText') : (pr.message || t('wiz.build.lead')))}</p>
      <div class="bar"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="step-list">${steps.map((s) => `<div class="tile ${s.state === 'todo' ? 'todo' : ''}">${badge(s)}<div class="grow"><div class="title">${esc(s.title)}</div>${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}</div></div>`).join('')}</div>
      ${showLog ? `<div class="log" id="log">${esc(logLines.slice(-300).join('\n'))}</div>` : ''}
      <div class="grow"></div>
      <div class="wiz-foot">
        <button class="btn quiet" id="toggle-log">${icon('scroll-text')}${esc(showLog ? t('wiz.build.hideLog') : t('wiz.build.showLog'))}</button>
        <button class="btn quiet" id="open-log">${icon('file-text')}${esc(t('wiz.build.openLog'))}</button>
        <span class="spacer"></span>
        ${running ? `<button class="btn" id="cancel">${esc(t('wiz.build.cancel'))}</button>` : ''}
        ${!running && !finished ? `<button class="btn" id="back">${esc(t('wiz.back'))}</button><button class="btn primary" id="retry">${esc(t('wiz.build.retry'))}</button>` : ''}
        ${finished ? `<button class="btn primary" id="to-play">${icon('play')}${esc(t('wiz.build.play'))}</button>` : ''}
      </div>
    </div>`;
    const log = el.querySelector('#log');
    if (log) log.scrollTop = log.scrollHeight;
    el.querySelector('#toggle-log').addEventListener('click', () => { showLog = !showLog; draw(); });
    el.querySelector('#open-log').addEventListener('click', () => api('open_setup_log').catch((e) => toast(errText(e), 'error')));
    el.querySelector('#cancel')?.addEventListener('click', () => api('cancel_setup'));
    el.querySelector('#back')?.addEventListener('click', () => { wizStep = 'options'; ctx.go('home'); });
    el.querySelector('#retry')?.addEventListener('click', async () => {
      try { await api('start_setup'); st = await api('setup_status'); draw(); } catch (e) { toast(errText(e), 'error'); }
    });
    el.querySelector('#to-play')?.addEventListener('click', () => { wizStep = null; ctx.go('home'); });
    refreshIcons();
  };
  draw();
  ctx.onLog((lines) => {
    logLines.push(...lines);
    if (logLines.length > 2000) logLines = logLines.slice(-1000);
    const log = el.querySelector('#log');
    if (log) { log.textContent = logLines.slice(-300).join('\n'); log.scrollTop = log.scrollHeight; }
  });
  ctx.onSetup(async () => { st = await api('setup_status').catch(() => st); draw(); });
}
