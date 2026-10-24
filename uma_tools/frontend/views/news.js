export const bindings = ["newsItems","newsError","newsLoading","newsRange","newsType","newsQuery","newsFiltered","newsHero","newsDetail","newsDetailBody","newsDetailLoading","newsLanguage","setNewsLanguage","newsImage","newsDate","newsTypeOf","newsTypeLabel","newsTitle","openNews","newsHeroCover","newsPage","newsPaged","newsPageCount","newsPageStart","newsPageEnd","newsPageList","setNewsPage","goNewsPage","loadNews","newsLink","routes"];
export const template = `
            <div v-if="newsDetail" class="news-detail">
                <div v-if="newsDetail.image_big" class="news-detail-cover-wrap">
                    <img class="news-detail-cover" v-media-src="newsImage(newsDetail.image_big)" :data-original="newsDetail.image_big" :alt="newsDetail.title_zh || newsDetail.title">
                </div>
                <div class="news-detail-meta">
                    <div class="news-detail-date">{{ newsDetail.post_at }}<a v-if="newsDetail.source === 'lantis'" :href="newsDetail.url || 'https://umamusume.lantis.jp/'" target="_blank" rel="noopener noreferrer">原文 ↗</a><a v-else :href="'https://umamusume.jp/news/detail?id=' + newsDetail.announce_id" target="_blank" rel="noopener noreferrer">原文 ↗</a></div>
                    <button type="button" class="news-language" role="switch" aria-label="新闻语言：日文" :aria-checked="newsLanguage==='ja'" @click="setNewsLanguage(newsLanguage==='zh'?'ja':'zh')">
                        <span class="news-language-thumb" :class="{'is-ja':newsLanguage==='ja'}" aria-hidden="true"></span>
                        <span :class="{active:newsLanguage==='zh'}" aria-hidden="true">中文</span>
                        <span :class="{active:newsLanguage==='ja'}" aria-hidden="true">日文</span>
                    </button>
                </div>
                <h2 class="news-detail-title">{{ newsLanguage === 'ja' ? newsDetail.title : (newsDetail.title_zh || newsDetail.title) }}</h2>
                <content-state v-if="newsError" state="error" subject="新闻正文" :retry="true" @retry="openNews(newsDetail.announce_id)"></content-state>
                <content-state v-else-if="newsDetail.waiting_stopped" state="error" subject="新闻正文" reason="新闻正文读取超时" :retry="true" @retry="openNews(newsDetail.announce_id)"></content-state>
                <content-state v-else-if="newsDetailLoading || newsDetail.archive_state==='pending'" state="loading" subject="新闻正文"></content-state>
                <content-state v-else-if="newsLanguage==='zh' && !newsDetail.message_zh && newsDetail.translation_state==='pending'" state="loading" subject="中文译文"></content-state>
                <content-state v-else-if="newsLanguage==='zh' && !newsDetail.message_zh" state="uncollected" subject="中文译文"></content-state>
                <div class="news-detail-body" :lang="newsLanguage==='ja'?'ja':'zh-Hans'" v-html="newsDetailBody"></div>
            </div>

            <div v-else class="news-list">
                <content-state v-if="newsError" state="error" subject="新闻" :retry="true" @retry="loadNews(true)"></content-state>

                <div v-if="!newsError && (newsItems.length || newsLoading)" class="news-hero-grid">
                    <template v-if="newsItems.length">
                        <a v-for="(n,i) in newsHero" :key="n.announce_id" class="news-hero-card" :href="routes.news(n.announce_id)" @click="newsLink($event,n.announce_id)" style="color:inherit;text-decoration:none">
                            <img class="news-hero-cover" v-media-src="newsHeroCover(n)" :alt="n.title" :loading="i === 0 ? 'eager' : 'lazy'" :fetchpriority="i === 0 ? 'high' : 'auto'" decoding="async">
                            <div class="news-hero-body">
                                <div class="news-hero-meta">
                                    <span class="news-hero-tag" :class="newsTypeOf(n)">{{ newsTypeLabel(n) }}</span>
                                    <span class="news-hero-date">{{ newsDate(n.post_at) }}</span>
                                </div>
                                <div class="news-hero-title">{{ newsTitle(n) }}</div>
                            </div>
                        </a>
                    </template>
                    <template v-else>
                        <div v-for="i in 3" :key="'news-skeleton-' + i" class="news-hero-card news-hero-skeleton" aria-hidden="true">
                            <div class="news-hero-cover"></div>
                            <div class="news-hero-body">
                                <span class="news-skeleton-line short"></span>
                                <span class="news-skeleton-line"></span>
                            </div>
                        </div>
                    </template>
                </div>

                <div v-if="!newsError" class="archive-toolbar">
                    <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="newsQuery" aria-label="搜索新闻标题" placeholder="搜索新闻标题" autocomplete="off"><button v-if="newsQuery" type="button" @click.prevent="newsQuery=''" aria-label="清空搜索">×</button></label>
                    <div class="archive-controls">
                        <ui-select v-model="newsRange" label="时间" :options="[{value:'all',label:'全部'},{value:'7',label:'7天内'},{value:'30',label:'30天内'},{value:'90',label:'90天内'}]"></ui-select>
                        <ui-select v-model="newsType" label="类型" :options="[{value:'all',label:'全部'},{value:'media',label:'MEDIA'},{value:'game',label:'GAME'},{value:'cd',label:'CD相关'}]"></ui-select>
                    </div>
                </div>

                <div v-if="!newsError && newsFiltered.length && !newsLoading" id="news-list-top" class="news-rows">
                    <div class="news-row news-row-head">
                        <span class="nw-d">时间</span>
                        <span class="nw-t">类型</span>
                        <span class="nw-title">标题</span>
                    </div>
                    <a v-for="n in newsPaged" :key="n.announce_id" class="news-row" :href="routes.news(n.announce_id)" @click="newsLink($event,n.announce_id)" style="color:inherit;text-decoration:none">
                        <span class="nw-d">{{ newsDate(n.post_at) }}</span>
                        <span class="nw-t" :class="newsTypeOf(n)">{{ newsTypeLabel(n) }}</span>
                        <span class="nw-title">{{ newsTitle(n) }}</span>
                    </a>
                </div>
                <content-state v-if="!newsError && newsLoading" state="loading" subject="新闻"></content-state>
                <content-state v-else-if="!newsError && newsItems.length && !newsFiltered.length" state="filtered" subject="新闻" :clear="true" @clear="newsRange='all';newsType='all'"></content-state>
                <content-state v-else-if="!newsError && !newsLoading && !newsItems.length" state="uncollected" subject="新闻"></content-state>

                <div v-if="!newsError && newsFiltered.length && !newsLoading" class="news-pager">
                    <div class="news-pager-count">显示 {{ newsPageStart }}-{{ newsPageEnd }} 共 {{ newsFiltered.length }} 条</div>
                    <div class="news-pager-btns">
                        <button type="button" class="news-pager-btn" :disabled="newsPage<=1" @click="setNewsPage(1)">«</button>
                        <button type="button" class="news-pager-btn" :disabled="newsPage<=1" @click="goNewsPage(-1)">‹</button>
                        <template v-for="(p,i) in newsPageList" :key="'p'+i">
                            <button v-if="p==='…'" type="button" class="news-pager-ellipsis" disabled>…</button>
                            <button v-else type="button" class="news-pager-btn" :class="{active: p===newsPage}" @click="setNewsPage(p)">{{ p }}</button>
                        </template>
                        <button type="button" class="news-pager-btn" :disabled="newsPage>=newsPageCount" @click="goNewsPage(1)">›</button>
                        <button type="button" class="news-pager-btn" :disabled="newsPage>=newsPageCount" @click="setNewsPage(newsPageCount)">»</button>
                    </div>
                </div>
            </div>
        `;
