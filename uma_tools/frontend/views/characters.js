export const bindings = ["coverThumb","onCatalogImageError","isActive","voiceHrefByName","openEvent","eventKindLabel","playRelationRelease","addSongTrack","relationSong","relationSongVersions","relationReleaseVocalists","expandedRelationSongId","toggleRelationSong","openAlbumFromSong","voiceName","voicePhoto","voicePhotoByName","charDetail","charSort","characterSortOptions","charSection","charHasPedigree","setCharSection","charAppearance","charHistoryQuery","charHistoryKind","charHistoryEvents","horseUrlForCharacter","horseVideosForCharacter","openVoice","appearanceIsLoading","appearanceError","retryAppearance","pedigreeStatus","pedigreeError","retryPedigree","animeError","retryAnime","characterAnimeWorks","animeLink","appearanceSessionLabel","appearanceDateLabel","historyKindOptions","routes"];
export const template = `
            <template v-if="!charDetail">
                <div class="archive-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input class="c-search" id="cIntroSearch" aria-label="搜索角色名或声优名" placeholder="搜索角色名或声优名" autocomplete="off"></label>
                    <ui-select v-model="charSort" label="排序" :options="characterSortOptions"></ui-select>
                </div>
                <div class="cio-list loading" id="cIntroList"><ul class="cio-grid" id="cIntroGrid"></ul><div class="ui-state" id="cIntroNoData">没有找到匹配的角色</div></div>
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
                    <button v-if="charHasPedigree" :class="{active:charSection==='pedigree'}" @click="setCharSection('pedigree')">血统溯源</button>
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
                <section v-if="charHasPedigree && charSection==='pedigree'" class="pedigree-section">
                    <div v-if="pedigreeStatus==='loading' || pedigreeStatus==='idle'" class="ui-state ui-state-loading" role="status">血统关系加载中</div>
                    <div v-else-if="pedigreeStatus==='error'" class="ui-state ui-state-error" role="alert"><span>{{ pedigreeError }}</span><button type="button" class="ui-retry" @click="retryPedigree">重试</button></div>
                    <div v-else id="cCharBlood"></div>
                </section>
                <section v-if="charSection==='songs'" class="entity-section">
                    <div v-if="appearanceIsLoading('character',charDetail.id)" class="ui-state ui-state-loading">歌曲信息加载中</div>
                    <div v-else-if="appearanceError('character',charDetail.id)" class="ui-state ui-state-error" role="alert"><span>{{ appearanceError('character',charDetail.id) }}</span><button type="button" class="ui-retry" @click="retryAppearance('character',charDetail.id)">重试</button></div>
                    <div v-else-if="charAppearance.songs.length" class="relation-song-list">
                        <ui-disclosure v-for="song in charAppearance.songs" :key="song.song_id" class="relation-song-row" :open="expandedRelationSongId===song.song_id" @toggle="toggleRelationSong(song.song_id)">
                            <template #leading><img v-media-src="coverThumb((relationSong(song)||{}).cover,112)" alt=""></template><template #title><b>{{ song.name }}</b></template>
                            <div class="relation-song-detail">
                                <section v-for="version in relationSongVersions(song,'character',charDetail.id)" :key="version.id" class="relation-version">
                                    <header><a class="text-link" :href="routes.songs(song.song_id)" @click="animeLink($event,$event.currentTarget.href)">{{ version.title }}</a><span>{{ version.version_label || '原始版本' }}</span></header>
                                    <div v-for="release in version.releases" :key="release.album_id+'-'+release.track_number" class="relation-release">
                                        <button class="album-inline" type="button" @click="openAlbumFromSong({version:version,release:release})"><img v-media-src="coverThumb(release.cover,88)" alt="" @error="onCatalogImageError($event)"><span><b>{{ release.album_name }}</b><span class="secondary-line">{{ release.release_date || '日期待补' }} · {{ release.catalog || release.type }}</span></span></button>
                                        <div class="performer-chip-list compact"><button v-for="vocalist in relationReleaseVocalists(release,'character',charDetail.id)" :key="vocalist.voice_actor_id+'-'+(vocalist.character_id || '')" class="performer-chip voice-chip" :style="{'--chip-color':(vocalist.character && vocalist.character.color_main) || '#3157ed'}" @click="openVoice(vocalist.voice_actor_id)"><img v-if="voicePhoto(vocalist.voice_actor_id)" v-media-src="voicePhoto(vocalist.voice_actor_id)" alt=""><span>{{ voiceName(vocalist.voice_actor_id,vocalist.voice_actor_name) }}</span></button></div>
                                        <entity-actions v-if="release.audio_url" size="compact" :playing="isActive(release.audio_url)" @play="playRelationRelease(relationSong(song),version,release)" @add="addSongTrack(relationSong(song),version,release)"></entity-actions>
                                    </div>
                                </section>

                            </div>
                        </ui-disclosure>
                    </div>
                    <div v-else class="ui-state compact">暂无演唱歌曲</div>
                </section>
                <section v-if="charSection==='anime'" class="entity-section">
                    <div v-if="animeError" class="ui-state ui-state-error" role="alert"><span>动画关联暂时无法载入。</span><button class="ui-retry" @click="retryAnime">重试</button></div>
                    <anime-participation v-else-if="characterAnimeWorks.length" :works="characterAnimeWorks" :self-character-id="charDetail.id"></anime-participation>
                    <div v-else class="ui-state compact">暂无动画出演</div>
                </section>
                <section v-if="charSection==='events'" class="entity-section">
                    <div class="archive-toolbar compact"><label class="ui-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="charHistoryQuery" aria-label="搜索活动或年份" placeholder="搜索活动或年份"></label><ui-select v-model="charHistoryKind" label="类型" :options="historyKindOptions"></ui-select></div>
                    <div v-if="appearanceIsLoading('character',charDetail.id)" class="ui-state ui-state-loading">出演记录加载中</div>
                    <div v-else-if="appearanceError('character',charDetail.id)" class="ui-state ui-state-error" role="alert"><span>{{ appearanceError('character',charDetail.id) }}</span><button type="button" class="ui-retry" @click="retryAppearance('character',charDetail.id)">重试</button></div>
                    <div v-else-if="charHistoryEvents.length" class="history-list"><button v-for="event in charHistoryEvents" :key="event.event_id+'-'+(event.session_id||'event')" @click="openEvent(event.event_id,event.session_id)"><time>{{ appearanceDateLabel(event) }}</time><span>{{ event.title }}<em v-if="appearanceSessionLabel(event)" class="credit-role-tag session-tag">{{ appearanceSessionLabel(event) }}</em></span><em>{{ eventKindLabel(event.kind) }}</em></button></div>
                    <div v-else class="ui-state compact">暂无演出活动</div>
                </section>
            </article>
        `;
