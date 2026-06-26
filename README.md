# VisemeSync

Deskbot **口型 / 表情** 可视化设计工具（纯静态前端，无 Node.js）。

音素与情绪已**统一为单个 JSON 文件**，顶层结构：

```json
{
  "name": "deskbot-default",
  "description": "…",
  "phonemes": [ { "name", "alias", "title", "frames": [{ "ms", "elements" }] } ],
  "emotions": [ { "name", "alias", "title", "frames": [{ "ms", "elements" }] } ]
}
```

- **phonemes**：说话时按音素/别名匹配口型（可含多帧过渡，如 `ai` → a 再 i）
- **emotions**：待机/交互情绪（idle、happy、angry 等），`alias` 可写 `default`、`standby` 等

仍兼容旧字段名 `phoneme_expressions` / `emotion_expressions`（导入时自动映射）。

## 本地预览

```bash
cd /home/mabaiming/work/src/VisemeSync
python3 -m http.server 8088
```

浏览器打开 http://127.0.0.1:8088/

> 需通过 HTTP 访问（不能直接 `file://` 打开），以便加载 `data/*.json`。

## GitHub Pages

1. 推送本仓库到 GitHub  
2. Settings → Pages → Source 选 `main` 分支 `/ (root)`  
3. 访问 `https://<user>.github.io/VisemeSync/`

## 功能概览

| 模块 | 说明 |
|------|------|
| **音素 phonemes** | 编辑 `name` / `alias` / `title` / 多帧 `frames` |
| **情绪 emotions** | 同上；内置 idle、happy、shy、angry、curious、alert、surprised、sad |
| **画布** | 默认 284×240，可改宽高 |
| **交互** | 拖动图元；Ctrl+滚轮缩放；属性面板改参数 |
| **导出** | 下载完整设计 JSON（`phonemes` + `emotions`） |
| **Agent** | 读写虚拟 `source.json`（即当前设计文档） |

## 图元类型

与 pb / OLED 协议一致：`round_rect`、`round_rect_outline`、`ellipse_fill`、`circle`、`line` 等。

## 目录

```
VisemeSync/
├── index.html
├── css/app.css
├── js/                  # app、oled-renderer、data-models、agent…
└── data/
    ├── deskbot-default.json   # 默认设计（phonemes + emotions）
    └── projects.json          # 项目列表
```

## 与 deskbot-server 集成

将导出的 JSON 复制为：

`brufik_in_one/service/deskbot-server/data/deskbot-face.json`

服务端优先加载该文件：

- TTS 口型：按 `phonemes[].name` / `alias` 匹配，使用对应帧的完整 `elements`（眼/鼻/嘴一体）
- 表情场景：使用 `emotions` 列表（支持 `alias`，如 `idle` ↔ `default`）

若不存在 `deskbot-face.json`，仍回退到旧的 `face_mouth_by_phoneme.json` + `face_expr_scenes.json`。

## 迭代建议

- [ ] 音素多帧在时间轴上随 TTS 片长 scrub 预览
- [ ] 从旧版 `face_mouth_by_phoneme.json` 一键迁移导入
- [ ] RGB565 / 256 色调色板增强
