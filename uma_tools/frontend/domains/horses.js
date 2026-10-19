/* horses state and behavior; external dependencies are explicit live ports. */
export function createHorses(deps) {
  let pedigreeLoadPromise = null;

  let pedigreeMetaLoadPromise = null;

  const pedigreeStatus = deps.ref("idle");

  const pedigreeError = deps.ref("");

  const charHasPedigree = deps.computed(function () {
    const id = deps.charDetail.value && deps.charDetail.value.id;
    const meta = window.CHARACTER_PEDIGREE_META || {};
    return !!id && (meta.available || []).indexOf(id) >= 0;
  });

  const otherSection = deps.ref("relationships");

  const horsesList = deps.ref([]);

  const horsesTotal = deps.ref(0);

  const horsesPagedByApi = deps.ref(false);

  let horseListRevision = 0;

  const horsesListError = deps.ref("");

  const horseDetail = deps.ref(null);

  const horseQuery = deps.ref("");

  const horsePage = deps.ref(1);

  const horseSex = deps.ref("");

  const horseSort = deps.ref("newest");

  const horseSexOptions = [
    { value: "", label: "全部" },
    { value: "male", label: "牡马" },
    { value: "female", label: "牝马" },
    { value: "gelding", label: "阉马" },
  ];

  const horseSortOptions = [
    { value: "newest", label: "出生日期（新→老）" },
    { value: "oldest", label: "出生日期（老→新）" },
    { value: "name", label: "名称" },
  ];

  const horsesPerPage = 30;

  let horsesDataPromise = null;

  let horsesListPromise = null;

  let horseIndexUpdatedAt = Date.now();

  function loadHorsesListData(params) {
    horsesListError.value = "";
    const paged = deps.currentUrlPath().split("?")[0] === deps.routes.horses();
    if (
      !paged &&
      window.HORSES &&
      window.HORSES.length &&
      Date.now() - horseIndexUpdatedAt < 300000
    ) {
      horsesList.value = window.HORSES;
      return Promise.resolve();
    }
    const revision = ++horseListRevision;
    const requested = paged
      ? params || {
          q: horseQuery.value,
          sex: horseSex.value,
          sort: horseSort.value,
          page: horsePage.value,
          page_size: horsesPerPage,
        }
      : { scope: "index" };
    const query = paged
      ? {
          q: requested.q,
          sex: requested.sex || "",
          sort: requested.sort || "newest",
          page: requested.page,
          page_size: horsesPerPage,
        }
      : requested;
    horsesListPromise = deps.api
      .request("/api/catalog/horses" + deps.api.query(query))
      .then(function (data) {
        if (revision !== horseListRevision) return;
        if (!data || !Array.isArray(data.items))
          throw new Error("invalid horses list");
        horsesPagedByApi.value = paged;
        horsesList.value = data.items;
        horsesTotal.value = data.total;
        if (paged) horsePage.value = data.page;
        else {
          window.HORSES = data.items;
          horseIndexUpdatedAt = Date.now();
        }
      })
      .catch(function () {
        if (revision === horseListRevision) {
          horsesListPromise = null;
          horsesListError.value = "原型马目录暂时无法载入，请重试。";
        }
        throw new Error("horses list load failed");
      });
    return horsesListPromise;
  }

  const curatedVideos = [
    { id: "BV1N83n6YEyT", title: "“笨蛋，我一直都认可你啊！”" },
    { id: "BV1sRw2ezEXZ", title: "我以世纪大逃 换你奇迹复活" },
    { id: "BV1jF411B7sw", title: "无败的陨落，奇迹的复活「T.E.I.O」" },
    { id: "BV1J5411Q7Do", title: "场上的嘘声对于“反派”的她却是最好的勋章" },
    { id: "BV1Az4y1c7NU", title: "三匹三冠马的对决：特殊的时代" },
    { id: "BV1Q1HUzaE6H", title: "Never give up" },
    { id: "BV1FH4y1z78L", title: "不是所有的马都是卡莲酱的，池添" },
    { id: "BV1vz4y1Y7M3", title: "船哥与121亿日元" },
    { id: "BV1PyfDBaEUE", title: "1993 有马纪念：他们都说我赢不了" },
    { id: "BV12G411r72u", title: "曾风光无限的目白牧场为何解散？" },
    { id: "BV1WY411Y7o5", title: "一匹赛马能为已逝的人类母亲做什么？" },
    { id: "BV1zA411L7YT", title: "一代芦毛马传奇：小栗帽" },
    { id: "BV1znUwB4ELs", title: "后来，那个时代被称为黄金时代" },
    { id: "BV1kSLdznEGS", title: "你强任你强，我有三冠王" },
    { id: "BV1dt4y1o7x1", title: "这就是男子汉的谢幕之际" },
  ];

  function loadPedigreeMeta() {
    if (pedigreeMetaLoadPromise) return pedigreeMetaLoadPromise;
    const source = "/data/character_pedigree_meta.js";
    pedigreeMetaLoadPromise = deps
      .loadDataScript(source, "CHARACTER_PEDIGREE_META")
      .catch(function () {
        delete deps.dataScriptPromises[source];
        pedigreeMetaLoadPromise = null;
      })
      .finally(function () {
        pedigreeMetaLoadPromise = null;
      });
    return pedigreeMetaLoadPromise;
  }

  function loadPedigreeData() {
    if (pedigreeLoadPromise) return pedigreeLoadPromise;
    pedigreeStatus.value = "loading";
    pedigreeError.value = "";
    const source = "/data/pedigree_data.js";
    pedigreeLoadPromise = Promise.all([
      deps.loadCharacterUi(),
      deps.loadDataScript(source, "PED_REL"),
    ])
      .then(function () {
        if (!window.PED_REL || !window.PED_REL.length)
          throw new Error("empty pedigree data");
        pedigreeStatus.value = "ready";
        Vue.nextTick(renderCharBlood);
      })
      .catch(function () {
        pedigreeLoadPromise = null;
        delete deps.dataScriptPromises[source];
        pedigreeStatus.value = "error";
        pedigreeError.value = "血统资料暂时无法载入，请重试。";
      })
      .finally(function () {
        pedigreeLoadPromise = null;
      });
    return pedigreeLoadPromise;
  }

  function retryPedigree() {
    loadPedigreeData().then(function () {
      Vue.nextTick(renderCharBlood);
    });
  }

  function loadHorsesData(id) {
    id = id || decodeURIComponent(deps.routeSegments()[2] || "");
    if (!id) return loadHorsesListData();
    horsesListError.value = "";
    const sourcePath = deps.currentUrlPath();
    const navigation = deps.navigationRevision.value;
    horsesDataPromise = deps.api.request("/api/catalog/horse" + deps.api.query({ id }))
      .then(function (data) {
        if (!data?.horse) throw new Error("empty horse data");
        window.HORSES_DETAIL = { ...window.HORSES_DETAIL, [id]: data.horse };
      })
      .catch(function (error) {
        horsesDataPromise = null;
        if (error.message === "HTTP 404") {
          window.HORSES_DETAIL = { ...window.HORSES_DETAIL, [id]: null };
          return;
        }
        if (sourcePath === deps.currentUrlPath() && navigation === deps.navigationRevision.value)
          horsesListError.value = "原型马资料暂时无法载入，请重试。";
        throw error;
      });
    return horsesDataPromise;
  }

  function retryHorses() {
    return loadHorsesData().catch(() => {});
  }

  function setOtherSection(section) {
    if (
      ["relationships", "videos", "horses", "jockeys"].indexOf(section) === -1
    )
      return;
    otherSection.value = section;
    horseDetail.value = null;
    if (section === "horses")
      loadHorsesListData().catch(function () {
        horsesListError.value = "原型马目录暂时无法载入，请重试。";
      });
    deps.pushUrl();
  }

  const horseFiltered = deps.computed(function () {
    if (horsesPagedByApi.value) return horsesList.value;
    let rows = horsesList.value.slice();
    const query = String(horseQuery.value || "")
      .trim()
      .toLowerCase();
    if (query) {
      rows = rows.filter(function (horse) {
        return (
          String(horse.zh || "")
            .toLowerCase()
            .indexOf(query) !== -1 ||
          String(horse.ja || "")
            .toLowerCase()
            .indexOf(query) !== -1 ||
          String(horse.en || "")
            .toLowerCase()
            .indexOf(query) !== -1 ||
          String(horse.birthdate || "").indexOf(query) !== -1
        );
      });
    }
    return rows;
  });

  const horsePaged = deps.computed(function () {
    if (horsesPagedByApi.value) return horsesList.value;
    const start = (horsePage.value - 1) * horsesPerPage;
    return horseFiltered.value.slice(start, start + horsesPerPage);
  });

  const horsePageCount = deps.computed(function () {
    return Math.max(
      1,
      Math.ceil(
        (horsesPagedByApi.value
          ? horsesTotal.value
          : horseFiltered.value.length) / horsesPerPage,
      ),
    );
  });

  const horsePageStart = deps.computed(function () {
    return horseFiltered.value.length
      ? (horsePage.value - 1) * horsesPerPage + 1
      : 0;
  });

  const horsePageEnd = deps.computed(function () {
    return Math.min(
      horsePage.value * horsesPerPage,
      horsesPagedByApi.value ? horsesTotal.value : horseFiltered.value.length,
    );
  });

  const horsePageList = deps.computed(function () {
    return deps.pagerList(horsePage.value, horsePageCount.value);
  });

  function setHorsePage(page) {
    const next = Math.min(Math.max(1, Number(page) || 1), horsePageCount.value);
    horsePage.value = next;
    if (horsesPagedByApi.value) loadHorsesListData().catch(() => {});
    deps.resetPageScroll();
    deps.pushUrl();
  }

  function goHorsePage(page) {
    setHorsePage(horsePage.value + page);
  }

  function openHorse(id) {
    const isCurrent = deps.beginEntityNavigation();
    const show = function () {
      if (!isCurrent()) return;
      if (!window.HORSES_DETAIL || !window.HORSES_DETAIL[id]) return;
      deps.clearEntityDetails("horse");
      deps.activeTab.value = "database";
      deps.dbView.value = "other";
      otherSection.value = "horses";
      horseDetail.value = window.HORSES_DETAIL[id];
      horseQuery.value = "";
      deps.resetPageScroll();
      deps.pushUrl();
    };
    return Promise.resolve(loadHorsesData(id)).then(show, show);
  }

  const horseMajorExpanded = deps.ref(false);

  function horseRaceRows(detail) {
    const rows = (detail.races || []).slice();
    const dates = new Set(
      rows
        .map((row) => row.date)
        .filter((date) => /^\d{4}\.\d{2}\.\d{2}$/.test(date)),
    );
    const keys = new Set(rows.map((row) => row.date + ":" + row.race));
    (detail.major || []).forEach((row) => {
      const key = row.date + ":" + row.race;
      if (dates.has(row.date) || keys.has(key)) return;
      rows.push(row);
      keys.add(key);
    });
    return rows;
  }

  const horseMajorTotal = deps.computed(function () {
    const detail = horseDetail.value || {};
    return horseRaceRows(detail).length;
  });

  function horseGradeFor(race, date, track) {
    if (!window.HORSES_DETAIL || !track || !/^\\d{4}[.-]\\d{2}[.-]\\d{2}$/.test(String(date || ""))) return "";
    const grades = new Set();
    Object.values(window.HORSES_DETAIL).forEach(function (horse) {
      [...(horse?.races || []), ...(horse?.major || [])].forEach(function (row) {
        if (row.race === race && row.date === date && row.track === track && row.grade) grades.add(row.grade);
      });
    });
    return grades.size === 1 ? [...grades][0] : "";
  }

  const horseMajorRows = deps.computed(function () {
    const detail = horseDetail.value || {};
    const source = horseRaceRows(detail);
    const rows = source.map(function (row) {
      const place = String(row.place == null ? "" : row.place).trim();
      const distance = String(row.distance || "");
      return {
        date: row.date || "",
        track: row.track || "",
        race: row.race || "",
        grade: row.grade || horseGradeFor(row.race, row.date, row.track) || "",
        placeLabel: /^\d+$/.test(place) ? place + "着" : place || "—",
        surface: row.surface || "",
        distance: distance
          ? /\d$/.test(distance)
            ? distance + "m"
            : distance
          : "",
        top: row.winner || row.beaten || "",
        prize: row.prize || "",
      };
    });
    rows.sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    return horseMajorExpanded.value ? rows : rows.slice(0, 10);
  });

  function toggleHorseMajor() {
    horseMajorExpanded.value = !horseMajorExpanded.value;
  }

  const horseFacts = deps.computed(function () {
    const facts = (horseDetail.value && horseDetail.value.facts) || {};
    const defs = [
      ["sire", "父系"],
      ["dam", "母系"],
      ["damsire", "外祖父"],
      ["owner", "马主"],
      ["breeder", "生产牧场"],
      ["farm", "牧场"],
      ["trainer", "调教师"],
      ["stable", "厩舍"],
      ["record", "战绩"],
      ["earnings", "总赏金"],
      ["registration", "登记"],
      ["country", "产地"],
    ];
    return defs
      .filter(function (entry) {
        return String(facts[entry[0]] || "").trim();
      })
      .map(function (entry) {
        return { name: entry[1], value: String(facts[entry[0]]).trim() };
      });
  });

  function horseSexLabel(horse) {
    const sex = horse && horse.sex;
    if (sex === "male") return "牡马";
    if (sex === "female") return "牝马";
    if (sex === "gelding") return "阉马";
    return "—";
  }

  function horseForCharacter(characterId) {
    const normalized = String(characterId || "").toLowerCase();
    let pool = window.HORSES && window.HORSES.length ? window.HORSES : [];
    if (!pool.length && window.HORSES_DETAIL)
      pool = Object.keys(window.HORSES_DETAIL).map(function (key) {
        return window.HORSES_DETAIL[key];
      });
    for (let i = 0; i < pool.length; i++) {
      const horse = pool[i];
      if (String(horse.id || "").toLowerCase() === normalized) return horse;
      if (
        (horse.cids || []).some(function (cid) {
          return String(cid || "").toLowerCase() === normalized;
        })
      )
        return horse;
    }
    return null;
  }

  function horseUrlForCharacter(characterId) {
    const horse = horseForCharacter(characterId);
    return horse ? deps.routes.horses(horse.id) : "";
  }

  const horseVideos = {
    "sakurabakushino": [{ id: "BV12K4y1N78N", title: "短途领域的爆进之王" }],
    "haruurara": [{ id: "BV1xp4y1t7VS", title: "百战百败努力家，不胜传说乌拉拉" }],
    "symbolirudolf": [{ id: "BV1264y1m7qa", title: "我以不败身姿，傲立三冠之列（上）" }, { id: "BV1if4y1s71V", title: "七冠荣光退役，归来仍是皇帝（下）" }],
    "oguricap": [{ id: "BV1BN411o7Nw", title: "传说的开始！芦毛怪物诞生！（上）" }, { id: "BV1D64y1d7Rv", title: "芦毛怪物VS白色闪电！小栗帽三战玉藻十字（中）" }, { id: "BV1nh411e7Y4", title: "平成三强的激斗，芦毛怪物有终之美！（下）" }],
    "biwahayahide": [{ id: "BV1YV411s7dg", title: "傲立三强我以晨光之名，头顶青天高举芦毛终旗！" }],
    "mejiromcqueen": [{ id: "BV1gK4y1M7nE", title: "芦毛三代连霸G1，天皇赏春目白传说（上）" }, { id: "BV1Ro4y1X7pK", title: "目白麦昆VS东海帝皇，92年春世纪之战！（下）" }],
    "taikishuttle": [{ id: "BV1GU4y1H7uX", title: "漂亮的尾花栗，无败的英里王！（上）" }, { id: "BV1Mq4y197Zv", title: "风中疾走的金色闪电，雨下跃动的尾花栗毛！（下）" }],
    "inesfujin": [{ id: "BV1JU4y1E7PJ", title: "20万人的日本德比，燃烧生命的一逃到底！" }],
    "nicenature": [{ id: "BV1tA411c79B", title: "有马三着的传说，独一无二的荣耀！" }],
    "hishiamazon": [{ id: "BV1b64y1a7uK", title: "狂气追走炸裂末脚！漆黑的女杰菱亚马逊" }],
    "grasswonder": [{ id: "BV1gU4y1F7E6", title: "栗毛怪物再出世，踏雪无痕草上飞（上）" }, { id: "BV1EL4y1q7Xx", title: "终点前草特交锋，毫厘间决定胜负（下）" }],
    "seiunsky": [{ id: "BV1AQ4y1i7Dn", title: "划过青空的闪电，刻铭心中的逃亡！" }],
    "riceshower": [{ id: "BV1hR4y1g7Gk", title: "虽无钢铁不坏躯，却有青岭英雄魂（上）" }, { id: "BV1pT4y1m7z3", title: "跨越了肉体灵魂，疾驰于天堂彼岸（下）" }],
    "zennorobroy": [{ id: "BV1a44y1L7cV", title: "秋行王道三冠征途，疾行荒漠善战英雄" }],
    "fujikiseki": [{ id: "BV1Wr4y1a7Gk", title: "虽承父相终大器未完，无事名驹即富士奇石" }],
    "goldship": [{ id: "BV1vb4y1s72Y", title: "漂移过弯初露怪物锋芒 ，上坡加速尽显英雄本色（上）" }, { id: "BV1AR4y157op", title: "黄金战舰开创伟大航路，连霸宝冢再续芦毛传说（中）" }, { id: "BV1DZ4y167Wg", title: "三战天春不负麦昆血脉，奋身抬腿力劝马迷戒赌（下）" }],
    "supercreek": [{ id: "BV16i4y1C7Tb", title: "稚嫩天才邂逅初恋，此般相遇一生几何" }],
    "sakuralaurel": [{ id: "BV1fu411v7zq", title: "力战三冠势破两强，残樱终迎满开之时！" }],
    "kitasanblack": [{ id: "BV19B4y127p5", title: "越战越勇终贯彻王道，彻夜高声奏祭典之歌！（上）" }, { id: "BV1bT4y1r7Eu", title: "满身泥泞斗伏兵强敌，身披七冠展最后英姿（下）" }],
    "vodka": [{ id: "BV1qG411x7mU", title: "巾帼之身鏖战德比，反叛英姿勇斗强敌（上）" }, { id: "BV1H34y1H768", title: "宿命之敌决战府中，女帝之名响彻东京（下）" }],
    "sweeptosho": [{ id: "BV19S4y177jQ", title: "刁蛮任性大小姐，暴走狂气小魔女" }],
    "nakayamafesta": [{ id: "BV1VB4y187ns", title: "寥寥一生胜负，漫漫长路追梦" }],
    "silencesuzuka": [{ id: "BV1oW4y1b7CF", title: "半生起伏半生跌踉，乘风飞翔向梦的彼方（上）" }, { id: "BV1iV4y1W7vN", title: "一生速度一生梦幻，化作天马愿真心永恒（下）" }],
    "manhattancafe": [{ id: "BV1nG4y1Q74v", title: "不鸣则已，一鸣惊人！" }],
    "junglepocket": [{ id: "BV1mz4tzyERT", title: "打开新时代之门" }],
    "agnestachyon": [{ id: "BV1ki421X7xq", title: "他仅凭四场比赛便成为了传奇\"幻之三冠马" }],
    "mejiropalmer": [{ id: "BV13V4y1N7DB", title: "跌宕起伏我仍不屈不挠，昂首高歌梦想追逐闪耀" }],
    "tmoperao": [{ id: "BV1Tg411i7CS", title: "天生耀眼神明为之嫉妒，连战不捷拉开传说序幕（上）" }, { id: "BV1x24y1a7Gp", title: "创不败传说得万人景仰，奏霸王凯歌令群马俯首（中）" }, { id: "BV16k4y1473R", title: "登上山巅直面七冠高墙，唯一无二王朝终将落幕（终）" }],
    "mrcb": [{ id: "BV13H4y1o7iP", title: "疾驰，飞驰，腾驰，在温暖的大地（上）" }, { id: "BV1ke411X7GH", title: "丢弃，抛弃，舍弃，那仅剩的尊严（下）" }],
    "tamamocross": [{ id: "BV1WB421z7Dz", title: "那悲哀的胆怯的马儿，早已随着故乡一起死去（上）" }, { id: "BV1pD421j7z8", title: "那勇敢的迅疾的闪电，将最初的梦想不断延续（下）" }],
    "hishimiracle": [{ id: "BV1Tx421S7E9", title: "以奇迹为名，令天地倒转" }],
    "staygold": [{ id: "BV1W9FSz8Eut", title: "褪去昔日旧枷锁，今日方知我是我" }],
    "buenavista": [{ id: "BV1kVZABWEzy", title: "名雌辈出，我依旧是正统女主角（上）" }, { id: "BV1t1AizuE8H", title: "屡次吃瘪，你仍然集一生所偏爱（下）" }],
    "mejiroramonu": [{ id: "BV1sbRbBtE2v", title: "青鬃踏雪完美小姐驾到，一骑绝尘三冠女王登顶" }],
    "twinturbo": [{ id: "BV1d3VG68EBu", title: "除了逃，再无其他活法" }],
    "mayanotopgun": [{ id: "BV1AT4y1Y7xd", title: "变幻自在的英里天才少女——摩耶重炮" }],
    "agnesdigital": [{ id: "BV1yR4y1p7Fz", title: "全能贵公子为何如此变态？——爱丽数码" }],
    "specialweek": [{ id: "BV1sL4y1e7wN", title: "特能吃的外交总大将——特别周" }],
    "tokaiteio": [{ id: "BV1yq4y1s77y", title: "三度骨折仍复活的奇迹不死鸟——东海帝王" }],
    "nishinoflower": [{ id: "BV1K64y1r7fa", title: "闪耀的短跑少女——西野花" }],
    "matikanetannhauser": [{ id: "BV1h54y1V79w", title: "主角身后的努力家——待兼诗歌剧" }],
    "daiwascarlet": [{ id: "BV1uK4y1N7SX", title: "世纪死对头——大和赤骥" }],
    "akikawayayoi": [{ id: "BV1d64y1S7Lg", title: "理事长也是马娘？北方风味" }],
    "mihonobourbon": [{ id: "BV1Hw4m1e7mg", title: "凭努力硬刚血统，败于命运的挑战者——美浦波旁" }],
    "casinodrive": [{ id: "BV1iVDMBVErK", title: "CY为何选娱乐场作为远征引路人？" }],
    "elcondorpasa": [{ id: "BV1LUZ7BdEdf", title: "非冠即亚的天才！3G1进殿堂——神鹰" }],
    "copanorickey": [{ id: "BV18hrEBuEws", title: "272倍赔率下取胜的传奇——小林历奇" }],
    "wonderacute": [{ id: "BV1C5BKBDEJV", title: "老骥伏枥，志在千里——奇锐骏" }],
    "luckylilac": [{ id: "BV1RDbpzmEoe", title: "若无杏目，她早已成为传奇——旺紫丁" }],
    "admiregroove": [{ id: "BV1vUn2zZEnP", title: "传承至未来的名血——爱慕律动" }],
    "chronogenesis": [{ id: "BV1rSGAzfEfg", title: "首位春秋三连霸母马——创世驹" }],
    "lovesonlyyou": [{ id: "BV1mWLmzKEME", title: "发光→低谷→完全闪耀——唯独爱你" }],
    "granalegria": [{ id: "BV1r9ZBYYEBq", title: "其名为胜利的欢呼声——放声欢呼" }],
    "fenomeno": [{ id: "BV1epR4Y5EjJ", title: "并非无端COS承太郎——超常骏骥" }],
    "durandal": [{ id: "BV1ivAnenE1Y", title: "以圣剑为名的短英强者——多旺达" }],
    "naritabrian": [{ id: "BV1cxkmYSEje", title: "20世纪名马第一位——成田白仁" }],
    "astonmachan": [{ id: "BV15N4y1w79e", title: "转瞬即逝的跑车" }],
    "rheinkraft": [{ id: "BV1ueC1Y8EvC", title: "早逝的变则二冠母马——莱茵力量" }],
    "cesario": [{ id: "BV1DS2JYPER9", title: "来自日本的超级巨星——西沙里奥" }],
    "daringtact": [{ id: "BV1oWtxe8Euf", title: "首位无败三冠母马——谋勇兼备" }],
    "neouniverse": [{ id: "BV1EwptedEPb", title: "神秘宇宙——新宇宙" }],
    "finemotion": [{ id: "BV1QHWPemEHS", title: "与这样的马比赛，她对手太可怜——美妙姿势" }],
    "dreamjourney": [{ id: "BV1WHY9ePEKE", title: "没有他，就没有黄金巨匠和黄金船——梦之旅" }],
    "symbolikriss": [{ id: "BV1Eb42177oK", title: "漆黑的帝王——吉兆" }],
    "daiichiruby": [{ id: "BV1eS42197aU", title: "因想成为母亲而退役——第一红宝石" }],
    "dantsuflame": [{ id: "BV1wZ421s7Ty", title: "电影主角团一员的悲剧原型——烈焰快驹" }],
    "noreason": [{ id: "BV1Vi421k7jh", title: "名为莫名其妙的赛马有多莫名其妙？" }],
    "chevalgrand": [{ id: "BV1Lm41127vd", title: "5分钟了解高尚骏逸的原型故事" }],
    "vivlos": [{ id: "BV1Vr421V7eS", title: "5分钟了解强击的原型故事" }],
    "verxina": [{ id: "BV1P1421U7HW", title: "极峰成为女版怒涛的背后玄机" }],
    "gentildonna": [{ id: "BV1aD421L763", title: "竟有这样的母马——贵妇人" }],
    "stillinlove": [{ id: "BV1Gu4m137uE", title: "自带病娇属性的爱如往昔" }],
    "hokkotarumae": [{ id: "BV1sH4y1E7or", title: "能成为城市观光大使的北港火山" }],
    "smartfalcon": [{ id: "BV14K411h7bL", title: "连战连胜反而风评下降——醒目飞鹰" }],
    "bamboomemory": [{ id: "BV1va4y127fM", title: "初代短距离王者——青竹回忆" }],
    "inarione": [{ id: "BV1Hw41147nz", title: "从地方转中央并青史留名——稻荷一" }],
    "satonocrown": [{ id: "BV1we41197gZ", title: "北部玄驹真正的青梅竹马——里见皇冠" }],
    "satonodiamond": [{ id: "BV1nC4y1V78Y", title: "6分钟了解里见光钻的原型故事" }],
    "duramente": [{ id: "BV1Ew411X7VU", title: "未能复活的帝王——大鸣大放" }],
    "maruzensky": [{ id: "BV1Go4y1P7FG", title: "充满遗憾的强者——丸善斯基" }],
    "meishodoto": [{ id: "BV1mu411W74T", title: "世纪末倒霉蛋——名将怒涛" }],
    "naritatoproad": [{ id: "BV13s4y1R7ou", title: "三年未胜G1，得票仍是第一——成田路" }],
    "currenchan": [{ id: "BV1NX4y1R7aH", title: "人爱马敬的闪光少女——真机伶" }],
    "airshakur": [{ id: "BV1eG4y1P7op", title: "最惨准三冠马——空中神宫" }],
    "shinkowindy": [{ id: "BV1ds4y1h7pQ", title: "咬马是故意的——新光风" }],
    "kawakamiprincess": [{ id: "BV1aY411i7UJ", title: "凶暴又娇贵的实力派——川上公主" }],
    "ksmiracle": [{ id: "BV1xD4y1N7s5", title: "被人为摧毁的奇迹——凯斯奇迹" }],
    "tosenjordan": [{ id: "BV1nG4y1U7RS", title: "苦心马，天不负——东瀛佐敦" }],
    "mejirobright": [{ id: "BV1Ky4y1X73x", title: "'庸才'的逆袭——目白光明" }],
    "matikanefukukitaru": [{ id: "BV1Y8411w7eg", title: "承兄之福，弥兄之憾——待兼福来" }],
    "hishiakebono": [{ id: "BV1MM411875C", title: "大体重的奇迹——菱曙" }],
    "sakurachiyonoo": [{ id: "BV12Y41197px", title: "燃尽一切的奇迹逆转——樱花千代王" }],
    "mejiroryan": [{ id: "BV1kx4y137cM", title: "目白赖恩与横山典弘的友情" }],
    "admirevega": [{ id: "BV1H14y1u7hy", title: "燃尽一切，只为不负亡兄——爱慕织姬" }],
    "katsuragiace": [{ id: "BV1pHcJeWEzn", title: "从'废马'到'日本的王牌'——葛城王牌" }],
    "foreveryoung": [{ id: "BV1iQPVzfEqA", title: "CY家的太子有多强？——青春永驻" }],
    "victoirepisa": [{ id: "BV1m2QFBkEgb", title: "他的胜利为日本带来了勇气和希望——比萨胜驹" }],
    "marchelorraine": [{ id: "BV1zdXsBiEct", title: "人气倒数爆大冷，G1首胜创造历史——洛林军歌" }],
    "orfevre": [{ id: "BV1PM411y7Zz", title: "黄金巨匠！脑子有问题的超强赛马" }],
    "winningticket": [{ id: "BV1sv4y1W7i8", title: "纪念最近离世的胜利奖券" }],
    "almondeye": [{ id: "BV1MZ42187ds", title: "杏目，9个G1的母马三冠王" }],
    "titleholder": [{ id: "BV195HpzoE5K", title: "领衔！阪神竞马场的领跑王者" }],
    "venuspaques": [{ id: "BV18C4y1L79h", title: "卓芙！击碎日本马凯旋门冠军梦" }],
    "darleyarabian": [{ id: "BV1WGfCBgEWK", title: "达利阿拉伯 Darley Arabian" }],
    "godolphinbarb": [{ id: "BV1trNAzSEcn", title: "高多芬阿拉伯 Godolphin Barb" }],
    "byerleyturk": [{ id: "BV1CcfqBWECy", title: "拜耶尔土耳其 Byerley Turk" }],
    "haiseiko": [{ id: "BV1Q7nAzcESe", title: "20世纪的名马 第8位 海塞克" }],
    "airgroove": [{ id: "BV15XfdBhEdC", title: "20世纪的名马 第9位 气槽" }],
    "mejirodober": [{ id: "BV1yEZrBeEar", title: "20世纪的名马 第19位 目白多伯" }],
    "northflight": [{ id: "BV1jqcTzNEvv", title: "20世纪的名马 第35位 北方飞翔" }],
    "daitakuhelios": [{ id: "BV179PizoE5y", title: "20世纪的名马 第73位 大拓太阳神" }],
    "phalaenopsis": [{ id: "BV18s8B6vEU9", title: "20世纪的名马 第85位 蝴蝶兰" }],
    "hayakawatazuna": [{ id: "BV1x44y1H7CJ", title: "20世纪的名马 第44位 丰收时刻" }],
    "rigantona": [{ id: "BV1E4JCzpEaY", title: "名马传说--Dancing Brave 勇舞者" }],
    "saintlite": [{ id: "BV1iS4y1c7WM", title: "三冠马之路—圣烈特 " }],
    "speedsymboli": [{ id: "BV1fJPueREut", title: "时代的先驱，日本速度的象征！" }],
    "bochuzoku": [{ id: "BV1ZMt563Ezj", title: "【世界の名马】望族(モンジュー Moutjeu)" }],
    "yukinobijin": [{ id: "BV1614y1e78m", title: "雪之美人 专属特殊胜利实况" }],
    "marveloussunday": [{ id: "BV1gPy5YCEeB", title: "瑰丽的强者灵魂！美丽周日原型介绍！" }],
    "yamaninzephyr": [{ id: "BV1Vm4y1w7c8", title: "傲人的飓风 也文攝輝" }],
    "siriussymboli": [{ id: "BV1XhUZYmE2z", title: "远征海外的先驱！-天狼星象征原型" }],
    "tapdancecity": [{ id: "BV1GPXVYAEUd", title: "继续与时间赛跑吧！-跳舞城原型介绍" }],
    "bikopegasus": [{ id: "BV1GhMcz8Egb", title: "与命运抗争的小小英雄—微光飞驹原型介绍" }],
    "ikunodictus": [{ id: "BV1V7grzEEYz", title: "不屈的铁娘子—生野狄杜斯原型介绍" }],
    "transcend": [{ id: "BV1XPuBziEvg", title: "短暂制霸泥地的新星~创升原型介绍" }],
    "soundsofearth": [{ id: "BV1XZY4zPEzq", title: "最强坠机王万老二是也～万籁争鸣原型介绍" }],
    "yaenomuteki": [{ id: "BV1X7anzVEvU", title: "光辉与热忱并存的战士～八重无敌原型介绍" }],
    "eishinflash": [{ id: "BV1jFSjBwETr", title: "一匹在日本土生土长的德国马～荣进闪耀原型介绍" }],
    "calstonelighto": [{ id: "BV1yDyuBLEEN", title: "学院里来了只傲娇猫娘～金镇之光原型介绍" }],
    "airmessiah": [{ id: "BV18zwXzWEWx", title: "璀璨短暂的名门之后～空中救世主原型介绍" }],
    "naritataishin": [{ id: "BV1qLNczfEiP", title: "努力证明不被看好的自己～成田大进原型介绍" }],
    "bubblegumfellow": [{ id: "BV1oxcvzLEbD", title: "看我如何两面包夹芝士～吹波糖原型介绍" }],
    "winvariation": [{ id: "BV1PTDvBAEqd", title: "舞动吧，草地上的奥杰塔～凯旋芭蕾原型介绍" }],
    "tsurumarutsuyoshi": [{ id: "BV1spEj6TEgS", title: "好像斯佩酱也不是我的对手~鹤丸刚志原型介绍" }],
    "furioso": [{ id: "BV17t5969EQA", title: "泥地出了个奖项收集者~狂怒乐章原型介绍" }],
    "kinghalo": [{ id: "BV1sYJ9zFEQa", title: "我这一生如履薄冰～帝王光辉原型介绍" }],
    "goldcity": [{ id: "BV1fb4y1Z7QT", title: "百年难遇的梦幻美马！10分钟带你了解历史上的黄金城（ゴールドシチー）！" }],
    "seekingthepearl": [{ id: "BV1QpXYYDEW3", title: "【赛马娘角色介绍＃8】采珠" }],
    "mejiroardan": [{ id: "BV1Vr4y1r7Yr", title: "被时代遮蔽的强者【目白阿尔丹】不屈的中国媳妇" }],
    "espoircity": [{ id: "BV1BdpgzNEin", title: "【赛马娘】希望之城 专属特殊胜利实况" }],
    "taninogimlet": [{ id: "BV1ubvRBREmX", title: "将胜利的美酒传递给爱女——谷水琴蕾" }],
    "believe": [{ id: "BV17tW3zTEaz", title: "【赛马娘】信念 专属特殊胜利实况" }],
    "samsonbig": [{ id: "BV1eNbzzWExo", title: "下落不明史实马系列 大森逊传说" }],
    "royceandroyce": [{ id: "BV1ksKf6QEQb", title: "【赛马娘】莱斯莱斯 专属特殊胜利实况" }],
    "daringheart": [{ id: "BV1M7yKB3EdP", title: "后冠之梦跨越时空——勇敢之心人物志" }],
    "fusaichipandora": [{ id: "BV1uLbDzjEBg", title: "【赛马娘】火神 专属特殊胜利实况" }],
    "genuine": [{ id: "BV1G1thzcEr9", title: "20世纪的名马 第55位 真诚 ジェニュイン" }],
    "sakurachitoseo": [{ id: "BV1NA411U7RS", title: "【20世纪の名胜负】1995年 天皇赏·秋——樱花千岁王" }],
    "blastonepiece": [{ id: "BV19s3B6fEKE", title: "Blast onepiece 防爆装束 @Hooskey" }],
    "currenbouquetdor": [{ id: "BV1gg4y1b7U5", title: "机伶金花：最强2胜马传奇" }],
    "reddesire": [{ id: "BV1tgLU6RELw", title: "【赛马娘】红色梦想 专属特殊胜利实况" }],
    "kiseki": [{ id: "BV1Joz7B1E53", title: "【赛马娘】神业 特殊实况合集" }],
    "epiphaneia": [{ id: "BV19U4y1q7mE", title: "21世纪的名马 神威启示" }],
    "logotype": [{ id: "BV1cv411W7vq", title: "21世纪的名马 标志名驹" }],
    "rosekingdom": [{ id: "BV1P44y1s77p", title: "2010.11.28 日本杯　玫瑰帝国" }],
    "rulership": [{ id: "BV1qpgR6GE4p", title: "【赛马娘】统治地位 专属特殊胜利实况" }],
    "efforia": [{ id: "BV1k84y1K7yW", title: "21世纪的名马 乐透心" }],
  };
  function horseVideosForCharacter(id) {
    return horseVideos[id] || [];
  }

  function horseChars(horse) {
    return ((horse && horse.cids) || []).map(deps.findCharById).filter(Boolean);
  }

  function onHorseImageError(event) {
    const image = event && event.currentTarget;
    if (!image) return;
    const replaced = "/uma_tools/img/album-placeholder.svg";
    if (!String(image.src || "").endsWith("album-placeholder.svg"))
      image.src = replaced;
  }

  let horseSearchTimer;

  function renderCharBlood() {
    var box = document.getElementById("cCharBlood");
    if (!box) return;
    box.innerHTML = "";
    var id = deps.charDetail.value && deps.charDetail.value.id;
    if (
      !id ||
      deps.charSection.value !== "pedigree" ||
      !charHasPedigree.value ||
      pedigreeStatus.value !== "ready"
    )
      return;
    if (typeof window.renderBloodGraphInDetail !== "function") {
      pedigreeStatus.value = "error";
      pedigreeError.value = "血统组件暂时无法载入，请重试。";
      return;
    }
    if (window.renderBloodGraphInDetail(box, id) === false) {
      box.innerHTML = "";
      deps.charSection.value = "profile";
      deps.pushUrl(true);
    }
  }
  function start() {
    deps.watch(horseDetail, function () {
      horseMajorExpanded.value = false;
    });
    deps.watch(
      horseQuery,
      function () {
        if (!deps.restoringRoute) {
          horseListRevision += 1;
          horsePage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      horseQuery,
      function () {
        if (
          deps.restoringRoute ||
          deps.currentUrlPath().split("?")[0] !== deps.routes.horses()
        )
          return;
        window.clearTimeout(horseSearchTimer);
        horseSearchTimer = window.setTimeout(() => {
          if (deps.currentUrlPath().split('?')[0] === deps.routes.horses()) loadHorsesListData().catch(() => {});
        }, 180);
      },
      { flush: "sync" },
    );
    const onFilterChange = function () {
      if (!deps.restoringRoute) {
        horseListRevision += 1;
        horsePage.value = 1;
        deps.pushUrl(true);
      }
      if (
        deps.restoringRoute ||
        deps.currentUrlPath().split("?")[0] !== deps.routes.horses()
      )
        return;
      loadHorsesListData().catch(() => {});
    };
    deps.watch(horseSex, onFilterChange);
    deps.watch(horseSort, onFilterChange);
  }
  return {
    start,
    charHasPedigree,
    curatedVideos,
    goHorsePage,
    horseChars,
    horseDetail,
    horseFacts,
    horseFiltered,
    horseMajorExpanded,
    horseMajorRows,
    horseMajorTotal,
    horsePage,
    horsePageCount,
    horsePageEnd,
    horsePageList,
    horsePageStart,
    horsePaged,
    horseQuery,
    horseSex,
    horseSexLabel,
    horseSexOptions,
    horseSort,
    horseSortOptions,
    horseUrlForCharacter,
    horseVideosForCharacter,
    horsesList,
    horsesListError,
    horsesTotal,
    horsesPerPage,
    loadHorsesData,
    loadHorsesListData,
    loadPedigreeData,
    loadPedigreeMeta,
    onHorseImageError,
    openHorse,
    otherSection,
    pedigreeError,
    pedigreeStatus,
    renderCharBlood,
    retryHorses,
    retryPedigree,
    setHorsePage,
    setOtherSection,
    toggleHorseMajor,
  };
}
