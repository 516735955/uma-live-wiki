export const bindings = ["routeReady","animeLoading","animeError","retryAnime","staffQuery","staffPage","staffPageCount","staffPaged","staffPageList","setStaffPage","staffDetail","staffFiltered","staffVisibleRoles","staffPortrait","staffCredits","staffDisplayAliases","staffHref","animeLink"];
export const template = `
            <div v-if="animeLoading || !routeReady" class="ui-state loading">正在加载制作人员资料…</div>
            <div v-else-if="animeError" class="ui-state error">{{ animeError }}<button class="state-retry" @click="retryAnime()">重试</button></div>
            <template v-else>
                <template v-if="!staffDetail">
                    <div class="archive-toolbar" id="staffArchiveTop">
                        <label class="ui-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" v-model.trim="staffQuery" aria-label="搜索制作人员姓名或职务" placeholder="搜索制作人员姓名或职务" autocomplete="off"><button v-if="staffQuery" type="button" @click.prevent="staffQuery=''" aria-label="清空搜索">×</button></label>

                    </div>
                    <div class="creator-catalog">
                        <a v-for="person in staffPaged" :key="person.id" class="creator-catalog-row" :href="staffHref(person)" @click="animeLink($event,staffHref(person))">
                            <span class="identity-portrait staff-portrait"><img :src="staffPortrait(person)" alt="" loading="lazy" @error="person.photo=''"></span>
                            <span class="creator-catalog-name"><b>{{ person.name }}</b></span>
                            <span class="creator-catalog-roles role-tag-row"><em v-for="role in staffVisibleRoles(person)" :key="role" class="credit-role-tag">{{ role }}</em></span>

                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                        </a>
                        <div v-if="!staffFiltered.length" class="ui-state">没有符合条件的制作人员<button type="button" class="state-retry" @click="staffQuery=''">清除搜索</button></div>
                    </div>
                    <div v-if="staffFiltered.length" class="ui-pager"><div><button :disabled="staffPage===1" @click="setStaffPage(staffPage-1)">上一页</button><button v-for="page in staffPageList" :key="page" :class="{active:page===staffPage}" :disabled="page==='…'" @click="setStaffPage(page)">{{ page }}</button><button :disabled="staffPage===staffPageCount" @click="setStaffPage(staffPage+1)">下一页</button></div></div>
                </template>
            <article v-else class="entity-detail staff-entity-detail"><div class="entity-hero creator-hero music-archive-hero"><div class="entity-cover"><img :src="staffPortrait(staffDetail)" :alt="staffDetail.name" @error="staffDetail.photo=''"></div><div class="entity-intro"><span class="entity-kind">制作人员</span><h1>{{ staffDetail.name }}</h1><p v-if="staffDisplayAliases.length" class="entity-reading">{{ staffDisplayAliases.join(' / ') }}</p><p v-if="staffDetail.bio">{{ staffDetail.bio }}</p><dl class="entity-meta"><div v-if="staffDetail.birthday"><dt>生日</dt><dd>{{ staffDetail.birthday }}</dd></div></dl></div></div><div class="media-content"><section class="entity-section"><anime-participation :works="staffCredits" section="staff"></anime-participation></section></div></article>
            </template>
        `;
