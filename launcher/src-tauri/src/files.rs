// SPDX-License-Identifier: GPL-3.0-or-later
//! The Saves and Clean up page: the player's save files (open, back up, restore, delete a backup) and the files an
//! install collects that the game does not need to start (build leftovers, logs, download leftovers, the shader cache).
//!
//! Every path here is a fixed name under the run folder (or, in a checkout, the repository's build folder): nothing the
//! page sends is used as a path. A backup is named by the id this module made; ids with anything but [0-9A-Za-z-] are
//! refused. Nothing runs while the game or a build is running.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone)]
pub struct SaveFile {
    /// path under the save folder, '/' separated (account/<uid>/bf2savefile.sav)
    pub rel: String,
    pub name: String,
    pub size: u64,
    /// seconds since 1970 (UTC)
    pub modified: u64,
}

#[derive(Serialize, Clone)]
pub struct Backup {
    pub id: String,
    pub created: u64,
    pub files: usize,
    pub size: u64,
}

#[derive(Serialize)]
pub struct SavesOverview {
    pub save_dir: String,
    pub backup_dir: String,
    pub files: Vec<SaveFile>,
    pub backups: Vec<Backup>,
}

#[derive(Serialize, Clone)]
pub struct CleanItem {
    pub id: String,
    pub path: String,
    pub bytes: u64,
    /// the item cannot be removed now (why, in English: the page shows its own text for the ids it knows)
    pub blocked: Option<String>,
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// A junction or symbolic link (on Windows both are reparse points that symlink_metadata reports as links).
fn is_link(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false) || is_junction(p)
}

#[cfg(windows)]
fn is_junction(p: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    fs::symlink_metadata(p).map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0).unwrap_or(false)
}

#[cfg(not(windows))]
fn is_junction(_: &Path) -> bool {
    false
}

/// Size of a file or folder; links are not followed (a junction to the game data counts as nothing).
pub fn size_of(p: &Path) -> u64 {
    let Ok(m) = fs::symlink_metadata(p) else { return 0 };
    if is_link(p) {
        return 0;
    }
    if m.is_file() {
        return m.len();
    }
    let mut total = 0;
    if let Ok(rd) = fs::read_dir(p) {
        for e in rd.flatten() {
            total += size_of(&e.path());
        }
    }
    total
}

fn walk_files(root: &Path, dir: &Path, out: &mut Vec<SaveFile>, depth: usize) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if is_link(&p) {
            continue;
        }
        if p.is_dir() {
            if depth < 6 {
                walk_files(root, &p, out, depth + 1);
            }
            continue;
        }
        let Ok(rel) = p.strip_prefix(root) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push(SaveFile { rel, name, size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0), modified: mtime_secs(&p) });
    }
}

/// The game's save files: everything under <save>/account except the runtime's own bookkeeping (.meta, .work.*).
pub fn list_saves(save_dir: &Path) -> Vec<SaveFile> {
    let mut out = Vec::new();
    walk_files(save_dir, save_dir, &mut out, 0);
    out.retain(|f| !f.rel.split('/').any(|part| part.contains(".work.")) && !f.name.ends_with(".meta"));
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

pub fn backup_dir(game_dir: &Path) -> PathBuf {
    game_dir.join("save-backups")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn list_backups(game_dir: &Path) -> Vec<Backup> {
    let mut out: Vec<Backup> = fs::read_dir(backup_dir(game_dir))
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir() && !is_link(&e.path()))
                .filter_map(|e| {
                    let id = e.file_name().to_string_lossy().into_owned();
                    if !valid_id(&id) {
                        return None;
                    }
                    let files = list_saves(&e.path());
                    Some(Backup { id, created: mtime_secs(&e.path()), size: files.iter().map(|f| f.size).sum(), files: files.len() })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

/// yyyymmdd-hhmmss (UTC) for a backup's folder name; the page shows the folder's time in local time.
fn stamp(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    // civil-from-days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", y, m, d, rem / 3600, (rem / 60) % 60, rem % 60)
}

fn copy_tree(src: &Path, dst: &Path) -> Result<usize, String> {
    fs::create_dir_all(dst).map_err(|e| format!("cannot create {}: {}", dst.display(), e))?;
    let mut n = 0;
    for e in fs::read_dir(src).map_err(|e| format!("cannot read {}: {}", src.display(), e))?.flatten() {
        let p = e.path();
        let name = e.file_name();
        if is_link(&p) || name.to_string_lossy().contains(".work.") {
            continue;
        }
        if p.is_dir() {
            n += copy_tree(&p, &dst.join(&name))?;
        } else {
            fs::copy(&p, dst.join(&name)).map_err(|e| format!("cannot copy {}: {}", p.display(), e))?;
            n += 1;
        }
    }
    Ok(n)
}

/// Copies the whole save folder into save-backups/<stamp>[-suffix]. Returns the new backup's id.
pub fn make_backup(save_dir: &Path, game_dir: &Path, suffix: &str) -> Result<String, String> {
    if list_saves(save_dir).is_empty() {
        return Err("There are no saves to back up yet.".into());
    }
    let base = stamp(now_secs());
    let mut id = if suffix.is_empty() { base.clone() } else { format!("{base}-{suffix}") };
    let mut k = 2;
    while backup_dir(game_dir).join(&id).exists() {
        id = format!("{}-{}", if suffix.is_empty() { base.clone() } else { format!("{base}-{suffix}") }, k);
        k += 1;
    }
    let dst = backup_dir(game_dir).join(&id);
    if let Err(e) = copy_tree(save_dir, &dst) {
        let _ = fs::remove_dir_all(&dst);
        return Err(e);
    }
    Ok(id)
}

fn backup_path(game_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("That is not a backup name.".into());
    }
    let p = backup_dir(game_dir).join(id);
    if !p.is_dir() || is_link(&p) {
        return Err(format!("The backup {id} does not exist."));
    }
    Ok(p)
}

/// Puts a backup back: the current saves are backed up first (id "<stamp>-before-restore"), then the save folder's
/// game files are replaced by the backup's. Returns the id of that safety backup, when there were saves to keep.
pub fn restore_backup(save_dir: &Path, game_dir: &Path, id: &str) -> Result<Option<String>, String> {
    let src = backup_path(game_dir, id)?;
    if list_saves(&src).is_empty() {
        return Err(format!("The backup {id} holds no save files."));
    }
    let safety = if list_saves(save_dir).is_empty() { None } else { Some(make_backup(save_dir, game_dir, "before-restore")?) };
    let account = save_dir.join("account");
    if account.is_dir() && !is_link(&account) {
        fs::remove_dir_all(&account).map_err(|e| format!("cannot clear {}: {}", account.display(), e))?;
    }
    copy_tree(&src, save_dir)?;
    Ok(safety)
}

pub fn delete_backup(game_dir: &Path, id: &str) -> Result<(), String> {
    let p = backup_path(game_dir, id)?;
    fs::remove_dir_all(&p).map_err(|e| format!("cannot delete {}: {}", p.display(), e))
}

/// What can be cleaned. `game_dir` is the run folder; `repo_build` the checkout's xc2/build/301 (None in a package);
/// `linked` the folders the game's data links point into (an unpacked .nup the RomFS still reads from is not removable).
pub fn clean_items(game_dir: &Path, nup: &Path, repo_build: Option<&Path>, linked: &[PathBuf]) -> Vec<CleanItem> {
    let mut items = Vec::new();
    let mut add = |id: &str, paths: Vec<PathBuf>, blocked: Option<String>| {
        let present: Vec<PathBuf> = paths.into_iter().filter(|p| fs::symlink_metadata(p).is_ok()).collect();
        if present.is_empty() {
            return;
        }
        let bytes = present.iter().map(|p| size_of(p)).sum();
        let path = present.iter().map(|p| crate::dump::fwd(p)).collect::<Vec<_>>().join("\n");
        items.push(CleanItem { id: id.into(), path, bytes, blocked });
    };
    // The recompiler's intermediate output: Build makes it again (about a minute of lifting, a few of linking).
    let mut build = vec![game_dir.join("build").join("lift"), game_dir.join("build").join("obj-zig"), game_dir.join("build").join("obj")];
    if let Some(rb) = repo_build {
        build.push(rb.join("lift"));
        build.push(rb.join("obj"));
    }
    add("build", build, None);
    // The unpacked .nup: removable only once the game's data no longer points into it.
    let nup = nup.to_path_buf();
    let nup_real = fs::canonicalize(&nup).unwrap_or_else(|_| nup.clone());
    let in_use = linked.iter().any(|l| l.starts_with(&nup) || l.starts_with(&nup_real));
    add("nup", vec![nup.clone()], in_use.then(|| "the game's data is read from this folder".into()));
    // Logs: the game's play logs, the setup's logs, NVN-HLE's log, crash reports.
    let mut logs = Vec::new();
    for d in [game_dir.join("work").join("logs"), game_dir.join("user").join("log"), game_dir.join("reports")] {
        logs.push(d);
    }
    if let Ok(rd) = fs::read_dir(game_dir.join("setup")) {
        logs.extend(rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "log")));
    }
    if let Ok(rd) = fs::read_dir(game_dir) {
        logs.extend(rd.flatten().map(|e| e.path()).filter(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            p.is_file() && (n.ends_with(".dmp") || n == "fefw_fatal.txt" || n.starts_with("crash"))
        }));
    }
    add("logs", logs, None);
    // Downloads already unpacked, half-finished downloads, the updater's copy of the previous version.
    let mut dl = vec![game_dir.join("update").join("old"), game_dir.join("work").join(".nvnhle-download")];
    for d in [game_dir.join("upscalers"), game_dir.join("tools").join("build"), game_dir.to_path_buf()] {
        if let Ok(rd) = fs::read_dir(&d) {
            dl.extend(rd.flatten().map(|e| e.path()).filter(|p| {
                let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                p.is_file() && (n.ends_with(".part") || (n.ends_with(".zip") && (n.starts_with("zig-") || n.starts_with("streamline-sdk"))))
            }));
        }
    }
    add("downloads", dl, None);
    // Bookkeeping files the runtime leaves when the game was ended without closing (save/account/*.work.<pid>).
    let mut work = Vec::new();
    if let Ok(rd) = fs::read_dir(game_dir.join("save").join("account")) {
        work.extend(rd.flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().contains(".work."))));
    }
    add("leftovers", work, None);
    // NVN-HLE's shader cache: rebuilt while playing (the first minutes stutter again).
    add("shaders", vec![game_dir.join("user").join("cache"), game_dir.join("shader_cache")], None);
    items
}

fn remove_path(p: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    let r = if is_link(p) {
        // a link itself, never what it points to
        fs::remove_dir(p).or_else(|_| fs::remove_file(p))
    } else if m.is_dir() {
        fs::remove_dir_all(p)
    } else {
        fs::remove_file(p)
    };
    r.map_err(|e| format!("cannot remove {}: {}", p.display(), e))
}

/// Removes the items with these ids (as clean_items lists them now). Returns the bytes freed.
pub fn clean(game_dir: &Path, nup: &Path, repo_build: Option<&Path>, linked: &[PathBuf], ids: &[String]) -> Result<u64, String> {
    let mut freed = 0;
    let mut errors = Vec::new();
    for item in clean_items(game_dir, nup, repo_build, linked) {
        if !ids.contains(&item.id) {
            continue;
        }
        if let Some(why) = &item.blocked {
            errors.push(format!("{}: {}", item.id, why));
            continue;
        }
        for p in item.path.lines() {
            let p = PathBuf::from(p);
            let size = size_of(&p);
            match remove_path(&p) {
                Ok(()) => freed += size,
                Err(e) => errors.push(e),
            }
        }
    }
    if errors.is_empty() {
        Ok(freed)
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_is_utc_calendar_time() {
        assert_eq!(stamp(0), "19700101-000000");
        assert_eq!(stamp(1_795_651_200 + 3661), "20261126-010101");
    }

    #[test]
    fn backup_restore_and_delete() {
        let root = std::env::temp_dir().join(format!("xc2-files-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let save = root.join("save");
        let acc = save.join("account").join("uid");
        fs::create_dir_all(&acc).unwrap();
        fs::write(acc.join("bf2savefile.sav"), b"one").unwrap();
        fs::write(save.join("account").join("uid.meta"), b"m").unwrap();
        fs::create_dir_all(save.join("account").join("uid.work.42")).unwrap();
        assert_eq!(list_saves(&save).len(), 1);
        let id = make_backup(&save, &root, "").unwrap();
        assert!(backup_dir(&root).join(&id).join("account").join("uid").join("bf2savefile.sav").is_file());
        assert!(!backup_dir(&root).join(&id).join("account").join("uid.work.42").exists());
        fs::write(acc.join("bf2savefile.sav"), b"two").unwrap();
        let safety = restore_backup(&save, &root, &id).unwrap().unwrap();
        assert_eq!(fs::read(acc.join("bf2savefile.sav")).unwrap(), b"one");
        assert_eq!(list_backups(&root).len(), 2);
        assert!(restore_backup(&save, &root, "../x").is_err());
        delete_backup(&root, &safety).unwrap();
        assert_eq!(list_backups(&root).len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn clean_keeps_what_the_game_reads() {
        let root = std::env::temp_dir().join(format!("xc2-clean-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("build").join("lift")).unwrap();
        fs::write(root.join("build").join("lift").join("a.cpp"), b"xx").unwrap();
        fs::create_dir_all(root.join("build").join("exefs-patched")).unwrap();
        fs::create_dir_all(root.join("game").join("nup_dump").join("base").join("romfs")).unwrap();
        let linked = vec![root.join("game").join("nup_dump").join("base").join("romfs")];
        let nup = root.join("game").join("nup_dump");
        let items = clean_items(&root, &nup, None, &linked);
        assert!(items.iter().find(|i| i.id == "nup").unwrap().blocked.is_some());
        let freed = clean(&root, &nup, None, &linked, &["build".into()]).unwrap();
        assert_eq!(freed, 2);
        assert!(!root.join("build").join("lift").exists());
        assert!(root.join("build").join("exefs-patched").exists());
        assert!(clean(&root, &nup, None, &linked, &["nup".into()]).is_err());
        assert!(root.join("game").join("nup_dump").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
