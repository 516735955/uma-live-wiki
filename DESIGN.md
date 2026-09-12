---
name: Uma Musume Live Wiki
description: 一套可相互跳转、可持续维护的赛马娘演出资料档案。
colors:
  navy: "#20283b"
  navy-secondary: "#2c3650"
  accent-red: "#d6001c"
  brand-orange: "#ff8c1a"
  paper: "#f5f4f9"
  white: "#ffffff"
  archive-blue: "#d8e9f8"
  table-blue: "#cfe3f6"
  link-blue: "#244f8c"
  border: "#e6e4ee"
  text: "#26272b"
  text-secondary: "#5f5f6a"
rounded:
  sm: "5px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "18px"
typography:
  display:
    fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif"
    fontSize: "clamp(1.3rem, 3vw, 1.8rem)"
    fontWeight: 800
    lineHeight: 1.3
  headline:
    fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.4
  body:
    fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
components:
  archive-heading:
    backgroundColor: "{colors.archive-blue}"
    textColor: "{colors.navy}"
    typography: "{typography.display}"
    rounded: "{rounded.lg}"
    padding: "18px 22px"
  archive-input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "40px"
  archive-chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "34px"
  archive-table:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
  archive-action:
    backgroundColor: "#3159a5"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "40px"
---

# Design System: Uma Musume Live Wiki

## Overview

**Creative North Star: "可往返的浅蓝档案馆"**

资料库页面是一套连续的档案：用户可以从活动看到场次、曲目、出演者和来源，再进入歌曲、角色或声优，且返回时保留原来的浏览语境。视觉上沿用站内已有的浅蓝标题栏、白色资料表和蓝橙强调色，让信息本身成为主角，支持长列表的快速扫描和逐层深入。

页面采用克制的平面层次和中等信息密度。活动、歌曲、专辑、角色、声优共用页头、搜索、筛选、表格、分节标题、链接和空状态；活动详情复用成熟的现场曲目表，版本、收录盘和出演关系通过真实链接继续展开。中文是界面语言，不用英文小标题、指标卡、装饰性注释或彩色侧边条制造层次。

**Key Characteristics:**

- 浅蓝标题栏与白底档案表构成统一骨架。
- 14px 起的正文、稳定列结构和紧凑留白服务长资料阅读。
- 蓝色链接承担跨库导航，橙色只用于强调和清除筛选等辅助动作。
- 桌面优先，同时在 390px 宽度下转换为可读的纵向资料块。

## Colors

冷静的纸张底色承接丰富的角色图像；深海军蓝负责正文和标题，浅蓝负责资料层级，蓝色负责可点击关系，红橙色保留站点识别与少量操作强调。

### Primary

- **档案蓝** (#d8e9f8)：资料页头、分节栏和场次标题的共同底色。
- **导航蓝** (#244f8c)：歌曲、活动、角色、声优和专辑之间的可点击关系。

### Secondary

- **品牌橙** (#ff8c1a)：站点品牌元素和需要被注意的辅助动作。
- **提醒红** (#d6001c)：全站已有的重点状态与焦点色，资料页中保持节制。

### Neutral

- **纸张灰** (#f5f4f9)：页面底色，避免纯白大面积刺眼。
- **白色** (#ffffff)：表格、资料区和输入控件的阅读表面。
- **海军蓝** (#20283b)：标题和主要文字。
- **正文灰** (#26272b)：常规信息文字。
- **边界灰** (#e6e4ee)：表格行分隔和控件边界。

**The One Archive Rule.** 同级资料页必须使用相同的浅蓝页头、工具栏、筛选、表格和分节结构；差异只来自内容关系，不来自另造一套界面。

## Typography

**Display Font:** Microsoft YaHei, with PingFang SC, Noto Sans SC and system sans-serif fallbacks.

**Body Font:** 同一中文无衬线字体栈，避免在资料页切换字体造成扫描断裂。

**Character:** 字体朴素、清晰、偏信息导向；粗体只标出标题、列名和可行动的记录，不用装饰性字距或等宽字体模拟“数据感”。

### Hierarchy

- **Display** (800, clamp(1.3rem, 3vw, 1.8rem), 1.3)：资料库页头和详情标题。
- **Headline** (800, 17px, 1.4)：白色资料区的分节标题。
- **Title** (700–800, 14–16px, 1.4)：表格记录、场次名称和可点击实体。
- **Body** (400, 14px, 1.5–1.75)：资料、来源、说明和表格内容。
- **Label** (700, 14px, 1.3)：筛选标签、表头、按钮和结果数量。

**The Readable Record Rule.** 资料页正文和可点击记录不低于 14px；13px 只用于次要日期、类型或来源辅助信息，不能承担主要内容。

## Layout

资料页使用单列档案流，内容在桌面端保持宽而不散，页头、筛选、表格和详情分节按固定顺序出现。页头以 18–22px 内边距建立入口，工具栏和筛选紧随其后，表格采用 14px 正文、10–14px 单元格内边距和清楚的横向分隔。详情页先展示活动或实体核心资料，再展示关系表，最后放媒体与来源。

搜索和下拉控件统一为 40px 高；筛选项使用同一组胶囊按钮，选中态为实色蓝，未选中态为无填充。桌面端筛选组水平排列，760px 以下改为纵向；560px 以下活动和歌曲索引表逐条堆叠，现场曲目和专辑表保留稳定可读的列宽并允许横向滚动，390px 页面不得出现意外溢出。

## Elevation & Depth

资料库采用平面优先的层次。白色资料区叠在纸张灰背景上，浅蓝标题栏和极细边界表达结构；档案表和关系卡不使用悬浮阴影或上移动画。全站旧页面仍有既有阴影，但新增和统一后的 #6 资料组件保持无阴影，以免把档案误读成仪表盘卡片。

**The Flat Archive Rule.** 默认状态只用背景色和边界分层；交互反馈使用浅蓝底色或边界变深，不用发光、浮起或渐变来抢夺内容注意力。

## Shapes

形状是克制的圆角矩形：资料容器约 8px，输入、按钮和链接约 6px，标签使用完整胶囊圆角。边界为浅灰或低饱和蓝，表格行不另套卡片；现场曲目表的场次标题与表格共享连续的上圆角轮廓。头像和封面保留内容本身的圆形或方形比例，不把每条关系包成独立彩色卡片。

## Components

### Buttons

- **Shape:** 轻微圆角（6px），40px 最小高度，中文标签保持清楚。
- **Primary:** 档案操作按钮使用实色蓝底白字，水平内边距 14px。
- **Hover / Focus:** 悬停变为更深蓝或浅蓝底；焦点使用 2px 可见轮廓，不移动布局。
- **Secondary / Ghost:** 关系链接和清除筛选使用白底或透明底蓝字，只有边界或底色变化。

### Chips

- **Style:** 34px 高、12px 水平内边距、胶囊形；未选中透明，悬停浅蓝。
- **State:** 选中使用实色蓝底白字；同一筛选组始终只有一个选中值。

### Cards / Containers

- **Corner Style:** 资料区 8px，内部详情和版本块 6–7px。
- **Background:** 页面纸张灰、内容白、标题档案蓝。
- **Shadow Strategy:** #6 资料库不使用阴影，依靠色调和边界表达层级。
- **Border:** 使用浅灰细线，表格内部用横向分隔。
- **Internal Padding:** 页头 18–22px，资料区 18px，移动端收窄到 12–16px。

### Inputs / Fields

- **Style:** 白底、浅灰边界、6px 圆角，40px 高；搜索图标内置但不喧宾夺主。
- **Focus:** 蓝色边界和轻微 3px 外圈，保持键盘可见。
- **Error / Disabled:** 文字和空状态直接说明原因；没有资料时展示诚实的“待补充/暂未收录”，不伪造内容。

### Navigation

- **Style:** 跨库关系使用统一蓝色文字按钮或链接；活动、歌曲、版本、专辑、角色和声优都可互相进入。
- **State:** 悬停下划线或浅蓝底；详情页提供返回来源入口，返回时恢复筛选和滚动语境。
- **Mobile:** 详情关系按纵向分节阅读，长表格使用局部横向滚动，不缩小到难以阅读。

### Archive Table

表格是本项目的签名组件：浅蓝表头、白底记录、细横线和悬停浅蓝行。活动详情直接复用已精调的现场曲目表，并在曲名、出演者和出典处提供关系链接；没有可靠数据时保留来源和明确的待补状态。

## Do's and Don'ts

### Do:

- **Do** 先复用已有档案表、页头、筛选和控件，再扩展数据关系。
- **Do** 把活动、歌曲、专辑、角色、声优的关系做成可点击的真实路径，并提供返回语境。
- **Do** 用浅蓝标题栏、白底资料表、蓝色链接和橙色辅助强调维持站内连续性。
- **Do** 在桌面和 390px 手机都保持 14px 以上的主要资料文字和 40px 控件。
- **Do** 为未发布、待补充和不适用信息保留明确状态，维护者可以据此继续更新。

### Don't:

- **Don't** 为活动详情或任何同级资料页另造一套不兼容的布局。
- **Don't** 使用英文小标题、指标卡、装饰性说明、彩色侧边条或卡片堆叠制造 AI 味道。
- **Don't** 把同一实体分别维护在多个重复索引中，或为了“完整”推测没有证据的出演关系。
- **Don't** 把主要信息压缩成小字，也不要用阴影、渐变和浮起动画替代清楚的结构。
- **Don't** 改写或覆盖人工精调的现场曲目来源。
