# Katraineo

Katraineo is a tool for analyzing games and playing go with AI feedback from KataGo:

* Review your games to find the moves that were most costly in terms of points lost.
* Play against AI and get immediate feedback on mistakes with option to retry.
* Play against a wide range of weakened versions of AI with various styles.
* Automatically generate focused SGF reviews which show your biggest mistakes.

Katraineo is a desktop app built with [Tauri v2](https://v2.tauri.app/), React and TypeScript, ported from the
original Python + Kivy [KaTrain by Sander Land](https://github.com/sanderland/katrain). It plays, analyzes and saves
games the same way, uses the same settings and translations, and reads and writes the same SGF files, including
KaTrain's saved analysis. See [DEVELOPMENT.md](DEVELOPMENT.md) for how it is built.

## Manual

- [Installation](#install)
- [Configuring KataGo](#kata)
- [Play against AI](#ai)
- [Analysis](#analysis)
- [Keyboard and mouse shortcuts](#keyboard)
- [FAQ](#faq)
- [Credits](#credits)

## <a name="install"></a> Installation

Test builds for Windows, macOS (Apple Silicon and Intel) and Linux are on the
[`tauri-nightly` release](https://github.com/yongjer/katraineo/releases/tag/tauri-nightly):

* **macOS**: open the `_aarch64.dmg` (Apple Silicon) or `_x64.dmg` (Intel) and drag Katraineo to Applications.
  The build is not signed, so the first time, open it from Finder with right click → Open
  (or allow it under System Settings → Privacy & Security).
* **Windows**: run the `.msi` or `-setup.exe` installer. SmartScreen may warn about an unknown publisher; choose
  *More info* → *Run anyway*.
* **Linux**: install the `.deb`, or make the `.AppImage` executable and run it (this needs FUSE: on Ubuntu or Debian,
  `sudo apt install libfuse2t64`, or `libfuse2` on older versions).

## <a name="kata"></a> Configuring KataGo

Katraineo comes with KataGo and the `b10c384h6nbt` transformer model, which is stronger per visit than the strongest
18 block models while being about as fast. KataGo uses the Metal backend on Apple Silicon Macs (macOS 15 or later),
and OpenCL on Windows, Linux and Intel Macs (macOS 11 or later).

Open *General & Engine Settings* (F8) to configure the engine. The selected tab decides which engine is used:

* **Local engine**: the KataGo executable, model, human-like model and KataGo config file. *Download Models* offers
  the human-like model and the latest and strongest models from KataGo's distributed training.
  For other hardware, KataGo has versions on [its release page](https://github.com/lightvector/KataGo/releases):
  CUDA and TensorRT for NVIDIA GPUs, ROCm for AMD GPUs, ONNX for Intel GPUs/NPUs or DirectML,
  and Eigen for computers without a usable GPU. Download one and set the KataGo path to it.
* **Remote engine**: a `ws://` or `wss://` URL of a KataGo analysis engine served over a WebSocket. Katraineo reconnects
  automatically if the connection drops, and resumes the analysis that was in progress.
* **Custom command**: the full command that starts the analysis engine, e.g. to run it over ssh.

Keep in mind that Katraineo uses the *analysis engine* of KataGo, and not the GTP engine.
[ENGINE.md](ENGINE.md) helps when KataGo does not start.

## <a name="ai"></a> Play against AI

* Select the players at the top of the side panel, or under 'New Game'.
* In a teaching game, Katraineo will analyze your moves and automatically undo those that are sufficiently bad.
* When playing against AI, note that the "Undo" button will undo both the AI's last move and yours.
* In play mode the side panel shows the game clock; set main time and byo-yomi under *Timer Settings* (F5).

### Instant feedback

The dots on the move indicate how many points were lost by that move.

* The colour indicates the size of the mistake according to KataGo
* The size indicates if the mistake was actually punished. Going from fully punished at maximal size,
  to no actual effect on the score at minimal size.

In short, if you are a weaker player you should mostly focus on large dots that are red or purple,
while stronger players can pay more attention to smaller mistakes. If you want to hide some colours
on the board, or not output details for them in SGFs, you can do so in the teaching settings.

### AIs

In the 'AI settings', settings which have been tested and calibrated are at the top,
changing these will show an estimate of rank.
This estimate should be reasonably accurate as long as you have not changed the other settings.

* Recommended options for serious play include:
    * **KataGo** is full KataGo, above professional level. The analysis and feedback given is always based on this full strength KataGo AI.
    * **Calibrated Rank Bot** was calibrated on various bots (e.g. GnuGo and Pachi at different strength settings) to play a balanced
     game from the opening to the endgame without making serious (DDK) blunders.
    * **Simple Style** prefers moves that solidify both players' territory, leading to relatively simpler moves.
    * **Human-like** and **Historical Pro** use KataGo's human-trained model to imitate human players of a given rank,
      or professional players from a given era. To enable them, download the 'Human-like model' under 'Download Models'
      and select it as the human-like model in the engine settings.
* Legacy options which were developed earlier include:
    * **ScoreLoss** is KataGo analyzing as usual, but
      choosing from potential moves depending on the expected score loss, leading to a varied style with mostly small mistakes.
    * **Policy** uses the top move from the policy network (it's 'shape sense' without reading).
    * **Policy Weighted** picks a random move weighted by the policy, leading to a varied style with mostly small mistakes, and occasional blunders due to a lack of reading.
    * **Blinded Policy** picks a number of moves at random and play the best move among them, being effectively 'blind' to part of the board each turn. Calibrated rank is based on the same idea, and recommended over this option.
* Options that are more on the 'fun and experimental' side include:
    * Variants of **Blinded Policy**, which use the same basic strategy, but with a twist:
       * **Local Style** will consider mostly moves close to the last move.
       * **Tenuki Style** will consider mostly moves away from the last move.
       * **Influential Style** will consider mostly 4th+ line moves, leading to a center-oriented style.
       * **Territory Style** is biased in the opposite way, towards 1-3rd line moves.
    * **KataJigo** is KataGo attempting to win by 0.5 points, typically by responding to your mistakes with an immediate mistake of its own.
    * **KataAntiMirror** is KataGo assuming you are playing mirror go and attempting to break out of it with profit as long as you are.

The Engine based AIs (KataGo, ScoreLoss, KataJigo) are affected by both the model and choice of visits and maximum time,
 while the policy net based AIs are affected by the choice of model file, but work identically with 1 visit.

## <a name="analysis"></a> Analysis

| Key            | Short Description                      | Details |
| -------------- | -------------------------------------- | ------- |
| <kbd>Tab</kbd> | Switch between analysis and play modes | AI moves, teaching mode and timers are suspended in analysis mode. The analysis options are saved separately for 'play' and 'analyze'. |

The toggles at the top of the screen:

| Key          | Short Description     | Details |
| ------------ | --------------------- | ------- |
| <kbd>q</kbd> | Child moves are shown | Turn it off when you want to guess the next move. |
| <kbd>w</kbd> | Show all dots         | Coloured evaluation 'dots' on the last few moves. Thresholds and how many moves they are shown for are in the teaching settings. |
| <kbd>e</kbd> | Top moves             | The next moves KataGo considered, colored by their expected point loss. Small/faint dots have few visits. Hover over any of them to see the principal variation. |
| <kbd>r</kbd> | Policy moves          | KataGo's policy network: where it thinks the best next move is without any 'reading'. |
| <kbd>t</kbd> | Expected territory    | Expected ownership of each intersection. |

The options under 'Analysis Options' are used for deeper evaluation of the position:

| Key                | Short Description       | Details |
| ------------------ | ----------------------- | ------- |
| <kbd>a</kbd>       | Deeper analysis         | Re-evaluate the position using more visits. |
| <kbd>s</kbd>       | Equalize visits         | Re-evaluate all currently shown next moves with the same visits as the current top move. |
| <kbd>d</kbd>       | Analyze all moves       | Evaluate all possible next moves, using 'fast visits'. |
| <kbd>f</kbd>       | Find alternatives       | Search again while excluding the current candidate moves. |
| <kbd>g</kbd>       | Select area of interest | Drag a box to search only for moves in it, e.g. for tsumego. Select a single point to clear it. |
| <kbd>h</kbd>       | Reset analysis          | Revert the analysis to what a normal query returns. |
| <kbd>i</kbd>       | Insert mode             | Insert moves, e.g. an exchange both players ignored. Press again to stop inserting and copy the rest of the branch. |
| <kbd>l</kbd>       | Play out the game       | Play the game to the end as a collapsed branch, to see the effect of mistakes. |
| <kbd>Space</kbd>   | Continuous analysis     | Keep improving the analysis of the current position while there are no other queries. |
| <kbd>Enter</kbd>   | AI move                 | The AI moves for the current player regardless of the player selection. |
| <kbd>F2</kbd>      | Deeper full game analysis | Analyze the entire game, or a range of moves, or only the mistakes, with more visits. |
| <kbd>F3</kbd>      | Performance report      | Accuracy, point loss and agreement with the AI for both players, for the whole game, opening, midgame or endgame. |
| <kbd>F10</kbd>     | Tsumego frame           | After placing a life and death problem in a corner or on a side, fill the rest of the board so the AI focuses on it. |
| <kbd>Escape</kbd>  | Stop all analysis       | |

## <a name="keyboard"></a> Keyboard and mouse shortcuts

In addition to the shortcuts above and those shown in the menus:

| Key                                   | Short Description |
| ------------------------------------- | ----------------- |
| <kbd>k</kbd>                          | Toggle display of board coordinates |
| <kbd>m</kbd>                          | Toggle display of move numbers |
| <kbd>p</kbd>                          | Pass |
| <kbd>Pause</kbd>                      | Pause/resume the timer |
| <kbd>←</kbd> or <kbd>z</kbd>          | Undo move (hold shift for 10 moves, ctrl to go to the start) |
| <kbd>→</kbd> or <kbd>x</kbd>          | Redo move (hold shift for 10 moves, ctrl to go to the end) |
| <kbd>↑</kbd>/<kbd>↓</kbd>             | Switch branch |
| <kbd>Home</kbd>/<kbd>End</kbd>        | Go to the beginning/end of the game |
| <kbd>PageUp</kbd>                     | Make the current branch the main branch |
| <kbd>Ctrl</kbd> + <kbd>Delete</kbd>   | Delete the current node |
| <kbd>c</kbd>                          | Collapse/uncollapse the branch from the current node to the previous branching point |
| <kbd>b</kbd>                          | Go back to the previous branching point (shift: back to the main branch) |
| <kbd>n</kbd>                          | Go to one move before the next mistake by a human player (shift: the previous mistake) |
| Scroll over the board                 | Redo/undo move |
| Middle click on a top move            | Add its principal variation to the move tree |
| Right click in the move tree          | Delete, make main branch, collapse or prune |
| Drop a file onto the window           | Load that game (`.sgf`, `.gib` or `.ngf`) |
| <kbd>Ctrl</kbd> + <kbd>v</kbd>        | Load an SGF, or a link to one, from the clipboard |
| <kbd>Ctrl</kbd> + <kbd>c</kbd>        | Copy the game as SGF to the clipboard |

## <a name="faq"></a> FAQ

* The program is running too slowly. How can I speed it up?
  * Adjust the number of visits or maximum time allowed in the settings.
* KataGo crashes with "out of memory" errors, how can I prevent this?
  * Try using a lower number for `nnMaxBatchSize` in the KataGo config file, and avoid using versions compiled with large board sizes.
  * If you don't have a GPU, or your GPU does not support OpenCL, use KataGo's Eigen (CPU) version.
  * The *KataGo log* in the main menu shows KataGo's own messages, which usually explain the problem.

## <a name="credits"></a> Credits

KaTrain was created by [Sander Land](https://github.com/sanderland/) with many contributors and translators,
see [CONTRIBUTIONS.md](CONTRIBUTIONS.md). KataGo is by David Wu ("lightvector").
