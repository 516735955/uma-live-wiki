const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream");
const { CatalogStore } = require("./catalog-store");
const { AnimeStore } = require("./anime-store");
const { mergeNews, NewsContent } = require("./news-content");
const { TranslationCache } = require("./translation-cache");
const { loadTerms, createTerms } = require("./translation-terms");
const { imageStore } = require("./news-images");
const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python" : "python3");
const CLI_ARGS = process.argv.slice(2);
const NO_AUTO_CRAWL = CLI_ARGS.includes("--no-crawl");
const POSITIONAL_ARGS = CLI_ARGS.filter((arg) => arg !== "--no-crawl");
const PORT = parseInt(POSITIONAL_ARGS[0] || "8080", 10);
const ROOT = fs.realpathSync(
  path.resolve(POSITIONAL_ARGS[1] || path.join(__dirname, "..")),
);
function autoCrawlDisabled() {
  if (NO_AUTO_CRAWL) return true;
  if (!process.env.UMA_ACTIVE_FILE) return false;
  try { return fs.readFileSync(process.env.UMA_ACTIVE_FILE, 'utf8').trim() !== ROOT + ':' + PORT; }
  catch (_) { return true; }
}
const releaseInfo = fs.existsSync(path.join(ROOT, "release.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "release.json"), "utf8"))
  : { commit: "development" };
const DATA_DIR = path.join(ROOT, "data");
const catalogStore = new CatalogStore(DATA_DIR);
const animeStore = new AnimeStore(DATA_DIR);
const horseStore = new (require("./horse-store").HorseStore)(DATA_DIR);
const loadNewsImage = imageStore(path.join(DATA_DIR, "news_image_cache"));
const loadRemoteImage = imageStore(path.join(DATA_DIR, 'news_image_cache'), { validateUrl: require('./media-url').remoteImage });
const { previewStore, localImageLoader } = require('./image-previews');
const previewImage = previewStore(path.join(DATA_DIR, 'news_image_cache', 'previews'), PYTHON_BIN);
const loadLocalPreview = localImageLoader(ROOT, previewImage);
const services = {};
services.static = require("./server-static").createService({
  path, ROOT, fs, zlib, pipeline,
});
services.transport = require("./server-transport").createService({
  https, zlib, requestAcceptsGzip: services.static.requestAcceptsGzip,
});
services.translation = require("./server-translation").createService({
  path, ROOT, fs, TranslationCache, DATA_DIR, createTerms, loadTerms, NewsContent, crypto, https,
});
services.catalog = require("./server-catalog").createService({
  catalogStore, crypto, horseStore, animeStore, sendJson: services.transport.sendJson,
});
services.news = require("./server-news").createService({
  path, DATA_DIR, fs, mergeNews, crypto,
  AUTO_CRAWL_DISABLED: NO_AUTO_CRAWL,
  get translationAvailable() { return services.translation.translationAvailable; },
  newsContent: services.translation.newsContent,
  httpsGet: services.transport.httpsGet,
  get NO_AUTO_CRAWL() {
    return autoCrawlDisabled();
  },
  translateTitle: services.translation.translateTitle,
  sendJson: services.transport.sendJson,
  translateArticle: services.translation.translateArticle,
  get lantisRunning() {
    return services.scheduler.lantisRunning;
  },
  get runLantisCrawl() {
    return services.scheduler.runLantisCrawl;
  },
  httpsGetHtml: services.transport.httpsGetHtml,
});
services.audio = require("./server-audio").createService({
  http, https, pipeline,
});
services.scheduler = require("./server-scheduler").createService({
  path, PYTHON_BIN,
  get NO_AUTO_CRAWL() { return autoCrawlDisabled(); },
  LANTIS_CRAWL_TIMEOUT: services.news.LANTIS_CRAWL_TIMEOUT,
  reloadLantis: services.news.reloadLantis,
  get lantisAt() {
    return services.news.lantisAt;
  },
  set lantisAt(value) {
    services.news.lantisAt = value;
  },
  publishLantisMerge: services.news.publishLantisMerge,
});
services.application = require("./server-application").createService({
  http, path, ROOT, fs, crypto, loadNewsImage, loadRemoteImage, previewImage, loadLocalPreview, PORT, catalogStore, releaseInfo,
  AUTO_CRAWL_DISABLED: NO_AUTO_CRAWL,
  sendJson: services.transport.sendJson,
  handleNewsIndex: services.news.handleNewsIndex,
  handleHomeSummary: services.catalog.handleHomeSummary,
  handleCatalogApi: services.catalog.handleCatalogApi,
  handleNewsDetail: services.news.handleNewsDetail,
  handleLantisNews: services.news.handleLantisNews,
  handleLantisDetail: services.news.handleLantisDetail,
  handleAudioProxy: services.audio.handleAudioProxy,
  isInsideRoot: services.static.isInsideRoot,
  MIME: services.static.MIME,
  serveFile: services.static.serveFile,
  get INDEX_FILE() {
    return services.static.INDEX_FILE;
  },
  reloadLantis: services.news.reloadLantis,
  get NO_AUTO_CRAWL() {
    return autoCrawlDisabled();
  },
  refreshNewsIndex: services.news.refreshNewsIndex,
  runCatalogRefresh: services.scheduler.runCatalogRefresh,
  ensureLantisFresh: services.news.ensureLantisFresh,
});
for (const service of Object.values(services)) service.start?.();
