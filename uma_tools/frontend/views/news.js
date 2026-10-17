export const bindings = ["newsItems","newsError","newsLoading","newsRange","newsType","newsFiltered","newsHero","newsDetail","newsDetailBody","newsDetailLoading","newsLanguage","setNewsLanguage","newsImage","newsDate","newsTypeOf","newsTypeLabel","newsTitle","openNews","newsHeroCover","newsPage","newsPaged","newsPageCount","newsPageStart","newsPageEnd","newsPageList","setNewsPage","goNewsPage"];
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
                <div v-if="newsError" class="ui-state ui-state-error" role="alert">{{ newsError }} <button type="button" @click="openNews(newsDetail.announce_id)">重试</button></div>
                <div v-else-if="newsDetailLoading || newsDetail.archive_state==='pending'" class="ui-state ui-state-loading" role="status">正在读取归档正文…</div>
                <p v-else-if="newsLanguage==='zh' && !newsDetail.message_zh" class="news-translation-status">中文译文正在整理中，可切换日文查看原文。</p>
                <div class="news-detail-body" :lang="newsLanguage==='ja'?'ja':'zh-Hans'" v-html="newsDetailBody"></div>
            </div>

            <div v-else class="news-list">
                <div v-if="newsError" class="news-error">{{ newsError }}</div>

                <div v-if="newsItems.length || newsLoading" class="news-hero-grid">
                    <template v-if="newsItems.length">
                        <div v-for="(n,i) in newsHero" :key="n.announce_id" class="news-hero-card" @click="openNews(n.announce_id)">
                            <img class="news-hero-cover" v-media-src="newsHeroCover(n)" :alt="n.title" :loading="i === 0 ? 'eager' : 'lazy'" :fetchpriority="i === 0 ? 'high' : 'auto'" decoding="async">
                            <div class="news-hero-body">
                                <div class="news-hero-meta">
                                    <span class="news-hero-tag" :class="newsTypeOf(n)">{{ newsTypeLabel(n) }}</span>
                                    <span class="news-hero-date">{{ newsDate(n.post_at) }}</span>
                                </div>
                                <div class="news-hero-title">{{ newsTitle(n) }}</div>
                            </div>
                        </div>
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

                <div class="archive-toolbar">
                    <div class="archive-controls">
                        <ui-select v-model="newsRange" label="时间" :options="[{value:'all',label:'全部'},{value:'7',label:'7天内'},{value:'30',label:'30天内'},{value:'90',label:'90天内'}]"></ui-select>
                        <ui-select v-model="newsType" label="类型" :options="[{value:'all',label:'全部'},{value:'media',label:'MEDIA'},{value:'game',label:'GAME'},{value:'cd',label:'CD相关'}]"></ui-select>
                    </div>
                </div>

                <div id="news-list-top" class="news-rows">
                    <div class="news-row news-row-head">
                        <span class="nw-d">时间</span>
                        <span class="nw-t">类型</span>
                        <span class="nw-title">标题</span>
                    </div>
                    <div v-for="n in newsPaged" :key="n.announce_id" class="news-row" @click="openNews(n.announce_id)">
                        <span class="nw-d">{{ newsDate(n.post_at) }}</span>
                        <span class="nw-t" :class="newsTypeOf(n)">{{ newsTypeLabel(n) }}</span>
                        <span class="nw-title">{{ newsTitle(n) }}</span>
                    </div>
                    <div v-if="!newsFiltered.length && newsItems.length" class="news-empty">当前筛选下暂无新闻</div>
                    <div v-if="newsLoading" class="news-empty">新闻加载中...</div>
                </div>

                <div v-if="newsFiltered.length && !newsLoading" class="news-pager">
                    <div class="news-pager-count">显示 {{ newsPageStart }}-{{ newsPageEnd }} 共 {{ newsFiltered.length }} 条</div>
                    <div class="news-pager-btns">
                        <button type="button" class="news-pager-btn" :disabled="newsPage<=1" @click="goNewsPage(-1)">«</button>
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
