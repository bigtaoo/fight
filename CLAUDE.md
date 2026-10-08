# dnf（暂名）— 会话规则

DNF 式 2.5D 横版动作页游，PixiJS v8，目标平台网页 + 微信小游戏。水墨美术，AI 出图。
整体方案见 [`design/README.md`](design/README.md)，当前阶段（最小化验证）见 [`design/MVP.md`](design/MVP.md)。

## 语言

- 对用户说话：中文。
- 代码、注释、commit message：英文。
- 设计文档（`design/`）：中文。

## 参考项目（先看这里，别重新发明）

- `D:\funny`：30Hz 定点 lockstep 引擎（`server/engine`）、节拍器中继（`server/gameserver`）、
  录像与复算（`judgeRunner`、`runHeadless`）、protobuf 协议（`server/contracts`）、骨骼编辑器（`tools/animator`）。
- `D:\standing`：PixiJS v8 + Vite + 微信小游戏适配、确定性引擎包 `engine/`、AI 出图流程
  （`tools/`：Mistral FLUX 出图、抠图、骨骼拆件、打包、可读性测试；经验在 `art/**/README.md`）。
- `D:\daydayup`：standing 的客户端平台层来源（微信适配、骨骼动画运行时）。

## 硬规则

- 游戏逻辑只放在 `engine/`：30Hz 固定步长、整数/定点状态（`FP_SCALE=1000`），只由玩家指令驱动；
  禁用 `Math.random`、`Date.now`、浮点三角/开方；不 import 引擎外的任何东西。客户端只画状态、消费事件。
- 判定框、招式帧数据属于引擎数据，不能从渲染骨骼实时推导（服务器要能无头复算）。
- 掉落、背包、结算只由服务器决定；客户端上报的任何结果都不可信。
- 出图密钥在 `~/.vibe/mistral_curl_key*.conf`，绝不进仓库。每张图的 prompt 存成同名 `.txt` 放在图旁边。
