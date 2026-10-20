export const bindings = ["contactEmails"];
export const template = `
            <div class="legal-wrap info-page">
                <header class="entity-hero music-archive-hero entity-hero-text"><div class="entity-intro"><h1>隐私政策</h1></div></header>

                <article class="entity-section information-document">
                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">一、</span><span class="legal-sec-title">浏览与账户</span></div>
                    <p class="legal-text">浏览本站无需注册或登录。本站目前不提供访问者账户，也不会要求您提供姓名或联系方式才能查看公开资料。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">二、</span><span class="legal-sec-title">自动产生的访问记录</span></div>
                    <p class="legal-text">托管服务器为提供页面和排查故障，可能记录请求时间、访问 IP、浏览器标识、请求路径和响应状态等访问日志。维护者仅在排障、防滥用或处理安全问题时查看相关记录；日志保存方式和期限取决于实际托管环境。</p>
                    <p class="legal-text">本站目前未接入广告或站内行为分析服务。部分图片、视频缩略图及您主动打开的媒体播放器可能由外部服务提供；浏览器向这些服务请求资源时，相关服务可能按其自身政策处理访问数据。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">三、</span><span class="legal-sec-title">Cookie 与本地存储</span></div>
                    <p class="legal-text">本站当前不要求使用 Cookie 才能浏览公开内容，也未使用浏览器本地存储建立访问者档案。外部服务在您使用其表单、媒体或链接时，可能按其自身政策使用 Cookie 或类似技术。</p>
                    <p class="legal-text">您可以通过浏览器设置管理或清除站点数据；清除后，相关页面偏好或外部服务状态可能需要重新设置。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">四、</span><span class="legal-sec-title">用户主动提交的内容</span></div>
                    <p class="legal-text">若您提交资料订正，页面 URL、问题描述、依据链接及您自愿填写的联系方式会通过 FormSubmit 转发到两位维护者的邮箱，用于核实与回复。表单内容不会自动发布。FormSubmit 作为第三方服务会处理这些字段；其公开文档说明提交记录可在其归档中保留 30 天。邮件副本的保留取决于维护者所用邮箱服务及处理需要。</p>
                    <p class="legal-text">请勿在表单或邮件中提交他人的非公开个人信息。若希望查询、更正或删除您提交的内容，请通过下方邮箱说明提交时间与相关内容。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">五、</span><span class="legal-sec-title">资料来源与外部链接</span></div>
                    <p class="legal-text">站点的资料更新任务会从公开来源整理活动、角色与音乐信息。该后台采集不以访问者身份向来源站点发送请求。若您点击外部来源链接、播放外部媒体，或浏览页面中直接来自第三方的资源，则由您的浏览器连接相应服务。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">六、</span><span class="legal-sec-title">未成年人</span></div>
                    <p class="legal-text">本站面向一般受众。请勿提交未成年人的个人信息；未成年人提交资料前，请先取得监护人同意。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">七、</span><span class="legal-sec-title">访问、更正与删除请求</span></div>
                    <p class="legal-text">本站不出售提交内容，也不将其用于广告。若您希望查询、更正或删除您向本站提交的信息，请通过下方邮箱联系我们。维护者会核对请求所指内容，并在能够控制的范围内处理；第三方服务保存的数据可能还需依其政策另行申请。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">八、</span><span class="legal-sec-title">版权方与资料来源方的删改请求</span></div>
                    <p class="legal-text">若您是权利方、资料来源方或当事人，认为某条目涉及权利问题，请提供页面链接和说明并通过下方邮箱联系我们。维护者会优先核实并处理。相关内容使用说明见「使用条款」。</p>
                </div>

                <div class="legal-section">
                    <div class="legal-sec-head"><span class="legal-sec-no">九、</span><span class="legal-sec-title">联系方式</span></div>
                    <p class="legal-text">联系邮箱：<a v-for="email in contactEmails" :key="email" :href="'mailto:'+email">{{ email }}</a>。资料订正也可使用页脚表单。</p>
                    <p class="legal-text">本政策可能随站点功能与实际服务变化而更新；变更会在本页注明日期。</p>
                </div>

                <p class="legal-updated">最后更新：2026-09-20</p>
                </article>
            </div>
        `;
