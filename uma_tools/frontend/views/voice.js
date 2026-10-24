export const bindings = ["coverThumb","onCatalogImageError","isActive","openEvent","eventKindLabel","playRelationRelease","addSongTrack","relationSong","relationSongVersions","relationReleaseVocalists","expandedRelationSongId","toggleRelationSong","openAlbumFromSong","voiceName","voicePhoto","voicePaletteStyle","openCharacter","voiceProfiles","voiceLoading","voiceError","voiceDetail","voiceSection","setVoiceSection","voiceAppearance","voiceHistoryEvents","voiceHistoryQuery","voiceHistoryKind","voiceFieldLabel","openVoice","appearanceIsLoading","appearanceError","retryAppearance","animeError","retryAnime","voiceAnimeWorks","animeLink","appearanceSessionLabel","appearanceDateLabel","historyKindOptions","routes","retryVoice","internalLink"];
export const template = `
            <content-state v-if="voiceError" state="error" subject="声优资料" :retry="true" @retry="retryVoice()"></content-state>
            <template v-if="!voiceDetail && !voiceError">
                <div class="archive-toolbar"><label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input class="va-search" id="vaSearch" aria-label="搜索声优名或角色名" placeholder="搜索声优名或角色名" autocomplete="off"></label></div>
                <div v-if="voiceLoading && !voiceProfiles.length" class="archive-card-skeletons" aria-hidden="true"><span v-for="i in 8" :key="'voice-load-'+i"></span></div>
                <ul class="va-grid" id="vaGrid"></ul>
                <div id="vaNoData"><content-state state="filtered" subject="声优"></content-state></div>
            </template>
            <article v-else-if="voiceDetail" class="entity-detail voice-entity-detail" :style="voicePaletteStyle(voiceDetail)">
                <div class="entity-hero" :class="{'entity-hero-text':!voiceDetail.photo}">
                    <div v-if="voiceDetail.photo" class="entity-cover portrait-cover"><img v-media-src="voiceDetail.photo" :alt="voiceDetail.zh" fetchpriority="high"></div>
                    <div class="entity-intro">
                        <span class="entity-kind">声优</span><h1>{{ voiceDetail.zh }}</h1><p class="entity-reading">{{ voiceDetail.ja }}</p>
                        <div class="performer-chip-list">
                            <a v-for="role in voiceDetail.roles" :key="role.id" class="performer-chip character-chip" :style="{'--chip-color':role.main}" :href="routes.characters(role.id)" @click="internalLink($event, () => openCharacter(role.id))"><img v-if="role.img" v-media-src="role.img" alt=""><span>{{ role.zh }}</span></a>
                        </div>
                    </div>
                </div>
                <nav class="entity-tabs" aria-label="声优栏目">
                    <button :class="{active:voiceSection==='profile'}" @click="setVoiceSection('profile')">个人信息</button>
                    <button :class="{active:voiceSection==='songs'}" @click="setVoiceSection('songs')">歌曲信息</button>
                    <button :class="{active:voiceSection==='anime'}" @click="setVoiceSection('anime')">动画出演</button>
                    <button :class="{active:voiceSection==='events'}" @click="setVoiceSection('events')">活动出演</button>
                </nav>
                <section v-if="voiceSection==='profile'" class="entity-section">
                    <dl class="profile-facts">
                        <div><dt>中文名</dt><dd>{{ voiceDetail.zh }}</dd></div>
                        <div><dt>日文名</dt><dd>{{ voiceDetail.ja }}</dd></div>
                        <div><dt>假名</dt><dd>{{ voiceDetail.kana || '—' }}</dd></div>
                        <div><dt>生日</dt><dd>{{ voiceFieldLabel(voiceDetail,'birthday') }}</dd></div>
                        <div><dt>出身地</dt><dd>{{ voiceFieldLabel(voiceDetail,'birthplace') }}</dd></div>
                        <div><dt>事务所</dt><dd>{{ voiceFieldLabel(voiceDetail,'agency') }}</dd></div>


                    </dl>
                </section>
                <section v-else-if="voiceSection==='songs'" class="entity-section">
                    <div v-if="appearanceIsLoading('voice_actor',voiceDetail.id)" class="ui-state ui-state-loading">歌曲信息加载中</div>
                    <content-state v-else-if="appearanceError('voice_actor',voiceDetail.id)" state="error" subject="歌曲信息" :retry="true" @retry="retryAppearance('voice_actor',voiceDetail.id)"></content-state>
                    <div v-else-if="voiceAppearance.songs.length" class="relation-song-list">
                        <ui-disclosure v-for="song in voiceAppearance.songs" :key="song.song_id" class="relation-song-row" :open="expandedRelationSongId===song.song_id" @toggle="toggleRelationSong(song.song_id)">
                            <template #leading><img v-media-src="coverThumb((relationSong(song)||{}).cover,112)" alt=""></template><template #title><b>{{ song.name }}</b></template>
                            <div class="relation-song-detail">
                                <section v-for="version in relationSongVersions(song,'voice_actor',voiceDetail.id)" :key="version.id" class="relation-version">
                                    <header><a class="text-link" :href="routes.songs(song.song_id)" @click="animeLink($event,$event.currentTarget.href)">{{ version.title }}</a><span>{{ version.version_label || '原始版本' }}</span></header>
                                    <div v-for="release in version.releases" :key="release.album_id+'-'+release.track_number" class="relation-release">
                                        <a class="album-inline" :href="release.album_id ? routes.albums(release.album_id) : routes.query(routes.albums(),{q:release.album_name})" @click="internalLink($event, () => openAlbumFromSong({version:version,release:release}))"><img v-media-src="coverThumb(release.cover,88)" alt="" @error="onCatalogImageError($event)"><span><b>{{ release.album_name }}</b><span class="secondary-line">{{ release.release_date || '日期待补' }} · {{ release.catalog || release.type }}</span></span></a>
                                        <div class="performer-chip-list compact"><a v-for="vocalist in relationReleaseVocalists(release,'voice_actor',voiceDetail.id)" :key="vocalist.voice_actor_id+'-'+(vocalist.character_id || '')" class="performer-chip voice-chip" :style="{'--chip-color':(vocalist.character && vocalist.character.color_main) || '#3157ed'}" :href="routes.voiceActors(vocalist.voice_actor_id)" @click="internalLink($event, () => openVoice(vocalist.voice_actor_id))"><img v-if="voicePhoto(vocalist.voice_actor_id)" v-media-src="voicePhoto(vocalist.voice_actor_id)" alt=""><span>{{ voiceName(vocalist.voice_actor_id,vocalist.voice_actor_name) }}</span></a></div>
                                        <entity-actions v-if="release.audio_url" size="compact" :playing="isActive(release.audio_url)" @play="playRelationRelease(relationSong(song),version,release)" @add="addSongTrack(relationSong(song),version,release)"></entity-actions>
                                    </div>
                                </section>

                            </div>
                        </ui-disclosure>
                    </div>
                    <content-state v-else state="uncollected" subject="演唱歌曲"></content-state>
                </section>
                <section v-else-if="voiceSection==='anime'" class="entity-section">
                    <content-state v-if="animeError" state="error" subject="动画关联" :retry="true" @retry="retryAnime"></content-state>
                    <anime-participation v-else-if="voiceAnimeWorks.length" :works="voiceAnimeWorks" hide-single-role></anime-participation>
                    <content-state v-else state="uncollected" subject="动画出演"></content-state>
                </section>
                <section v-else-if="voiceSection==='events'" class="entity-section">
                    <div class="archive-toolbar compact"><label class="ui-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="voiceHistoryQuery" aria-label="搜索活动或年份" placeholder="搜索活动或年份"></label><ui-select v-model="voiceHistoryKind" label="类型" :options="historyKindOptions"></ui-select></div>
                    <div v-if="appearanceIsLoading('voice_actor',voiceDetail.id)" class="ui-state ui-state-loading">出演记录加载中</div>
                    <content-state v-else-if="appearanceError('voice_actor',voiceDetail.id)" state="error" subject="出演记录" :retry="true" @retry="retryAppearance('voice_actor',voiceDetail.id)"></content-state>
                    <activity-history v-else-if="voiceHistoryEvents.length" :events="voiceHistoryEvents" :routes="routes" :date-label="appearanceDateLabel" :kind-label="eventKindLabel" :session-label="appearanceSessionLabel" @open="openEvent($event.event_id,$event.session_id)"></activity-history>
                    <content-state v-else-if="voiceHistoryQuery || voiceHistoryKind!=='all'" state="filtered" subject="演出活动" :clear="true" @clear="voiceHistoryQuery='';voiceHistoryKind='all'"></content-state>
                    <content-state v-else state="uncollected" subject="演出活动"></content-state>
                </section>
            </article>
        `;
