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
const releaseInfo = fs.existsSync(path.join(ROOT, "release.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "release.json"), "utf8"))
  : { commit: "development" };
const DATA_DIR = path.join(ROOT, "data");
const catalogStore = new CatalogStore(DATA_DIR);
const animeStore = new AnimeStore(DATA_DIR);
const horseStore = new (require("./horse-store").HorseStore)(DATA_DIR);
const loadNewsImage = imageStore(path.join(DATA_DIR, "news_image_cache"));
const services = {};
services.static = require("./server-static").createService({
  get path() {
    return path;
  },
  get ROOT() {
    return ROOT;
  },
  get fs() {
    return fs;
  },
  get zlib() {
    return zlib;
  },
  get pipeline() {
    return pipeline;
  },
});
services.transport = require("./server-transport").createService({
  get https() {
    return https;
  },
  get requestAcceptsGzip() {
    return services.static.requestAcceptsGzip;
  },
  get zlib() {
    return zlib;
  },
});
services.translation = require("./server-translation").createService({
  get path() {
    return path;
  },
  get ROOT() {
    return ROOT;
  },
  get fs() {
    return fs;
  },
  get TranslationCache() {
    return TranslationCache;
  },
  get DATA_DIR() {
    return DATA_DIR;
  },
  get createTerms() {
    return createTerms;
  },
  get loadTerms() {
    return loadTerms;
  },
  get NewsContent() {
    return NewsContent;
  },
  get crypto() {
    return crypto;
  },
  get https() {
    return https;
  },
});
services.catalog = require("./server-catalog").createService({
  get catalogStore() {
    return catalogStore;
  },
  get sendJson() {
    return services.transport.sendJson;
  },
  get crypto() {
    return crypto;
  },
  get horseStore() {
    return horseStore;
  },
  get animeStore() {
    return animeStore;
  },
});
services.news = require("./server-news").createService({
  get path() {
    return path;
  },
  get DATA_DIR() {
    return DATA_DIR;
  },
  get newsContent() {
    return services.translation.newsContent;
  },
  get fs() {
    return fs;
  },
  get httpsGet() {
    return services.transport.httpsGet;
  },
  get mergeNews() {
    return mergeNews;
  },
  get NO_AUTO_CRAWL() {
    return NO_AUTO_CRAWL;
  },
  get translateTitle() {
    return services.translation.translateTitle;
  },
  get sendJson() {
    return services.transport.sendJson;
  },
  get crypto() {
    return crypto;
  },
  get translateArticle() {
    return services.translation.translateArticle;
  },
  get lantisRunning() {
    return services.scheduler.lantisRunning;
  },
  get runLantisCrawl() {
    return services.scheduler.runLantisCrawl;
  },
  get httpsGetHtml() {
    return services.transport.httpsGetHtml;
  },
});
services.audio = require("./server-audio").createService({
  get http() {
    return http;
  },
  get https() {
    return https;
  },
  get pipeline() {
    return pipeline;
  },
});
services.scheduler = require("./server-scheduler").createService({
  get path() {
    return path;
  },
  get PYTHON_BIN() {
    return PYTHON_BIN;
  },
  get LANTIS_CRAWL_TIMEOUT() {
    return services.news.LANTIS_CRAWL_TIMEOUT;
  },
  get reloadLantis() {
    return services.news.reloadLantis;
  },
  get lantisAt() {
    return services.news.lantisAt;
  },
  set lantisAt(value) {
    services.news.lantisAt = value;
  },
  get publishLantisMerge() {
    return services.news.publishLantisMerge;
  },
});
services.application = require("./server-application").createService({
  get http() {
    return http;
  },
  get sendJson() {
    return services.transport.sendJson;
  },
  get releaseInfo() {
    return releaseInfo;
  },
  get handleNewsIndex() {
    return services.news.handleNewsIndex;
  },
  get handleHomeSummary() {
    return services.catalog.handleHomeSummary;
  },
  get handleCatalogApi() {
    return services.catalog.handleCatalogApi;
  },
  get handleNewsDetail() {
    return services.news.handleNewsDetail;
  },
  get handleLantisNews() {
    return services.news.handleLantisNews;
  },
  get handleLantisDetail() {
    return services.news.handleLantisDetail;
  },
  get handleAudioProxy() {
    return services.audio.handleAudioProxy;
  },
  get path() {
    return path;
  },
  get ROOT() {
    return ROOT;
  },
  get isInsideRoot() {
    return services.static.isInsideRoot;
  },
  get fs() {
    return fs;
  },
  get loadNewsImage() {
    return loadNewsImage;
  },
  get MIME() {
    return services.static.MIME;
  },
  get serveFile() {
    return services.static.serveFile;
  },
  get INDEX_FILE() {
    return services.static.INDEX_FILE;
  },
  get PORT() {
    return PORT;
  },
  get reloadLantis() {
    return services.news.reloadLantis;
  },
  get catalogStore() {
    return catalogStore;
  },
  get NO_AUTO_CRAWL() {
    return NO_AUTO_CRAWL;
  },
  get refreshNewsIndex() {
    return services.news.refreshNewsIndex;
  },
  get runCatalogRefresh() {
    return services.scheduler.runCatalogRefresh;
  },
  get ensureLantisFresh() {
    return services.news.ensureLantisFresh;
  },
});
for (const service of Object.values(services)) service.start();
