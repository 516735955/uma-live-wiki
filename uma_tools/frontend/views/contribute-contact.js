export const bindings = ["contactEmails","goContributeFix"];
export const template = `
            <div class="contact-wrap info-page">
                <header class="info-page-head"><span class="info-page-kicker">参与共建 · CONTACT</span><h1 class="contact-title">联系我们</h1><p class="contact-intro">本站由个人粉丝自愿维护，并非官方运营渠道。资料订正请使用表单；版权、来源和其他站务事项可以直接邮件联系两位维护者。</p></header>

                <div class="contact-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-no">一</span>
                        <span class="contact-sec-title">邮件</span>
                    </div>
                    <div class="contact-card">
                        <div class="contact-row"><div class="contact-k">联系邮箱</div><div class="contact-v"><a v-for="email in contactEmails" :key="email" :href="'mailto:'+email">{{ email }}</a></div></div>
                        <div class="contact-row"><div class="contact-k">适用情形</div><div class="contact-v">版权与来源咨询、删改请求、媒体联络、合作申请</div></div>
                    </div>
                </div>

                <div class="contact-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-no">二</span>
                        <span class="contact-sec-title">资料订正</span>
                    </div>
                    <div class="contact-card">
                        <div class="contact-row"><div class="contact-k">页面入口</div><div class="contact-v"><button type="button" class="info-inline-action" @click="goContributeFix()">打开资料订正表单 ↗</button></div></div>
                        <div class="contact-row"><div class="contact-k">处理方式</div><div class="contact-v">维护者核实来源后处理。表单不会直接更改已发布资料；处理时间视核实难度而定。</div></div>
                    </div>
                </div>

                <div class="contact-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-no">三</span>
                        <span class="contact-sec-title">准确性免责</span>
                    </div>
                    <p class="contact-text">
                        本站整合公开资料，仍可能存在遗漏或更新延迟。购票、出行等重要事项，请以官方最新公告与售票渠道为准。
                    </p>
                </div>

                <div class="contact-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-no">四</span>
                        <span class="contact-sec-title">关于本站</span>
                    </div>
                    <p class="contact-text">
                        本站由个人粉丝自愿维护，非盈利运营，不以广告收入用于任何商业目的。本站与株式会社 Cygames 及任何相关商业实体无任何关系，不代表任何赛马娘角色、艺人、声优或其所属事务所的立场，所有信息仅供粉丝参考使用。
                    </p>
                </div>

                <div class="contact-section">
                    <div class="contact-sec-head">
                        <span class="contact-sec-no">五</span>
                        <span class="contact-sec-title">删改请求</span>
                    </div>
                    <p class="contact-text">
                        权利方、资料来源方或当事人可通过上述邮箱提供相关页面与说明。维护者收到后会优先核实并处理；紧急请求请在邮件主题中注明。
                    </p>
                </div>

                <p class="contact-updated">最后更新：2026-09-20</p>
            </div>
        `;
