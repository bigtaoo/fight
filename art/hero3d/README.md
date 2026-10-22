# 主角 3D 模型

流程：`concept/ref2_D_front.png`（正面 A 姿参考图）→ Tripo 图生 3D（`model/gen_v1`）→ 绑骨 v1.0（`model/rig_v1`）。
3D 渲染器（`client/src/three/webModels.ts`）直接加载 `model/rig_v1.glb`。

早先把它切成 2D 剪纸骨骼、给 PixiJS 版用的流程（`blender/rig2d.py`、`rig2d_spec.py`、`tools/pack_tao.py`、
套用 `art/rig_r3` 的动作）已随 PixiJS 一起移到 `leftovers/`（2026-10-22，按原路径存放）。
