export const bindings = ["venuesList","venuesError","venuesTotal","venuesPerPage","venueDetail","venueEvents","venueEventRows","venueEventsExpanded","toggleVenueEvents","venueQuery","venuePage","venuePageCount","venuePageStart","venuePageEnd","venuePageList","setVenuePage","goVenuePage","openVenue","retryVenues","venueLabel","venueAliasRows","venueMapUrl","venueQueryLabel","venueSourceLabel","eventKindLabel","eventDateLabel","eventModeLabel","eventSeriesName","routes","internalLink"];
export const template = `
            <section v-if="!venueDetail" class="venue-db-section entity-section">
                <div class="archive-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="venueQuery" aria-label="搜索会场名称、地区…" placeholder="搜索会场名称、地区…" autocomplete="off"></label>
                </div>
                <content-state v-if="venuesError" state="error" subject="会场资料" :retry="true" @retry="retryVenues"></content-state>
                <content-state v-else-if="!venuesList.length" state="loading" subject="会场资料"></content-state>
                <div v-else class="horse-table-wrap">
                    <table class="horse-table venue-table">
                        <thead><tr><th>名称</th><th>国家·地区</th><th>城市</th><th>记录</th></tr></thead>
                        <tbody>
                            <tr v-for="venue in venuesList" :key="venue.id"><td><a :href="routes.venues(venue.id)" @click="internalLink($event, () => openVenue(venue.id))">{{ venueLabel(venue) || venue.id }}</a></td><td>{{ venue.country || '—' }}</td><td>{{ venue.city || '—' }}</td><td class="num">{{ venue.event_count }} 场活动<span v-if="venue.session_count && venue.session_count !== venue.event_count"> · {{ venue.session_count }} 公演</span></td></tr>
                        </tbody>
                    </table>
                </div>
                <div v-if="venuesList.length" class="ui-pager">
                    <span>{{ venuePageStart }}–{{ venuePageEnd }} / {{ venuesTotal }}</span>
                    <div>
                        <button :disabled="venuePage<=1" @click="goVenuePage(-1)">上一页</button>
                        <button v-for="(page,index) in venuePageList" :key="index" :class="{active:page===venuePage}" :disabled="page==='…'" @click="setVenuePage(page)">{{ page }}</button>
                        <button :disabled="venuePage>=venuePageCount" @click="goVenuePage(1)">下一页</button>
                    </div>
                </div>
            </section>
            <article v-else class="entity-detail venue-entity-detail">
                <a class="horse-back" :href="routes.venues()" @click="internalLink($event, () => {})">← 返回会场列表</a>
                <div class="entity-hero entity-hero-text">
                    <div class="entity-intro">
                        <span class="entity-kind">会场</span>
                        <h1>{{ venueLabel(venueDetail) || venueDetail.id }}</h1>
                        <p class="entity-reading">{{ venueDetail.name_ja }}<template v-if="venueDetail.name_raw && venueDetail.name_raw !== venueDetail.name_ja && venueDetail.name_raw !== (venueDetail.name_zh || venueDetail.name)">　{{ venueDetail.name_raw }}</template></p>
                        <p class="horse-badge-line">
                            <span v-if="venueDetail.country" class="horse-badge">国家·地区 {{ venueDetail.country }}</span>
                            <span v-if="venueDetail.city" class="horse-badge">城市 {{ venueDetail.city }}</span>
                            <span class="horse-badge">举办活动 {{ venueDetail.event_count }}</span>
                            <span v-if="venueDetail.session_count" class="horse-badge">公演 {{ venueDetail.session_count }}</span>
                        </p>
                        <p v-if="venueMapUrl(venueDetail)" class="horse-badge-line"><a class="horse-badge venue-map-link" :href="venueMapUrl(venueDetail)" target="_blank" rel="noopener">🗺 在 Google 地图打开 ↗</a></p>
                    </div>
                </div>
                <dl class="entity-meta detail-meta horse-meta">
                    <div v-if="venueDetail.name && venueDetail.name !== (venueDetail.name_zh || venueDetail.name_ja)"><dt>登记名称</dt><dd>{{ venueDetail.name }}</dd></div>
                    <div v-if="venueDetail.name_raw && venueDetail.name_raw !== venueDetail.name"><dt>原始名称</dt><dd>{{ venueDetail.name_raw }}</dd></div>
                    <div v-if="venueAliasRows(venueDetail).length"><dt>别名</dt><dd>{{ venueAliasRows(venueDetail).join('、') }}</dd></div>
                    <div v-if="venueDetail.last_date"><dt>最后有活动</dt><dd>{{ venueDetail.last_date }}</dd></div>
                    <div v-if="(venueDetail.sources || []).length"><dt>数据来源</dt><dd>{{ venueDetail.sources.map(venueSourceLabel).join('、') }}</dd></div>
                </dl>
                <section class="entity-section">
                    <div class="section-toolbar"><span class="credit-role-tag">在此举办的活动</span></div>
                    <content-state v-if="!venueEventRows(venueEvents).length" state="uncollected" subject="活动记录"></content-state>
                    <div v-else class="horse-table-wrap">
                        <table class="horse-table">
                            <thead><tr><th>日期</th><th>活动</th><th>类型</th><th>场次</th></tr></thead>
                            <tbody>
                                <tr v-for="row in venueEventRows(venueEvents)" :key="row.id" :class="{cancelled:row.schedule_status==='cancelled'}"><td>{{ eventDateLabel(row) }}</td><td><a :href="routes.events(row.id)">{{ row.title_zh || row.title }}</a></td><td>{{ eventKindLabel(row.kind) }}</td><td class="num">{{ row.session_count }}<template v-if="row.schedule_status==='cancelled'">（已取消）</template><template v-else-if="row.schedule_status==='partially_cancelled'">（部分取消）</template></td></tr>
                            </tbody>
                        </table>
                    </div>
                    <button v-if="venueEvents.length > 10" type="button" class="horse-expand-btn" @click="toggleVenueEvents">{{ venueEventsExpanded ? '收起' : '查看全部 ' + venueEvents.length + ' 场' }}</button>
                </section>
            </article>
        `;
