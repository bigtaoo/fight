# leftovers：PixiJS 版留下的旧资源

2026-10-22 游戏改成只用 Three.js 3D 渲染（提交 1a087aa），PixiJS 版的代码和资源从原位置删掉，原样存到这里，
目录结构和原来的路径一一对应（`leftovers/<原路径>`）。这里的东西不参与构建、类型检查和测试，脚本里的相对路径也都还是原来的，
要再用得先搬回原位置。

- `client/src/game/`：2D 渲染代码（`bodyView`、`fx`、`itemView`、`scenery`、`shotView`、`sprites`、`layout`、`tao/` 剪纸骨骼运行时），依赖 `pixi.js`。
- `client/public/art/`：2D 角色图集和骨骼包（主角、山贼、弓手、盾兵、寨主、3D 转 2D 的主角和弓手、姿势帧）。
- `art/rig_*`、`art/poses_r3`：剪纸骨骼的源文件（A-pose 原图和 prompt、拆件、动作脚本、`.tao`）。
- `art/archer3d/`、`art/hero3d/`：把 Tripo 3D 模型渲成 2D 部件 / 图集的 Blender 脚本。
- `tools/`：只给 2D 流程用的工具（`pack_tao`、`pack_sprites`、`split_parts`、`rigpose`、`mannequin`、`draw_sword`、`anim_sheet`、`pose_test`、`rig_scene_test`）。

流程说明见 `design/ART.md`（R3 各节）。被改写而不是删除的文件（`Game.ts`、`hud.ts`、菜单和面板等）的 PixiJS 旧版本只在 git 历史里（1a087aa 之前）。
