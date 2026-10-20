export const bindings = ["characterImage","characterColor","openCharDetail","otherSection","setOtherSection","curatedVideos","horseFacts","horseMajorRows","horseMajorExpanded","horseMajorTotal","toggleHorseMajor","horsesListError","horseDetail","horseQuery","horseSex","horseSexOptions","horseSort","horseSortOptions","horsePage","horseFiltered","horsePaged","horsePageCount","horsePageStart","horsePageEnd","horsePageList","setHorsePage","goHorsePage","openHorse","horseSexLabel","horseChars","onHorseImageError","retryHorses","routes","horsesTotal","internalLink"];
export const template = `
            <nav v-if="!['horses','jockeys'].includes(otherSection)" class="entity-tabs" aria-label="其他栏目"><button :class="{active:otherSection==='relationships'}" @click="setOtherSection('relationships')">角色设定相关</button><button v-if="curatedVideos.length" :class="{active:otherSection==='videos'}" @click="setOtherSection('videos')">精选推荐视频</button></nav>
            <section v-if="otherSection==='relationships'" class="entity-section other-section">
                <div class="section-toolbar"><span class="credit-role-tag">赛马娘设定集</span></div>
                <div class="setting-book-list">
                    <a style="--thumb:url('/video_thumbs/BV1MsdABFEc7.jpg')" href="https://www.bilibili.com/read/cv48718536" target="_blank" rel="noopener"><b>第1册</b><span>阅读 ↗</span></a>
                    <a style="--thumb:url('/video_thumbs/BV1iPV96jEbf.jpg')" href="https://www.bilibili.com/read/cv49894422" target="_blank" rel="noopener"><b>第2册</b><span>阅读 ↗</span></a>
                    <a style="--thumb:url('/video_thumbs/BV1UrNA6zEqq.jpg')" href="https://www.bilibili.com/read/cv51385181" target="_blank" rel="noopener"><b>第3册</b><span>阅读 ↗</span></a>
                    <a style="--thumb:url('/video_thumbs/BV18FbM6jEA5.jpg')" href="https://www.bilibili.com/read/cv52884578" target="_blank" rel="noopener"><b>第4册</b><span>阅读 ↗</span></a>
                </div>
                <div class="section-toolbar"><span class="credit-role-tag">宿舍室友关系</span></div>
                <img v-media-src="'/uma_tools/img/character-roommates.jpg'" alt="宿舍室友关系图" class="roommate-image" loading="lazy">
            </section>
            <section v-else-if="otherSection==='videos'" class="entity-section other-section">
                <content-state v-if="!curatedVideos.length" state="uncollected" subject="推荐视频"></content-state>
                <div v-else class="video-library">
                    <a v-for="video in curatedVideos" :key="video.id" :href="'https://www.bilibili.com/video/'+video.id+'/'" target="_blank" rel="noopener"><img v-media-src="'/video_thumbs/'+video.id+'.jpg'" :alt="video.title" loading="lazy"><b>{{ video.title }}</b><span>观看 ↗</span></a>
                </div>
            </section>
            <section v-else-if="otherSection==='horses'" class="horse-db-section">
                <template v-if="!horseDetail">
                    <div class="archive-toolbar">
                        <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="horseQuery" aria-label="搜索马名或出生日期…" placeholder="搜索马名或出生日期…" autocomplete="off"></label>
                        <div class="archive-controls">
                            <ui-select v-model="horseSex" label="性别" :options="horseSexOptions"></ui-select>
                            <ui-select v-model="horseSort" label="排序" :options="horseSortOptions"></ui-select>
                        </div>
                    </div>
                    <content-state v-if="horsesListError" state="error" subject="原型马资料" :retry="true" @retry="retryHorses"></content-state>
                    <div v-else-if="horsePaged.length" class="horse-list">
                        <a v-for="horse in horsePaged" :key="horse.id" class="horse-row" :href="routes.horses(horse.id)" @click="internalLink($event, () => openHorse(horse.id))">
                            <span class="horse-thumb"><img v-if="horse.photo" v-media-src="horse.photo" :alt="horse.zh" loading="lazy" @error="onHorseImageError($event)"><i v-else>{{ (horse.zh || '马').slice(0,1) }}</i></span>
                            <span class="horse-row-main"><b>{{ horse.zh }}</b><span class="horse-row-ja">{{ horse.ja }}<template v-if="horse.en"> · {{ horse.en }}</template></span><span class="horse-row-meta">{{ horseSexLabel(horse) }}<template v-if="horse.born"> · {{ horse.born }} 年出生</template><template v-if="horse.birthdate"> · {{ horse.birthdate }}</template></span></span>
                            <span class="horse-row-go">查看 <em>→</em></span>
                        </a>
                    </div>
                    <content-state v-else state="filtered" subject="原型马" :clear="true" @clear="horseQuery='';setHorsePage(1)"></content-state>
                    <div v-if="horsePaged.length" class="ui-pager">
                        <span>{{ horsePageStart }}–{{ horsePageEnd }} / {{ horsesTotal }}</span>
                        <div>
                            <button :disabled="horsePage<=1" @click="goHorsePage(-1)">上一页</button>
                            <button v-for="(page,index) in horsePageList" :key="index" :class="{active:page===horsePage}" :disabled="page==='…'" @click="setHorsePage(page)">{{ page }}</button>
                            <button :disabled="horsePage>=horsePageCount" @click="goHorsePage(1)">下一页</button>
                        </div>
                    </div>
                </template>
                <article v-else class="entity-detail horse-entity-detail">
                    <button type="button" class="horse-back" @click="setOtherSection('horses')">← 返回原型马列表</button>
                    <div class="entity-hero" :class="{'entity-hero-text':!horseDetail.photo}">
                        <div v-if="horseDetail.photo" class="entity-cover horse-cover"><img v-media-src="horseDetail.photo" :alt="horseDetail.zh" fetchpriority="high" @error="onHorseImageError($event)"></div>
                        <div class="entity-intro">
                            <span class="entity-kind">原型马 · {{ horseSexLabel(horseDetail) }}</span>
                            <h1>{{ horseDetail.zh }}</h1>
                            <p class="entity-reading">{{ horseDetail.ja }}<template v-if="horseDetail.en"> · {{ horseDetail.en }}</template></p>
                            <p class="horse-badge-line">
                                <span v-if="horseDetail.born" class="horse-badge">出生 {{ horseDetail.birthdate || horseDetail.born + ' 年' }}</span>
                                <span v-if="horseDetail.colour" class="horse-badge">毛色 {{ horseDetail.colour }}</span>
                                <span v-if="horseDetail.country" class="horse-badge">产地 {{ horseDetail.country }}</span>
                                <span v-if="horseDetail.death" class="horse-badge horse-badge-death">卒 {{ horseDetail.death }}</span>
                            </p>
                            <div v-if="horseChars(horseDetail).length" class="hero-chip-row">
                                <a v-for="character in horseChars(horseDetail)" :key="character.id" class="performer-chip character-chip" :style="{'--chip-color':characterColor(character.id)}" :href="routes.characters(character.id)" @click="internalLink($event, () => openCharDetail(character.id))"><img v-if="characterImage(character.id)" v-media-src="characterImage(character.id)" alt=""><span>{{ character.zh }}</span></a>
                            </div>
                        </div>
                    </div>
                    <div v-if="horseDetail.wins && horseDetail.wins.length" class="horse-wins">
                        <span v-for="(win,index) in horseDetail.wins" :key="index" class="horse-win-medal" :class="'horse-win-' + String(win.grade || '').toLowerCase()">{{ win.grade }} {{ win.race }}<template v-if="win.year">（{{ win.year }}）</template></span>
                    </div>
                    <dl v-if="horseFacts.length" class="entity-meta detail-meta horse-meta">
                        <div v-for="(fact,index) in horseFacts" :key="index"><dt>{{ fact.name }}</dt><dd>{{ fact.value }}</dd></div>
                    </dl>
                    <section v-if="horseDetail.intro && horseDetail.intro.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">简介</span></div>
                        <p v-for="(paragraph,index) in horseDetail.intro" :key="index" class="horse-paragraph">{{ paragraph }}</p>
                    </section>
                    <section v-if="horseDetail.career && horseDetail.career.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">生涯</span></div>
                        <p v-for="(paragraph,index) in horseDetail.career" :key="index" class="horse-paragraph">{{ paragraph }}</p>
                    </section>
                    <section v-if="horseDetail.yearly && horseDetail.yearly.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">年度成绩</span></div>
                        <div class="horse-table-wrap">
                            <table class="horse-table">
                                <thead><tr><th>年份</th><th>出场</th><th>胜</th><th>2着</th><th>3着</th><th>其他</th><th>赏金</th><th>办赛</th></tr></thead>
                                <tbody>
                                    <tr v-for="(row,index) in horseDetail.yearly" :key="index" :class="{sum:row.year==='合計'}"><td>{{ row.year }}</td><td>{{ row.starts }}</td><td>{{ row.wins }}</td><td>{{ row.seconds }}</td><td>{{ row.thirds }}</td><td>{{ row.unplaced }}</td><td class="num">{{ row.earnings }}</td><td>{{ row.venue }}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                    <section v-if="(horseDetail.races && horseDetail.races.length) || (horseDetail.major && horseDetail.major.length)" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">比赛记录</span></div>
                        <div class="horse-table-wrap">
                            <table class="horse-table major-table">
                                <thead><tr><th>日期</th><th>场馆</th><th>赛事</th><th>级别</th><th>名次</th><th>场地</th><th>距离</th><th>头马（二马）</th><th>赏金</th></tr></thead>
                                <tbody>
                                    <tr v-for="(row,index) in horseMajorRows" :key="index"><td>{{ row.date }}</td><td>{{ row.track }}</td><td>{{ row.race || '—' }}</td><td><span class="horse-grade" :class="'horse-grade-' + String(row.grade||'').toLowerCase()">{{ row.grade || '—' }}</span></td><td>{{ row.placeLabel }}</td><td>{{ row.surface }}</td><td>{{ row.distance }}</td><td class="beaten">{{ row.top }}</td><td class="num">{{ row.prize || '—' }}</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <button v-if="horseMajorTotal > 10" type="button" class="horse-expand-btn" @click="toggleHorseMajor">{{ horseMajorExpanded ? '收起' : '展开查看更多' }}</button>
                    </section>
                    <section v-if="horseDetail.awards && horseDetail.awards.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">获奖</span></div>
                        <div class="horse-awards"><span v-for="(award,index) in horseDetail.awards" :key="index" class="horse-award-chip">{{ award.year }} {{ award.title }}</span></div>
                    </section>
                    <section v-if="horseDetail.retirement && horseDetail.retirement.length" class="entity-section">
                        <div class="section-toolbar"><span class="credit-role-tag">退役 · 繁育 · 纪念</span></div>
                        <p v-for="(paragraph,index) in horseDetail.retirement" :key="index" class="horse-paragraph">{{ paragraph }}</p>
                    </section>



                </article>
            </section>
            <section v-else class="entity-section other-section">
                <div class="section-toolbar"><span class="credit-role-tag">骑师</span></div>
                <content-state state="uncollected" subject="骑师资料"></content-state>
            </section>
        `;
