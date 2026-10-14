// scheduler service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  const { execFile } = require("child_process");

  const KNOWLEDGE_SCRIPT = deps.path.join(__dirname, "sync_knowledge.py");

  let catalogRefreshRunning = false;

  function runCatalogRefresh(reason) {
    if (catalogRefreshRunning) return;
    catalogRefreshRunning = true;
    execFile(
      deps.PYTHON_BIN,
      [KNOWLEDGE_SCRIPT],
      { windowsHide: true, timeout: 6 * 60 * 60 * 1000, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } },
      (err, stdout, stderr) => {
        catalogRefreshRunning = false;
        if (stdout.trim())
          console.log("[knowledge " + reason + "]\n" + stdout.trim());
        if (err)
          console.error(
            "[knowledge " + reason + "] incomplete:",
            String(stderr || err.message || "")
              .trim()
              .split("\n")
              .pop(),
          );
      },
    );
  }

  const LANTIS_SCRIPT = deps.path.join(__dirname, "crawl_lantis_news.py");

  let lantisRunning = false;

  function runLantisCrawl(reason) {
    if (lantisRunning) return;
    lantisRunning = true;
    const t0 = Date.now();
    execFile(
      deps.PYTHON_BIN,
      [LANTIS_SCRIPT],
      { windowsHide: true, timeout: deps.LANTIS_CRAWL_TIMEOUT, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } },
      (err, stdout, stderr) => {
        lantisRunning = false;
        const tag = "[lantis-crawl " + reason + "]";
        if (err)
          console.log(
            tag,
            "FAILED:",
            String(stderr || err.message || "")
              .trim()
              .split("\n")
              .pop(),
          );
        else
          console.log(tag, "done in " + (((Date.now() - t0) / 1000) | 0) + "s");
        deps.reloadLantis();
        // 失败同样推进 TTL 标记（与新闻 fail() 相同的退避）：上游挂掉时最多每个 TTL 重试一次。
        deps.lantisAt = Date.now();
        // 抓取结果直接合并进 news_snapshot.json，不再重抓官网新闻来完成合并。
        if (!err) deps.publishLantisMerge();
      },
    );
  }
  function start() {}
  return {
    start,
    get lantisRunning() {
      return lantisRunning;
    },
    set lantisRunning(value) {
      lantisRunning = value;
    },
    runLantisCrawl,
    runCatalogRefresh,
  };
};
