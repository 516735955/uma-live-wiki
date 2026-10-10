# 部署

站点使用 `/var/www/umamusume`，服务用户由部署配置指定，Node 监听 8080。`current` 指向正在发布的代码目录；`shared/data`、翻译缓存和图片跨版本保留。

## 更新

服务器自动解析 main 的具体提交、下载该提交并生成资源：

```bash
curl -fsSL https://raw.githubusercontent.com/516735955/uma-live-wiki/main/deploy/update.sh | sudo bash
```

本机发布已提交的确定版本：

```bash
node deploy/package-release.js HEAD /tmp/uma-release.tgz
```

上传压缩包和 update.sh 后：

```bash
sudo bash update.sh /var/www/umamusume /tmp/uma-release.tgz
```

发布串行执行，旧提交不能覆盖已上线的新提交。新版本先使用线上数据启动临时实例并检查，再切换 `current`、重载 nginx、重启正式服务。公网验证失败时恢复上一版代码和配置，不回退或覆盖运行数据。

保留当前与上一版代码，其他旧代码版本自动清理；两版引用的资源始终保留，其他内容版本资源至少保留 30 天，供已打开的页面使用。相同内容共用同一个文件。首次切换保留原部署文件作为迁移恢复入口。普通发布不覆盖任何已有 data、照片和翻译缓存；确认后的资料订正继续使用项目维护工具增量合并。

## 资源与版本

`prepare-release.js` 自动处理页面、懒加载和血统 iframe 的 JS/CSS 引用，资源按内容生成文件名。入口 HTML 和可变 data JS 重新校验，`assets` 长期缓存。已打开的上一版页面仍可读取原资源，不需用户清缓存。

`/api/release` 返回进程启动时的提交；入口 HTML 和 release.json 记录同一提交。检查实际运行版本，不以文件复制成功代替上线成功。

## 自动刷新

新闻启动即后台更新；官网新闻 TTL 为 15 分钟，CD 新闻为 30 分钟。角色、活动、专辑、官方节目每 6 小时串行更新，单项抓取有超时。每日 02:00 重启与抓取独立。

## 验证

```bash
node deploy/test_release.js
node uma_tools/check_deployment.js https://umamusumelivewiki.top <完整提交号>
systemctl is-active umamusume
```

部署检查针对准备好的发布包，核对 HTML、进程、发布包提交及全部入口/懒加载资源，并检查根地址、直链、目录 API 和新闻快照。PC 实际交互使用现有回归场景复核。
