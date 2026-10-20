export const bindings = ["coverThumb","onCatalogImageError","isActive","voiceHrefByName","openEvent","eventKindLabel","playRelationRelease","addSongTrack","relationSong","relationSongVersions","relationReleaseVocalists","expandedRelationSongId","toggleRelationSong","openAlbumFromSong","voiceName","voicePhoto","voicePhotoByName","charDetail","charSort","characterSortOptions","charSection","charHasPedigree","setCharSection","charAppearance","charHistoryQuery","charHistoryKind","charHistoryEvents","horseUrlForCharacter","horseVideosForCharacter","openVoice","appearanceIsLoading","appearanceError","retryAppearance","pedigreeStatus","pedigreeError","retryPedigree","animeError","retryAnime","characterAnimeWorks","animeLink","appearanceSessionLabel","appearanceDateLabel","historyKindOptions","routes","internalLink"];
bindings.push("charPedigreeApplicable");
export const template = `
            <template v-if="!charDetail">
                <div class="archive-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input class="c-search" id="cIntroSearch" aria-label="搜索角色名或声优名" placeholder="搜索角色名或声优名" autocomplete="off"></label>
                    <ui-select v-model="charSort" label="排序" :options="characterSortOptions"></ui-select>
                </div>
                <div class="cio-list loading" id="cIntroList"><ul class="cio-grid" id="cIntroGrid"></ul><div id="cIntroNoData"><content-state state="filtered" subject="角色"></content-state></div></div>
            </template>
            <article v-else id="cIntroDetail" class="entity-detail character-entity-detail" :style="{'--entity-accent':charDetail.main || '#3157ed','--entity-sub':charDetail.sub || '#ffa932'}">
                <div class="entity-hero" :class="{'entity-hero-text':!charDetail.img}">
                    <div v-if="charDetail.img" class="entity-cover character-cover"><img v-media-src="charDetail.img" :alt="charDetail.zh" fetchpriority="high"></div>
                    <div class="entity-intro">
                        <span class="entity-kind">角色</span><h1>{{ charDetail.zh }}</h1>
                        <p class="entity-reading">{{ charDetail.ja }}<template v-if="charDetail.en"> · {{ charDetail.en }}</template></p>
                        <div v-if="charDetail.cv_zh || horseUrlForCharacter(charDetail.id)" class="hero-chip-row">
                            <a v-if="voiceHrefByName(charDetail.cv_zh)" class="performer-chip voice-chip" :style="{'--chip-color':charDetail.main}" :href="voiceHrefByName(charDetail.cv_zh)" @click="animeLink($event,voiceHrefByName(charDetail.cv_zh))"><img v-if="voicePhotoByName(charDetail.cv_zh)" v-media-src="voicePhotoByName(charDetail.cv_zh)" alt=""><span>{{ charDetail.cv_zh }}</span></a>
                            <span v-else-if="charDetail.cv_zh" class="performer-chip voice-chip" :style="{'--chip-color':charDetail.main}">{{ charDetail.cv_zh }}</span>
                            <a v-if="horseUrlForCharacter(charDetail.id)" class="horse-link-chip" :href="horseUrlForCharacter(charDetail.id)" @click="animeLink($event,horseUrlForCharacter(charDetail.id))">原型马 <em>↗</em></a>
                        </div>
                    </div>
                    <aside v-if="horseVideosForCharacter(charDetail.id).length" class="hero-video-aside">
                        <b>原型马解说视频：</b>
                        <a v-for="video in horseVideosForCharacter(charDetail.id)" :key="video.id" class="horse-link-chip" :href="'https://www.bilibili.com/video/'+video.id+'/'" target="_blank" rel="noopener">{{ video.title }} <em>↗</em></a>
                    </aside>
                </div>
                <nav class="entity-tabs" aria-label="角色栏目">
                    <button :class="{active:charSection==='profile'}" @click="setCharSection('profile')">角色信息</button>
                    <button v-if="charPedigreeApplicable" :class="{active:charSection==='pedigree'}" @click="setCharSection('pedigree')">血统溯源</button>
                    <button :class="{active:charSection==='songs'}" @click="setCharSection('songs')">歌曲信息</button>
                    <button :class="{active:charSection==='anime'}" @click="setCharSection('anime')">动画出演</button>
                    <button :class="{active:charSection==='events'}" @click="setCharSection('events')">活动出演</button>
                </nav>
                <section v-show="charSection==='profile'" class="entity-section character-profile">
                    <dl v-if="charDetail.birth || charDetail.height || charDetail.weight || charDetail.sankak" class="profile-facts">
                        <div v-if="charDetail.birth"><dt>生日</dt><dd>{{ charDetail.birth }}</dd></div>
                        <div v-if="charDetail.height"><dt>身高</dt><dd>{{ charDetail.height }}cm</dd></div>
                        <div v-if="charDetail.weight"><dt>体重</dt><dd>{{ charDetail.weight }}</dd></div>
                        <div v-if="charDetail.sankak"><dt>三围</dt><dd>{{ charDetail.sankak }}</dd></div>
                    </dl>
                    <div class="c-detail-block" id="cDetailBlock"></div>
                </section>
                <section v-if="charSection==='pedigree'" class="pedigree-section">
                    <content-state v-if="!charHasPedigree" :state="charPedigreeApplicable ? 'uncollected' : 'not_applicable'" subject="血统资料"></content-state>
                    <div v-else-if="pedigreeStatus==='loading' || pedigreeStatus==='idle'" class="ui-state ui-state-loading" role="status">血统关系加载中</div>
                    <content-state v-else-if="pedigreeStatus==='error'" state="error" subject="血统关系" :retry="true" @retry="retryPedigree"></content-state>
                    <div v-else id="cCharBlood"></div>
                </section>
                <section v-if="charSection==='songs'" class="entity-section">
                    <div v-if="appearanceIsLoading('character',charDetail.id)" class="ui-state ui-state-loading">歌曲信息加载中</div>
                    <content-state v-else-if="appearanceError('character',charDetail.id)" state="error" subject="歌曲信息" :retry="true" @retry="retryAppearance('character',charDetail.id)"></content-state>
                    <div v-else-if="charAppearance.songs.length" class="relation-song-list">
                        <ui-disclosure v-for="song in charAppearance.songs" :key="song.song_id" class="relation-song-row" :open="expandedRelationSongId===song.song_id" @toggle="toggleRelationSong(song.song_id)">
                            <template #leading><img v-media-src="coverThumb((relationSong(song)||{}).cover,112)" alt=""></template><template #title><b>{{ song.name }}</b></template>
                            <div class="relation-song-detail">
                                <section v-for="version in relationSongVersions(song,'character',charDetail.id)" :key="version.id" class="relation-version">
                                    <header><a class="text-link" :href="routes.songs(song.song_id)" @click="animeLink($event,$event.currentTarget.href)">{{ version.title }}</a><span>{{ version.version_label || '原始版本' }}</span></header>
                                    <div v-for="release in version.releases" :key="release.album_id+'-'+release.track_number" class="relation-release">
                                        <a class="album-inline" :href="release.album_id ? routes.albums(release.album_id) : routes.query(routes.albums(),{q:release.album_name})" @click="internalLink($event, () => openAlbumFromSong({version:version,release:release}))"><img v-media-src="coverThumb(release.cover,88)" alt="" @error="onCatalogImageError($event)"><span><b>{{ release.album_name }}</b><span class="secondary-line">{{ release.release_date || '日期待补' }} · {{ release.catalog || release.type }}</span></span></a>
                                        <div class="performer-chip-list compact"><a v-for="vocalist in relationReleaseVocalists(release,'character',charDetail.id)" :key="vocalist.voice_actor_id+'-'+(vocalist.character_id || '')" class="performer-chip voice-chip" :style="{'--chip-color':(vocalist.character && vocalist.character.color_main) || '#3157ed'}" :href="routes.voiceActors(vocalist.voice_actor_id)" @click="internalLink($event, () => openVoice(vocalist.voice_actor_id))"><img v-if="voicePhoto(vocalist.voice_actor_id)" v-media-src="voicePhoto(vocalist.voice_actor_id)" alt=""><span>{{ voiceName(vocalist.voice_actor_id,vocalist.voice_actor_name) }}</span></a></div>
                                        <entity-actions v-if="release.audio_url" size="compact" :playing="isActive(release.audio_url)" @play="playRelationRelease(relationSong(song),version,release)" @add="addSongTrack(relationSong(song),version,release)"></entity-actions>
                                    </div>
                                </section>

                            </div>
                        </ui-disclosure>
                    </div>
                    <content-state v-else state="uncollected" subject="演唱歌曲"></content-state>
                </section>
                <section v-if="charSection==='anime'" class="entity-section">
                    <content-state v-if="animeError" state="error" subject="动画关联" :retry="true" @retry="retryAnime"></content-state>
                    <anime-participation v-else-if="characterAnimeWorks.length" :works="characterAnimeWorks" :self-character-id="charDetail.id"></anime-participation>
                    <content-state v-else state="uncollected" subject="动画出演"></content-state>
                </section>
                <section v-if="charSection==='events'" class="entity-section">
                    <div class="archive-toolbar compact"><label class="ui-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="charHistoryQuery" aria-label="搜索活动或年份" placeholder="搜索活动或年份"></label><ui-select v-model="charHistoryKind" label="类型" :options="historyKindOptions"></ui-select></div>
                    <div v-if="appearanceIsLoading('character',charDetail.id)" class="ui-state ui-state-loading">出演记录加载中</div>
                    <content-state v-else-if="appearanceError('character',charDetail.id)" state="error" subject="出演记录" :retry="true" @retry="retryAppearance('character',charDetail.id)"></content-state>
                    <div v-else-if="charHistoryEvents.length" class="history-list"><a v-for="event in charHistoryEvents" :key="event.event_id+'-'+(event.session_id||'event')" :href="routes.events(event.event_id,event.session_id)" @click="internalLink($event, () => openEvent(event.event_id,event.session_id))"><time>{{ appearanceDateLabel(event) }}</time><span>{{ event.title }}<em v-if="appearanceSessionLabel(event)" class="credit-role-tag session-tag">{{ appearanceSessionLabel(event) }}</em></span><em>{{ eventKindLabel(event.kind) }}</em></a></div>
                    <content-state v-else-if="charHistoryQuery || charHistoryKind!=='all'" state="filtered" subject="演出活动" :clear="true" @clear="charHistoryQuery='';charHistoryKind='all'"></content-state>
                    <content-state v-else state="uncollected" subject="演出活动"></content-state>
                </section>
            </article>
        `;
