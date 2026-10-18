# 中国象棋 · 好友对战 (H5)

微信好友联机中国象棋，**完整规则 + 服务端权威校验**，免安装、发链接即玩。
与「五子棋」「国际象棋」同一套架构（Node + WebSocket）。

## 玩法

1. 点「创建房间」→ 生成 4 位房间号 + 分享链接/二维码
2. 把链接或二维码发到微信，好友点开自动进同一房间
3. 红方先手，轮流落子；支持悔棋协商、提议和棋、认输、再来一局（交换先后手）、表情互动

## 规则完整支持

- 车马炮相仕帅兵全部标准走法：**蹩马腿、塞象眼、炮架吃子（隔一打一）、相/象不过河、兵过河才能横走、不能后退**
- **飞将（将帅照面）**：走子后两将同列无遮挡即违规（含「制造照面」「将主动走入照面线」两种判定）
- 将军提示、将死判负、困毙判负
- 中文记谱（炮二平五 / 马8进7 风格）

> 引擎正确性经 **perft 标准计数验证：开局 perft(1)=44、perft(2)=1920**，与国际公认值完全一致。

## 技术架构

- `public/xiangqi-engine.js`：**UMD 单份规则引擎**，服务端 `require` 与浏览器 `<script>` 加载同一份代码，前后端规则零分歧
- `server.js`：HTTP 静态资源 + WebSocket 房间；所有写操作（落子/悔棋/认输/和棋/重开）在服务端用引擎校验，前端无法作弊
- 断线重连：掉线玩家重新进入自动恢复原颜色与局面
- 端口读 `process.env.PORT`，适配 Render / Railway 等免费云

## 本地运行

```bash
npm install
npm start
# 打开 http://localhost:3000
# 两个浏览器标签页对下；或 ?demo=1 进入沙盒试玩
```

## 部署到云端（Railway 免费额度，无需绑卡）

1. 把本仓库推到你的 GitHub
2. 打开 https://railway.app → **Login with GitHub**
3. **New Project → Deploy from GitHub repo** → 选择本仓库
4. 构建完成后 **Settings → Domains → Generate Domain**
5. 拿到 `https://xxx.up.railway.app` → 发微信即玩

Railway 免费计划：$0/月、每月赠 $1 额度，无需信用卡；此轻量服务可长期免费运行。

## 文件结构

```
xiangqi-h5/
├── server.js               # HTTP + WebSocket 房间 + 权威校验
├── package.json
├── render.yaml             # Render 一键部署配置（备用）
└── public/
    ├── index.html          # 单文件前端（canvas 棋盘 + 分享 + 音效）
    └── xiangqi-engine.js   # UMD 规则引擎（前后端共用）
```
