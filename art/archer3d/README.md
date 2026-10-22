# 弓手 3D 模型

流程：`concept/ref2_F.png`（参考图）→ Tripo 图生 3D（`model/gen_v1`）→ 绑骨 v1.0（`model/rig_v1`）
→ 预设动作重定向（`model/anim_*.glb`）。3D 渲染器（`client/src/three/webModels.ts`）直接加载这些 glb。

- Tripo 预设里能用的：idle、walk、hit（受击）、fall（倒地，起身用倒放）。shoot、hurt、jump 不能用（坐着、挥手）。
- 手：Tripo 绑骨没有手指骨，手是张开的平板，两面都有皮肤，绕前臂转 180° 看起来几乎一样。
- 积分：试验用掉 150，余 190（v2.5 绑骨重定向报错 1004，白花 25；人形要用绑骨 v1.0）。
- 早先用 Blender 把它渲成 2D 图集、给 PixiJS 版用的脚本（`blender/render.py`、`pack.py`、`rig2d.py`）
  已随 PixiJS 一起移到 `leftovers/art/archer3d/blender/`（2026-10-22）。
