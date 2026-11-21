export const bindings = ["albums","coverThumb","onCatalogImageError","isActive","playSongTrack","addSongTrack","relationSong","openSong","creatorCatalog","creatorCatalogError","creatorCatalogLoading","creatorDetail","creatorSection","setCreatorSection","creatorQuery","creatorCurrentPage","creatorPage","creatorPageCount","creatorPageList","setCreatorPage","goCreatorPage","openCreator","creatorRoleLabel","creatorWorkRoleLabels","creatorPortrait","creatorWorkVersions","creatorRecordingLoading","creatorRecordingErrors","loadCreatorRecording","expandedCreatorWorkId","toggleCreatorWork","animeError","retryAnime","creatorAnimeWorks","animeLink","routes","loadCreatorCatalog","internalLink"];
export const template = `
            <div v-if="creatorCatalogError" class="ui-state ui-state-error">{{ creatorCatalogError }} <button type="button" class="ui-retry" @click="loadCreatorCatalog()">重试</button></div>
            <template v-if="!creatorDetail">
                <div class="archive-toolbar creator-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="creatorQuery" aria-label="搜索创作者或歌曲" placeholder="搜索创作者或歌曲" autocomplete="off"><button v-if="creatorQuery" type="button" @click.prevent="creatorQuery=''" aria-label="清空搜索">×</button></label>
                </div>
                <div id="creatorArchiveTop" class="creator-catalog">
                    <template v-if="creatorCatalogLoading && !creatorCatalog.creators.length"><div v-for="i in 8" :key="'creator-load-'+i" class="archive-row-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></template>
                    <a v-for="creator in creatorCurrentPage" :key="creator.id" class="creator-catalog-row" :href="routes.creators(creator.id)" @click="internalLink($event, () => openCreator(creator))">
                        <span class="identity-portrait"><img v-media-src="creatorPortrait(creator)" alt="" loading="lazy" @error="creator.image='';creator.photo=''"></span>
                        <span class="creator-catalog-name"><b>{{ creator.name }}</b><small v-if="creator.affiliations.length">{{ creator.affiliations.join('、') }}</small></span>
                        <span class="creator-catalog-roles role-tag-row"><em v-for="role in creator.roles" :key="role.role" class="credit-role-tag">{{ role.label || creatorRoleLabel(role.role) }}</em></span>

                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                    </a>
                    <content-state v-if="!creatorCatalogError && !creatorCatalogLoading && !creatorCurrentPage.length" :state="creatorQuery ? 'filtered' : 'uncollected'" subject="创作者" :clear="Boolean(creatorQuery)" @clear="creatorQuery=''"></content-state>
                </div>
                <div v-if="creatorCurrentPage.length" class="ui-pager"><div><button :disabled="creatorPage<=1" @click="goCreatorPage(-1)">上一页</button><button v-for="(page,index) in creatorPageList" :key="index" :class="{active:page===creatorPage}" :disabled="page==='…'" @click="setCreatorPage(page)">{{ page }}</button><button :disabled="creatorPage>=creatorPageCount" @click="goCreatorPage(1)">下一页</button></div></div>
            </template>

            <article v-else class="entity-detail creator-entity-detail">
                <div class="entity-hero creator-hero music-archive-hero">
                    <div class="entity-cover creator-cover"><img v-media-src="creatorPortrait(creatorDetail)" :alt="creatorDetail.name" @error="creatorDetail.image='';creatorDetail.photo=''"></div>
                    <div class="entity-intro creator-intro">
                        <span class="entity-kind">创作者</span>
                        <h1>{{ creatorDetail.name }}</h1>
                        <p v-if="creatorDetail.aliases.length" class="entity-reading">{{ creatorDetail.aliases.join('、') }}</p>
                        <div class="role-tag-row creator-role-tags"><em v-for="role in creatorDetail.roles" :key="role.role" class="credit-role-tag">{{ role.label }}</em></div>
                    </div>
                </div>
                <div class="media-content">
                    <nav class="entity-tabs" aria-label="创作者栏目">
                        <button :class="{active:creatorSection==='works'}" @click="setCreatorSection('works')">参与歌曲</button>
                        <button :class="{active:creatorSection==='collaborators'}" @click="setCreatorSection('collaborators')">常见合作</button>
                        <button :class="{active:creatorSection==='anime'}" @click="setCreatorSection('anime')">动画制作</button>
                    </nav>
                    <section v-if="creatorDetail.works.length && creatorSection==='works'" class="entity-section">
                        <div class="relation-song-list">
                            <ui-disclosure v-for="work in creatorDetail.works" :key="work.song_id" class="relation-song-row" :open="expandedCreatorWorkId===work.song_id" @toggle="toggleCreatorWork(work.song_id)">
                                <template #leading><img v-media-src="coverThumb(work.cover,112)" alt="" loading="lazy" @error="onCatalogImageError($event)"></template>
                                <template #title><b>{{ work.title }}</b></template>
                                <template #subtitle>{{ creatorWorkRoleLabels(work.roles) }}</template>
                                <template #meta>{{ work.release_date || '—' }}</template>
                                <div class="relation-song-detail">
                                    <section v-for="version in creatorWorkVersions(work)" :key="version.id" class="relation-version">
                                        <header>
                                            <a class="text-link" :href="routes.songs(work.song_id)" @click="internalLink($event, () => openSong(work.song_id))">{{ version.title || work.title }}</a>
                                            <span>{{ version.version_label || '原始版本' }}</span>
                                            <span class="role-tag-row"><em v-for="role in version.roles" :key="role" class="credit-role-tag">{{ creatorRoleLabel(role) }}</em></span>
                                        </header>
                                        <div v-for="release in version.releases" :key="release.album_id+'-'+release.track_number" class="relation-release">
                                            <a class="album-inline" :href="routes.albums(release.album_id)" @click="animeLink($event,$event.currentTarget.href)">
                                                <img v-media-src="coverThumb(release.cover || work.cover,88)" alt="" @error="onCatalogImageError($event)">
                                                <span><b>{{ release.album_name }}</b><span class="secondary-line">{{ release.release_date || '日期待补' }}<template v-if="release.catalog">　{{ release.catalog }}</template></span></span>
                                            </a>
                                            <span></span>
                                            <entity-actions v-if="release.audio_url" size="compact" :playing="isActive(release.audio_url)" @play="playSongTrack(relationSong(work),version,release)" @add="addSongTrack(relationSong(work),version,release)"></entity-actions>
                                        </div>
                                    </section>
                                    <p v-if="creatorRecordingLoading[work.song_id]" class="secondary-line">正在加载录音…</p>
                                    <p v-if="creatorRecordingErrors[work.song_id]" class="secondary-line">{{ creatorRecordingErrors[work.song_id] }} <button type="button" class="state-retry" @click="loadCreatorRecording(work)">重试</button></p>
                                </div>
                            </ui-disclosure>
                        </div>
                    </section>
                    <section v-else-if="creatorSection==='works'" class="entity-section">
                        <content-state state="uncollected" subject="参与歌曲"></content-state>
                    </section>
                    <section v-else-if="creatorSection==='collaborators'" class="entity-section">
                        <creator-network v-if="creatorDetail.collaborators.length" :creator="creatorDetail" :catalog="creatorCatalog.creators" :role-label="creatorRoleLabel" @open-creator="openCreator" @open-song="openSong"></creator-network>
                        <content-state v-else state="uncollected" subject="常见合作"></content-state>
                    </section>
                    <section v-else-if="creatorSection==='anime'" class="entity-section">
                        <content-state v-if="animeError" state="error" subject="动画制作" :retry="true" @retry="retryAnime"></content-state>
                        <anime-participation v-else-if="creatorAnimeWorks.length" :works="creatorAnimeWorks" section="staff"></anime-participation>
                        <content-state v-else state="uncollected" subject="动画制作"></content-state>
                    </section>
                </div>
            </article>
        `;
