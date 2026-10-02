# 登山 · 农场 · 深海 · 素材需求

给出图的 agent 用。三个模式的概念片：

- 登山：https://claude.ai/artifact/Aj7x6DdUuGNgRRyUMbiTKW
- 农场：https://claude.ai/artifact/NoYWGgHRSFhZr4vDiZKrtZ
- 深海：https://claude.ai/artifact/UNbXhrqtAH2b362B4rVkWu

概念片是用代码画的扁平示意，**画风统一换成远足那套绢本青绿**（《千里江山图》）。
**统一要求、风格锚点、负面提示词全部沿用 `docs/art-brief.md`**，下面每条提示词末尾的 `[风格锚点]` 就是那一段。

几条补充：

- 文件放到 `assets/art/<模式>/`（`mountain/`、`farm/`、`sea/`），远足已有的素材（云、树、草、牛羊、茅屋、渔舟）各模式可以直接复用，这里不再重复要。
- 人物都是宋画里的小人：几笔勾出来，高约一指，不画五官。同一个模式里的“你”要是同一个人（同样的衣色、帽子），姿态不同。
- **贴图**（文件名带 `tile`）是例外：要铺满整张、上下左右能无缝拼接，不要留底色。
- 地形和水面的形状由代码算，素材只提供“质感”和“点景”。
- 每类先出 2–3 张，确认风格后再补齐。

---

## 一、登山（目标）

侧面看一座山。做过的事一层层垒成山，你沿山路往上走；每个日程是路边一处营地，走过后留下一座石堆；越远的路藏进云里；山顶插旗，是截止日。排满的时段是陡坡（岩石），空闲的时段是草甸。

范本：郭熙《早春图》、范宽《溪山行旅图》（行旅小人、山路），《千里江山图》的栈道和山亭。

### 1. 登山的人（最重要）

- 文件：`mountain/climber-walk-1…3.png`（走路的三个步态）、`climber-steep-1.png`（陡坡上弯腰拄杖）、`climber-rest-1.png`（坐着歇脚）、`climber-camp-1.png`（夜里坐在营火旁）
- 尺寸：512 × 512，侧面朝右，脚底在画面下部中央
- 要点：背行囊、拄竹杖、戴斗笠的行旅人，衣服用石青，行囊赭石；同一个人。

```
A single small traveler figure in Northern Song style, wearing a conical bamboo hat and an azurite blue robe, carrying an ochre bundle on the back and a bamboo walking staff, [walking to the right, mid-stride | bent forward climbing a steep slope, leaning on the staff | sitting on a rock resting | sitting beside a small campfire at night], side view facing right, tiny figure drawn with a few fine ink lines, no facial details, feet at the bottom center, [风格锚点]
```

### 2. 同行的人

- 文件：`mountain/companion-1…3.png`
- 尺寸：512 × 512，同上
- 要点：衣色和“你”区分开（石绿、赭石、蛤粉白），会议进行时跟在你身后一起走。

```
A single small traveler figure walking to the right, [malachite green robe with a cloth cap | ochre robe carrying a scroll | pale white robe holding a folding fan], side view, tiny figure drawn with a few fine ink lines, no facial details, feet at the bottom center, [风格锚点]
```

### 3. 营地（日程）

- 文件：`mountain/camp-1…3.png`（还没到的营地）、`camp-lit-1.png`（夜里亮灯的）
- 尺寸：512 × 512，落地点在底边中央
- 要点：宋画里的山间小亭或茅棚，不要现代帐篷；屋顶可以有一点朱砂。代码会按日程类型着色，所以主体颜色不要太满。

```
A single small thatched pavilion / mountain shelter with four thin posts and a pointed roof, a small stone platform underneath, [empty | a paper lantern hanging under the eaves glowing warm vermilion], seen from the side slightly above, [风格锚点]
```

### 4. 石堆（走过的营地）

- 文件：`mountain/cairn-1…3.png`
- 尺寸：256 × 256

```
A single small cairn of three to five stacked flat stones, ochre and pale ink, simple and quiet, base at the bottom center, [风格锚点]
```

### 5. 山顶的旗（截止日）

- 文件：`mountain/summit-flag-1.png`
- 尺寸：512 × 768，竖向，旗杆根部在底边中央
- 要点：一根细竹竿挑着一面朱砂色的三角旗，旁边可有一小块山石。

```
A single tall thin bamboo pole with a small triangular vermilion banner fluttering to the right, planted among a few rocks, vertical composition, pole base at the bottom center, [风格锚点]
```

### 6. 山体贴图（陡坡 / 草甸）

- 文件：`mountain/rock-tile-1.png`、`mountain/meadow-tile-1.png`
- 尺寸：1024 × 1024，**四边无缝拼接，铺满整张**
- 要点：代码按日程忙闲算出山的轮廓，再用这两种贴图填进去。岩石用斧劈皴（石青石绿罩在赭石上）；草甸是石绿平涂，点几簇苔点和小花（朱砂、蛤粉）。

```
Seamless tileable texture filling the entire square, [rocky mountain face with axe-cut texture strokes (fupi cun), malachite green and azurite blue over ochre, fine ink outlines | gentle alpine meadow, flat malachite green wash with scattered moss dots and a few tiny vermilion and white flowers], no horizon, no sky, no border, edges wrap seamlessly, Chinese blue-and-green landscape painting style of Wang Ximeng, mineral pigments on silk, delicate brushwork
```

### 7. 云带（看不清的未来）

- 文件：`mountain/cloud-band-1…3.png`
- 尺寸：2048 × 512，横向
- 要点：比远足的云厚、长，能把一段山路整个藏住；《千里江山图》里那种成团的白云，边缘用淡墨勾，不要祥云卷纹。

```
A long thick horizontal band of white cloud with soft rounded billows, faint pale ink contours along the upper edge only, the lower edge dissolving softly, wide format, [风格锚点]
```

### 8. 远处的群峰和点景（可选）

- `mountain/range-back.png`（4096 × 768，山后连绵的远峰，同远足 `range-far` 的要求，但中间不留山口）
- `mountain/pine-cliff-1…3.png`（1024²，长在崖边、斜伸出去的松）
- `mountain/plank-road-1.png`（1024 × 512，栈道一段，木桩插在崖壁上，用在最陡的地方）

---

## 二、农场（积累）

斜俯视一片农场，一天是一块地。做过的事留在地里：专注是翻过的土、后来长成庄稼；学习是播种，几周后才发芽；会议是去集市；习惯是浇果树，坚持下来长成果园；没做事的地空着长草。

范本：张择端《清明上河图》的农舍和集市，楼璹《耕织图》的农活；界画的斜俯视角。

**视角统一**：立着的东西（房子、人、树）一律从**左前上方约 30° 斜俯视**；地块贴图一律**正俯视**（代码会压扁成透视）。

### 1. 农夫（最重要）

- 文件：`farm/farmer-walk-1…2.png`、`farmer-hoe-1.png`（锄地）、`farmer-sow-1.png`（撒种）、`farmer-water-1.png`（挑水浇树）、`farmer-cart-1.png`（推独轮车）、`farmer-sit-1.png`（坐在屋檐下）
- 尺寸：512 × 512，脚底在画面下部中央
- 要点：戴斗笠、短衣、卷起裤脚，衣服石青；同一个人。

```
A single small farmer figure in Song dynasty style, wearing a conical straw hat, short azurite blue jacket and rolled-up trousers, [walking | hoeing the soil with a long hoe | scattering seeds from a basket | carrying two water buckets on a shoulder pole | pushing a wooden wheelbarrow loaded with baskets | sitting on a low bench resting], three-quarter view from slightly above, tiny figure, few fine ink lines, no facial details, feet at the bottom center, [风格锚点]
```

### 2. 地块贴图（每天一块）

- 文件：`farm/plot-<状态>.png`，状态共 8 种：`bare`（未动的土）、`tilled`（翻过的垄沟）、`seeded`（撒了种的垄）、`sprout`（刚出芽）、`young`（青苗）、`ripe`（金黄的稻麦）、`fallow`（空着长草）、`stubble`（收割后的茬）
- 尺寸：1024 × 1024，**正俯视，铺满整张**（四边可以不拼接，代码会加田埂）
- 要点：垄沟横向排列，和概念片一致；颜色只用赭石（土）、石绿（苗）、泥金（熟）。

```
Top-down view of a single square farm field filling the entire image, [bare ochre soil | freshly plowed horizontal furrows in dark ochre | furrows with tiny seed dots | furrows with tiny green sprouts | rows of young malachite green rice seedlings | rows of ripe golden grain | fallow field overgrown with loose wild grass | harvested stubble rows], flat even lighting, no border, Chinese blue-and-green painting style, mineral pigments on silk, fine brushwork
```

### 3. 农舍、粮仓、鸡舍

- 文件：`farm/house-1.png`（1024²）、`farm/granary-1…3.png`（512²，空 / 半满 / 满）、`farm/coop-1.png`（512²）、`farm/hen-1…3.png`（256²）
- 要点：农舍是瓦顶或草顶的院落，有屋檐和门前空地（屋檐下要坐人）；粮仓是圆形的囷，顶上草帽形，开一扇小窗露出谷子多少。

```
A single [small Song dynasty farmhouse with a grey tiled roof, wide eaves, a wooden porch and a low bench in front | round woven granary with a conical thatched roof and a small open hatch showing it [empty | half full | full] of golden grain | small thatched chicken coop with a tiny ramp | single hen pecking the ground], three-quarter view from slightly above, base at the bottom center, [风格锚点]
```

### 4. 果树（习惯）

- 文件：`farm/fruit-tree-1…5.png`：树苗、小树、成树、开花、结果（朱砂色的果子）
- 尺寸：1024 × 1024，树根在底边中央
- 要点：同一棵树的五个阶段，树形一致、越来越大；底下留一点地面。

```
A single [tiny sapling with a few leaves | small young fruit tree | full-grown leafy fruit tree | fruit tree in full blossom with pale pink-white flowers | fruit tree laden with small round vermilion fruits], same tree shape across stages, roots at the bottom center, three-quarter view from slightly above, [风格锚点]
```

### 5. 集市（会议）

- 文件：`farm/stall-1…3.png`（不同货物：布、菜、陶器）、`farm/villager-1…4.png`（赶集的人）
- 尺寸：摊位 1024 × 1024，人 512 × 512
- 要点：《清明上河图》的街边摊，竹竿撑一块布棚；布棚颜色由代码区分，所以棚布画成浅色（蛤粉白、淡赭）。

```
A single small Song dynasty market stall with a wooden table and a pale cloth awning on bamboo poles, goods on the table: [bolts of cloth | baskets of vegetables | stacked pottery jars], three-quarter view from slightly above, base at the bottom center, [风格锚点]
```

```
A single small villager figure in Song dynasty clothing, [carrying a basket | holding a bundle | bargaining with a raised hand | carrying goods on a shoulder pole], [malachite green | ochre | pale white | azurite] robe, three-quarter view from slightly above, tiny figure, no facial details, feet at the bottom center, [风格锚点]
```

### 6. 点景

- `farm/fence-1.png`（1024 × 256，一段竹篱笆，横向）
- `farm/stake-flag-1.png`（256²，插在地头的木桩挂小旗：明天要做的事；旗画成浅色，由代码着色）
- `farm/crate-1.png`、`farm/basket-1.png`（256²，车上装的东西：带去的和带回的）
- 羊、牛、柳树沿用远足的素材。

```
A single [short section of woven bamboo fence, horizontal | small wooden stake with a tiny pale cloth flag | small wooden crate tied with rope | round woven bamboo basket with a lid], three-quarter view from slightly above, base at the bottom center, [风格锚点]
```

---

## 三、深海（专注）

侧面剖开的一片海。深度就是专注：不被打断的工作让你越潜越深、越深越暗；手里的光只照亮前面一小段。专注是一条大鱼，学习是水母，琐事是一群小鱼，会议是水面上的船，运动是浮标。上船开会前，沿路收集要带的珠子。

古画里少有水下，这里借两样东西：马远《水图》（十二幅水纹，水面和水波的画法）和“北冥有鱼，其名为鲲”。“你”是采珠人（合浦采珠的故事），手里捧一颗夜明珠照路。

### 1. 采珠人（最重要）

- 文件：`sea/diver-swim-1…2.png`（平游的两个蹬腿姿态）、`diver-down-1.png`（头朝下往深处潜）、`diver-up-1.png`（往上浮）、`diver-rest-1.png`（悬在水中不动）
- 尺寸：512 × 512，**身体朝右，横向**，身体中心在画面正中
- 要点：赤足、短衣、腰间系一只小竹篓（装珠子），一手向前托着一颗发光的珠子；衣服石青；不要潜水镜、脚蹼等现代装备。

```
A single pearl diver figure swimming underwater in Song dynasty style, bare feet, short azurite blue tunic, a small bamboo basket tied at the waist, one arm stretched forward holding a small glowing white pearl, [swimming horizontally to the right | diving head-first downward to the right | rising upward to the right | floating still], hair and sash drifting, side view facing right, tiny figure, few fine ink lines, no facial details, body centered, [风格锚点]
```

### 2. 鲲（专注的大鱼）

- 文件：`sea/kun-1…3.png`
- 尺寸：2048 × 768，横向，朝右
- 要点：长而安静的大鱼，鳞片用细墨线一片片勾出（宋人画鱼的画法），背部石青，腹部蛤粉白；长短由代码按工作时长拉伸，所以身体中段要能横向拉长而不难看。

```
A single enormous mythical fish (Kun) swimming calmly to the right, long streamlined body, azurite blue back fading to pale white belly, scales outlined individually with fine ink lines, flowing fins and tail, serene and majestic, side view, wide horizontal format, [风格锚点]
```

### 3. 水母（学习）、鱼群（琐事）

- 文件：`sea/jelly-1…3.png`（512²）、`sea/fish-school-1…2.png`（1024 × 512）、`sea/fish-1…3.png`（256²，单条，代码可以自己排成群）
- 要点：水母用蛤粉和极淡的石青，半透明感，触须是几根游丝线；鱼参照宋人《鱼藻图》，石绿或赭石小鱼。

```
A single [translucent jellyfish with a pale white bell and long thin trailing threads drawn as fine gossamer ink lines | loose school of nine small fish swimming to the right among a few strands of waterweed | single small fish swimming to the right], [pale white and faint azurite | malachite green and ochre], in the manner of Song dynasty fish-and-waterweed paintings, [风格锚点]
```

### 4. 水面上的船（会议）、浮标（运动）

- 文件：`sea/boat-1…2.png`（1024 × 512，船上有三四个人，可坐可站）、`boat-lit-1.png`（夜里船上挂灯笼）、`sea/buoy-1…2.png`（256 × 512）
- 尺寸见上，**吃水线在画面下部，吃水线以下不画**（水下部分由代码处理）
- 要点：渔舟或小舫，有篷；浮标用宋代的东西替代：一只系着绳的葫芦或竹筒浮子，顶上一面小朱砂旗。

```
A single [small wooden boat with a woven bamboo canopy, three or four tiny figures seated and talking | same boat at night with a glowing vermilion paper lantern hanging from the canopy], side view, waterline at the lower part of the image with nothing drawn below it, [风格锚点]
```

```
A single floating gourd buoy tied with a rope that hangs straight down, a tiny vermilion flag on a thin stick on top, side view, [风格锚点]
```

### 5. 水面与水纹（贴图）

- 文件：`sea/surface-tile-1.png`（2048 × 256，**横向无缝**，水面的一道波纹带）、`sea/water-tile-1…2.png`（1024²，**四边无缝**，水里极淡的水纹，用来让深处不是死黑）
- 要点：照马远《水图》的线描水纹；水纹线要很淡、很疏，代码会叠在深色上。

```
Seamless tileable [horizontal band of gentle sea surface waves | very faint sparse rippling water lines filling the entire square], drawn entirely in fine flowing ink lines in the manner of Ma Yuan's "Water Album", pale azurite tint, no sky, no horizon, edges wrap seamlessly, mineral pigments on silk, Southern Song dynasty
```

### 6. 珠子和海底点景

- `sea/pearl-1…3.png`（128²，一颗珠子：要带上船的东西）
- `sea/weed-1…3.png`（512 × 1024，竖长的水草/海藻，根在底边）
- `sea/coral-1…2.png`（512²，石青、朱砂的珊瑚枝）
- `sea/seabed-1.png`（4096 × 512，横向，一条海底礁石带，上沿是礁石轮廓，下沿铺满）

```
A single [luminous round white pearl with a soft sheen | tall swaying strand of seaweed, malachite green | small branching coral, azurite and vermilion | long horizontal band of seabed rocks with axe-cut texture, top edge a rocky silhouette], [风格锚点]
```

---

## 交付顺序建议

三个模式不急着一起做。每个模式先出“最重要”的那一条（人物）和一两样标志物（营地 / 地块 / 鲲），看画风能不能和远足放在一起，确认后再补齐其余的。
