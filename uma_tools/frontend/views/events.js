export const bindings = ["liveView","isActive","eventsQuery","evTime","evYear","eventYearOptions","eventTypeOptions","eventTypeSelection","setEvTime","setEvYear","eventsCurrentPage","eventsPage","eventsPageCount","eventsTotal","eventsPageStart","eventsPageEnd","eventsPageList","setEventsPage","goEventsPage","onEventImageError","eventDetail","selectedEventSession","selectedEventSessionId","eventSessionOptions","selectEventSession","eventPlayableRows","playEventTrack","addEventTrack","playEventSession","enqueueEventSession","eventMediaCards","activeMediaKey","activateEventMedia","eventVoiceCast","eventVoiceCastGroups","eventUnscopedCast","openEvent","openNews","eventDateLabel","eventSummary","eventCurrentSummary","eventSessionSummary","eventSessionImage","eventCancellation","eventStatusNewsId","eventKindLabel","eventModeLabel","eventSeriesName","eventSongCount","eventSessionTable","onEventSetlistClick","playableSongRelease","relationSong","openSong","characterName","characterPerformanceImage","characterColor","voiceName","voicePhoto","openCharacter","openVoice","animeError","eventAnimeRelations","retryAnime","eventAnimeWorks","eventsAll","eventsError","eventsLoading","loadEvents","internalLink","routes"];
bindings.push("eventCharacterCast", "characterImage");
export const template = `
            <content-state v-if="eventsError" state="error" subject="活动" :retry="true" @retry="loadEvents()"></content-state>

            <template v-if="liveView==='eventHub'">
                <div class="archive-toolbar">
                    <label class="ui-search">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                        <input type="search" v-model.trim="eventsQuery" aria-label="搜索活动、系列、出演者、角色或歌曲" placeholder="搜索活动、系列、出演者、角色或歌曲" autocomplete="off">
                        <button v-if="eventsQuery" type="button" @click.prevent="eventsQuery=''" aria-label="清空搜索">×</button>
                    </label>
                    <div class="archive-controls event-filter-controls">
                        <ui-select v-model="evTime" label="状态" :options="[{value:'all',label:'全部'},{value:'upcoming',label:'未结束'},{value:'past',label:'已结束'},{value:'announced',label:'日期未知'},{value:'cancelled',label:'已取消'}]" @change="setEvTime"></ui-select>
                        <ui-select class="event-type-select" v-model="eventTypeSelection" label="类型" :options="eventTypeOptions"></ui-select>
                        <ui-select v-model="evYear" label="年份" :options="eventYearOptions" @change="setEvYear"></ui-select>
                    </div>
                </div>

                <div id="eventsRowsTop" class="event-catalog">
                    <template v-if="eventsLoading && !eventsAll.length">
                        <div v-for="i in 6" :key="'event-load-'+i" class="archive-row-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
                    </template>
                    <a v-for="(event,i) in eventsCurrentPage" :key="event.id" class="event-catalog-row" :href="routes.events(event.id)" @click="internalLink($event, () => openEvent(event))">
                        <span class="event-catalog-cover">
                            <img v-media-src="event.image" :alt="event.title" :loading="i===0?'eager':'lazy'" :fetchpriority="i===0?'high':'auto'" decoding="async" @error="onEventImageError($event,event)">
                        </span>
                        <time v-if="event.end_date && event.end_date !== event.date" class="event-date-range"><span>{{ event.date }}</span><span aria-hidden="true">—</span><span>{{ event.end_date }}</span></time>
                        <time v-else>{{ event.date || '待公布' }}</time>
                        <span class="event-catalog-main">
                            <b>{{ event.title }}</b>
                            <span>{{ eventSeriesName(event) || eventKindLabel(event.kind) }}<template v-if="event.venue">　{{ event.venue }}</template></span>
                        </span>
                        <span class="event-catalog-facts">
                            <em v-if="event.schedule_status==='cancelled'" class="event-status-cancelled">已取消</em>
                            <i>{{ eventKindLabel(event.kind) }}</i>
                            <b v-if="event.cast_count">{{ event.cast_count }} 位{{ event.schedule_status==='cancelled' ? '原定出演' : '出演' }}</b>
                            <b v-if="eventSongCount(event)">{{ eventSongCount(event) }} 首曲目</b>
                        </span>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                    </a>
                    <content-state v-if="!eventsError && !eventsLoading && !eventsCurrentPage.length" :state="(eventsQuery || evTime!=='all' || eventTypeSelection!=='kind:all' || evYear!=='all') ? 'filtered' : 'uncollected'" subject="活动" :clear="!!(eventsQuery || evTime!=='all' || eventTypeSelection!=='kind:all' || evYear!=='all')" @clear="eventsQuery='';evTime='all';eventTypeSelection='kind:all';evYear='all';eventsPage=1"></content-state>
                </div>
                <div v-if="eventsCurrentPage.length" class="ui-pager">
                    <span>{{ eventsPageStart }}–{{ eventsPageEnd }} / {{ eventsTotal }}</span>
                    <div>
                        <button :disabled="eventsPage<=1" @click="goEventsPage(-1)">上一页</button>
                        <button v-for="(page,i) in eventsPageList" :key="i" :class="{active:page===eventsPage}" :disabled="page==='…'" @click="setEventsPage(page)">{{ page }}</button>
                        <button :disabled="eventsPage>=eventsPageCount" @click="goEventsPage(1)">下一页</button>
                    </div>
                </div>
            </template>

            <template v-else-if="eventDetail">
                <article class="entity-detail event-entity-detail">
                    <div class="entity-hero">
                        <div v-if="eventSessionOptions.length > 1 || eventCancellation || eventDetail.schedule_status==='partially_cancelled'" class="event-hero-controls">
                            <span v-if="eventCancellation || eventDetail.schedule_status==='partially_cancelled'" class="event-status-cancelled">{{ eventDetail.schedule_status==='cancelled' ? '已取消' : eventCancellation ? '本场已取消' : '部分场次取消' }}</span>
                            <ui-select v-if="eventSessionOptions.length > 1" class="event-session-select" :floating="true" :menu-min-width="260" menu-class="event-session-menu" :model-value="selectedEventSessionId" :label="eventDetail.unit_kind || '场次'" :options="eventSessionOptions" @change="selectEventSession"></ui-select>
                        </div>
                        <div class="entity-cover event-cover">
                            <img :key="selectedEventSessionId || eventDetail.id" v-media-src="eventSessionImage" :data-original="(selectedEventSession && (selectedEventSession.image_original || selectedEventSession.image)) || eventDetail.image_original || eventDetail.image" :alt="eventDetail.title" fetchpriority="high" @error="onEventImageError($event,selectedEventSession || eventDetail)">
                        </div>
                        <div class="entity-intro">
                            <span class="entity-kind">{{ eventKindLabel(eventDetail.kind) }}</span>
                            <h1>{{ eventDetail.title }}</h1><p v-if="eventDetail.title_ja && eventDetail.title_ja !== eventDetail.title" class="entity-reading">{{ eventDetail.title_ja }}</p>
                            <div class="event-hero-facts">
                            <activity-time v-if="!selectedEventSession" :date="eventDetail.date" :end-date="eventDetail.end_date" :doors-time="eventDetail.doors_time" :start-time="eventDetail.start_time" :end-time="eventDetail.end_time" :broadcast-time="eventDetail.broadcast_time"></activity-time>
                            <dl v-if="(selectedEventSession && selectedEventSession.venue) || eventDetail.venue" class="entity-meta event-venue-meta"><div><dt>地点</dt><dd>{{ (selectedEventSession && selectedEventSession.venue) || eventDetail.venue }}</dd></div></dl>
                            <activity-time v-if="selectedEventSession" class="event-session-time" :date="selectedEventSession.date || eventDetail.date" :end-date="selectedEventSession.end_date" :doors-time="selectedEventSession.doors_time" :start-time="selectedEventSession.start_time" :end-time="selectedEventSession.end_time" :start-estimated="!!selectedEventSession.start_time_estimated" :note="selectedEventSession.schedule_note || ''" :end-estimated="!!selectedEventSession.end_time_estimated" :broadcast-time="selectedEventSession.broadcast_time || selectedEventSession.broadcast" :broadcast-date="selectedEventSession.broadcast_date" :published-time="selectedEventSession.published_time" :published-date="selectedEventSession.published_date"></activity-time>
                            </div>
                        </div>
                    </div>

                    <section class="entity-overview">
                        <dl><div><dt>形式</dt><dd>{{ eventModeLabel(eventDetail.mode) }}</dd></div><div v-if="eventSeriesName(eventDetail)"><dt>系列</dt><dd>{{ eventSeriesName(eventDetail) }}</dd></div></dl>
                        <p v-if="eventCurrentSummary">{{ eventCurrentSummary }}</p>
                        <p v-if="eventCancellation" class="event-status-note">{{ eventCancellation.status_note }} <a v-if="eventStatusNewsId(eventCancellation)" class="text-link" :href="routes.news(eventStatusNewsId(eventCancellation))" @click="internalLink($event, () => openNews(eventStatusNewsId(eventCancellation)))">查看取消公告 <span aria-hidden="true">→</span></a><a v-else-if="eventCancellation.status_source_url" class="text-link" :href="eventCancellation.status_source_url" target="_blank" rel="noopener">官方取消公告 ↗</a></p>
                    </section>

                    <section v-if="selectedEventSession && eventDetail.schedule_status!=='cancelled' && selectedEventSession.schedule_status!=='cancelled' && (eventSessionTable(selectedEventSession) || (selectedEventSession.performances && selectedEventSession.performances.length))" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">演出曲目</span><div class="entity-section-actions"><entity-actions v-if="eventPlayableRows.length" size="compact" play-label="播放本场" add-label="加入本场" @play="playEventSession" @add="enqueueEventSession"></entity-actions></div></div>
                        <div v-if="eventSessionTable(selectedEventSession)" class="setlist-frame" @click="onEventSetlistClick($event)" v-html="eventSessionTable(selectedEventSession)"></div>
                        <table v-else-if="selectedEventSession.performances && selectedEventSession.performances.length" class="data-table setlist-table">
                            <thead><tr><th>#</th><th>曲名</th><th>出演者</th><th>出处</th><th>试听</th></tr></thead>
                            <tbody><tr v-for="(performance,index) in selectedEventSession.performances" :key="performance.id || index">
                                <td class="setlist-no">{{ index + 1 }}</td>
                                <td class="setlist-song"><a class="text-link setlist-song-link" :href="routes.songs(performance.song_id)" @click="internalLink($event, () => openSong(performance.song_id))">{{ performance.song }}</a></td>
                                <td class="setlist-perf"><performance-cast :performance="performance"></performance-cast></td>
                                <td class="setlist-src">{{ performance.source || '现场演唱' }}</td>
                                <td class="setlist-actions"><entity-actions v-if="playableSongRelease(relationSong(performance))" size="compact" :playing="isActive(playableSongRelease(relationSong(performance)).release.audio_url)" @play="playEventTrack(performance)" @add="addEventTrack(performance)"></entity-actions><span v-else>—</span></td>
                            </tr></tbody>
                        </table>
                        <content-state v-else state="uncollected" subject="曲目"></content-state>
                    </section>

                    <section class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">{{ eventCancellation ? '原定出演' : '出演阵容' }}</span><span v-if="eventVoiceCast.length">{{ eventVoiceCast.length }} 位</span></div>
                        <div v-if="eventVoiceCast.length" class="performer-cast-groups">
                          <div v-for="(group,groupIndex) in eventVoiceCastGroups" :key="groupIndex" class="performer-chip-list performer-group">
                            <span v-if="!group[0].character_id && group[0].voice_actor_id" class="identity-group-label">非马娘身份出演</span>
                            <component v-for="(cast,index) in group" :is="cast.voice_actor_id ? 'a' : 'span'" :key="cast.voice_actor_id || ('external-' + cast.name + '-' + index)" class="performer-chip voice-chip" :style="cast.character_id ? {'--chip-color':characterColor(cast.character_id)} : {}" :href="cast.voice_actor_id ? routes.voiceActors(cast.voice_actor_id) : undefined" @click="cast.voice_actor_id && internalLink($event, () => openVoice(cast.voice_actor_id))">
                                <img v-if="voicePhoto(cast.voice_actor_id)" v-media-src="voicePhoto(cast.voice_actor_id)" alt=""><span>{{ voiceName(cast.voice_actor_id,cast.name) }}</span><em v-if="cast.participation_label" class="credit-role-tag">{{ cast.participation_label }}</em>
                            </component>
                          </div>
                        </div>
                        <div v-else-if="eventCharacterCast.length" class="performer-chip-list">
                            <a v-for="characterId in eventCharacterCast" :key="characterId" class="performer-chip character-chip" :style="{'--chip-color':characterColor(characterId)}" :href="routes.characters(characterId)" @click="internalLink($event, () => openCharacter(characterId))"><img v-if="characterImage(characterId)" v-media-src="characterImage(characterId)" alt=""><span>{{ characterName(characterId) }}</span></a>
                        </div>
                        <content-state v-else state="uncollected" subject="出演阵容"></content-state>
                    </section>
                    <section v-if="eventUnscopedCast.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">场次未明确</span></div>
                        <div class="performer-chip-list"><component v-for="(cast,index) in eventUnscopedCast" :is="cast.voice_actor_id ? 'a' : 'span'" :key="cast.voice_actor_id || ('external-' + cast.name + '-' + index)" class="performer-chip voice-chip" :href="cast.voice_actor_id ? routes.voiceActors(cast.voice_actor_id) : undefined" @click="cast.voice_actor_id && internalLink($event, () => openVoice(cast.voice_actor_id))"><img v-if="voicePhoto(cast.voice_actor_id)" v-media-src="voicePhoto(cast.voice_actor_id)" alt=""><span>{{ voiceName(cast.voice_actor_id,cast.name) }}</span><em v-if="cast.participation_label" class="credit-role-tag">{{ cast.participation_label }}</em></component></div>
                    </section>

                    <content-state v-if="animeError" state="error" subject="动画关联" :retry="true" @retry="retryAnime"></content-state>
                    <section v-if="eventAnimeRelations.length" class="entity-section anime-crosslink-section">
                        <div class="section-toolbar"><span class="credit-role-tag">动画关联</span></div>
                        <anime-participation :works="eventAnimeWorks"></anime-participation>
                    </section>

                    <section v-if="eventMediaCards.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">节目影像</span></div>
                        <div class="event-video-grid">
                            <div v-for="media in eventMediaCards" :key="media.key" class="event-video" :class="'event-video-'+media.platform">
                                <iframe v-if="media.embedUrl && activeMediaKey===media.key" v-media-src="media.embedUrl+'?autoplay=1'" :title="eventDetail.title+'　'+media.label" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                                <button v-else-if="media.embedUrl" class="event-video-launch" type="button" @click="activateEventMedia(media)">
                                    <img v-media-src="media.image" :alt="media.label" loading="lazy" @error="onEventImageError($event,eventDetail)">
                                    <span class="event-video-platform">{{ media.platformLabel }}</span>
                                    <span class="event-video-label">{{ media.label }}</span>
                                    <span class="event-video-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg></span>
                                </button>
                                <a v-else :href="media.url" target="_blank" rel="noopener noreferrer">
                                    <img v-media-src="media.image" :alt="media.label" loading="lazy" @error="onEventImageError($event,eventDetail)">
                                    <span class="event-video-platform">{{ media.platformLabel }}</span>
                                    <span class="event-video-label">{{ media.label }}</span>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                                </a>
                            </div>
                        </div>
                    </section>
                </article>
            </template>
        `;
