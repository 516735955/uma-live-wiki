import { createNavigation } from "/uma_tools/frontend/domains/navigation.js";
import { createPlayer } from "/uma_tools/frontend/domains/player.js";
import { createAlbums } from "/uma_tools/frontend/domains/albums.js";
import { createRouting } from "/uma_tools/frontend/domains/routing.js";
import { createSongs } from "/uma_tools/frontend/domains/songs.js";
import { createCharacters } from "/uma_tools/frontend/domains/characters.js";
import { createEvents } from "/uma_tools/frontend/domains/events.js";
import { createNews } from "/uma_tools/frontend/domains/news.js";
import { createCreators } from "/uma_tools/frontend/domains/creators.js";
import { createVoices } from "/uma_tools/frontend/domains/voices.js";
import { createHorses } from "/uma_tools/frontend/domains/horses.js";
import { createAnime } from "/uma_tools/frontend/domains/anime.js";
import { createStaff } from "/uma_tools/frontend/domains/staff.js";
export function createDomains(env) {
  const domains = {};
  domains.navigation = createNavigation(
    ports(
      env,
      domains,
      {
        albums: [
          "albumDetail",
          "coverThumb",
          "loadAlbums",
          "relPage",
          "relPageCount",
        ],
        anime: ["animeDetail", "animeSection", "animeUnitDetail"],
        environment: ["api", "computed", "reactive", "ref", "routes", "watch"],
        routing: [
          "beginEntityNavigation",
          "clearEntityDetails",
          "navigateTo",
          "navigationRevision",
          "pushUrl",
        ],
        characters: ["charDetail", "charSection"],
        creators: ["creatorDetail", "creatorRoleLabel", "creatorSection"],
        events: [
          "evKind",
          "evMode",
          "evSeries",
          "evTime",
          "evYear",
          "eventDetail",
          "eventsAll",
          "eventsPage",
          "homeNextEvent",
          "nextUpcomingEvent",
          "openEvent",
        ],
        horses: ["horseDetail", "otherSection", "renderCharBlood"],
        news: ["newsDetail", "newsTitle"],
        player: ["playerController"],
        songs: ["songDetail", "songSection"],
        staff: ["staffDetail"],
        voices: ["voiceDetail", "voiceProfileForName", "voiceSection"],
      },
      [],
    ),
  );
  domains.albums = createAlbums(
    ports(
      env,
      domains,
      {
        navigation: ["activeTab", "dbView", "homeStats", "resetPageScroll"],
        environment: ["api", "computed", "reactive", "ref", "watch"],
        characters: ["appearanceSongs", "charDetail", "loadCharacterIndexData"],
        routing: [
          "beginEntityNavigation",
          "clearEntityDetails",
          "navigationError",
          "notFound",
          "pushUrl",
          "restoringRoute",
        ],
        player: [
          "buildPlayerTrack",
          "isActive",
          "mergePlayerVocalists",
          "player",
          "playerController",
          "playerVocalistsFromArtist",
          "playerVocalistsFromRelease",
        ],
        songs: ["findSong", "mergeSong", "songCatalog", "songsById"],
        voices: ["findVaBySlug", "loadVoiceData", "voiceDetail", "voiceName"],
        anime: ["loadAnimeCatalogOptional"],
      },
      [],
    ),
  );
  domains.routing = createRouting(
    ports(
      env,
      domains,
      {
        environment: ["LANG_PREFIX", "ref", "routes"],
        navigation: [
          "activeTab",
          "dbView",
          "fixDone",
          "home",
          "isAtomicView",
          "listParamsFromUrl",
          "resetPageScroll",
          "routeSegments",
        ],
        albums: [
          "albumDetail",
          "loadAlbums",
          "openAlbum",
          "relFilter",
          "relPage",
          "relPageCount",
          "relQuery",
          "relSort",
          "relWork",
          "relYear",
        ],
        anime: [
          "animeCatalog",
          "animeDetail",
          "animeEdition",
          "animeEpisodeQuery",
          "animeFormat",
          "animeQuery",
          "animeSection",
          "animeSingle",
          "animeSort",
          "animeStatus",
          "animeStillUnit",
          "animeUnitDetail",
          "findAnimeUnit",
          "findAnimeWork",
          "loadAnimeCatalog",
          "loadAnimeCatalogOptional",
          "loadAnimeRelatedMedia",
        ],
        staff: [
          "animeStaffQuery",
          "staffDetail",
          "staffPage",
          "staffPageCount",
          "staffQuery",
          "staffSort",
        ],
        news: [
          "cancelNewsDetailRequest",
          "loadNews",
          "newsDetail",
          "newsDetailBody",
          "newsDetailRequest",
          "newsPage",
          "newsPageCount",
          "newsRange",
          "newsType",
          "openNews",
        ],
        characters: [
          "charDetail",
          "charSection",
          "findCharById",
          "loadCharacterDetailData",
          "loadCharacterIndexData",
          "loadCharacterUi",
          "setCharSection",
        ],
        creators: [
          "creatorDetail",
          "creatorPage",
          "creatorPageCount",
          "creatorQuery",
          "creatorRole",
          "creatorSection",
          "loadCreatorCatalog",
          "openCreator",
        ],
        events: [
          "evKind",
          "evMode",
          "evSeries",
          "evTime",
          "evYear",
          "eventDetail",
          "eventSeriesMap",
          "eventsPage",
          "eventsPageCount",
          "eventsQuery",
          "liveView",
          "loadEvents",
          "openEvent",
          "selectedEventSessionId",
        ],
        voices: [
          "findVaBySlug",
          "loadVoiceData",
          "setVoiceSection",
          "voiceDetail",
          "voiceProfiles",
          "voiceSection",
        ],
        horses: [
          "horseDetail",
          "horsePage",
          "horsePageCount",
          "horseQuery",
          "loadHorsesData",
          "loadHorsesListData",
          "loadPedigreeMeta",
          "otherSection",
          "renderCharBlood",
        ],
        songs: [
          "loadSongCatalog",
          "openSong",
          "songDbPage",
          "songDbPageCount",
          "songDbQuery",
          "songDetail",
          "songLinkRelease",
          "songLinkVersion",
          "songSection",
        ],
      },
      [],
    ),
  );
  domains.songs = createSongs(
    ports(
      env,
      domains,
      {
        navigation: [
          "activeTab",
          "dbView",
          "decodeHtml",
          "homeStats",
          "normName",
          "pagerList",
          "resetPageScroll",
        ],
        player: [
          "addSongTrack",
          "isActive",
          "playableSongRelease",
          "playerController",
        ],
        albums: ["albums"],
        environment: ["api", "computed", "reactive", "ref", "routes", "watch"],
        routing: [
          "beginEntityNavigation",
          "clearEntityDetails",
          "navigationError",
          "notFound",
          "pushUrl",
          "restoringRoute",
        ],
        events: ["eventPerformanceKey", "eventSongs"],
        characters: [
          "findCharByAvatar",
          "findCharByDisplayName",
          "loadCharacterIndexData",
        ],
        voices: ["findVaBySlug", "loadVoiceData"],
        anime: ["loadAnimeCatalogOptional"],
      },
      [],
    ),
  );
  domains.player = createPlayer(
    ports(
      env,
      domains,
      {
        voices: ["findVaBySlug", "voiceName", "voiceProfileForName"],
        songs: ["openSong", "proxySongUrl", "songDetail", "songSingerLabel"],
        environment: ["reactive", "ref", "watch"],
      },
      [],
    ),
  );
  domains.characters = createCharacters(
    ports(
      env,
      domains,
      {
        navigation: [
          "activeTab",
          "dbView",
          "loadDataScript",
          "normName",
          "resetPageScroll",
        ],
        environment: ["api", "computed", "reactive", "ref", "watch"],
        routing: ["beginEntityNavigation", "clearEntityDetails", "pushUrl"],
        horses: [
          "charHasPedigree",
          "loadPedigreeData",
          "loadPedigreeMeta",
          "renderCharBlood",
        ],
        songs: ["expandedRelationSongId"],
        anime: ["loadAnimeCatalogOptional"],
        voices: ["loadVoiceData"],
      },
      [],
    ),
  );
  domains.events = createEvents(
    ports(
      env,
      domains,
      {
        navigation: [
          "activeTab",
          "fixAvatarSrc",
          "hideEncorePerf",
          "resetPageScroll",
        ],
        environment: ["api", "computed", "ref", "watch"],
        routing: [
          "beginEntityNavigation",
          "clearEntityDetails",
          "navigateTo",
          "navigationError",
          "notFound",
          "pushUrl",
          "restoringRoute",
        ],
        player: [
          "buildReleasePlayerTrack",
          "playableSongRelease",
          "playerController",
        ],
        characters: [
          "charAppearance",
          "charHistoryKind",
          "charHistoryQuery",
          "loadCharacterIndexData",
          "openCharacter",
        ],
        songs: ["findSong", "linkSetlistSongs", "openSong"],
        anime: ["loadAnimeCatalogOptional"],
        voices: ["loadVoiceData"],
      },
      [],
    ),
  );
  domains.news = createNews(
    ports(
      env,
      domains,
      {
        navigation: ["activeTab", "resetPageScroll"],
        environment: ["api", "computed", "ref", "routes", "watch"],
        routing: [
          "beginEntityNavigation",
          "clampLocalPages",
          "clearEntityDetails",
          "currentUrlPath",
          "pushUrl",
          "restoringRoute",
        ],
        creators: ["creatorPageCount"],
        horses: ["horsePageCount"],
        albums: ["relPageCount"],
      },
      [],
    ),
  );
  domains.creators = createCreators(
    ports(
      env,
      domains,
      {
        navigation: ["activeTab", "dbView", "pagerList", "resetPageScroll"],
        environment: ["api", "computed", "reactive", "ref", "routes", "watch"],
        routing: [
          "beginEntityNavigation",
          "clearEntityDetails",
          "navigateTo",
          "navigationError",
          "notFound",
          "pushUrl",
          "restoringRoute",
        ],
        songs: ["findSong", "mergeSong"],
        anime: ["loadAnimeCatalogOptional"],
      },
      [],
    ),
  );
  domains.voices = createVoices(
    ports(
      env,
      domains,
      {
        navigation: ["activeTab", "dbView", "resetPageScroll"],
        environment: ["api", "computed", "ref", "routes", "watch"],
        characters: [
          "appearanceIndex",
          "loadCharacterIndexData",
          "loadCharacterUi",
          "loadRelationshipData",
          "openCharacter",
        ],
        routing: ["beginEntityNavigation", "clearEntityDetails", "pushUrl"],
        songs: ["expandedRelationSongId"],
        anime: ["loadAnimeCatalogOptional"],
      },
      [],
    ),
  );
  domains.horses = createHorses(
    ports(
      env,
      domains,
      {
        navigation: [
          "activeTab",
          "dataScriptPromises",
          "dbView",
          "loadDataScript",
          "pagerList",
          "resetPageScroll",
          "routeSegments",
        ],
        environment: ["api", "computed", "ref", "routes", "watch"],
        routing: [
          "beginEntityNavigation",
          "clearEntityDetails",
          "currentUrlPath",
          "pushUrl",
          "restoringRoute",
        ],
        characters: [
          "charDetail",
          "charSection",
          "findCharById",
          "loadCharacterUi",
        ],
      },
      [],
    ),
  );
  domains.anime = createAnime(
    ports(
      env,
      domains,
      {
        navigation: ["activeTab", "dbView", "resetPageScroll", "routeSegments"],
        albums: ["albumDetail", "albums", "findAlbumById"],
        staff: [
          "animeCurrentStaff",
          "animeStaffAggregate",
          "animeStaffQuery",
          "creatorAnimeStaff",
        ],
        environment: ["api", "computed", "reactive", "ref", "routes", "watch"],
        characters: ["charDetail", "characterName"],
        creators: ["creatorDetail"],
        routing: [
          "currentUrlPath",
          "navigateTo",
          "navigationRevision",
          "pushUrl",
          "routeError",
          "routeReady",
          "syncFromUrl",
        ],
        events: ["eventDetail", "eventsAll"],
        songs: ["findSong", "mergeSong", "songDetail"],
        voices: ["voiceDetail", "voiceName"],
      },
      [],
    ),
  );
  domains.staff = createStaff(
    ports(
      env,
      domains,
      {
        navigation: ["activeTab", "dbView", "pagerList"],
        anime: [
          "animeCatalog",
          "animeContentUnit",
          "animeDetail",
          "animeEdition",
          "animeRowMatchesEdition",
          "animeSingle",
          "animeUnitDetail",
          "findAnimeUnit",
          "findAnimeWork",
          "groupAnimeParticipation",
        ],
        environment: ["computed", "ref", "routes", "watch"],
        creators: ["creatorDetail", "creatorsPerPage"],
        routing: ["pushUrl", "restoringRoute", "routeReady"],
      },
      [],
    ),
  );
  Object.values(domains).forEach((domain) => domain.start());
  return domains;
}

// Domains receive only declared dependencies. Getters preserve mutable route and
// request state without copying it or exposing another domain's private fields.
function ports(env, domains, dependencies, writable) {
  const result = {};
  for (const [owner, names] of Object.entries(dependencies)) {
    for (const name of names) {
      const target = () => (owner === "environment" ? env : domains[owner]);
      Object.defineProperty(result, name, {
        get: () => target()[name],
        ...(writable.includes(name)
          ? {
              set: (value) => {
                target()[name] = value;
              },
            }
          : {}),
      });
    }
  }
  return result;
}
