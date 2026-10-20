export const bindings = ["fix","fixDone","fixSendState","fixMailto","submitFix","goLegal","fixTitleOptions"];
export const template = `
            <div class="fix-wrap info-page">
                <header class="entity-hero music-archive-hero entity-hero-text"><div class="entity-intro"><h1>资料订正</h1></div></header>

                <form class="entity-section fix-card" @submit.prevent="submitFix">
                    <div class="fix-row">
                        <label class="fix-label" for="fixPage">页面 URL<span class="req">*</span></label>
                        <input class="fix-input" id="fixPage" type="text" v-model.trim="fix.page"
                            placeholder="请粘贴需要订正的页面链接" required>
                    </div>

                    <div class="fix-row">
                        <span class="fix-label">问题类型</span>
                        <div class="ui-filter-group fix-chips"><div>
                            <button type="button" :class="{active: fix.kind==='k1'}" @click="fix.kind='k1'">资料错误</button>
                            <button type="button" :class="{active: fix.kind==='k2'}" @click="fix.kind='k2'">缺少资料</button>
                            <button type="button" :class="{active: fix.kind==='k3'}" @click="fix.kind='k3'">翻译问题</button>
                            <button type="button" :class="{active: fix.kind==='k4'}" @click="fix.kind='k4'">图片问题</button>
                            <button type="button" :class="{active: fix.kind==='k5'}" @click="fix.kind='k5'">链接问题</button>
                            <button type="button" :class="{active: fix.kind==='k6'}" @click="fix.kind='k6'">其他</button>
                        </div></div>
                    </div>

                    <div class="fix-row">
                        <label class="fix-label" for="fixTitle">这是哪类条目？</label>
                        <ui-select id="fixTitle" v-model="fix.title" :options="fixTitleOptions" aria-label="条目类型"></ui-select>
                    </div>

                    <div class="fix-row">
                        <label class="fix-label" for="fixBody">正确内容应为<span class="req">*</span></label>
                        <textarea class="fix-textarea" id="fixBody" v-model.trim="fix.body" maxlength="2000"
                            placeholder="描述哪里不对、正确的应该是什么。" required></textarea>
                        <p class="fix-hint">{{ fix.body.length }} / 2000 个字符</p>
                    </div>

                    <div class="fix-row">
                        <label class="fix-label" for="fixSrc">来源 / 依据 URL（可选）</label>
                        <input class="fix-input" id="fixSrc" type="text" v-model.trim="fix.src"
                            placeholder="附上一个佐证订正的链接，可以帮助审核者更快核实。">
                    </div>

                    <div class="fix-row">
                        <label class="fix-label" for="fixContact">联系方式（可选）</label>
                        <input class="fix-input" id="fixContact" type="text" v-model.trim="fix.contact"
                            placeholder="仅在审核者需要跟进时使用，不会公开显示。">
                    </div>

                    <div class="fix-row fix-agreement">
                        <label class="fix-check">
                            <input type="checkbox" v-model="fix.agree">
                            <span>我已阅读并同意使用条款，且确认有权分享所提交的内容。</span>
                        </label>
                        <button type="button" class="info-inline-action" @click="goLegal('terms')">阅读使用条款 ↗</button>
                    </div>

                    <button class="fix-submit" type="submit" :disabled="!fix.page || !fix.body || !fix.agree || fixSendState==='sending' || fixSendState==='ok'">
                        {{ fixSendState==='sending' ? '正在提交…' : '提交订正' }}
                    </button>
                    <div v-if="fixSendState==='error'" class="fix-feedback error" role="alert">本次未确认发送成功，内容仍保留在表单中。<button type="button" class="info-inline-action" @click="submitFix()">重试</button><a :href="fixMailto">改用邮件发送 ↗</a></div>
                    <div v-if="fixDone" class="fix-feedback success" role="status">订正已提交。维护者核实后才会更新资料，感谢反馈！</div>
                </form>
            </div>
        `;
