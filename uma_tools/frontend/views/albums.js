export const bindings = ["albums","albumsError","albumsLoading","albumDetail","player","openAlbumFromDb","coverStyle","coverThumb","onCatalogImageError","sampleCover","isActive","playAlbumTrack","addAlbumTrack","playAlbum","enqueueAlbum","albumPlayableCount","openSong","albumTrackVocalists","albumTrackSecondary","albumTrackSongId","openVoice","animeError","albumAnimeRelations","retryAnime","albumAnimeWorks","relFilter","relTypeList","relYearList","relWorkList","relQuery","relWork","relSort","relYear","relPage","relFiltered","relPaged","relPageCount","relPageStart","relPageEnd","relPageList","setRelPage","goRelPage","albumSortOptions","albumsTotal","loadAlbums","internalLink","routes"];
export const template = `
            <content-state v-if="albumsError" state="error" subject="专辑资料" :retry="true" @retry="loadAlbums()"></content-state>
            <template v-if="!albumDetail">
                <div class="archive-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="relQuery" aria-label="搜索专辑、歌曲、歌手或商品编号" placeholder="搜索专辑、歌曲、歌手或商品编号" autocomplete="off"><button v-if="relQuery" type="button" @click.prevent="relQuery=''" aria-label="清空搜索">×</button></label>
                    <div class="archive-controls">
                        <ui-select v-model="relFilter" label="类型" :options="[{value:'',label:'全部'},...relTypeList.map(type=>({value:type,label:type}))]"></ui-select>
                        <ui-select v-model="relWork" label="作品" :options="[{value:'',label:'全部'},...relWorkList.map(item=>({value:item.key,label:item.label}))]"></ui-select>
                        <ui-select v-model="relYear" label="年份" :options="[{value:'',label:'全部'},...relYearList.map(year=>({value:year,label:year==='unknown'?'未知':year}))]"></ui-select>
                        <ui-select v-model="relSort" label="排序" :options="albumSortOptions"></ui-select>
                    </div>
                </div>
                <div class="albums-grid album-database-grid">
                    <template v-if="albumsLoading && !albums.length">
                        <div v-for="i in 8" :key="'album-load-'+i" class="archive-card-skeleton" aria-hidden="true"><span></span><span></span></div>
                    </template>
                    <a v-for="(album,index) in relPaged" :key="album.name" class="album-card" :style="coverStyle(album)" :href="routes.albums(album.id)" @click="internalLink($event, () => openAlbumFromDb(album))">
                            <img class="album-cover" v-media-src="coverThumb(album.cover,420)" :alt="album.name" :loading="index < 2 ? 'eager' : 'lazy'" :fetchpriority="index === 0 ? 'high' : 'auto'" decoding="async" @load="sampleCover($event, album.cover)" @error="onCatalogImageError($event)">
                        <div class="album-info">
                            <div class="album-name">{{ album.name }}</div>
                            <div class="album-count">{{ album.release || '日期待补' }} · {{ album.type }}</div>
                        </div>
                        <div class="card-veil"><p>View more</p><span class="card-veil-arrow" aria-hidden="true">&gt;</span></div>
                    </a>
                    <content-state v-if="!albumsError && !albumsLoading && !relFiltered.length" :state="(relQuery || relFilter || relWork || relYear) ? 'filtered' : 'uncollected'" subject="专辑" :clear="Boolean(relQuery || relFilter || relWork || relYear)" @clear="relQuery='';relFilter='';relWork='';relYear='';relPage=1"></content-state>
                </div>
                <div v-if="relFiltered.length" class="ui-pager"><span>{{ relPageStart }}–{{ relPageEnd }} / {{ albumsTotal }}</span><div><button :disabled="relPage<=1" @click="goRelPage(-1)">上一页</button><button v-for="(page,i) in relPageList" :key="i" :class="{active:page===relPage}" :disabled="page==='…'" @click="setRelPage(page)">{{ page }}</button><button :disabled="relPage>=relPageCount" @click="goRelPage(1)">下一页</button></div></div>
            </template>
            <article v-else class="entity-detail album-entity-detail">
                <div class="entity-hero music-archive-hero">
                    <div class="entity-cover album-cover-detail"><img v-media-src="coverThumb(albumDetail.data.cover,720)" :data-original="albumDetail.data.cover" :alt="albumDetail.data.name" fetchpriority="high" @error="onCatalogImageError($event)"></div>
                    <div class="entity-intro"><span class="entity-kind">{{ albumDetail.data.type || '专辑' }}</span><h1>{{ albumDetail.data.name }}</h1><dl class="entity-meta"><div><dt>发行日期</dt><dd>{{ albumDetail.data.release || '—' }}</dd></div><div><dt>商品编号</dt><dd>{{ albumDetail.data.catalog || '—' }}</dd></div><div v-if="albumDetail.data.company"><dt>发行公司</dt><dd>{{ albumDetail.data.company }}</dd></div></dl><entity-actions v-if="albumPlayableCount(albumDetail)" size="hero" :playing="player.current && player.current.albumId===(albumDetail.data.id || albumDetail.data.catalog) && isActive(player.current.url)" play-label="播放这张专辑" add-label="加入这张专辑" @play="playAlbum(albumDetail)" @add="enqueueAlbum(albumDetail)"></entity-actions></div>
                </div>
                <div class="media-content">
                    <content-state v-if="animeError" state="error" subject="动画关联" :retry="true" @retry="retryAnime"></content-state>
                    <section v-if="albumAnimeRelations.length" class="entity-section anime-crosslink-section">
                        <div class="section-toolbar"><span class="credit-role-tag">动画关联</span></div>
                        <anime-participation :works="albumAnimeWorks" section="music"></anime-participation>
                    </section>
                    <section class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">曲目</span><div v-if="albumDetail.songs.length" class="entity-section-actions"><span>{{ albumDetail.songs.length }} 首</span></div></div>
                        <div v-if="albumDetail.songs.length" class="album-track-list">
                            <div v-for="(song,index) in albumDetail.songs" :key="song.name+'-'+index">
                                <span>{{ String(index+1).padStart(2,'0') }}</span>
                                <div class="album-track-main">
                                    <a class="text-link" :href="routes.songs(albumTrackSongId(song,index))" @click="internalLink($event, () => openSong(albumTrackSongId(song,index)))"><b>{{ song.name }}</b></a>
                                    <div v-if="albumTrackVocalists(song,index).length" class="performer-chip-list compact">
                                        <a v-for="vocalist in albumTrackVocalists(song,index)" :key="vocalist.voice_actor_id" class="performer-chip voice-chip" :style="{'--chip-color':vocalist.color}" :href="routes.voiceActors(vocalist.voice_actor_id)" @click="internalLink($event, () => openVoice(vocalist.voice_actor_id))"><img v-media-src="vocalist.image" alt=""><span>{{ vocalist.name }}</span></a>
                                    </div>
                                    <span v-else-if="albumTrackSecondary(song)" class="secondary-line">{{ albumTrackSecondary(song) }}</span>
                                </div>
                                <entity-actions v-if="song.url" size="compact" :playing="isActive(song.url)" @play="playAlbumTrack(albumDetail,index)" @add="addAlbumTrack(albumDetail,index)"></entity-actions>
                            </div>
                        </div>
                        <content-state v-else :state="(albumDetail.data.content_status && albumDetail.data.content_status.tracks && albumDetail.data.content_status.tracks.state) || 'uncollected'" subject="曲目"></content-state>
                    </section>
                </div>
            </article>
        `;
