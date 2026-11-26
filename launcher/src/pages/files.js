import { api, esc, icon, refreshIcons, toast, errText } from '../util.js';
import { t } from '../i18n.js';

/*
 * Saves and clean-up (files.rs): the game's save files with backups, and the files an install collects that the game
 * does not need to start. Every change asks first and is refused by the launcher while the game or a build runs.
 */

const fmtBytes = (n) =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${n ? Math.max(1, Math.round(n / 1024)) : 0} KB`;
const fmtTime = (secs) => (secs ? new Date(secs * 1000).toLocaleString() : '');

/** The game's own file names, said in words; anything else shows its name. */
function saveLabel(name) {
  const n = name.toLowerCase();
  if (n.startsWith('bfsgame')) return t(n.replace('.sav', '').endsWith('a') ? 'files.save.auto' : 'files.save.main', { name });
  if (n.startsWith('bfssystem')) return t('files.save.options', { name });
  return name;
}

const CLEAN = ['build', 'nup', 'logs', 'downloads', 'leftovers', 'shaders'];

let modalOpen = false;
function confirmModal(title, text, okLabel, danger) {
  if (modalOpen) return Promise.resolve(false);
  modalOpen = true;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">${icon(danger ? 'triangle-alert' : 'circle-question-mark')}<h2>${esc(title)}</h2></div>
        <div class="modal-body"><p class="modal-note">${esc(text)}</p></div>
        <div class="modal-foot">
          <button type="button" class="btn quiet" data-cancel>${esc(t('common.cancel'))}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>
        </div>
      </div>`;
    const close = (ok) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      modalOpen = false;
      resolve(ok);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(false); };
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(false); });
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    backdrop.querySelector('[data-ok]').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    refreshIcons();
    backdrop.querySelector('[data-cancel]').focus();
  });
}

/** mode 'saves': the title-bar Saves page; 'clean': the gear's Clean up tab. */
async function render(el, mode) {
  let saves = null;
  let items = null;
  let picked = new Set();
  let busy = false;

  async function load() {
    try {
      if (mode === 'saves') saves = await api('saves_overview');
      else items = await api('clean_scan');
      if (items) picked = new Set([...picked].filter((id) => items.some((i) => i.id === id && !i.blocked)));
    } catch (e) {
      toast(errText(e), 'error');
    }
    draw();
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    draw();
    try {
      await fn();
    } catch (e) {
      toast(errText(e), 'error');
    }
    busy = false;
    await load();
  }

  const sm = (cls, attrs, ic, label) => `<button class="btn sm ${cls}" ${attrs}>${icon(ic)}${esc(label)}</button>`;

  function savesCard() {
    if (!saves) return `<div class="card files-card"><p class="dim">${icon('loader-circle', 'spin')} ${esc(t('files.loading'))}</p></div>`;
    const files = saves.files.length
      ? saves.files
          .map((f) => `<div class="tile compact"><span class="dot"></span><span class="title">${esc(saveLabel(f.name))}</span>
              <span class="faint grow">${esc(fmtBytes(f.size))} · ${esc(t('files.changed', { time: fmtTime(f.modified) }))}</span></div>`)
          .join('')
      : `<div class="tile compact"><span class="faint">${esc(t('files.noSaves'))}</span></div>`;
    const backups = saves.backups.length
      ? saves.backups
          .map((b) => `<div class="tile compact">${icon('archive')}
              <span class="title">${esc(fmtTime(b.created))}</span>
              <span class="faint grow">${esc(t('files.backupMeta', { count: b.files, size: fmtBytes(b.size) }))}${b.id.includes('before-restore') ? ` ${esc(t('files.beforeRestore'))}` : ''}</span>
              ${sm('', `data-restore="${esc(b.id)}" ${busy ? 'disabled' : ''}`, 'rotate-ccw', t('files.restore'))}
              ${sm('quiet', `data-delete="${esc(b.id)}" ${busy ? 'disabled' : ''}`, 'trash', t('files.delete'))}</div>`)
          .join('')
      : `<div class="tile compact"><span class="faint">${esc(t('files.noBackups'))}</span></div>`;
    return `
      <div class="card files-card">
        <div class="files-title"><h2>${icon('save')}${esc(t('files.yourSaves'))}</h2><code class="faint path" title="${esc(saves.save_dir)}">${esc(saves.save_dir)}</code></div>
        ${files}
        <div class="row wrap">
          ${sm('primary', `id="backup" ${busy || !saves.files.length ? 'disabled' : ''}`, 'archive', t('files.backupNow'))}
          ${sm('', 'id="open-saves"', 'folder-open', t('files.openSaves'))}
          ${sm('quiet', `id="import" ${busy ? 'disabled' : ''}`, 'folder-input', t('files.import'))}
        </div>
      </div>
      <div class="card files-card">
        <div class="files-title"><h2>${icon('archive')}${esc(t('files.backupsTitle'))}</h2>
          ${sm('quiet', 'id="open-backups"', 'folder-open', t('files.openBackups'))}</div>
        ${backups}
      </div>`;
  }

  function cleanCard() {
    if (!items) return `<div class="card files-card"><p class="dim">${icon('loader-circle', 'spin')} ${esc(t('files.loading'))}</p></div>`;
    const shown = CLEAN.map((id) => items.find((i) => i.id === id)).filter(Boolean);
    const total = shown.filter((i) => picked.has(i.id)).reduce((a, i) => a + i.bytes, 0);
    const rows = shown.length
      ? shown
          .map((i) => `<label class="tile compact" title="${esc(i.blocked ? t(`files.cleanBlocked.${i.id}`) : t(`files.cleanHint.${i.id}`))}">
              <input type="checkbox" data-pick="${esc(i.id)}" ${picked.has(i.id) ? 'checked' : ''} ${i.blocked || busy ? 'disabled' : ''}>
              <span class="title">${esc(t(`files.clean.${i.id}`))}</span>
              <span class="faint grow clip">${esc(i.blocked ? t(`files.cleanBlocked.${i.id}`) : t(`files.cleanHint.${i.id}`))}</span>
              <span class="faint">${esc(fmtBytes(i.bytes))}</span></label>`)
          .join('')
      : `<div class="tile compact"><span class="faint">${esc(t('files.cleanNothing'))}</span></div>`;
    return `
      <div class="card files-card">
        ${rows}
        <div class="row wrap">
          ${sm('primary', `id="clean" ${busy || !picked.size ? 'disabled' : ''}`, 'trash', t('files.cleanRun', { size: fmtBytes(total) }))}
          ${sm('quiet', `id="rescan" ${busy ? 'disabled' : ''}`, 'refresh-cw', t('files.rescan'))}
        </div>
      </div>`;
  }

  function draw() {
    el.innerHTML = `<div class="page files-page">
      <div class="files-head"><h1>${esc(t(mode === 'saves' ? 'files.savesTitle' : 'files.cleanTitle'))}</h1>
        <p class="dim">${esc(t(mode === 'saves' ? 'files.savesHint' : 'files.cleanHint'))}</p></div>
      ${mode === 'saves' ? savesCard() : cleanCard()}
    </div>`;
    refreshIcons();
    const on = (sel, fn) => el.querySelector(sel)?.addEventListener('click', fn);
    on('#open-saves', () => api('open_saves_dir').catch((e) => toast(errText(e), 'error')));
    on('#open-backups', () => api('open_backups_dir').catch((e) => toast(errText(e), 'error')));
    on('#backup', () => act(async () => { await api('backup_saves'); toast(t('files.backedUp')); }));
    on('#import', async () => {
      const dir = await api('pick_folder', { title: t('files.import'), start: null }).catch(() => null);
      if (dir) act(async () => toast(await api('import_saves', { path: dir })));
    });
    el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.restore;
      const when = fmtTime(saves.backups.find((x) => x.id === id)?.created);
      if (!(await confirmModal(t('files.restoreTitle'), t('files.restoreText', { time: when }), t('files.restore'), false))) return;
      act(async () => { await api('restore_saves', { id }); toast(t('files.restored')); });
    }));
    el.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.delete;
      const when = fmtTime(saves.backups.find((x) => x.id === id)?.created);
      if (!(await confirmModal(t('files.deleteTitle'), t('files.deleteText', { time: when }), t('files.delete'), true))) return;
      act(() => api('delete_save_backup', { id }));
    }));
    el.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
      draw();
    }));
    on('#rescan', () => act(async () => {}));
    on('#clean', async () => {
      const names = [...picked].map((id) => t(`files.clean.${id}`)).join(', ');
      if (!(await confirmModal(t('files.cleanTitle'), t('files.cleanConfirm', { names }), t('files.cleanGo'), true))) return;
      act(async () => {
        const freed = await api('clean_run', { ids: [...picked] });
        picked.clear();
        toast(t('files.cleaned', { size: fmtBytes(freed) }));
      });
    });
  }

  draw();
  await load();
}

export const renderSaves = (el) => render(el, 'saves');
export const renderClean = (el) => render(el, 'clean');
