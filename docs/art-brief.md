# 河流世界 · 水墨素材需求

给出图的 agent 用。素材会被代码切成图层，再按时间、透视摆放和着色，所以**格式要求比画面本身更要紧**。

## 统一要求（每张都适用）

- **纯白背景，只用黑色墨**：不要彩色、不要宣纸纹理、不要印章、不要题字、不要边框。
  代码会把“白”当成透明、“墨的深浅”当成不透明度，再按钟点染色（白天浓墨、黄昏暖色、夜里月光灰）。背景不是纯白就抠不干净。
- **主体完整，四周留足白边**：不要被画面边缘裁掉，主体之间不要相互遮挡或粘连。
- **同一批风格一致**：每条提示词都带上下面这段“风格锚点”。
- 文件为 PNG，尺寸见各条。放到 `assets/ink/`，按下面的文件名命名。

**风格锚点**（每条提示词末尾都加上）：

```
Traditional Chinese ink wash painting (shuimo), Song dynasty landscape style, monochrome black ink on pure white background, expressive brush strokes with dry-brush texture and soft ink gradients, generous empty white space, isolated subject, no color, no paper texture, no seal stamp, no calligraphy, no border, no frame
```

## 1. 雪山（路尽头的主峰）· 最重要

- 文件：`peak-1.png`、`peak-2.png`（出两三个备选）
- 尺寸：2048 × 1024，横向
- 要点：一座孤高的尖峰居中，左右各有一个较低的山肩，左右不对称；**积雪用留白表现**（雪的部分是白纸，只用墨画岩石、阴影和沟壑）；山脊有一道连续、闭合的轮廓线（代码要靠它抠出山的形状）；山脚往下淡入白色的雾，底边完全变白。

```
A single majestic snow-capped mountain peak centered, with two lower asymmetric shoulders on the left and right, snow rendered as untouched white paper, ink used only for rocky ridges, crevices and the shadowed right flank, a clear continuous ink outline along the whole skyline, the base dissolving into white mist so the bottom edge is pure white, wide horizontal composition, [风格锚点]
```

## 2. 远山（三层，从远到近）

- 文件：`range-far.png`、`range-mid.png`、`range-near.png`
- 尺寸：4096 × 768，很宽的横条
- 要点：一排连绵的山，**正中间要低、留出山口**（雪山从那里露出来，河也从那里流走）；远层淡而高、近层浓而矮；底部淡入白雾；左右两端最好能大致接上，方便横向铺开。

```
A long horizontal panorama of rolling mountain ridges, peaks rising on the left and right sides with a low gap in the exact center, base fading into white mist, [far: very pale diluted ink, tall distant peaks | mid: medium ink tone | near: darker ink, lower rounded hills with Mi-style dotted texture], extremely wide format, [风格锚点]
```

## 3. 树

- 文件：`tree-pine-1…6.png`、`tree-broad-1…6.png`、`tree-willow-1…4.png`
- 尺寸：每棵一张，1024 × 1024；树根在画面底边中央附近，树干下方有一点地面就够
- 要点：一张只画一棵树；松树（横向层叠的针叶团，树干有力弯曲）、阔叶树（墨点叠成的树冠）、柳树（下垂的细枝）。

```
A single [gnarled pine tree with layered horizontal needle clusters | broadleaf tree with a crown built from layered ink dots | weeping willow with drooping thin branches], full tree from roots to top, trunk base at the bottom center, standing alone, [风格锚点]
```

## 4. 草与芦苇

- 文件：`grass-1…8.png`
- 尺寸：512 × 512，一丛一张，根部在底边中央

```
A single small clump of [wild grass | reeds | grass with a few tiny flowers], a few quick calligraphic strokes, base at the bottom center, [风格锚点]
```

## 5. 牛、羊（可加牧童）

- 文件：`buffalo-1…4.png`、`sheep-1…4.png`、（可选）`herdboy-1.png`
- 尺寸：512 × 512，侧面，四脚着地处在画面下部
- 要点：水墨小品的画法，几笔写意即可；姿态多样（低头吃草、抬头、卧着、走动）。水牛（牧牛图）比黄牛更有味道。

```
A single [water buffalo grazing with head down | water buffalo standing, head raised | water buffalo lying down | sheep grazing | small group of two sheep], side view, minimal expressive brushwork, [风格锚点]
```

## 6. 云

- 文件：`cloud-1…6.png`
- 尺寸：1536 × 512，横向
- 要点：淡墨晕开的横向云带，边缘柔和，不要卷云纹样（祥云）。

```
A single soft horizontal wisp of cloud, very pale diluted ink wash with soft blurred edges, [风格锚点]
```

## 7. 可选

- `stream-1…3.png`：一段弯曲的小溪，从远处蜿蜒而来，两岸几笔淡墨（用于岸边，透视由代码处理，所以画成**正俯视**的弯曲带子更好用）
- `hut-1.png` 茅屋、`bridge-1.png` 小石桥、`boat-1.png` 渔舟：点景用，数量少

## 交付

- 每类先出 2–3 张，确认风格后再补齐。
- 只交 PNG 原图即可，抠图、着色、透视摆放由代码完成。
- 生成时如果有“负面提示词”，填：`color, colorful, paper texture, seal, stamp, calligraphy, text, signature, border, frame, watermark, gradient background, cropped`
