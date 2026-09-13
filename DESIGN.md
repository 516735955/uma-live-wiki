---
name: Uma Musume Live Wiki
description: 官方灵感的深蓝纹理资料馆，连接赛马娘的活动、歌曲、专辑、角色与声优。
colors:
  navy: "#20283b"
  navy-deep: "#141a29"
  cobalt: "#3558d8"
  cobalt-dark: "#3654b7"
  brand-orange: "#ff8c1a"
  brand-orange-dark: "#b94c00"
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
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.055em"
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
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "46px"
  data-table:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
---

# Design System: Uma Musume Live Wiki

## Overview

**Creative North Star: "深蓝纹理里的官方资料馆"**

这是一个围绕赛马娘 LIVE 资料建立的粉丝档案馆。官方 umamusume.jp 的深蓝纹理、强烈的中文标题和橙色品牌强调提供入口感；进入资料区后，白色纸张表面承载长列表和表格，让活动、歌曲、专辑、角色与声优之间的事实关系保持清楚。页面不是各自独立的仪表盘，而是一套可以沿关系连续浏览、随时返回的资料系统。

资料库同级目录遵循同一套骨架：不设重复的标题、计数和返回区，页面直接从统一搜索、下拉与筛选组件开始，再进入结果列表或资料表。原子详情使用规范面包屑、详情 hero 与关系分节；只有从一个原子详情进入另一个原子详情时，才出现不占版面的上下文返回按钮。活动详情直接承接已经精调的现场曲目表；专辑列表保留封面卡片和 `View more` 悬停反馈，角色列表保留旧版彩色角色卡。信息优先于装饰，不使用粉色、暖色筛选面板、大红重置按钮、AI 式小字说明、侧边色条或嵌套卡片。

**Key Characteristics:**

- 深蓝纹理导航和蓝色纹理详情 hero 建立站点识别，橙色只做品牌与状态强调。
- 同级目录从同一套搜索、下拉和筛选控件开始，不再用页头重复表达导航中已有的信息。
- 搜索、下拉使用克制圆角白色表面；筛选、分页和详情栏目使用统一胶囊语言，active 使用蓝色渐变。
- 白色纸张表面承载数据；关系 chip 由角色色圆形头像和中文名组成。
- 桌面端强调扫描，900px/700px/480px 逐级收窄，390px 仍保持清楚的主要文字。

## Colors

深蓝和蓝色负责空间与结构，白色负责阅读表面，橙色负责导航、详情身份、角色卡和少量关键交互；角色卡的颜色来自角色资料本身，只在角色卡和头像边界中出现。

### Primary

- **深海军蓝** (#20283b)：导航、正文标题、表格线和主要文字。
- **纹理钴蓝** (#3558d8)：资料详情 hero、搜索焦点和导航区域的结构色。
- **品牌橙** (#ff8c1a)：导航、详情身份标签、角色卡和关键交互强调，不承担筛选或分页 active。

### Secondary

- **深橙文字** (#b94c00)：橙色背景上的深色文字、链接 hover 和辅助动作。
- **角色色** (由数据提供)：角色卡、角色头像边框和关系 chip 的身份色，不用于整块筛选面板。

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
- **Headline** (900, 1.2rem, 1.4)：详情分节标题和重要资料名称。
- **Body** (400, 14px, 1.5–1.75)：表格、来源、关系和说明。
- **Label** (700–900, 14px, 1.3)：搜索、下拉、筛选、表头和数量。

**The Clear Record Rule.** 主要资料文字不低于 14px；页头层级由中文标题和蓝色底线直接表达，不把关键内容藏进小字注释、侧边说明或仅供模型理解的标签。

## Layout

资料页最大宽度约 1280px，采用单列档案流。目录从搜索与下拉开始，筛选胶囊紧随其后，列表以白色纸张表面展开；结果总数只在分页范围中自然出现。实体详情先给出 `首页 › 分组 › 目录 › 当前条目` 面包屑，再使用蓝纹理 hero：左侧封面或头像，右侧橙色身份、标题、关系 chip 和事实；下面以栏目切换和白色资料分节承载表格。

控件默认 40–44px 高、胶囊圆角；筛选项 34px 高。活动、歌曲和专辑目录使用带封面的整行记录，专辑目录延续封面卡片和 `View more` hover，角色目录延续每张角色独有的主色卡。900px 以下控件换行，700px 以下 hero 和目录改为移动布局，480px 以下栏目保持可用且封面、头像与主要记录仍可读；长表格只在必要时局部横向滚动。

## Elevation & Depth

深蓝纹理、白色纸张和低强度蓝灰阴影组成混合层次。导航和实体 hero 用纹理与蓝色渐变建立深度，白色表面用细边界和轻阴影从页面背景中分离；目录行、专辑封面和角色卡可以在 hover 时轻微抬升或放大，反馈结束后回到原位。筛选和数据表不使用厚重阴影或暖色面板，active 胶囊使用蓝色渐变表达状态。

### Shadow Vocabulary

- **纸张分离** (`0 5px 12px rgba(53,88,216,.10)`): 搜索、下拉和分页胶囊与背景的轻微分离。
- **目录 hover** (`0 8px 20px rgba(53,88,216,.11)`): 目录行或封面卡 hover 的短暂反馈。
- **品牌 hover** (`0 5px 12px rgba(255,140,26,.16)`): 橙色关系按钮和来源按钮的反馈。

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
- **Character:** 角色列表保留旧版彩色角色卡、角色图、主色边框和 hover 遮罩。
- **Hero:** 歌曲、专辑、活动、声优、角色详情共享纹理蓝 hero，封面或肖像带白框和橙色偏移阴影。
- **Surface:** 白色纸张表面承载分节和表格；避免嵌套卡片、侧边色条和装饰性指标卡。

### Inputs / Fields

- **Search:** 白底 8px 圆角，46px 高，左侧搜索图标，焦点为橙色边界和轻微外圈。
- **Select:** 白底 8px 圆角，原生下拉行为，统一箭头和 46px 高度。
- **Filter:** 各资料库共用 `.ui-filter-group` 和胶囊按钮；active 统一蓝色渐变，重置使用中性白底。

### Navigation

- **Style:** 深蓝纹理导航提供站点入口；“音乐”“资料库”是只负责展开的分组按钮，只有其子项执行跳转。
- **State:** 目录记录、关系 chip、曲名、专辑、角色和声优都使用真实可点击关系；原子页通过规范面包屑回到目录，原子页之间的跳转额外提供浮动上下文返回。
- **Mobile:** 五个一级入口始终同屏可达，分组子项在导航下方展开；栏目允许换行，长表格局部滚动，不靠隐藏入口解决空间问题。

### Archive Table

表格是资料阅读的基础组件：白底、浅灰表头、深蓝底线、14px 正文和轻微 hover。活动详情复用成熟现场曲目表，歌曲、出演者、角色和出典均可继续跳转；来源和待补信息保持明确而不伪造。

## Do's and Don'ts

### Do:

- **Do** 使用深蓝纹理导航和详情 hero、橙色品牌强调、白色纸张表面。
- **Do** 让所有同级目录直接从统一搜索、下拉和筛选组件开始。
- **Do** 延续专辑封面卡片与 `View more` hover，延续角色彩色卡和角色色头像 chip。
- **Do** 让活动、歌曲、专辑、角色、声优通过真实关系互相跳转，并允许返回原浏览位置。
- **Do** 让主要资料在桌面和 390px 手机都保持清晰可读，并尊重 `prefers-reduced-motion`。

### Don't:

- **Don't** 为同级资料库另造标题计数区、筛选、下拉或表格组件。
- **Don't** 使用粉色、暖色筛选面板、大红重置、AI 式小字说明、英文微型副标题、侧边色条或嵌套卡片。
- **Don't** 用指标卡、渐变大背景或装饰性统计替代真实资料和关系表。
- **Don't** 把关系 chip 做成无头像的通用标签，也不要把角色色扩散成整页暖色背景。
- **Don't** 覆盖人工精调的现场曲目来源，或推测没有证据的出演关系。
