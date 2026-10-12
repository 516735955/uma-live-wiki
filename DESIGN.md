---
name: Uma Musume Live Wiki
description: 官方灵感的深蓝纹理资料馆，连接赛马娘的动漫、活动、歌曲、专辑、角色与声优。
colors:
  navy: "#20283b"
  navy-deep: "#141a29"
  cobalt: "#3157ed"
  cobalt-dark: "#213aa8"
  brand-orange: "#ff7b16"
  brand-orange-light: "#ffa932"
  paper: "#f5f4f9"
  white: "#ffffff"
  surface-muted: "#f5f6fb"
  line: "#e3e5ef"
  text: "#26272b"
  text-muted: "#5f5f6a"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
typography:
  display:
    fontFamily: "Microsoft YaHei, PingFang SC, Hiragino Sans, Yu Gothic UI, Yu Gothic, Meiryo, Noto Sans CJK SC, Noto Sans CJK JP, system-ui, sans-serif"
    fontSize: "clamp(1.55rem, 2.8vw, 2.35rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0"
  title:
    fontFamily: "Microsoft YaHei, PingFang SC, Hiragino Sans, Yu Gothic UI, Yu Gothic, Meiryo, Noto Sans CJK SC, Noto Sans CJK JP, system-ui, sans-serif"
    fontSize: "clamp(1.55rem, 2.6vw, 2.35rem)"
    fontWeight: 900
    lineHeight: 1.18
  body:
    fontFamily: "Microsoft YaHei, PingFang SC, Hiragino Sans, Yu Gothic UI, Yu Gothic, Meiryo, Noto Sans CJK SC, Noto Sans CJK JP, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Microsoft YaHei, PingFang SC, Hiragino Sans, Yu Gothic UI, Yu Gothic, Meiryo, Noto Sans CJK SC, Noto Sans CJK JP, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1.3
components:
  archive-search:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "46px"
  capsule-filter-active:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "34px"
  entity-hero:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-deep}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "18px 24px"
  data-table:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
---

# Design System: Uma Musume Live Wiki

## Overview

**Creative North Star: "蓝橙结构里的官方资料馆"**

这是一个围绕赛马娘 LIVE 资料建立的粉丝档案馆。顶部导航的品牌蓝橙是公共界面的唯一品牌来源；进入资料区后，白色纸张表面承载长列表和表格，让动漫、活动、歌曲、专辑、角色、声优与创作者之间的事实关系保持清楚。页面不是各自独立的仪表盘，而是一套可以沿关系连续浏览、随时返回的资料系统。

资料库同级目录遵循同一套骨架：不设重复的标题、计数和返回区，页面直接从统一搜索、下拉与筛选组件开始，再进入结果列表或资料表。原子详情使用规范面包屑、详情 hero 与关系分节；只有从一个原子详情进入另一个原子详情时，才出现不占版面的上下文返回按钮。活动详情直接承接已经精调的现场曲目表；专辑列表保留封面卡片和 `View more` 悬停反馈，角色列表保留旧版彩色角色卡。信息优先于装饰，不使用粉色、暖色筛选面板、大红重置按钮、AI 式小字说明、侧边色条或嵌套卡片。

**Key Characteristics:**

- 顶部导航使用唯一品牌蓝橙；非人物详情 hero 使用同一蓝橙身份区，角色与声优 hero 使用角色数据中的规范双色。
- 同级目录从同一套搜索、下拉和筛选控件开始，不再用页头重复表达导航中已有的信息。
- 搜索、下拉使用克制圆角白色表面；筛选、分页和详情栏目使用统一胶囊语言，active 使用蓝色渐变。
- 白色纸张表面承载数据；关系 chip 由角色色圆形头像和中文名组成。
- 桌面端是主要验收面，先在 1440px 与 1920px 保证完整扫描和关系阅读，再在 900px/700px/480px 逐级收窄，390px 保持主要功能可用。

## Colors

深蓝和蓝色负责空间与结构，白色负责阅读表面，橙色负责导航、详情身份、角色卡和少量关键交互；角色卡的颜色来自角色资料本身，只在角色卡和头像边界中出现。

### Primary

- **深海军蓝** (#20283b)：导航、正文标题、表格线和主要文字。
- **品牌钴蓝** (#3157ed)：顶部导航、资料详情身份区、搜索焦点和结构强调。
- **深品牌蓝** (#213aa8)：蓝色渐变深端、正文链接和选中状态。
- **品牌橙** (#ff7b16)：导航、详情身份标签和关键交互的起点。
- **亮品牌橙** (#ffa932)：品牌橙渐变终点。

### Secondary

- **角色双色** (由规范实体数据提供)：角色 hero、对应声优 hero、角色卡、头像边框和人物关系 chip 的身份色；不得复制为另一份手写映射。

### Neutral

- **纸张灰** (#f5f4f9)：资料页面背景。
- **白色** (#ffffff)：搜索、下拉、资料表、详情分节和封面卡片表面。
- **表面灰** (#f5f6fb)：表头和次级资料区域。
- **正文黑** (#26272b)：正文和记录名称。
- **静音灰** (#5f5f6a)：日期、数量和次级信息。
- **结构线** (#e3e5ef)：表格行、分节和控件边界。

**The Blue Active Rule.** 筛选和分页 active 统一使用深蓝到钴蓝的渐变；橙色只用于导航、详情身份、角色卡和关键交互，不使用粉色、暖色筛选容器或大红色重置动作抢占资料层级。

## Typography

**Display Font:** Microsoft YaHei, with PingFang SC, Hiragino Sans, Yu Gothic, Meiryo, Noto Sans CJK and system sans-serif fallbacks.

**Body Font:** 同一中文无衬线字体栈。

**Character:** 原子页中文标题厚重直接，目录页不添加重复标题或英文微型副标题；正文保持朴素、可扫描，不用等宽字体或密集英文标签制造伪专业感。

### Hierarchy

- **Display** (900, clamp(2rem, 5vw, 3rem), 1)：首页与原子详情的中文主标题。
- **Title** (900, clamp(1.55rem, 2.6vw, 2.35rem), 1.18)：实体详情 hero 标题。
- **Headline** (900, 1.2rem, 1.4)：重要资料名称；正文分组使用标签或折叠摘要，不重复输出栏目标题。
- **Body** (400, 14px, 1.5–1.75)：表格、来源、关系和说明。
- **Label** (700–900, 14px, 1.3)：搜索、下拉、筛选、表头和数量。

**The Clear Record Rule.** 主要资料文字保持可读；实体名称由 Hero 标题表达，栏目与内容分组不重复制造标题和横线，不把关键内容藏进小字注释或侧边说明。

## Layout

资料页最大宽度约 1280px，采用单列档案流。目录从搜索与下拉开始，筛选胶囊紧随其后，列表以白色纸张表面展开；动漫、制作人员与创作者不显示汇总总数，分页只保留页码与前后页动作。实体详情先给出 `首页 › 分组 › 目录 › 当前条目` 面包屑，再用白色 Hero 承载图片、身份与事实。动漫作品使用大幅完整主视觉，剧集使用该话的横向画面；身份、日期、简介、观看操作和剧集导航分层排列。其他资料保留各自的紧凑 Hero，不使用概览统计卡填空。

控件默认 40–44px 高、胶囊圆角；筛选项 34px 高。活动、歌曲和专辑目录使用带封面的整行记录，专辑目录延续封面卡片和 `View more` hover，角色目录延续每张角色独有的主色卡。900px 以下控件换行，700px 以下 hero 和目录改为移动布局，480px 以下栏目保持可用且封面、头像与主要记录仍可读；长表格只在必要时局部横向滚动。

动漫目录使用专辑目录现有封面网格。作品和单集页使用现有实体 Hero、栏目 Tab、角色和声优标签；概览与观看入口位于 Hero，剧集、角色、音乐、制作人员和剧照按实际非空栏目浏览。制作人员目录使用现有创作者整行列表与分页。

动漫页的内容流保持事实优先：平台图标按钮、版本切换与唯一一套单集导航位于 Hero，剧照使用独立栏目。音乐用用途标签与既有专辑发行组件表达真实关系。Staff 索引提供姓名或职务搜索、40 条一页的分页；作品与单集 Staff 使用默认完整显示的岗位表，岗位顺序由共享排序函数决定。机构按本次署名分组，以次级文字显示，逐话标签保留点击入口。署名来源及完整性状态保存在资料数据中。

人物动画参与按作品、版本、岗位与当次署名范围组织；RTTT 剧场版与网络版各有版本层级，逐话标签位于网络版内部。角色页不重复本人姓名，声优多角色与历史身份保留。制作人员 Hero 的照片或 SVG 区域使用固定方形比例，加载期间保持布局稳定。

## Elevation & Depth

品牌蓝橙、白色纸张和低强度蓝灰阴影组成混合层次。导航和非人物 hero 用同一蓝橙结构建立识别，角色与声优 hero 改用规范角色双色；白色表面用细边界和轻阴影从页面背景中分离。目录行、专辑封面、关系节点和角色卡可以在 hover 时轻微抬升，反馈结束后回到原位。筛选和数据表不使用厚重阴影或暖色面板。

### Shadow Vocabulary

- **纸张分离** (`0 5px 12px rgba(49,87,237,.10)`): 搜索、下拉和分页胶囊与背景的轻微分离。
- **目录 hover** (`0 8px 20px rgba(49,87,237,.11)`): 目录行或封面卡 hover 的短暂反馈。
- **品牌 hover** (`0 5px 12px rgba(255,123,22,.16)`): 橙色关系按钮和来源按钮的反馈。

**The Texture-First Rule.** 深度优先来自官方风格纹理、内容封面和白色纸张的对比；阴影只说明表面或交互状态，不替代信息结构。

## Shapes

搜索和下拉统一使用 8px 克制圆角；筛选、返回和分页使用胶囊形（999px）；资料分节和详情 hero 使用 8–12px 圆角。表格内部不套一层层卡片，行以横线和交替的极浅蓝灰区分。角色卡保留角色色边框、彩色背景和 `View more` 遮罩这一既有形制；关系 chip 不包成彩色胶囊，而是圆形头像加中文名。

## Components

### Buttons

- **Shape:** 操作按钮默认胶囊，最小高度 40px；清除筛选也沿用白底胶囊，不能变成大红警示块。
- **Primary:** 关键交互可使用橙色；筛选和分页 active 使用深蓝到钴蓝渐变与白字。
- **Hover / Focus:** 使用橙色边界、轻微缩放或平移，焦点保持清楚的橙色轮廓；不改变布局尺寸。
- **Secondary:** 返回、来源和关系入口使用白底、深蓝文字与浅蓝/橙色边界。

### Chips

- **Style:** 筛选 chip 是白底、细边界、胶囊圆角；active 是深蓝到钴蓝渐变填充。
- **Relation:** 角色关系 chip 是角色色圆形头像 + 中文名，点击进入角色或声优，不使用小号英文身份说明。

### Cards / Containers

- **Directory:** 活动、歌曲、专辑使用白色整行目录；专辑延续封面卡片和 `View more` hover。
- **Anime:** 动漫目录沿用专辑网格与悬停效果，正式主视觉在统一 2:3 槽内完整显示，卡片等高；作品名、年份和形式放在图下；作品与单元详情使用白色资料流。
- **Character:** 角色列表保留旧版彩色角色卡、角色图、主色边框和 hover 遮罩。
- **Hero:** 歌曲、专辑、活动、创作者和原型马使用唯一品牌蓝橙；角色与声优使用角色规范双色。动漫 Hero 给主视觉和剧集画面足够空间；其他 Hero 保持紧凑尺寸和浅色正文面，长标题自然换行。
- **Surface:** 白色纸张表面承载分节和表格；避免嵌套卡片、侧边色条和装饰性指标卡。
- **Disclosure:** 角色歌曲、声优歌曲、歌曲收录、署名差异和创作者作品共用同一摘要、箭头、打开动效和展开面板。
- **Relation graph:** 创作者合作图沿用血统图的节点、连线、选中态和点击详情卡语言；节点卡可扫描，不使用占满桌面的放射圆阵。
- **Creator:** 创作者目录采用单行列表，姓名、岗位标签与所属组织横向对齐。制作人员和创作者的目录、详情与合作图统一使用真实照片或 A 排印字章：浅色方章、一个大字与蓝橙角标，完整姓名显示在图外。原创 SVG 不提供原图查看。音乐封面保持原图。

### Inputs / Fields

- **Search:** 白底 8px 圆角，46px 高，左侧搜索图标，焦点为橙色边界和轻微外圈。
- **Select:** 白底 8px 圆角，原生下拉行为，统一箭头和 46px 高度。
- **Filter:** 各资料库共用 `.ui-filter-group` 和胶囊按钮；active 统一蓝色渐变，重置使用中性白底。

### Navigation

- **Style:** 品牌蓝纹理导航提供站点入口；“音乐”“资料库”是只负责展开的分组按钮，只有其子项执行跳转。音乐固定为“歌曲 / 专辑 / 创作者”，资料库固定为“角色 / 声优 / 动漫 / 制作人员 / 其他”，不得把“其他”内部栏目擅自提升到总导航。
- **State:** 目录记录、关系 chip、曲名、专辑、角色和声优都使用真实可点击关系；原子页通过规范面包屑回到目录，原子页之间的跳转额外提供浮动上下文返回。
- **Mobile:** 五个一级入口始终同屏可达，分组子项在导航下方展开；栏目允许换行，长表格局部滚动，不靠隐藏入口解决空间问题。
- **Long records:** Hero 滚出视口后，在主导航下方显示简易身份与栏目栏；切换仍执行原栏目动作。目录搜索与筛选在结果区域内吸顶，手机将额外筛选收进可展开按钮，避免多层固定面板。

### Original Images and Profile Facts

真实封面、照片、剧照与宿舍关系图共用 PhotoSwipe 查看器。预览先显示，原图渐进替换；桌面提供缩放、适应窗口、100%、打开原图和关闭，手机将次要动作收进“更多”。失败保留预览并提供重试和来源，关闭恢复入口焦点与滚动位置，减少动态效果偏好时取消动效。合成 SVG、图标与占位图不提供入口。

角色与声优的个人资料使用白色描述列表。桌面两列、手机一列，标签和内容对齐，不使用局部灰色标签底或汇总数字填充事实。

### Anime Surface

- **Catalog:** 作品筛选只使用既有搜索、形式与状态胶囊；不设置年份筛选，网络短篇归入短篇动画。封面卡保持专辑网格与 `View more` 悬停。
- **Detail:** 概览、平台图标与平台名称、版本切换和唯一一套剧集导航都位于共享 Hero；来源保存在数据中。日期标签不拆字，空间不足时整条信息上下排列。剧照以 3 列桌面 / 2 列移动网格呈现。
- **Content:** 已选栏目不重复输出标题和横线；用途使用标签，机构使用次级文字，岗位使用紧凑描述列表。空简介不占分隔区，加载状态不恢复旧标题。音乐按歌曲、录音与发行信息组织，专辑作为简明出处链接，不循环嵌套面板。实际可播录音右侧统一提供播放／暂停与加入按钮，操作对应明确版本。真实比赛等关联使用紧凑内容入口，不设置独立关联资料栏目。
- **Disclosure:** 封面与次要信息按实际插槽分配列，缺少内容时不占空列。音乐用途标签位于标题下方，在手机端始终可见。制作人员名单默认完整显示，搜索保留岗位和机构上下文；歌曲等可展开资源维持自己的展开状态。
- **Staff:** Staff 目录直接复用创作者整行列表与分页，保留人物各自的照片或 SVG。作品及单集页所有岗位使用共享顺序和紧凑岗位表，默认完整显示，提供姓名、岗位及机构搜索。岗位内按当次署名的机构分组，每组显示一次机构标签和对应人员；未标机构的人员单独成组，不从相邻公司或人物资料推断归属。不另造组织筛选或组织目录。
- **Participation:** 制作人员、角色、声优与创作者的动画参与共用紧凑作品列表，封面与作品名对齐，岗位、当次机构和逐话标签保持不同语义并自然换行。角色与声优使用同级“动画出演／活动出演”栏目；活动列表显示实际场次标签。
- **Coverage:** 完整片尾署名依据逐集资料核查结果标记，尚未取得完整名单的单元保留 `partial_transcript`、`main_only` 或缺失状态，不以空栏目代替待补内容。

### Archive Table

表格是资料阅读的基础组件：白底、浅灰表头、深蓝底线、14px 正文和轻微 hover。活动详情复用成熟现场曲目表，歌曲、出演者、角色和出典均可继续跳转；来源和待补信息保持明确而不伪造。

## Do's and Don'ts

### Do:

- **Do** 使用唯一品牌蓝橙、白色纸张表面和规范角色双色。
- **Do** 先在 1440px 与 1920px 验收详情、关系图和长表，再检查移动端兼容。
- **Do** 让所有同级目录直接从统一搜索、下拉和筛选组件开始。
- **Do** 延续专辑封面卡片与 `View more` hover，延续角色彩色卡和角色色头像 chip。
- **Do** 让动漫、活动、歌曲、专辑、角色、声优通过真实关系互相跳转，并允许返回原浏览位置。
- **Do** 将概览与观看入口集中于 Hero，正文使用实际非空栏目、紧凑关系标签和共用折叠组件表达内容。
- **Do** 让 Staff 的搜索、分页、作品参与和机构标签沿用已有创作者资料语言，并在数据中如实记录署名覆盖状态。
- **Do** 让主要资料在桌面和 390px 手机都保持清晰可读，并尊重 `prefers-reduced-motion`。

### Don't:

- **Don't** 为同级资料库另造标题计数区、筛选、下拉或表格组件。
- **Don't** 使用粉色、暖色筛选面板、大红重置、AI 式小字说明、英文微型副标题、侧边色条或嵌套卡片。
- **Don't** 用指标卡、渐变大背景或装饰性统计替代真实资料和关系表。
- **Don't** 把关系 chip 做成无头像的通用标签，也不要把角色色扩散成整页暖色背景。
- **Don't** 将歌词、署名表、个人资料或共同作品居中成窄栏，也不要让桌面端为了迁就手机而失去正常阅读宽度。
- **Don't** 擅自改变“角色 / 声优 / 动漫 / 制作人员 / 其他”的资料库总导航层级。
- **Don't** 覆盖人工精调的现场曲目来源，或推测没有证据的出演关系。
- **Don't** 把 Staff 机构标签扩展成组织目录或过滤器，也不要把仅有主要职员资料的单元写成完整片尾署名。
- **Don't** 为动漫页面发明额外统计卡或独立分页结构；不把原生 disclosure 改造成自定义播放控件。
