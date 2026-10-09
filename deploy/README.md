# 部署

当前站点固定使用 `/var/www/umamusume`，服务用户为 `alaemiryoung`，Node 监听 8080。HTTPS server block 包含该目录的 `deploy/nginx-uma-live-wiki.conf`。systemd 与 nginx 配置使用相同路径。

## 更新

服务器不需要 Git；更新脚本下载 main 快照，也接受本机 Git 打包：

```bash
curl -fsSL https://raw.githubusercontent.com/516735955/uma-live-wiki/main/deploy/update.sh | sudo bash
```

GitHub 无法访问时，在本机执行：

```bash
git archive --format=tar.gz -o uma-live-wiki-main.tgz main
```

上传压缩包和 update.sh 后，在服务器执行：

```bash
sudo bash update.sh /var/www/umamusume /路径/uma-live-wiki-main.tgz
```

常规更新保留服务器已有的全部 data 文件、翻译缓存及仓库外的图片和日志；首次部署才安装仓库底库。确认过的数据订正单独合并并运行相关生成器，不通过代码发布覆盖线上资料。只发布代码补丁时，压缩包可只包含已提交的运行文件。

脚本修正公开数据的读取权限，安装 systemd 单元，校验并重载 nginx，重启 Node，再通过公网运行部署检查。更换目录或用户需同时修改 systemd/nginx 配置，不能只改变脚本参数。

## 自动刷新

生产服务启动即后台更新新闻；官网新闻 TTL 为 15 分钟，CD 新闻为 30 分钟。源站失败时继续提供已有快照，超时请求不能发布过期结果。

角色、活动、专辑、官方节目按每 6 小时一条串行链路更新，单项抓取有超时。生成目录热加载，新闻更新不等待完整抓取结束。每天 02:00 的重启定时器与这些更新独立。

## 上线验证

```bash
node uma_tools/check_deployment.js https://umamusumelivewiki.top
systemctl is-active umamusume
```

根地址应跳转到 `/zh-Hans/`；详情直链、目录 API、新闻响应及带版本的前端资源都应可用。修改长期缓存的 CSS/JS 时同步增加 `?v=`，并在 PC 浏览器检查实际线上效果。
