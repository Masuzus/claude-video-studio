---
name: video-studio
description: 用代码绘制动画来制作短片、动画、MV 或科普视频：先给用户出多种画风样片（水彩、手绘墨线、像素等）供选择，再完成脚本分镜、逐镜头动画、音效、GPU 渲染和成片剪辑。
---

# Video Studio：代码绘制动画短片的完整流程

画面由代码逐帧绘制：用 JavaScript 写镜头，在无头 Chrome 里按选定的**风格**渲染，再用 ffmpeg 合成声音和字幕。引擎和工具在 GitHub 仓库 **Masuzus/claude-video-studio**：

- `engine/`：风格无关的核心 `core.js`，以及 `styles/watercolor.js`、`ink.js`、`pixel.js`
- `tools/`：`render.mjs`（渲染）、`sfx.py`（音效合成）、`assemble.py`（剪辑合成）、`render_film.bat`（Windows 双击渲染）
- `examples/spirochete`：一个 8 秒示例镜头
- `docs/ENGINE.md`：API 参考和规则；`docs/STYLES.md`：风格说明，以及如何新增风格

**开工前先读 `docs/ENGINE.md`**，它比本文更细。下面是流程和踩过的坑。

## 0. 准备环境

1. 在自己的工作目录克隆引擎：`git clone --depth 1 https://github.com/Masuzus/claude-video-studio studio`。如果仓库是私有的，先用 add_repo 挂载。
2. **不要在云端容器里 `npm install`**，npm 仓库会返回 403。`render.mjs` 会自动退回使用全局安装的 Playwright；容器没有显卡，要加 `--soft`。p5 和 p5.brush 已经放在 `engine/vendor/`，不需要另外下载。
3. `sfx.py` 和 `assemble.py` 在容器里运行，已有 numpy、scipy，以及带 libass 的 ffmpeg 和 Noto CJK 字体。

## 1. 了解需求（开工前一次问清）

用 AskUserQuestion 问，已知的不用再问：
- 主题和核心信息
- 成片时长、截止日期、参赛规格（分辨率、时长上限、是否要求标注 AI）
- 观众、语言，要不要旁白或字幕
- 已有素材
- 哪些画面必须写实。写实人物、名画"活化"、实拍质感这类画面代码画不出来，要交给 AI 视频模型，本流程只负责给它们写提示词，并在最后剪进成片。

## 2. 选风格：用用户自己的题材出样片

不要只用文字描述风格，要让用户看到效果：
1. 建一个探针项目 `probe/scenes.js`：只画这部片最有代表性的一个画面，比如主角加背景加一行标题，约 40–80 行代码，2–3 秒，带一点镜头运动。
2. 渲染风格样片：`node studio/tools/render.mjs --project=probe --soft --board=0.5,1.5,2.5 --styles=watercolor,ink,pixel`，输出 `probe/out/style_board.jpg`。在容器里每种风格约 1–2 分钟。
3. 用 Read 看一遍样片，确认三种风格都正常，再用 SendUserFile 发给用户，并逐一说明：
   - **watercolor（水彩）**：水彩晕染、会颤动的墨线、纸纹。适合温暖、诗意、绘本、医学史或历史插画、MV。
   - **ink（手绘墨线）**：钢笔素描、排线、浅色调。适合笔记本、科学手稿、纪录片图解。深色场景会变成浅色素描。
   - **pixel（像素）**：低分辨率色块、色阶或网点抖动、扫描线。适合复古游戏感、轻松的科普、微观"精灵"世界。
4. 用 AskUserQuestion 让用户选。可以整片一种风格，也可以按章节混搭，比如微观段落用水彩、数据段落用像素。
5. 如果用户想要的风格还没有（水墨、版画、剪纸、Riso 印刷、黑板、老电影等），按 `docs/STYLES.md` 的"Adding a style"新增一个风格文件。新风格要先用 `examples/spirochete` 出样片验证，再给用户看。新增的风格要推回仓库，方便以后复用。

## 3. 脚本和分镜

在片子的文件夹里写 `STORYBOARD.md`，给用户审稿，**确认后再动手画**：
- 按章节列出：起止时间、旁白原文、画面描述、镜头运动、转场方式、音效要点。
- 每个镜头标明**制作方式**：`code`（本引擎）、`ai-video`（AI 视频平台）或 `still`（静帧）。
- `ai-video` 镜头要写好可以直接粘贴的提示词：主体、动作、镜头、光线、风格、时长、比例。说明如何保持角色和画风一致，比如用参考图、固定风格词。建议每个镜头多生成几次，挑最好的。
- 设计上，**每个镜头里都要有事情发生**；转场要有动机；文字尽量少。旁白放字幕，不要写成画面里的文字。

## 4. 逐镜头制作（code 镜头）

片子文件夹结构：
```
<film>/
  studio/                 ← 引擎副本
  shots/01_xxx/scenes.js  ← 每章或每段一个项目；可在 project({ style }) 里指定风格
  shots/01_xxx/cues.json → sound.wav
  ai/  audio/  stills/    ← AI 视频片段、旁白和配乐、静帧
  STORYBOARD.md  edit.json  subs.srt
  render_film.bat         ← 从 studio/tools/ 复制过来
```
每个镜头按这个循环做：
1. 写 `scenes.js`：先写 `project({...})`，把大背景放进 `plate()`，再写 `shot(...)`。
2. 出预览图：`node studio/tools/render.mjs --project=shots/01_xxx --soft --sheet=<6–9 个时间点>`。
3. 用 Read 看预览图，自己挑问题并修改。
4. 把满意的预览图发给用户，让他能及时调整方向。

规则：
- 每一帧必须是时间 t 的纯函数，画满整帧。不能用 `Math.random()`，用 `hash(i)` 和 `jit(a)`。
- 调色板控制在 10–18 色。
- 让镜头节奏和音效使用同一组时间数字，比如心跳函数和 cues 里的心跳时间一致，声画才对得上。
- 章节多时可以用子 agent 并行，每个子 agent 负责一个章节文件。先写一份简短的动画规范交给它们（风格、调色板、角色、共用函数），只许改各自的文件。

## 5. 声音

- **旁白**：请用户用配音工具（剪映、ElevenLabs 等）生成，或自己录音，放进 `audio/`。可以先根据分镜给出旁白稿和语气说明。
- **配乐**：用 AI 音乐平台（Suno 等）或正版曲库。给用户写好风格、BPM、情绪弧线的提示词。
- **音效**：用 `sfx.py` 按 cues.json 合成，支持 drone、bed、whoosh、riser、glide、heartbeat、boom、bell、tink、tick、file。每个镜头一份，渲染时自动合进该镜头的 MP4。用频谱图（ffmpeg showspectrumpic）和 volumedetect 检查结果。

## 6. 渲染

- **优先用用户的 GPU**：水彩和墨线在 GPU 上每帧约 0.1 秒（实测 RTX 3060 Ti），在容器里要 10 秒以上。像素风在哪里都快。
- 如果会话连着用户电脑，且电脑有显卡、Node.js 和 Chrome 或 Edge：
  1. 用 device_commit_files 把 `studio/`（engine、tools、docs，不含 examples 的输出）、`shots/` 和 `render_film.bat` 写进用户的片子文件夹。每次调用最多 50 个文件，要分批。
  2. 终端对我只开放点击，不能输入命令，所以**请用户双击 `render_film.bat`**。第一次运行会自动 `npm install` puppeteer-core 和 ffmpeg-static。
  3. 用 device_stage_files 读 `shots/*/out/render_log.txt`，确认 GPU 型号和每帧耗时。再抽一个 MP4，用 ffmpeg 截帧检查画面。
- 在容器里渲染：`--soft --all`，放后台运行（nohup），用每次不超过 10 分钟的 sleep 轮询日志。**不要用 `pkill -f <某段命令>`**，它会把自己的 shell 一起杀掉。

## 7. 剪辑合成

- 写 `edit.json`（格式见 `tools/assemble.py` 顶部）和 `subs.srt`，然后在容器里运行 `python studio/tools/assemble.py edit.json`。支持硬切或交叉淡化、全片淡入淡出、旁白压低配乐、烧录字幕。
- 检查：抽取每个剪辑点前后的帧，确认总时长、分辨率和音量，确认符合参赛规格。
- 交付：用 SendUserFile 发出成片。连着用户电脑时，也写一份到片子文件夹。

## 工期参考（4 分钟成片，约一半 code、一半 AI 视频）

- 我的工作时间大约 12–20 小时，日历时间 3–5 天，瓶颈是用户审稿和 AI 平台生成。
- 在 GPU 上渲染整片只要十几分钟；只在容器里渲染水彩，一分钟成片就要 4–5 小时。

## 已踩过的坑

- p5 必须用**实例模式**。全局模式会和引擎的 `text`、`stroke`、`lerp` 冲突，报 "Cannot redefine property"。
- p5 在 `setup()` 返回之前会忽略 `redraw()`，所以 plate 要在 setup 结束后再烘焙（已在 watercolor.js 里处理）。
- 全屏水彩晕染在 CPU 上每次要几秒到十几秒。背景一律做成 plate，每帧只叠加便宜的平涂和线条。
- 字体用列表兜底：`"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", serif`。容器里有 Noto CJK，Windows 上有宋体或雅黑。
- 像素风里半透明区域不要逐形状做抖动，会满屏网点。先正常混色，再统一量化到调色板（已实现），抖动强度用 `pixel.dither` 控制。
- 墨线风格里，浅色线条和文字会自动转成墨色，大面积深色只淡淡上色。这是有意的设计。
