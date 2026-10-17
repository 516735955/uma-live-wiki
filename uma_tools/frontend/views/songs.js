export const bindings = ["coverThumb","onCatalogImageError","isActive","songCatalog","songCatalogError","songCatalogLoading","songDetail","songSection","setSongSection","songDbQuery","songDbFiltered","songDbPaged","songDbPage","songDbPageCount","songTotal","songDbPageStart","songDbPageEnd","songDbPageList","setSongDbPage","goSongDbPage","songDetailReleaseVersions","songDetailPerformances","songCreditVersions","creditRoleGroups","songSingerLabel","playableSongRelease","playCatalogSong","playSongPrimary","addSongPrimary","playSongRelease","addSongTrack","openSong","openAlbumFromSong","openEventUrl","characterName","characterPerformanceImage","characterColor","voiceName","voicePhoto","releaseSingerLabel","songLyricVersions","songLyricVersionOptions","selectedSongLyricVersion","selectedSongLyricLines","songLyricVersionId","songLyricTranslation","setSongLyricVersion","expandedSongReleaseId","expandedSongCreditId","songLinkVersion","songLinkRelease","toggleSongRelease","toggleSongCredit","openCreator","openCharacter","openVoice","animeError","songAnimeRelations","retryAnime","songAnimeWorks"];
export const template = `
            <div v-if="songCatalogError" class="ui-state ui-state-error">{{ songCatalogError }}</div>
            <template v-if="!songDetail">
                <div class="archive-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="songDbQuery" aria-label="搜索曲名、版本、创作者或歌词" placeholder="搜索曲名、版本、创作者或歌词" autocomplete="off"><button v-if="songDbQuery" type="button" @click.prevent="songDbQuery=''" aria-label="清空搜索">×</button></label>
                </div>
                <div id="songArchiveTop" class="music-card-grid song-card-grid">
                    <template v-if="songCatalogLoading && !songCatalog.songs.length">
                        <div v-for="i in 8" :key="'song-load-'+i" class="archive-card-skeleton" aria-hidden="true"><span></span><span></span></div>
                    </template>
                    <article v-for="song in songDbPaged" :key="song.id" class="music-card song-card">
                        <button class="music-card-main" type="button" @click="openSong(song)">
                            <img v-media-src="coverThumb(song.cover,320)" :alt="song.title" loading="lazy" @error="onCatalogImageError($event)">
                            <span class="music-card-copy"><b>{{ song.title }}</b><small>{{ songSingerLabel(song) }}</small></span>
                            <span class="music-card-meta"><em>{{ song.version_count }} 版本</em><em>{{ song.performance_count }} 场演出</em></span>
                        </button>
                        <entity-actions v-if="playableSongRelease(song)" size="compact" :playing="isActive(playableSongRelease(song).release.audio_url)" @play="playCatalogSong(song)" @add="addSongTrack(song,playableSongRelease(song).version,playableSongRelease(song).release)"></entity-actions>
                    </article>
                    <div v-if="!songCatalogError && !songCatalogLoading && !songDbFiltered.length" class="ui-state">没有符合条件的歌曲</div>
                </div>
                <div v-if="songDbFiltered.length" class="ui-pager"><span>{{ songDbPageStart }}–{{ songDbPageEnd }} / {{ songTotal }}</span><div><button :disabled="songDbPage<=1" @click="goSongDbPage(-1)">上一页</button><button v-for="(page,index) in songDbPageList" :key="index" :class="{active:page===songDbPage}" :disabled="page==='…'" @click="setSongDbPage(page)">{{ page }}</button><button :disabled="songDbPage>=songDbPageCount" @click="goSongDbPage(1)">下一页</button></div></div>
            </template>

            <article v-else class="entity-detail song-entity-detail">
                <div class="entity-hero music-archive-hero">
                    <div class="entity-cover album-cover-detail"><img v-media-src="coverThumb(songDetail.cover,720)" :data-original="songDetail.cover" :alt="songDetail.title" fetchpriority="high" @error="onCatalogImageError($event)"></div>
                    <div class="entity-intro">
                        <span class="entity-kind">歌曲</span>
                        <h1>{{ songDetail.title }}</h1>
                        <entity-actions v-if="playableSongRelease(songDetail)" size="hero" :playing="isActive(playableSongRelease(songDetail).release.audio_url)" play-label="播放这首歌" add-label="加入播放列表" @play="playSongPrimary" @add="addSongPrimary"></entity-actions>
                    </div>
                </div>
                <div class="media-content">
                    <div v-if="animeError" class="ui-state ui-state-error" role="alert"><span>动画关联暂时无法载入。</span><button class="ui-retry" @click="retryAnime">重试</button></div>
                    <section v-if="songAnimeRelations.length" class="entity-section anime-crosslink-section">
                        <div class="section-toolbar"><span class="credit-role-tag">动画关联</span></div>
                        <anime-participation :works="songAnimeWorks" section="music"></anime-participation>
                    </section>
                    <nav class="entity-tabs" aria-label="歌曲栏目">
                        <button :class="{active:songSection==='releases'}" @click="setSongSection('releases')">收录信息</button>
                        <button :class="{active:songSection==='credits'}" @click="setSongSection('credits')">创作信息</button>
                        <button :class="{active:songSection==='lyrics'}" @click="setSongSection('lyrics')">歌词</button>
                        <button :class="{active:songSection==='performances'}" @click="setSongSection('performances')">出演记录</button>
                    </nav>

                    <section v-if="songSection==='releases'" class="entity-section">
                    <div class="song-version-list ui-disclosure-list">
                        <ui-disclosure v-for="version in songDetailReleaseVersions" :key="version.id" :id="'recording-'+version.id" :open="expandedSongReleaseId===version.id" @toggle="toggleSongRelease(version.id)">
                            <template #title><b>{{ version.title }}</b></template>
                            <template #subtitle>{{ version.version_label || '原始版本' }}</template>
                            <table v-if="version.releases.length" class="data-table">
                                <thead><tr><th>#</th><th>专辑</th><th>发售日</th><th>歌手</th><th>试听</th></tr></thead>
                                <tbody><tr v-for="release in version.releases" :key="release.album_id+'-'+release.track_number" :class="{'anime-selected-release':songLinkVersion===version.id && songLinkRelease===release.album_id}">
                                    <td data-label="#">{{ release.track_number }}</td>
                                    <td data-label="专辑"><button class="album-inline" type="button" @click="openAlbumFromSong({version:version,release:release})"><img v-media-src="coverThumb(release.cover,96)" alt="" @error="onCatalogImageError($event)"><span><b>{{ release.album_name }}</b><span class="secondary-line">{{ release.catalog || release.type }}</span></span></button></td>
                                    <td data-label="发售日">{{ release.release_date || '—' }}</td>
                                    <td data-label="歌手"><div v-if="release.vocalists.length" class="performer-chip-list compact"><button v-for="vocalist in release.vocalists" :key="vocalist.voice_actor_id" class="performer-chip voice-chip" :style="{'--chip-color':(vocalist.character && vocalist.character.color_main) || '#3157ed'}" @click="openVoice(vocalist.voice_actor_id)"><img v-if="voicePhoto(vocalist.voice_actor_id)" v-media-src="voicePhoto(vocalist.voice_actor_id)" alt=""><span>{{ voiceName(vocalist.voice_actor_id,vocalist.voice_actor_name) }}</span></button></div><span v-else-if="releaseSingerLabel(version,release)">{{ releaseSingerLabel(version,release) }}</span><span v-else>—</span></td>
                                    <td data-label="试听"><entity-actions v-if="release.audio_url" size="compact" :playing="isActive(release.audio_url)" @play="playSongRelease({version:version,release:release})" @add="addSongTrack(songDetail,version,release)"></entity-actions><span v-else>—</span></td>
                                </tr></tbody>
                            </table>
                        </ui-disclosure>
                        <div v-if="!songDetailReleaseVersions.length" class="ui-state compact">尚无可确认的正式音源收录</div>
                    </div>
                    </section>

                    <section v-else-if="songSection==='credits'" class="entity-section song-credit-section">
                        <div v-if="songCreditVersions.length" class="song-credit-list">
                            <div class="song-credit-original">
                                <dl class="credit-ledger">
                                    <div v-for="group in creditRoleGroups(songCreditVersions[0])" :key="group.role">
                                        <dt>{{ group.label }}</dt>
                                        <dd><template v-for="(credit,index) in group.credits" :key="credit.creator_id || credit.name"><span v-if="index" class="credit-separator"> / </span><em v-if="credit.organization" class="credit-role-tag">{{ credit.organization }}</em><button v-else-if="credit.creator_id" class="text-link" type="button" @click="openCreator(credit.creator_id)">{{ credit.name }}</button><span v-else>{{ credit.name }}</span><em v-if="credit.institution" class="credit-role-tag">{{ credit.institution }}</em></template></dd>
                                    </div>
                                </dl>
                            </div>
                            <div v-if="songCreditVersions.length > 1" class="song-credit-variants ui-disclosure-list">
                            <ui-disclosure v-for="version in songCreditVersions.slice(1)" :key="version.id" class="song-credit-version" :open="expandedSongCreditId===version.id" @toggle="toggleSongCredit(version.id)">
                                <template #title><b>{{ version.credit_heading }}</b></template>
                                <dl class="credit-ledger">
                                    <div v-for="group in creditRoleGroups(version)" :key="group.role">
                                        <dt>{{ group.label }}</dt>
                                        <dd><template v-for="(credit,index) in group.credits" :key="credit.creator_id || credit.name"><span v-if="index" class="credit-separator"> / </span><em v-if="credit.organization" class="credit-role-tag">{{ credit.organization }}</em><button v-else-if="credit.creator_id" class="text-link" type="button" @click="openCreator(credit.creator_id)">{{ credit.name }}</button><span v-else>{{ credit.name }}</span><em v-if="credit.institution" class="credit-role-tag">{{ credit.institution }}</em></template></dd>
                                    </div>
                                </dl>
                            </ui-disclosure>
                            </div>
                        </div>
                        <div v-else class="ui-state compact">暂无创作人资料</div>
                    </section>

                    <section v-else-if="songSection==='lyrics'" class="entity-section song-lyrics-section">
                        <template v-if="songLyricVersions.length">
                            <div class="lyrics-toolbar">
                                <ui-select v-model="songLyricVersionId" label="录音版本" :options="songLyricVersionOptions" @change="setSongLyricVersion"></ui-select>
                                <button v-if="selectedSongLyricVersion && selectedSongLyricVersion.lyrics.translation_lines && selectedSongLyricVersion.lyrics.translation_lines.length" class="filter-pill" :class="{active:songLyricTranslation}" type="button" @click="songLyricTranslation=!songLyricTranslation">{{ songLyricTranslation ? '显示原文' : '显示翻译' }}</button>
                            </div>
                            <ol class="lyrics-sheet">
                                <li v-for="line in selectedSongLyricLines" :key="line.index"><span>{{ line.text }}</span></li>
                            </ol>
                        </template>
                        <div v-else class="ui-state compact">该歌曲暂无可确认的歌词</div>
                    </section>

                    <section v-else-if="songSection==='performances'" class="entity-section">
                    <table v-if="songDetailPerformances.length" class="data-table">
                        <thead><tr><th>日期</th><th>活动 / 场次</th><th>版本</th><th>演唱角色</th></tr></thead>
                        <tbody><tr v-for="row in songDetailPerformances" :key="row.performance.session_id+'-'+row.performance.performance_index">
                            <td data-label="日期">{{ row.performance.session_date || row.performance.event_date || '—' }}</td>
                            <td data-label="活动 / 场次"><button class="text-link stacked" type="button" @click="openEventUrl(row.performance.event_url)"><b>{{ row.performance.event_title }}</b><span class="secondary-line">{{ row.performance.session_label }}<template v-if="row.display_no"> · 第 {{ row.display_no }} 首</template></span></button></td>
                            <td data-label="版本">{{ (row.performance.performance_variant && (row.performance.performance_variant.label || row.performance.performance_variant.title)) || row.version.version_label || '原始版本' }}</td>
                            <td data-label="演唱角色"><div class="performer-chip-list compact song-performance-cast"><button v-for="characterId in row.performance.character_ids" :key="characterId" class="performer-chip character-chip" :style="{'--chip-color':characterColor(characterId)}" @click="openCharacter(characterId)"><img v-if="characterPerformanceImage(characterId)" v-media-src="characterPerformanceImage(characterId)" alt=""><span>{{ characterName(characterId) }}</span></button><span v-for="guest in (row.performance.guest_performers || [])" :key="guest" class="guest-performer">{{ guest }}</span></div></td>
                        </tr></tbody>
                    </table>
                    <div v-else class="ui-state compact">暂无现场演出</div>
                    </section>

                </div>
            </article>
        `;
