const externalIcon = '<svg class="anime-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
export const bindings = [
    "venuesList", "venuesLoading", "venuesError", "venueDetail", "venueEvents",
    "venueEventRows", "venueActivityLabel", "venueEventsExpanded", "toggleVenueEvents",
    "venueQuery", "venuePage", "venuePageCount", "venuePageList", "setVenuePage",
    "goVenuePage", "openVenue", "retryVenues", "venueLabel", "venueLocation",
    "venueOriginalName", "venueEnglishName", "venueAliasRows", "venueCapacityLabel",
    "venueNameHistory", "venueHeroLinks",
    "eventKindLabel", "eventDateLabel", "openEvent",
    "routes", "internalLink", "onCatalogImageError",
];
export const template = `
    <template v-if="!venueDetail">
        <div class="archive-toolbar">
            <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="venueQuery" aria-label="搜索会场名称或地区" placeholder="搜索会场名称或地区" autocomplete="off"><button v-if="venueQuery" type="button" aria-label="清空搜索" @click.prevent="venueQuery=''">×</button></label>
        </div>
        <content-state v-if="venuesError" state="error" subject="会场资料" :retry="true" @retry="retryVenues"></content-state>
        <content-state v-else-if="venuesLoading" state="loading" subject="会场资料"></content-state>
        <content-state v-else-if="!venuesList.length" :state="venueQuery ? 'filtered' : 'uncollected'" subject="会场" :clear="!!venueQuery" @clear="venueQuery=''"></content-state>
        <template v-else>
            <div class="albums-grid album-database-grid venue-grid">
                <a v-for="(venue,index) in venuesList" :key="venue.id" class="album-card" :href="routes.venues(venue.id)" @click="internalLink($event, () => openVenue(venue.id))">
                    <img v-if="venue.cover" class="album-cover" v-media-src="venue.cover" :alt="venueLabel(venue)" :loading="index < 2 ? 'eager' : 'lazy'" :fetchpriority="index === 0 ? 'high' : 'auto'" decoding="async" @error="onCatalogImageError($event)">
                    <span v-else class="album-cover venue-photo-empty">暂无照片</span>
                    <div class="album-info">
                        <div class="album-name">{{ venueLabel(venue) || venue.id }}</div>
                        <div class="album-count">{{ venueLocation(venue) || '暂无资料' }}<span class="venue-card-count">{{ venue.event_count }} 项活动</span></div>
                    </div>
                    <div class="card-veil" aria-hidden="true"><p>View more</p><span class="card-veil-arrow">&gt;</span></div>
                </a>
            </div>
            <div v-if="venuePageCount > 1" class="ui-pager">
                <div>
                    <button :disabled="venuePage<=1" @click="goVenuePage(-1)">上一页</button>
                    <button v-for="(page,index) in venuePageList" :key="index" :class="{active:page===venuePage}" :disabled="page==='…'" @click="setVenuePage(page)">{{ page }}</button>
                    <button :disabled="venuePage>=venuePageCount" @click="goVenuePage(1)">下一页</button>
                </div>
            </div>
        </template>
    </template>

    <article v-else class="entity-detail venue-entity-detail">
        <div class="entity-hero music-archive-hero venue-hero">
            <div class="entity-cover album-cover-detail">
                <img v-if="venueDetail.cover" v-media-src="venueDetail.cover" :data-original="venueDetail.cover" :style="{objectPosition:venueDetail.localization?.photo?.focus || 'center'}" :alt="venueLabel(venueDetail)" fetchpriority="high" @error="onCatalogImageError($event)">
                <span v-else class="venue-photo-empty">暂无照片</span>
            </div>
            <div class="entity-intro">
                <span class="entity-kind">会场</span>
                <h1>{{ venueLabel(venueDetail) }}</h1>
                <p v-if="venueOriginalName(venueDetail) && venueOriginalName(venueDetail) !== venueLabel(venueDetail)" class="entity-reading">{{ venueOriginalName(venueDetail) }}</p>
                <dl class="entity-meta venue-hero-facts">
                    <div v-if="venueLocation(venueDetail)"><dt>所在地</dt><dd>{{ venueLocation(venueDetail) }}</dd></div>
                    <div v-if="venueDetail.localization?.venue_type"><dt>类型</dt><dd>{{ venueDetail.localization.venue_type }}</dd></div>
                </dl>
                <div v-if="venueHeroLinks(venueDetail).length" class="hero-chip-row venue-hero-links">
                    <a v-for="link in venueHeroLinks(venueDetail)" :key="link.label" class="horse-link-chip" :href="link.url" :title="link.title" target="_blank" rel="noopener"><img v-if="link.icon" class="venue-link-logo" :src="link.icon" alt="" aria-hidden="true">{{ link.label }}${externalIcon}</a>
                </div>
            </div>
        </div>
        <section v-if="venueDetail.localization?.description_zh || venueDetail.localization?.notes_zh || venueCapacityLabel(venueDetail) || venueEnglishName(venueDetail) || venueAliasRows(venueDetail).length || venueNameHistory(venueDetail).length || venueDetail.profile?.screen_count" class="entity-section venue-section">
            <div class="section-toolbar"><span class="credit-role-tag">会场资料</span></div>
            <div v-if="venueDetail.localization?.description_zh || venueDetail.localization?.notes_zh" class="venue-introduction">
                <p v-if="venueDetail.localization?.description_zh">{{ venueDetail.localization.description_zh }}</p>
                <p v-if="venueDetail.localization?.notes_zh && venueDetail.localization.notes_zh !== venueDetail.localization.description_zh">{{ venueDetail.localization.notes_zh }}</p>
            </div>
            <dl class="profile-facts venue-information-facts">
                <div v-if="venueEnglishName(venueDetail)"><dt>英文名</dt><dd>{{ venueEnglishName(venueDetail) }}</dd></div>
                <div v-if="venueAliasRows(venueDetail).length" class="venue-fact-wide"><dt>别名</dt><dd><ul class="venue-alias-list"><li v-for="alias in venueAliasRows(venueDetail)" :key="alias">{{ alias }}</li></ul></dd></div>
                <div v-if="venueNameHistory(venueDetail).length" class="venue-fact-wide"><dt>名称沿革</dt><dd><ol class="venue-name-history"><li v-for="(entry,index) in venueNameHistory(venueDetail)" :key="index"><span v-if="entry.period" class="venue-name-period">{{ entry.period }}</span><span class="venue-history-name">{{ entry.name }}</span></li></ol></dd></div>
                <div v-if="venueCapacityLabel(venueDetail)"><dt>容量</dt><dd><span v-for="line in (venueDetail.localization?.capacity_zh?.length ? venueDetail.localization.capacity_zh : [venueCapacityLabel(venueDetail)])" :key="line" class="venue-fact-line">{{ line }}</span></dd></div>
                <div v-if="venueDetail.profile?.screen_count"><dt>影厅数</dt><dd>{{ venueDetail.profile.screen_count }} 个</dd></div>
            </dl>
        </section>
        <section id="venue-map-panel" class="entity-section venue-section">
            <div class="section-toolbar"><span class="credit-role-tag">位置与交通</span></div>
            <div class="venue-travel-layout" :class="{'has-map':venueDetail.localization?.location}">
                <div class="venue-travel-copy">
                    <dl class="profile-facts">
                        <div v-if="venueDetail.profile?.address"><dt>地址</dt><dd>{{ venueDetail.profile.address }}</dd></div>
                        <div v-if="venueDetail.localization?.access_zh"><dt>交通</dt><dd class="venue-copy">{{ venueDetail.localization.access_zh }}</dd></div>
                        <div v-if="venueDetail.localization?.parking_zh"><dt>停车</dt><dd>{{ venueDetail.localization.parking_zh }}</dd></div>
                        <div v-if="venueDetail.profile?.phone"><dt>电话</dt><dd>{{ venueDetail.profile.phone }}</dd></div>
                    </dl>
                </div>
                <div v-if="venueDetail.localization?.location" class="venue-travel-map">
                    <venue-map :key="venueDetail.id" :location="venueDetail.localization.location" :title="venueLabel(venueDetail)" :country="venueDetail.country"></venue-map>
                    <p v-if="venueDetail.localization.location.scope === 'complex'" class="venue-map-caption">地图标记为所在园区。</p>
                </div>
            </div>
        </section>
        <section v-if="venueEvents.length" class="entity-section venue-section">
            <div class="section-toolbar"><span class="credit-role-tag">活动记录</span><span>{{ venueDetail.event_count }} 项活动</span></div>
            <activity-history :events="venueEventRows(venueEvents)" :routes="routes" :date-label="eventDateLabel" :kind-label="eventKindLabel" :session-label="venueActivityLabel" @open="openEvent($event.event_id,$event.session_id)"></activity-history>
            <button v-if="venueEvents.length > 10" type="button" class="horse-expand-btn" :aria-expanded="venueEventsExpanded" @click="toggleVenueEvents">{{ venueEventsExpanded ? '收起' : '查看全部活动' }}</button>
        </section>
    </article>
`;
