export function animeFormatLabel(format) {
  return (
    {
      tv: "电视动画",
      movie: "剧场版",
      short: "短篇动画",
      web: "网络动画",
      special: "特别动画",
      unknown: "待公布",
    }[format] || "动画"
  );
}
export function animeStatusLabel(status) {
  return (
    { completed: "已完结", airing: "连载中", announced: "待播出" }[status] ||
    status ||
    "状态待补"
  );
}
export function animePlatformLabel(platform) {
  return (
    {
      youtube: "YouTube",
      bilibili: "哔哩哔哩",
      bahamut: "巴哈姆特动画疯",
      abema: "ABEMA",
      unext: "U-NEXT",
      official: "官方网站",
      official_site: "官方网站",
    }[platform] || platform
  );
}
