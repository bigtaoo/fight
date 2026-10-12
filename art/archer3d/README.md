# 弓手 3D 预渲染试验

流程：`concept/ref2_F.png`（参考图）→ Tripo 图生 3D（`model/gen_v1`）→ 绑骨 v1.0（`model/rig_v1`）
→ 预设动作重定向（`model/anim_*.glb`）→ Blender 渲染帧 → 打图集 → 游戏里 `?archer3d` 开关。

- Tripo 预设里能用的：idle、walk、hit（受击）、fall（倒地，起身用倒放）。shoot、hurt、jump 不能用（坐着、挥手）。
- 射箭（34 tick，第 21 tick 放箭）在 `blender/render.py` 里手工 K 帧；弓、弦、箭都是程序生成的曲线，没有让 Tripo 建模。
- 重做帧：

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for c in "idle 17" "walk 17" "hit 9" "fall 12" "shoot 0"; do set -- $c; "$B" -b --python art/archer3d/blender/render.py -- $1 <tmp>/$1 $2 384; done
python art/archer3d/blender/pack.py <tmp> client/public/art/archer3d   # atlas.webp, about 0.6 MB
```

- 水墨风格（不花积分，全在本地）：`render.py` 把材质换成两阶色块（亮/暗，暗面 0.62，饱和度 0.8，自发光不受环境光），
  反向外壳描边（Solidify 翻法线 + 背面剔除，墨色）；`pack.py` 再沿外轮廓补 2px 墨边，补上网格接缝处的断线。
  Blender 5.2 的 EEVEE 下 Freestyle 画不出线，别用。预览：`model/preview/v3_ink.png`。
- 手：Tripo 绑骨没有手指骨，手是张开的平板。`render.py` 在编辑模式下给每只手加两节手指骨（按沿手轴的投影切权重），
  `hand(side, turn, curl)` 先按掌心方向转手（扭转分摊到前臂两节 twist 骨上）再弯指；拉弦手的弯指是射箭关键帧里的 `rc`。
- 手指方向：手掌朝骨骼左 -x、右 +x（拇指在掌侧）；v4（`model/preview/v4_hands.png`）弄反了，手指往手背弯，握不住弓。
  握弓手瞄准时把掌心转向身前，四指竖着绕过弓把；拉弦手掌心朝脖子；拉满时手肘抬在身后、和箭一线。
  调试特写：`ARCHER_FOCUS=L_Hand ARCHER_VIEW=90 ARCHER_TICKS=8,20`（骨骼、镜头绕 Z 的角度、射箭帧）。预览：`model/preview/v5_grip.png`。
- 积分：试验用掉 150，余 190（v2.5 绑骨重定向报错 1004，白花 25；人形要用绑骨 v1.0）。
