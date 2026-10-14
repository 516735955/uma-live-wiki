export const bindings = ["liveView","isActive","eventsQuery","evTime","evYear","eventYearOptions","eventTypeOptions","eventTypeSelection","setEvTime","setEvYear","eventsPaged","eventsFiltered","eventsPage","eventsPageCount","eventsTotal","eventsPageStart","eventsPageEnd","eventsPageList","setEventsPage","goEventsPage","onEventImageError","eventDetail","selectedEventSession","selectEventSession","eventPlayableRows","playEventTrack","addEventTrack","playEventSession","enqueueEventSession","eventMediaCards","activeMediaKey","activateEventMedia","eventVoiceCast","eventUnscopedCast","openEvent","eventDateLabel","eventSummary","eventKindLabel","eventModeLabel","eventSeriesName","eventSongCount","eventSessionTable","onEventSetlistClick","playableSongRelease","relationSong","openSong","characterName","characterImage","characterColor","voiceName","voicePhoto","openCharacter","openVoice","animeError","eventAnimeRelations","retryAnime","eventAnimeWorks"];
export const template = `
            <div v-if="eventsError" class="ui-state ui-state-error">{{ eventsError }}</div>

            <template v-if="liveView==='eventHub'">
                <div class="archive-toolbar">
                    <label class="ui-search">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                        <input type="search" v-model.trim="eventsQuery" aria-label="搜索活动、系列、出演者、角色或歌曲" placeholder="搜索活动、系列、出演者、角色或歌曲" autocomplete="off">
                        <button v-if="eventsQuery" type="button" @click.prevent="eventsQuery=''" aria-label="清空搜索">×</button>
                    </label>
                    <div class="archive-controls">
                        <ui-select v-model="evTime" label="状态" :options="[{value:'all',label:'全部'},{value:'upcoming',label:'未结束'},{value:'past',label:'已结束'},{value:'announced',label:'日期未知'}]" @change="setEvTime"></ui-select>
                        <ui-select v-model="eventTypeSelection" label="类型" :options="eventTypeOptions"></ui-select>
                        <ui-select v-model="evYear" label="年份" :options="eventYearOptions" @change="setEvYear"></ui-select>
                    </div>
                </div>

                <div id="eventsRowsTop" class="event-catalog">
                    <template v-if="eventsLoading && !eventsAll.length">
                        <div v-for="i in 6" :key="'event-load-'+i" class="archive-row-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
                    </template>
                    <button v-for="(event,i) in eventsPaged" :key="event.id" class="event-catalog-row" type="button" @click="openEvent(event)">
                        <span class="event-catalog-cover">
                            <img :src="event.image" :alt="event.title" :loading="i===0?'eager':'lazy'" :fetchpriority="i===0?'high':'auto'" decoding="async" @error="onEventImageError($event,event)">
                        </span>
                        <time v-if="event.end_date && event.end_date !== event.date" class="event-date-range"><span>{{ event.date }}</span><span aria-hidden="true">—</span><span>{{ event.end_date }}</span></time>
                        <time v-else>{{ event.date || '待公布' }}</time>
                        <span class="event-catalog-main">
                            <b>{{ event.title }}</b>
                            <span>{{ eventSeriesName(event) || eventKindLabel(event.kind) }}<template v-if="event.venue"> · {{ event.venue }}</template></span>
                        </span>
                        <span class="event-catalog-facts">
                            <i>{{ eventKindLabel(event.kind) }}</i>
                            <b>{{ event.cast_count || 0 }} 位出演</b>
                            <b v-if="eventSongCount(event)">{{ eventSongCount(event) }} 首曲目</b>
                        </span>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                    <div v-if="!eventsLoading && !eventsFiltered.length" class="ui-state">没有符合条件的活动</div>
                </div>
                <div v-if="eventsFiltered.length" class="ui-pager">
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
                        <div class="entity-cover event-cover">
                            <img :src="eventDetail.image" :alt="eventDetail.title" fetchpriority="high" @error="onEventImageError($event,eventDetail)">
                        </div>
                        <div class="entity-intro">
                            <span class="entity-kind">{{ eventKindLabel(eventDetail.kind) }}</span>
                            <h1>{{ eventDetail.title }}</h1>
                            <dl class="entity-meta">
                                <div><dt>日期</dt><dd>{{ eventDateLabel(eventDetail) }}</dd></div>
                                <div v-if="eventDetail.venue"><dt>地点</dt><dd>{{ eventDetail.venue }}</dd></div>
                            </dl>
                        </div>
                    </div>

                    <section class="entity-overview">
                        <dl><div><dt>形式</dt><dd>{{ eventModeLabel(eventDetail.mode) }}</dd></div><div v-if="eventSeriesName(eventDetail)"><dt>系列</dt><dd>{{ eventSeriesName(eventDetail) }}</dd></div></dl>
                        <p v-if="eventSummary(eventDetail)">{{ eventSummary(eventDetail) }}</p>
                    </section>

                    <nav v-if="eventDetail.sessions && eventDetail.sessions.length>1" class="entity-tabs" aria-label="活动场次">
                        <button v-for="session in eventDetail.sessions" :key="session.id" :class="{active:selectedEventSession && selectedEventSession.id===session.id}" @click="selectEventSession(session.id)">
                            {{ session.label }}
                        </button>
                    </nav>

                    <section v-if="selectedEventSession" class="entity-section">
                        <div class="section-toolbar">
                            <div class="entity-section-actions"><span>{{ selectedEventSession.date || eventDetail.date }}<template v-if="selectedEventSession.songs.length"> · {{ selectedEventSession.songs.length }} 首</template></span><entity-actions v-if="eventPlayableRows.length" size="compact" play-label="播放本场" add-label="加入本场" @play="playEventSession" @add="enqueueEventSession"></entity-actions></div>
                        </div>
                        <div v-if="eventSessionTable(selectedEventSession)" class="setlist-frame" @click="onEventSetlistClick($event)" v-html="eventSessionTable(selectedEventSession)"></div>
                        <table v-else-if="selectedEventSession.performances && selectedEventSession.performances.length" class="data-table setlist-table">
                            <thead><tr><th>#</th><th>曲名</th><th>出演者</th><th>出处</th><th>试听</th></tr></thead>
                            <tbody><tr v-for="(performance,index) in selectedEventSession.performances" :key="performance.version_id || performance.song">
                                <td class="setlist-no">{{ index + 1 }}</td>
                                <td class="setlist-song"><button class="text-link setlist-song-link" type="button" @click="openSong(performance.song_id)">{{ performance.song }}</button></td>
                                <td class="setlist-perf"><button v-for="characterId in performance.character_ids" :key="characterId" class="performer-chip character-chip" type="button" :style="{'--chip-color':characterColor(characterId)}" @click="openCharacter(characterId)">
                                    <img v-if="characterImage(characterId)" :src="characterImage(characterId)" alt=""><span>{{ characterName(characterId) }}</span>
                                </button><span v-for="guest in (performance.guest_performers || [])" :key="guest" class="guest-performer">{{ guest }}</span></td>
                                <td class="setlist-src">{{ performance.source || '现场演唱' }}</td>
                                <td class="setlist-actions"><entity-actions v-if="playableSongRelease(relationSong(performance))" size="compact" :playing="isActive(playableSongRelease(relationSong(performance)).release.audio_url)" @play="playEventTrack(performance)" @add="addEventTrack(performance)"></entity-actions><span v-else>—</span></td>
                            </tr></tbody>
                        </table>
                        <div v-else class="ui-state compact">无演出曲目</div>
                    </section>

                    <section class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">出演阵容</span><span>{{ eventVoiceCast.length }} 位</span></div>
                        <div v-if="eventVoiceCast.length" class="performer-chip-list">
                            <button v-for="cast in eventVoiceCast" :key="cast.voice_actor_id" class="performer-chip voice-chip" type="button" :style="{'--chip-color':characterColor(cast.character_id)}" @click="openVoice(cast.voice_actor_id)">
                                <img v-if="voicePhoto(cast.voice_actor_id)" :src="voicePhoto(cast.voice_actor_id)" alt=""><span>{{ voiceName(cast.voice_actor_id,cast.name) }}</span><em v-if="cast.participation_label" class="credit-role-tag">{{ cast.participation_label }}</em>
                            </button>
                        </div>
                        <div v-else class="ui-state compact">暂无出演阵容</div>
                    </section>
                    <section v-if="eventUnscopedCast.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">场次未明确</span></div>
                        <div class="performer-chip-list"><button v-for="cast in eventUnscopedCast" :key="cast.voice_actor_id" class="performer-chip voice-chip" type="button" @click="openVoice(cast.voice_actor_id)"><img v-if="voicePhoto(cast.voice_actor_id)" :src="voicePhoto(cast.voice_actor_id)" alt=""><span>{{ voiceName(cast.voice_actor_id,cast.name) }}</span></button></div>
                    </section>

                    <div v-if="animeError" class="ui-state ui-state-error" role="alert"><span>动画关联暂时无法载入。</span><button class="ui-retry" @click="retryAnime">重试</button></div>
                    <section v-if="eventAnimeRelations.length" class="entity-section anime-crosslink-section">
                        <div class="section-toolbar"><span class="credit-role-tag">动画关联</span></div>
                        <anime-participation :works="eventAnimeWorks"></anime-participation>
                    </section>

                    <section v-if="eventMediaCards.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">节目影像</span></div>
                        <div class="event-video-grid">
                            <div v-for="media in eventMediaCards" :key="media.key" class="event-video" :class="'event-video-'+media.platform">
                                <iframe v-if="media.embedUrl && activeMediaKey===media.key" :src="media.embedUrl+'?autoplay=1'" :title="eventDetail.title+' · '+media.label" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                                <button v-else-if="media.embedUrl" class="event-video-launch" type="button" @click="activateEventMedia(media)">
                                    <img :src="media.image" :alt="media.label" loading="lazy" @error="onEventImageError($event,eventDetail)">
                                    <span class="event-video-platform">{{ media.platformLabel }}</span>
                                    <span class="event-video-label">{{ media.label }}</span>
                                    <span class="event-video-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg></span>
                                </button>
                                <a v-else :href="media.url" target="_blank" rel="noopener noreferrer">
                                    <img :src="media.image" :alt="media.label" loading="lazy" @error="onEventImageError($event,eventDetail)">
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
