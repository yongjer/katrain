# KaTrain Tauri 移植：交接文件

更新於 2026-11-05。給下一個工作階段接手用。

## 1. 目標

把使用者自己 fork 的 KaTrain（https://github.com/yongjer/katrain）從 Python + Kivy 改寫成 **Tauri v2** 桌面 app。使用者一開始選定的做法：

- **A 方案**：遊戲邏輯全部改寫成 TypeScript，Rust 只負責 KataGo 的連線（本機程序／自訂命令／遠端 WebSocket）、檔案讀寫、設定和模型下載。
- 前端：**React + TypeScript + Vite**，狀態管理用 zustand。
- 行為要和原 Python 版一致：同樣的設定格式、翻譯（gettext .po）、SGF 讀寫（包括 KaTrain 的 `KT` 分析快取）。

使用者以繁體中文溝通，回覆請用繁體中文。使用者要求功能**直接在他的 Mac 上用 computer use 實際驗證**。

## 2. 目前做到哪

原本規劃的 4 個階段都已完成，並且已移除 Python/Kivy 程式碼；之後又完成了「下一步」清單中的第 4 項（macOS 內建 KataGo + Intel 版）。

| 階段 | 內容 | 狀態 |
|---|---|---|
| 1 | 指導棋模式、棋譜樹 | 完成，Mac 實測過 |
| 2 | 其餘 AI（16 種）、模型下載 | 完成，Mac 實測過 |
| 3 | 計時器、插入模式、下到終局、擺局、死活題外框、剪貼簿 SGF | 完成，Mac 實測過 |
| 4 | 表現報告（F3）、遠端引擎、移除 Python | 完成，Mac 實測過 |
| 追加 | G 框選分析區域、K 座標、F2 全盤分析、Ctrl+←/→、中鍵加入變化、拖放檔案 | 完成；G、K、F2 在 Mac 實測過，中鍵與拖放只在瀏覽器（Playwright）測過 |
| 追加 | macOS 內建 KataGo（Apple Silicon 用 Metal、Intel 用 OpenCL）、Intel 版建置 | 完成；Apple Silicon 版在 Mac 實測過 |

- 分支：`tauri-v2`，最新 commit `821b764`（工作目錄乾淨，全部已推上 GitHub）。
- PR：https://github.com/yongjer/katrain/pull/1 （open，base 是 `main`，標題「Port KaTrain to Tauri v2 + React + TypeScript」，說明已更新到第 4 階段）。**還沒合併**，合併要由使用者決定。
- 測試版頁面的 tag `tauri-nightly` 指向 `6611968`（之後的 `821b764` 只改文件，那次 CI 被我取消，所以安裝檔仍是 `6611968` 建的，內容相同）。

## 3. 已完成的結論

### 測試版（6 個安裝檔）

https://github.com/yongjer/katrain/releases/tag/tauri-nightly （prerelease，未簽章，僅供測試）

| 檔案 | 平台 |
|---|---|
| `KaTrain_2.0.0_aarch64.dmg` | macOS Apple Silicon（內建 Metal 版 KataGo，需 macOS 14+） |
| `KaTrain_2.0.0_x64.dmg` | macOS Intel（內建 OpenCL 版 KataGo，需 macOS 11+） |
| `KaTrain_2.0.0_x64_en-US.msi` | Windows 安裝檔 |
| `KaTrain_2.0.0_x64-setup.exe` | Windows 安裝檔（NSIS） |
| `KaTrain_2.0.0_amd64.deb` | Linux |
| `KaTrain_2.0.0_amd64.AppImage` | Linux |

下載直連（雲端容器可用 curl 抓）：`https://github.com/yongjer/katrain/releases/download/tauri-nightly/<檔名>`。CI 的 artifact 則無法從容器下載（blob 網域 403），要拿安裝檔請用上面的 release 連結。

### macOS 內建 KataGo

- 在使用者的 Mac（M1）確認：KataGo 紀錄顯示啟動的是 `/Applications/KaTrain.app/Contents/Resources/KataGo/katago-osx`，Metal backend（KataGo v1.18.2），擬人模型一起載入；分析與 AI 對弈（歷史職業棋風 9d）正常。
- `scripts/build-katago-macos.sh` 從原始碼編 KataGo（`stable` 分支），用 dylibbundler 把 Homebrew 函式庫複製到 `katago-libs/`，並 ad-hoc 簽章。
- 編譯前把 KataGo `cpp/core/global.cpp` 的 `quick_exit(EXIT_FAILURE)` 換成 `_Exit(EXIT_FAILURE)`：`quick_exit` 只在 macOS 15+ 存在，不換的話在 macOS 14 上一啟動就 `Symbol not found: _quick_exit` 當掉（CI 實際撞過）。
- Apple Silicon 版最低 macOS 14：內附的 protobuf/abseil 是 Homebrew 在 macOS 14 上編的。Intel 版把 Homebrew 排除在外（`CMAKE_IGNORE_PREFIX_PATH`），deployment target 11.0，只依賴系統的 OpenCL/zlib。
- app 用 ad-hoc 簽章（`tauri.macos.conf.json` 的 `signingIdentity: "-"`），不是 Apple 開發者簽章，第一次開啟仍要右鍵→打開或到「隱私權與安全性」放行。

### Intel 版驗證狀況

- **只在 GitHub 的 `macos-15-intel` runner 上驗證過**：CI 步驟「Check the bundled KataGo starts from inside the app」實際執行 app 內的 `katago-osx version`（輸出 KataGo v1.18.2、OpenCL backend），`otool -L` 只剩系統函式庫，`codesign --verify` 通過。
- **沒有在真的 Intel Mac 上跑過分析**（使用者只有 M1）。runner 沒有可用 GPU，所以 OpenCL 實際推論也沒測過。

### CI 注意事項（手動執行 macos-14）

- 工作流程：`.github/workflows/tauri.yml`。push 到 `tauri-v2` 會跑 test → build（windows-latest、ubuntu-22.04、macOS Apple Silicon、macos-15-intel）→ nightly（更新 `tauri-nightly`；需要所有 build 都成功）。
- **GitHub 的 `macos-latest`（Apple Silicon）機器容量不足**，job 常常排不到，最後被標成 cancelled（annotation：「The job was not acquired by Runner of type hosted even after multiple attempts」）。這時 nightly 會被跳過。
- 解法：到 Actions 手動執行 workflow，指定 macOS 機器：
  ```sh
  gh workflow run tauri.yml --ref tauri-v2 -f macos_runner=macos-14
  ```
  手動執行（workflow_dispatch）同樣會更新 `tauri-nightly`。為避免重複跑，我的習慣是 push 後把 push/pull_request 觸發的 run 取消（`gh run cancel <id>`），只留手動那次。
- KataGo 的 macOS 編譯結果用 `actions/cache` 快取，key 含 KataGo `stable` 的 commit 和 `scripts/build-katago-macos.sh` 的雜湊；改了腳本就會重編（約 5 分鐘）。
- macOS 編譯 KataGo 需要 Xcode 16（macOS 15 SDK）：workflow 用 `maxim-lobanov/setup-xcode@v1`（latest-stable）。
- 在這個雲端環境中，`gh` 的 GraphQL 被擋，請一律用 REST：`gh api repos/yongjer/katrain/...`。`gh release view` 也不能用，改用 `gh api repos/yongjer/katrain/releases/tags/tauri-nightly`。

### 測試

- `npm test`：109 個單元測試全過（25 個需要真實 KataGo 的預設跳過）。很多測試對照 Python 版產生的 golden data（`tests-ts/golden/*.json`：SGF 解析、讓子、float16/KT 快取、死活題外框、表現報告）。
- 真實 KataGo 的端對端測試：
  ```sh
  KATAGO_E2E=1 npx vitest run tests-ts/engine.e2e.test.ts tests-ts/selfplay.e2e.test.ts
  ```
  在這個雲端容器裡要用 CPU 的 pocl OpenCL：加 `POCL_KERNEL_CACHE=0`，並設 `KATRAIN_DATA_DIR` 到一個有 OpenCL tuning 檔的資料夾（第一次 tuning 很久；容器換 CPU 型號後 tuning 檔名會變，可複製舊檔改名沿用）。
- `cargo test`、`cargo clippy --all-targets -- -D warnings`、`npm run typecheck`、`npm run build` 都通過。
- 遠端引擎：在容器用一個 WebSocket→KataGo 的小伺服器（ws 套件）測過斷線重連與續送查詢；在 Mac 上連過公開的 `wss://echo.websocket.org`，確認加密連線可用（它不是 KataGo，所以沒有分析結果）。

## 4. 還沒做／還沒驗證

建議順序（使用者已看過這份清單，第 4 項已完成）：

1. **Windows 實機測試（建議下一步）**：Windows 版從未在實機跑過。內建 KataGo + 一堆 DLL + OpenCL，最可能出問題（路徑、防毒、缺 VC++ 執行環境、SmartScreen）。需要使用者提供一台 Windows 電腦並連到對話。
2. **Linux 實機測試**：只在早期用 Xvfb 跑過 Linux 版；deb/AppImage 沒有在真的桌面環境裝過。
3. **合併 PR #1 到 `main`**：需使用者同意。合併後要把 workflow 的 push 分支、nightly 條件從 `tauri-v2` 改成 `main`（或另外設計），並更新 README/DEVELOPMENT.md 裡提到 `tauri-v2` 的地方。
4. **正式發佈流程**：版本號統一（目前 `package.json` 和 `Cargo.toml` 是 `2.0.0-alpha.1`，`tauri.conf.json` 是 `2.0.0`，因為 MSI 不接受 prerelease 版本號）、推 tag 自動建正式版、Tauri updater 自動更新、macOS 簽章公證（需 Apple 開發者帳號）、Windows 簽章。
5. **Intel Mac 實機驗證**：需要有 Intel Mac 的人。
6. **還沒移植的功能**：在設定裡下載 KataGo 執行檔、參與分散式訓練（contribute mode）、主題與自訂快捷鍵、極簡 UI 模式（`~`/F12）。另外 PV 上捲動滑鼠逐手瀏覽、點棋子看該手詳細資料、雙擊跳轉也沒做。
7. **小問題**：選單中「Copy SGF」「Paste SGF / link」「KataGo log」三項沒有翻譯（原版沒有這些選單項目的字串）。
8. 中鍵加入變化、拖放棋譜檔只在瀏覽器測過，沒在 Mac app 裡測。

## 5. 重要檔案與連結

- Repo：https://github.com/yongjer/katrain （分支 `tauri-v2`）
- PR：https://github.com/yongjer/katrain/pull/1
- 測試版：https://github.com/yongjer/katrain/releases/tag/tauri-nightly
- 原版 KaTrain：https://github.com/sanderland/katrain
- KataGo：https://github.com/lightvector/KataGo

Repo 內：

| 路徑 | 說明 |
|---|---|
| `README.md` | 新版使用說明 |
| `DEVELOPMENT.md` | 架構、建置指令、測試方式、未移植清單 |
| `ENGINE.md` | KataGo 疑難排解 |
| `src/core/` | 遊戲邏輯（sgf、gameNode、game、engine、ai、report、tsumego、models、i18n） |
| `src/state/store.ts` | zustand store，相當於原 `__main__.py` 的控制邏輯 |
| `src/state/platform.ts` | Tauri／瀏覽器平台層（引擎 transport、檔案、剪貼簿、拖放） |
| `src/state/defaults.json` | 預設設定（原 `katrain/config.json`） |
| `src/ui/` | React 元件（Board、MoveTree、Dialogs、Bars、Panels、Timer、App） |
| `src/i18n/*.po` | 11 種語言的翻譯 |
| `src-tauri/src/engine.rs` | KataGo 程序／WebSocket 連線 |
| `src-tauri/src/paths.rs` | `katrain/...` 設定路徑對應到內建資源（開發時對應 repo 的 `resources/`） |
| `src-tauri/tauri*.conf.json` | 各平台打包設定（macOS 版含 katago-osx 與 katago-libs） |
| `resources/` | Windows/Linux 的 KataGo、預設模型、KataGo 設定檔 |
| `scripts/build-katago-macos.sh` | 編 macOS 版 KataGo（本機在 Mac 上 build app 前也要先跑一次） |
| `scripts/engine-bridge.mjs` | 在一般瀏覽器開發 UI 時跑 KataGo 的本機橋接 |
| `.github/workflows/tauri.yml` | CI |
| `tests-ts/` | 單元與端對端測試、golden data、測試棋譜 |

Golden data 原本是用 Python 程式產生的。Python 程式碼已從分支移除，若要重產，可從移除前的 commit 取回：`git show 4361e15^:katrain/...`。

## 6. 使用者的 Mac（computer use 注意事項）

- 裝置：Apple Silicon（M1）MacBook Air，macOS；已連接資料夾只有 `/Users/yongjer/Downloads`。
- 安裝測試版的流程：
  1. 容器下載 release 的 dmg。
  2. `SendUserFile` 傳給使用者，拿到 fileUuid。
  3. `device_commit_files` 用 fileUuid 寫到 `/Users/yongjer/Downloads/`（用 stagedPath 會 HTTP 400）。
  4. 在 Finder 打開 dmg，拖到 Applications，選 Replace，再從 Applications 雙擊啟動。
- KaTrain 的 bundle id：`io.github.yongjer.katrain`。結束 app 請用 `computer_app_menu` 的 ["KaTrain","Quit KaTrain"]（Cmd+Q 屬於系統組合鍵，沒有授權）。
- **背景模式（app_* 工具）的限制**：
  - KaTrain 的 WebView 沒有 AX 子元素，`<select>` 下拉選單無法在背景操作。
  - 背景送字母鍵（I、W 等）不會生效；方向鍵可以。
  - Finder 拖曳在背景會失敗。
  - 以上都要申請**全螢幕控制**（`computer_request_full_control`），拖曳要用 mouse_down → 多次慢速 mouse_move → mouse_up。
  - 全螢幕控制下字母快捷鍵正常。
- 使用者切到全螢幕 App 時，KaTrain 視窗在別的桌面，畫面不會更新、按鍵也送不進去，這時要請使用者切回一般桌面。
- 授權閒置 30 分鐘會失效，要重新 `computer_resolve_access` + `computer_request_access`。用完記得 `computer_release_full_control`、`computer_app_release`、`computer_release_lock`。
- 使用者的 Mac 有 Homebrew 的 KataGo（`/opt/homebrew/bin/katago`，v1.18.2），但現在 app 預設用內建的那支。
- KaTrain 設定目前是本機引擎；遠端分頁裡留著測試用的 URL `wss://echo.websocket.org`，但後端已切回 local。
- 「下載」裡可能還有測試版 dmg（`KaTrain_2.0.0_aarch64_bundled_katago.dmg`），桌面可能還掛著 KaTrain 安裝映像檔，已提醒使用者自行清理。

## 7. 接手者一開始該做什麼

1. 取得程式碼：`git clone https://github.com/yongjer/katrain && cd katrain && git checkout tauri-v2`（必要時用 add_repo 取得 push 權限），確認 `git log -1` 是 `821b764` 或更新。
2. `npm ci && npm run typecheck && npm test`，確認 109 個測試通過；需要時 `cargo test --manifest-path src-tauri/Cargo.toml`。
3. 讀 `DEVELOPMENT.md`（架構與指令）和本文件第 4 節。
4. 查 CI 與測試版狀態：
   - `gh run list --branch tauri-v2 --limit 5`
   - `gh api repos/yongjer/katrain/releases/tags/tauri-nightly --jq '.assets[].name'`
5. 用繁體中文問使用者要接著做哪一項，預設建議 **Windows 實機測試**：
   - 請使用者在 Windows 電腦上安裝 Claude 桌面 app 並把這個對話連到那台電腦。
   - 安裝 `KaTrain_2.0.0_x64-setup.exe` 或 `.msi`，依 Mac 的流程驗證：引擎啟動（KataGo 紀錄）、分析、AI 對弈、指導棋、計時器、模型下載、表現報告、遠端引擎設定。
6. 任何要合併 PR、改 `main`、發正式版、刪檔的動作，都先問使用者。
