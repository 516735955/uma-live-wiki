export const bindings = ["contactEmails","goContributeFix"];
export const template = `
            <div class="contact-wrap info-page">
                <header class="entity-hero music-archive-hero entity-hero-text info-hero">
                    <div class="entity-intro">
                        <span class="entity-kind">参与共建</span>
                        <h1>联系我们</h1>
                    </div>
                </header>

                <div class="contact-section entity-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-title">邮件联络</span>
                    </div>
                    <dl class="profile-facts contact-facts">
                        <div><dt>联系邮箱</dt><dd class="email-chip-list"><a v-for="email in contactEmails" :key="email" class="email-chip" :href="'mailto:'+email">{{ email }}</a></dd></div>
                        <div><dt>适用情形</dt><dd>版权与来源咨询、删改请求、媒体联络、合作申请</dd></div>
                    </dl>
                </div>

                <div class="contact-section entity-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-title">资料订正</span>
                    </div>
                    <dl class="profile-facts contact-facts">
                        <div><dt>页面入口</dt><dd><button type="button" class="info-inline-action" @click="goContributeFix()">打开资料订正表单</button></dd></div>
                    </dl>
                </div>

                <div class="contact-section entity-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-title">删改请求</span>
                    </div>
                    <p class="contact-text">
                        权利方、资料来源方或当事人可通过上述邮箱提供相关页面与说明。维护者收到后会优先核实并处理；紧急请求请在邮件主题中注明。
                    </p>
                </div>

                <p class="contact-updated">最后更新：2026-09-20</p>
            </div>
        `;
