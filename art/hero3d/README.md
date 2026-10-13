# 主角 3D 建模 → 2D 剪纸骨骼（水墨）

做法和弓手一样（见 `art/archer3d/README.md`）：3D 只是生产工具，游戏里仍是统一的 2D 剪纸骨骼。
动作不重做，直接用原来画的主角（`art/rig_r3/anims.py`）的全部 25 个动作，只换部件图。
游戏里 `?rig3d` 开关（`client/src/game/Game.ts`），不加参数仍是原来的纯色剪纸。

流程：`concept/ref2_D_front.png`（正面 A 姿参考图）→ Tripo 图生 3D（`model/gen_v1`）→ 绑骨 v1.0（`model/rig_v1`）
→ `blender/rig2d.py` 摆成 rig_r3 的静止姿势，按顶点组切部件，按水墨风格逐件渲染 → `rig2d_spec.py` 裁图、量静止角度和腿长，
套上 rig_r3 的动作 → `tools/pack_tao.py` 打包。

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$B" -b --python art/hero3d/blender/rig2d.py -- parts <tmp>     # 部件图 + rest.json
"$B" -b --python art/hero3d/blender/rig2d.py -- debug <tmp>     # full.png 整身、cut.png 部件分色，调切分用
python -I art/hero3d/rig2d_spec.py <tmp>
python -I tools/pack_tao.py art/rig_hero3d/hero_tao.json art/rig_hero3d/hero.tao client/public/art/hero_rig3d
python -I tools/anim_sheet.py client/public/art/hero_rig3d <png> idle:2 walk:4 run:4 atk1:4   # 每个动作至少 2 帧
```

- 尺寸对齐 rig_r3 的画：渲染图里鞋底到发髻 1042 px、鞋底在 y 1115，打包缩放 0.34，所以动作里的位移不用改。
- 部件：没有脚（鞋算小腿），多出袍子（腰带以下的下摆）、腰带前垂的布片（sash）、围巾（scarf）。
  这三件按位置和颜色从网格里切：围巾是红色；sash 是腰带以下、胯部中线之前的前片；
  袍子是 `HEM_Z` 以上、离大腿骨超过 `TROUSER` 的布。膝盖上方（`STRIPS_Z` 以下）下摆的碎布贴着腿，
  那一段只把 `STRIPS_TROUSER` 以内的裤腿芯留给大腿，不然大步跨开时碎布跟着大腿走。
- 大腿：模型在袍子底下几乎没有完整的裤腿面，切出来是碎片。`rig2d_spec.py` 的 `trouser()` 把大腿补成一条锥形胶囊
  （膝盖处和小腿顶上的裤腿一样宽，胯部宽 1.25 倍），有渲染像素的地方用原图，其余用最近的布色补，外圈描 9px 墨边；
  小腿膝盖以上的碎布在 30px 内淡出，盖在大腿的圆头上。
- 剑：模型手里是空的，剑在 `rig2d.py` 里程序生成（剑身、剑格、剑柄、剑首），墨黑，剑柄偏暖；剑挂在前手下面。
- 手：渲染出来比头显得大，`rig2d_spec.py` 里按手腕缩到 0.85，剑跟着手的支点移。
