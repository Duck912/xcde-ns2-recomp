<p align="center"><img src="docs/images/monado-icon.png" alt="xcde-ns2-recomp icon: the Monado" width="160"></p>

# xcde-ns2-recomp

A native Windows PC port of **Xenoblade Chronicles: Definitive Edition – Nintendo Switch 2 Edition**, made by
static recompilation: the game's code is translated into a regular Windows program on your own PC, and runs on a
small runtime that stands in for the console's system software. The picture is drawn by **NVN-HLE**, which replays
the game's graphics calls on Vulkan. It is not an emulator.

> **No game files are included.** You need your own legally dumped copy of the game, including its add-on (the
> Switch 2 Edition upgrade pack). Everything that reads the game happens on your PC, and nothing is written into
> your dump. Not affiliated with or endorsed by Nintendo or Monolith Soft.

## Status

The game plays from the title screen into the story at 60 fps.

| | |
|---|---|
| Picture | correct, drawn by NVN-HLE on Vulkan; the game's own DLSS runs on real NVIDIA DLSS (FSR 1 without it) |
| Movies | the opening and story movies play |
| Sound | yes |
| Saves | yes |
| Window | windowed or borderless fullscreen (F11), any size; the picture follows the window |
| Overlay | F1 settings menu (English or Chinese), F10 performance overlay, F12 screenshots |
| Settings | upscaler, DLSS model, window scaler, VSync; in the launcher and in the game |

Testing so far has been narrow, so expect rough edges (AMD and Intel GPUs are untried). See
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md), and open an issue with the log if something goes wrong.

## Play it

1. Download `xcde-ns2-recomp-<version>-windows-x64.zip` from [Releases](../../releases) and extract it into a new
   folder.
2. Run `xcde-launcher.exe`, press **Build**, pick your dump (the `.nup`, or its ExeFS, RomFS and add-on folders),
   keep **Download NVIDIA DLSS** ticked if you have an NVIDIA RTX card, and press **Build** again.
3. When it says your game is ready, press **Play**.

Nothing needs to be installed. The first build takes about 5 to 10 minutes: it downloads the compiler once (Zig,
about 100 MB, from ziglang.org) and NVIDIA Streamline if you ticked it (276 MB), then recompiles the game's code on
your PC. Later starts go straight to the game.

**What you need:** Windows 10 or 11 (x64), a graphics card with Vulkan 1.3 (NVIDIA RTX for DLSS), about 16 GB of
RAM, and your dump of XC:DE Switch 2 Edition 2.0.0 with its add-on `0100FF500E34B001`.

**Keys:** F1 menu · F10 performance overlay · F11 fullscreen · F12 screenshot. A gamepad works out of the box;
keyboard and mouse bindings are on the F1 menu's Controls page.

## Build from source

For developers: the same setup, with the runtime built from this checkout instead of the release's prebuilt one.

| tool | version | used for |
|---|---|---|
| Visual Studio Build Tools (MSVC + Windows SDK) | 2022+ | headers and import libraries for clang-cl |
| LLVM | 22+ | `clang-cl`, `llvm-lib` |
| CMake + Ninja | 3.25+ | the runtime |
| Python | 3.12 with `lz4`, `capstone`, `zstandard` | the recompiler and the dump reader |
| PowerShell | 7+ (`pwsh`) | the build scripts |

Put them on `PATH`, or set `XC2_ENV` to a PowerShell script that does ([docs/BUILD.md](docs/BUILD.md)). Then:

```powershell
python tools\setup\xcde_setup.py --repo . --install work\play --nup "D:\dumps\XC DE.nup"
tools\run\play-xcde.cmd
```

The setup downloads the prebuilt NVN-HLE library from the release (set `XCDE_NVNHLE_DIST` to use one you built),
builds the runtime, reads the dump, recompiles and links the game (`xcde/build/200/boot-n2den/xcde.exe`). With
folders instead of a `.nup`: `--exefs <dir> --romfs <dir> --dlc <dir>`. The launcher (`launcher/`, `npm install`
then `npm run tauri build -- --no-bundle`) runs the same engine. The release package is made with
`tools/build/build-release.ps1` and `tools/build/make-package-xcde.ps1` ([docs/RELEASE-PLAN.md](docs/RELEASE-PLAN.md)).

| | |
|---|---|
| `xcde/` | XC:DE's game folder, hook site lists, icon and supported build |
| `xc2/src/xc2_boot.cpp` | the boot program (`--game xcde`, `--nvn n2den`) |
| `third_party/fefw-recomp/` | the runtime: system services, input, audio, movies, the overlay, the NVN-HLE adapter |
| `tools/setup/xcde_setup.py` | the setup engine (the launcher runs it) |
| `launcher/` | the Tauri launcher |

This repository started as an import of [xc2-ns2-recomp](https://github.com/weile10000/xc2-ns2-recomp) with its
full history; XC:DE S2E shares its system modules with XC2 S2E byte for byte ([docs/TARGET.md](docs/TARGET.md)).
That project's README is kept as [README.xc2.md](README.xc2.md).

## Credits

- **NVN-HLE**, the renderer: by duck912 and the Eglantine Community, ported to n2den, and from there into
  this project. Its source for each release is attached to the release (`n2den-nvnhle-src-*.zip`).
- [xc2-ns2-recomp](https://github.com/weile10000/xc2-ns2-recomp) (weile10000 and contributors): the base this port
  is built on, including the settings menu and the launcher.
- [fefw-recomp](https://github.com/Goldoire/fefw-recomp) and nxrecomp: the runtime and the recompiler.
- n2den and Eden, and everyone before them: Ryujinx, Sudachi, Citron, Torzu, Suyu and Ryubing.
- nxnative and everyone those projects credit; see [README.xc2.md](README.xc2.md) and
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

License: GPL-3.0-or-later (matching the projects it builds on).
