# KaTrain Tauri 移植：交接文件

更新於 2026-11-05。給下一個工作階段接手用。

**現況：Ubuntu 上的工作已結束，接下來換到使用者的 Mac 測試。請先看第 4 節第 1 項，步驟都寫在那裡。**

## 1. 目標

把使用者自己 fork 的 KaTrain（https://github.com/yongjer/katrain）從 Python + Kivy 改寫成 **Tauri v2** 桌面 app。使用者一開始選定的做法：

- **A 方案**：遊戲邏輯全部改寫成 TypeScript，Rust 只負責 KataGo 的連線（本機程序／自訂命令／遠端 WebSocket）、檔案讀寫、設定和模型下載。
- 前端：**React + TypeScript + Vite**，狀態管理用 zustand。
- 行為要和原 Python 版一致：同樣的設定格式、翻譯（gettext .po）、SGF 讀寫（包括 KaTrain 的 `KT` 分析快取）。

使用者以繁體中文溝通，回覆請用繁體中文。使用者要求功能**實際驗證**。使用者有 M1 Mac 和 Ubuntu 桌機，**沒有 Windows 電腦**。

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
| 追加 | Linux 實機測試與修正（AppImage 引擎、第一手當機、音效） | 完成；實測範圍和沒測到的項目見第 3 節「Linux 實機測試」 |

- 分支：`tauri-v2`（工作目錄乾淨，全部已推上 GitHub）。Linux 修正已合併進來，測試分支都已刪除。
- PR：https://github.com/yongjer/katrain/pull/1 （open，base 是 `main`，標題「Port KaTrain to Tauri v2 + React + TypeScript」）。PR 說明還沒補上 Linux 這批修正。**還沒合併**，合併要由使用者決定。
- 測試版頁面的 tag `tauri-nightly` 指向 `d6680db`。之後的交接文件 commit 只改 `handoff.md`，那次 CI 已取消，所以安裝檔仍是 `d6680db` 建的，程式內容相同。
- 使用者的 Mac 上還是舊的測試版，要先換成這一版才能測。

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

### Windows 驗證狀況

- **只在 GitHub 的 `windows-latest` runner 上驗證過**：CI 步驟「Check the bundled KataGo starts from inside the installers」解開 MSI、實際安裝 NSIS 版，逐一確認打包的檔案都在，再從兩邊執行 `katago.exe version`（輸出 KataGo v1.18.1、OpenCL backend）。
- **app 本身從未在 Windows 上開過**：介面、分析、音效都沒測。runner 沒有可用 GPU，所以 OpenCL 實際推論也沒測過。
- 使用者沒有 Windows 電腦。除非有人能提供機器，否則這些都無法實測；虛擬機多半沒有 GPU，也測不到 OpenCL。

### Linux 實機測試

測試機：Ubuntu 26.04、RTX 4060 Ti、系統 WebKitGTK 2.52.6、PipeWire，音訊輸出是藍牙耳機（LDAC）。

**實測正常**

- deb（XWayland）：OpenCL 引擎、分析、AI 對弈、指導棋、計時器、快捷鍵、F3 報告、模型下載、SGF 存讀、剪貼簿、繁中介面、`ws://` 遠端與重連、正常結束、G 框選、F2 全盤分析、中鍵加入變化、拖放棋譜（用小視窗當拖曳來源，傳 `text/uri-list`；真正從「檔案」拖還沒試）。
- 真正安裝 deb（`apt`／`dpkg`）：引擎從 `/usr/share/KaTrain/KataGo/katago` 啟動，從選單開啟正常（覆蓋舊版本後要重新登入，見下表）。
- 擬人 AI 和歷史職業棋風：用測試設定讓兩邊自動對弈，引擎有載入擬人模型，AI 有落子；沒有走設定畫面。第一手要等約 30 秒，應該是在載入模型。
- AppImage：引擎、分析、落子與 AI 回應、音效（使用者手動下棋時聽得到，同時錄到 51 聲，停約 97 秒後也照常響）。
- 原生 Wayland：使用者確認正常。

**這輪修掉的問題**

| 問題 | 原因 | 修法 |
|---|---|---|
| AppImage 引擎死掉 | 內建的 Linux KataGo 本身是 AppImage，linuxdeploy 改寫 `usr/lib` 下所有 ELF 時把它弄壞 | 改裝到 `usr/share/KaTrain/KataGo`（`tauri.linux.conf.json`） |
| AppImage 引擎 status 127 | 外層 AppImage 的 `LD_LIBRARY_PATH` 弄壞系統工具 | 啟動引擎前還原環境（`src-tauri/src/appimage.rs`） |
| AppImage 第一手當機 | 沒打包 GStreamer 外掛，缺 `autoaudiosink` 讓 WebKitWebProcess 當掉 | `bundleMediaFramework`，CI 也檢查外掛 |
| 所有 Linux 版沒有音效 | WebKitGTK 的 `<audio>` 在 app 自己的網址上回報 `FormatError`，錯誤又被吞掉 | 改用 Web Audio（`src/ui/sounds.ts`） |
| Web Audio 只響第一聲 | 見下方 | 每個聲音開新的 AudioContext，播完就關 |
| 選單開到舊的 Python 版 | 捷徑是 `Exec=katrain`，`~/.local/bin` 排在 PATH 前面 | Linux 執行檔改名為 `katrain2`。**不要改用絕對路徑的捷徑範本**：AppImage 共用這份捷徑，會改去執行系統上裝的程式，沒裝就開不了（實際試過） |
| 框選區域後，下一次點棋盤被吃掉 | WebKit 在拖曳後沒送 `click`，用來吞掉那次 click 的旗標就留著 | mouse down 時清掉旗標（`src/ui/Board.tsx`）。Linux 上已驗證；macOS 同樣用 WebKit，可能也有這個問題，修正前後都沒測 |

覆蓋安裝後，如果 GNOME 選單還開到舊程式，是 GNOME Shell 記著舊的捷徑內容，重新登入就好（實際遇到過，這時 `gio launch` 已經會開到新版）。

G 之後框外還會有幾個低訪問數的建議點，這不是 bug：`game.ts` 會先跑一次不限區域的快速分析。已有的分析也不會因為框選而重算，要下一手之後才看得到效果。

**音效的實測數據**（AI 自動對弈，用 `parec` 錄輸出裝置的 `.monitor` 算聲數）

- 同一個 AudioContext、不 suspend，走 pulsesink：藍牙只有第一聲（AppImage 和 deb 都一樣），虛擬環繞輸出 0 聲，內建數位輸出正常。deb 用 `GST_PLUGIN_FEATURE_RANK=pipewiresink:MAX` 換成 pipewiresink 後，藍牙正常（12 秒 19 聲）。`PULSE_LATENCY_MSEC` 沒有效果。
- 同一個 AudioContext、每聲 suspend：AppImage 走內建輸出時間隔越拉越長（110 秒只有 10 聲），deb 走內建輸出正常（68 秒 123 聲）。
- 每聲新 context（現在的做法）：AppImage 和 deb 在藍牙、虛擬環繞、內建輸出都不再中斷。藍牙 24 秒分別 38、36 聲。只有 deb 走虛擬環繞比較少（14 秒 11 聲），原因沒查。
- **根本原因不明**：不知道為什麼同一個 context 走 pulsesink 只響第一聲，現在的做法是繞開它。
- **延遲**：使用者在藍牙耳機上感覺每手約慢 0.3 秒。PipeWire 回報藍牙輸出約 180 毫秒（不含耳機解碼）。從音訊串流建立到輸出端出現聲音，中位數 66 毫秒。使用者接受這個延遲。
- 自己用 Python + WebKit2 寫靜音探測程式不能當重現方式：它的 `resume()` 不管走哪個輸出都卡住，真正的 app 不會。請直接測真正的 app。

**沒測到**

`wss://`、沒有 FUSE 的系統、rpm、真正從「檔案」拖放、原生 Wayland 下的 G／中鍵／拖放（這些都是在 XWayland 測的）。

**已知但沒修**

- AppImage 的無障礙（AT-SPI）樹是空的，deb 正常，所以自動化工具讀不到 AppImage 的介面。
- Linux 和 Windows 內建的 KataGo 是 v1.18.1，macOS 是 v1.18.2。

**在 Linux 上自動化測試的限制**

- 用 `GDK_BACKEND=x11` 開 app，cua-driver 就看得到視窗，`delivery_mode:"foreground"` 的點擊、拖曳、按鍵都有效。AppImage 的無障礙樹是空的，要用座標操作。
- Xwayland 需要入口網站的遠端互動授權，**每個新的 cua-driver 工作階段都要重新授權**。沒授權時工具仍回報成功，但輸入沒有生效，要看截圖確認，然後請使用者按允許；授權前卡住的輸入可能之後才送到，所以要先確認盤面。
- 這台機器的 `/dev/uinput` 使用者可寫，但那會繞過遠端互動授權，使用者沒有同意，不要用。
- 判斷 AppImage 是否真的跑自己的程式，要看 `/proc/<pid>/exe` 是否在 `/tmp/.mount_*` 底下，系統上裝著 deb 時尤其要查。
- 不需要點擊的測試，可以用 AI 自動對弈的設定（兩邊都設成 `player:ai`）。
- 測音效要錄 `.monitor` 算聲數。用 `PULSE_SINK` 導到沒在用的輸出就不會吵到使用者，**但藍牙路徑一定要另外測**。
- Ubuntu 機器上沒有 `libwebkit2gtk-4.1-dev`，不能 `cargo check`，改 Rust 要靠 CI。Node 不在 PATH 上：`export PATH="$HOME/.openclaw/tools/node-v24.22.1/bin:$PATH"`。
- Ubuntu 機器全域 `~/.gitconfig` 的身分是 Gemini，不要改它。commit 請用 `git -c user.name=yongjer -c user.email=54315206+yongjer@users.noreply.github.com`。使用者同意過 commit 作者用這個身分；在其他機器 commit 前也先看 `git config user.name`。

**Ubuntu 機器上留下的東西**（repo 在 `~/code/katrain`）

- `ka-train` 套件還裝著（移除：`sudo apt remove ka-train`），設定檔和約 95 MB 的 app 資料（含擬人模型）在 `~/.config` 和 `~/.local/share` 的 `io.github.yongjer.katrain`。
- 舊的 Python 版 KaTrain（`uv tool`）沒有動，所以終端機打 `katrain` 開到的是它，新版要打 `katrain2`。
- 測試安裝檔和測試分支都刪了。要重新測 Linux，就從測試版頁面下載。

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

建議順序：

1. **Mac 實機測試（使用者已決定下一步做這個）**：這批 Linux 修正改到了共用的前端，而且有些項目從沒在 Mac app 裡測過。第 6 節有安裝方式和工具限制。依序：
   1. **安裝**：把 `KaTrain_2.0.0_aarch64.dmg` 換成測試版頁面上最新的版本，開啟後確認引擎有啟動、分析有結果。
   2. **框選後第一次點擊**：按 G，在棋盤上拖出一個方框，放開後立刻點框外一個**空點**，應該一次就下出棋子。沒下出來但再點一次就可以，就是修正無效（`src/ui/Board.tsx` 的 `justSelected`）。Linux 的問題是 WebKit 拖曳後沒送 `click`，Mac 的 WKWebView 不一定一樣；反過來也要注意：如果 Mac 拖曳後**有**送 `click`，放開滑鼠時不應該多下一手。
   3. **中鍵加入變化**：按 E 打開 Top Moves，把游標移到建議點上立刻按中鍵。棋譜樹（Analysis 分頁看得到）應該多一條變化，盤面不跳走，按右方向鍵確認第一手就是那個點。**MacBook Air 的觸控板沒有實體中鍵**：先看工具能不能送中鍵，不行就請使用者接滑鼠；都沒有就回報沒測到，不要跳過不說。
   4. **拖放棋譜**：從 Finder 把 SGF 拖進視窗，狀態列應該出現檔名，棋譜樹載入棋局。Mac 上沒有 repo 的話，可以從 https://github.com/yongjer/katrain/blob/tauri-v2/tests-ts/data/ogs.sgf 下載。（Ubuntu 上的 `test1.sgf` 已刪除。）
   5. **音效迴歸**：`src/ui/sounds.ts` 改過。Mac 走 `<audio>`，應該和以前一樣；請使用者親耳確認落子聲每手都有，中間停幾十秒再下也有。自動化工具聽不到聲音，所以這項一定要問使用者。
   6. **順手確認**：G 框選後的下一手，詳細分析應該在框內（框外幾個低訪問數的點是正常的，見第 3 節）；F2 全盤分析還能跑。
   - 測到問題就先修，推到測試分支並用手動 CI 打包驗證，**確認後再問使用者要不要合併進 `tauri-v2`**；合併會覆蓋 `tauri-nightly`。
2. **合併 PR #1 到 `main`**：Mac 測完後再問使用者。需使用者同意。合併前先補上 PR 說明裡缺的 Linux 修正。合併後要把 workflow 的 push 分支、nightly 條件從 `tauri-v2` 改成 `main`（或另外設計），並更新 README/DEVELOPMENT.md 裡提到 `tauri-v2` 的地方。
3. **Linux 剩餘測試**：主要流程已實測（第 3 節），還沒測的見該節「沒測到」，其中最值得先做的是沒有 FUSE 的系統和 `wss://`。
4. **Windows 實機測試**：**使用者沒有 Windows 電腦，目前做不到**，所以不要當成下一步建議。Windows 版只驗證到 KataGo 能從安裝檔啟動（第 3 節）；實機最可能出問題的是路徑、防毒、SmartScreen 和 OpenCL。有人能提供機器再做。
5. **正式發佈流程**：版本號統一（目前 `package.json` 和 `Cargo.toml` 是 `2.0.0-alpha.1`，`tauri.conf.json` 是 `2.0.0`，因為 MSI 不接受 prerelease 版本號）、推 tag 自動建正式版、Tauri updater 自動更新、macOS 簽章公證（需 Apple 開發者帳號）、Windows 簽章。
6. **Intel Mac 實機驗證**：需要有 Intel Mac 的人。
7. **還沒移植的功能**：在設定裡下載 KataGo 執行檔、參與分散式訓練（contribute mode）、主題與自訂快捷鍵、極簡 UI 模式（`~`/F12）。另外 PV 上捲動滑鼠逐手瀏覽、點棋子看該手詳細資料、雙擊跳轉也沒做。
8. **小問題**：選單中「Copy SGF」「Paste SGF / link」「KataGo log」三項沒有翻譯（原版沒有這些選單項目的字串）。
9. **音效的根本原因**：同一個 AudioContext 走 pulsesink 為什麼只響第一聲，目前只是繞開（第 3 節）。

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
| `src-tauri/src/appimage.rs` | 從 AppImage 啟動外部程式前還原環境變數 |
| `src-tauri/tauri*.conf.json` | 各平台打包設定（macOS 版含 katago-osx 與 katago-libs；Linux 版的執行檔叫 `katrain2`） |
| `src/ui/sounds.ts` | 音效：先用 `<audio>`，WebKitGTK 載入失敗就改用 Web Audio |
| `resources/` | Windows/Linux 的 KataGo、預設模型、KataGo 設定檔 |
| `scripts/build-katago-macos.sh` | 編 macOS 版 KataGo（本機在 Mac 上 build app 前也要先跑一次） |
| `scripts/engine-bridge.mjs` | 在一般瀏覽器開發 UI 時跑 KataGo 的本機橋接 |
| `.github/workflows/tauri.yml` | CI |
| `tests-ts/` | 單元與端對端測試、golden data、測試棋譜 |

Golden data 原本是用 Python 程式產生的。Python 程式碼已從分支移除，若要重產，可從移除前的 commit 取回：`git show 4361e15^:katrain/...`。

## 6. 使用者的 Mac（computer use 注意事項）

以下是之前在 Mac 上測試時的紀錄。工具名稱是當時雲端環境的，現在的環境不一定相同，請以實際可用的工具為準。

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

1. 取得程式碼：`git clone https://github.com/yongjer/katrain && cd katrain && git checkout tauri-v2`（必要時用 add_repo 取得 push 權限），確認 `git log` 裡有 `d6680db`。
2. `npm ci && npm run typecheck && npm test`，確認 109 個測試通過；需要時 `cargo test --manifest-path src-tauri/Cargo.toml`。
3. 讀 `DEVELOPMENT.md`（架構與指令）和本文件第 4 節。
4. 查 CI 與測試版狀態：
   - `gh run list --branch tauri-v2 --limit 5`
   - `gh api repos/yongjer/katrain/releases/tags/tauri-nightly --jq '.assets[].name'`
5. 使用者已決定接著做 **Mac 實機測試**（第 4 節第 1 項），用繁體中文確認一下就開始。測完回報時，請分清楚「實際操作過」「自動驗證」「沒測到」。
6. 任何要合併 PR、改 `main`、發正式版、刪檔的動作，都先問使用者。
