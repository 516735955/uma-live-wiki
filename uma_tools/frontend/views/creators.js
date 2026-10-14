export const bindings = ["albums","coverThumb","onCatalogImageError","isActive","playSongTrack","addSongTrack","relationSong","openSong","creatorCatalog","creatorCatalogError","creatorCatalogLoading","creatorDetail","creatorSection","setCreatorSection","creatorQuery","creatorFiltered","creatorPaged","creatorPage","creatorPageCount","creatorPageList","setCreatorPage","goCreatorPage","openCreator","creatorRoleLabel","creatorWorkRoleLabels","creatorPortrait","creatorWorkVersions","creatorRecordingLoading","creatorRecordingErrors","loadCreatorRecording","expandedCreatorWorkId","toggleCreatorWork","animeError","retryAnime","creatorAnimeWorks","creatorAnimeCueWorks","animeLink","routes"];
export const template = `
            <div v-if="creatorCatalogError" class="ui-state ui-state-error">{{ creatorCatalogError }}</div>
            <template v-if="!creatorDetail">
                <div class="archive-toolbar creator-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="creatorQuery" aria-label="搜索创作者或歌曲" placeholder="搜索创作者或歌曲" autocomplete="off"><button v-if="creatorQuery" type="button" @click.prevent="creatorQuery=''" aria-label="清空搜索">×</button></label>
                </div>
                <div id="creatorArchiveTop" class="creator-catalog">
                    <template v-if="creatorCatalogLoading && !creatorCatalog.creators.length"><div v-for="i in 8" :key="'creator-load-'+i" class="archive-row-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></template>
                    <button v-for="creator in creatorPaged" :key="creator.id" class="creator-catalog-row" type="button" @click="openCreator(creator)">
                        <span class="identity-portrait"><img :src="creatorPortrait(creator)" alt="" loading="lazy" @error="creator.image='';creator.photo=''"></span>
                        <span class="creator-catalog-name"><b>{{ creator.name }}</b><small v-if="creator.affiliations.length">{{ creator.affiliations.join(' · ') }}</small></span>
                        <span class="creator-catalog-roles role-tag-row"><em v-for="role in creator.roles" :key="role.role" class="credit-role-tag">{{ role.label || creatorRoleLabel(role.role) }}</em></span>

                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                    <div v-if="!creatorCatalogError && !creatorCatalogLoading && !creatorFiltered.length" class="ui-state">没有符合条件的创作者</div>
                </div>
                <div v-if="creatorFiltered.length" class="ui-pager"><div><button :disabled="creatorPage<=1" @click="goCreatorPage(-1)">上一页</button><button v-for="(page,index) in creatorPageList" :key="index" :class="{active:page===creatorPage}" :disabled="page==='…'" @click="setCreatorPage(page)">{{ page }}</button><button :disabled="creatorPage>=creatorPageCount" @click="goCreatorPage(1)">下一页</button></div></div>
            </template>

            <article v-else class="entity-detail creator-entity-detail">
                <div class="entity-hero creator-hero music-archive-hero">
                    <div class="entity-cover creator-cover"><img :src="creatorPortrait(creatorDetail)" :alt="creatorDetail.name" @error="creatorDetail.image='';creatorDetail.photo=''"></div>
                    <div class="entity-intro creator-intro">
                        <span class="entity-kind">创作者</span>
                        <h1>{{ creatorDetail.name }}</h1>
                        <p v-if="creatorDetail.aliases.length" class="entity-reading">{{ creatorDetail.aliases.join(' · ') }}</p>
                        <div class="role-tag-row creator-role-tags"><em v-for="role in creatorDetail.roles" :key="role.role" class="credit-role-tag">{{ role.label }}</em></div>
                    </div>
                </div>
                <div class="media-content">
                    <nav v-if="creatorDetail.works.length" class="entity-tabs" aria-label="创作者栏目"><button :class="{active:creatorSection==='works'}" @click="setCreatorSection('works')">参与歌曲</button><button v-if="creatorDetail.collaborators.length" :class="{active:creatorSection==='collaborators'}" @click="setCreatorSection('collaborators')">常见合作</button></nav>
                    <section v-if="creatorDetail.works.length && (creatorSection==='works' || !creatorDetail.collaborators.length)" class="entity-section"><div class="creator-relation-list ui-disclosure-list"><ui-disclosure v-for="work in creatorDetail.works" :key="work.song_id" :open="expandedCreatorWorkId===work.song_id" @toggle="toggleCreatorWork(work.song_id)"><template #leading><img :src="coverThumb(work.cover,128)" alt="" loading="lazy" @error="onCatalogImageError($event)"></template><template #title><b>{{ work.title }}</b></template><template #subtitle>{{ creatorWorkRoleLabels(work.roles) }}</template><template #meta>{{ work.release_date || '—' }}</template><div class="creator-relation-detail"><div v-for="version in creatorWorkVersions(work)" :key="version.id"><b>{{ version.version_label || '原始版本' }}</b><span class="role-tag-row"><em v-for="role in version.roles" :key="role" class="credit-role-tag">{{ creatorRoleLabel(role) }}</em></span><div v-for="release in version.releases" :key="release.album_id+'-'+release.track_number" class="recording-row"><div class="recording-copy"><a class="text-link" :href="routes.albums(release.album_id)" @click="animeLink($event,$event.currentTarget.href)">{{ release.album_name }}</a><small>{{ release.release_date }}<template v-if="release.catalog"> · {{ release.catalog }}</template></small></div><entity-actions v-if="release.audio_url" size="compact" :playing="isActive(release.audio_url)" @play="playSongTrack(relationSong(work),version,release)" @add="addSongTrack(relationSong(work),version,release)"></entity-actions></div></div><p v-if="creatorRecordingLoading[work.song_id]" class="secondary-line">正在加载录音…</p><p v-if="creatorRecordingErrors[work.song_id]" class="secondary-line">{{ creatorRecordingErrors[work.song_id] }} <button type="button" class="state-retry" @click="loadCreatorRecording(work)">重试</button></p><button type="button" class="relation-detail-link" @click="openSong(work.song_id)">查看歌曲详情</button></div></ui-disclosure></div></section>
                    <section v-else-if="creatorDetail.collaborators.length" class="entity-section"><creator-network :creator="creatorDetail" :catalog="creatorCatalog.creators" @open-creator="openCreator" @open-song="openSong"></creator-network></section>
                    <div v-if="animeError" class="ui-state ui-state-error" role="alert"><span>动画关联暂时无法载入。</span><button class="ui-retry" @click="retryAnime">重试</button></div>
                    <section v-if="creatorAnimeWorks.length" class="entity-section"><div class="section-toolbar"><span class="credit-role-tag">动画制作</span></div><anime-participation :works="creatorAnimeWorks" section="staff"></anime-participation></section>
                    <section v-if="creatorAnimeCueWorks.length" class="entity-section"><div class="section-toolbar"><span class="credit-role-tag">动画音乐</span></div><anime-participation :works="creatorAnimeCueWorks" section="music"></anime-participation></section>
                </div>
            </article>
        `;
