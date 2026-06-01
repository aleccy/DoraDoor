/* ============================================
   DoraDoor Admin - 主应用逻辑
   ============================================ */

const App = {
    _apiBase: '',
    // 状态
    token: null,
    user: null,
    currentPage: 'dashboard',
    refreshTimer: null,
    costChart: null,
    providerChart: null,
    logOffset: 0,
    logStatusFilter: '',
    // API测试状态
    testMessages: [],
    testModel: '',
    testStream: true,
    testMode: 'direct', // 'direct' 直连服务商, 'proxy' 代理网关
    testLoading: false,
    testAbortCtrl: null,
    _userScrolled: false,

    // ========== 初始化 ==========
    init() {
        const apiBaseMeta = document.querySelector('meta[name="api-base"]');
        if (apiBaseMeta && apiBaseMeta.content) this._apiBase = apiBaseMeta.content;
        const token = localStorage.getItem('gw_token');
        const user = localStorage.getItem('gw_user');
        if (token && user && user !== 'undefined') {
            try {
                this.token = token;
                this.user = JSON.parse(user);
                this.showApp();
            } catch(e) {
                localStorage.removeItem('gw_token');
                localStorage.removeItem('gw_user');
                this.showLogin();
            }
        } else {
            this.showLogin();
        }
        ChartConfig.applyDarkTheme();
    },

    // ========== 认证 ==========
    async login(event) {
        event.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');

        if (!username || !password) {
            errorEl.textContent = '请输入用户名和密码';
            errorEl.style.display = 'block';
            return false;
        }

        try {
            const res = await this.api('POST', '/api/auth/login', { username, password });
            if (res.token) {
                this.token = res.token;
                this.user = res.user;
                localStorage.setItem('gw_token', res.token);
                localStorage.setItem('gw_user', JSON.stringify(res.user));
                this.showApp();
                this.showToast('登录成功', 'success');
            } else {
                errorEl.textContent = res.error || '登录失败';
                errorEl.style.display = 'block';
            }
        } catch (e) {
            errorEl.textContent = '连接服务器失败';
            errorEl.style.display = 'block';
        }
        return false;
    },

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('gw_token');
        localStorage.removeItem('gw_user');
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.showLogin();
    },

    showLogin() {
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('appLayout').classList.add('hidden');
    },

    showApp() {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('appLayout').classList.remove('hidden');
        document.getElementById('userName').textContent = this.user?.username || 'admin';
        document.getElementById('userRole').textContent = this.user?.role === 'admin' ? '管理员' : '观察者';
        document.getElementById('userAvatar').textContent = (this.user?.username || 'A')[0].toUpperCase();
        this.navigate('dashboard');
    },

    // ========== API请求封装 ==========
    _pendingRequests: [],

    _cancelPendingRequests() {
        this._pendingRequests.forEach(xhr => { try { xhr.abort(); } catch {} });
        this._pendingRequests = [];
    },

    _isCancelledError(e) { return e && e.message === '__CANCELLED__'; },

    async api(method, path, body) {
        const base = this._apiBase || window.location.origin;
        const url = new URL(path, base).href;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 15000;
            if (this.token) xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
            this._pendingRequests.push(xhr);
            xhr.onload = function() {
                App._pendingRequests = App._pendingRequests.filter(x => x !== xhr);
                if (xhr.status === 401) { App.logout(); reject(new Error('未授权')); return; }
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status >= 400) { reject(new Error(data.error || '请求失败')); return; }
                    resolve(data);
                } catch(e) { reject(new Error('响应解析失败')); }
            };
            xhr.onerror = function() {
                App._pendingRequests = App._pendingRequests.filter(x => x !== xhr);
                reject(new Error('网络请求失败'));
            };
            xhr.ontimeout = function() {
                App._pendingRequests = App._pendingRequests.filter(x => x !== xhr);
                reject(new Error('请求超时，请检查网络连接'));
            };
            xhr.onabort = function() {
                App._pendingRequests = App._pendingRequests.filter(x => x !== xhr);
                reject(new Error('__CANCELLED__'));
            };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    },

    // ========== 导航 ==========
    navigate(page) {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this._cancelPendingRequests();
        this.currentPage = page;
        this.costChart = null;
        this.providerChart = null;

        // 更新侧边栏高亮
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });

        // 关闭移动端侧边栏
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('active');

        // 渲染页面
        const renderers = {
            dashboard: () => this.renderDashboard(),
            providers: () => this.renderProviders(),
            apikeys: () => this.renderApiKeys(),
            mappings: () => this.renderMappings(),
            pricing: () => this.renderPricing(),
            logs: () => this.renderLogs(),
            users: () => this.renderUsers(),
            portalusers: () => this.renderPortalUsers(),
            system: () => this.renderSystem(),
            apitest: () => this.renderApiTest(),
            accesslogs: () => this.renderAccessLogs(),
            invites: () => this.renderInvites(),
            usage: () => this.renderUsageAnalysis()
        };

        const renderer = renderers[page];
        if (renderer) {
            try { renderer(); } catch(e) { if (!this._isCancelledError(e)) { console.error('Page render error:', e); this.showToast('页面加载失败: ' + e.message, 'error'); } }
        }
    },

    toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebarOverlay').classList.toggle('active');
    },

    // ========== 仪表盘页面 ==========
    async renderDashboard() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>📊 仪表盘</h2>
            </div>
            <div class="stat-cards" id="statCards">
                <div class="stat-card"><div class="stat-header"><div class="stat-icon blue">📡</div><span class="stat-label">请求数</span></div><div class="stat-value" id="statRequests">-</div><div class="stat-sub" id="statRequestsSub"></div></div>
                <div class="stat-card"><div class="stat-header"><div class="stat-icon green">🔤</div><span class="stat-label">Token 数</span></div><div class="stat-value" id="statTokens">-</div><div class="stat-sub" id="statTokensSub"></div></div>
                <div class="stat-card"><div class="stat-header"><div class="stat-icon red">💰</div><span class="stat-label">总费用</span></div><div class="stat-value" id="statCost">-</div><div class="stat-sub" id="statCostSub"></div></div>
                <div class="stat-card"><div class="stat-header"><div class="stat-icon yellow">✅</div><span class="stat-label">成功率</span></div><div class="stat-value" id="statSuccess">-</div><div class="stat-sub" id="statSuccessSub"></div></div>
            </div>
            <div class="charts-row">
                <div class="chart-card"><h3>📈 费用趋势（24小时）</h3><div class="chart-container"><canvas id="costChartCanvas"></canvas></div></div>
                <div class="chart-card"><h3>🔧 服务商分布</h3><div class="chart-container"><canvas id="providerChartCanvas"></canvas></div></div>
            </div>
            <div class="table-card">
                <div class="table-header"><h3>🏆 模型使用排行</h3></div>
                <div class="table-wrapper"><table><thead><tr><th>排名</th><th>服务商</th><th>模型</th><th>请求数</th><th>输入Token</th><th>输出Token</th><th>费用</th><th>平均延迟</th></tr></thead><tbody id="modelRankingBody"><tr><td colspan="8" class="table-empty"><div class="empty-icon">📊</div>加载中...</td></tr></tbody></table></div>
            </div>
        `;
        await this.loadDashboardData();
        // 每5秒刷新实时数据
        this.refreshTimer = setInterval(() => this.loadDashboardData(), 5000);
    },

    async loadDashboardData() {
        try {
            const [summary, costData, providerData, ranking] = await Promise.all([
                this.api('GET', '/api/dashboard/summary?period=day'),
                this.api('GET', '/api/dashboard/cost-chart?hours=24'),
                this.api('GET', '/api/dashboard/provider-chart?period=day'),
                this.api('GET', '/api/dashboard/model-ranking?limit=10')
            ]);

            // 更新统计卡片
            document.getElementById('statRequests').textContent = this.formatNumber(summary.today_requests || 0);
            document.getElementById('statRequestsSub').textContent = `当日 ${this.formatNumber(summary.today_requests || 0)} | 当月 ${this.formatNumber(summary.month_requests || 0)} | 总计 ${this.formatNumber(summary.all_requests || 0)}`;
            document.getElementById('statTokens').textContent = this.formatReadableToken(summary.today_tokens || 0);
            document.getElementById('statTokensSub').textContent = `当日 ${this.formatReadableToken(summary.today_tokens || 0)} | 当月 ${this.formatReadableToken(summary.month_tokens || 0)} | 总计 ${this.formatReadableToken(summary.all_tokens || 0)}`;
            document.getElementById('statCost').textContent = this.formatCost(summary.today_cost || 0);
            document.getElementById('statCostSub').textContent = `当日 ${this.formatCost(summary.today_cost || 0)} ≈¥${this.formatCostCNY(summary.today_cost_cny || (summary.today_cost || 0) * 7.25)} | 当月 ${this.formatCost(summary.month_cost || 0)} ≈¥${this.formatCostCNY(summary.month_cost_cny || (summary.month_cost || 0) * 7.25)} | 总计 ${this.formatCost(summary.all_cost || 0)} ≈¥${this.formatCostCNY(summary.all_cost_cny || (summary.all_cost || 0) * 7.25)} | 服务商 ${summary.provider_count || 0} 个 / Key ${summary.api_key_count || 0} 个`;
            const rate = summary.success_rate !== undefined ? summary.success_rate.toFixed(1) : '0.0';
            document.getElementById('statSuccess').textContent = rate + '%';
            document.getElementById('statSuccessSub').textContent = `平均延迟 ${((summary.avg_latency_ms || 0) / 1000).toFixed(2)}s`;

            // 更新费用图表
            if (costData.chart_data && costData.chart_data.length > 0) {
                if (!this.costChart) {
                    this.costChart = ChartConfig.createCostChart('costChartCanvas', costData.chart_data);
                } else {
                    ChartConfig.updateCostChart(this.costChart, costData.chart_data);
                }
            }

            // 更新服务商图表
            if (providerData.chart_data && providerData.chart_data.length > 0) {
                if (!this.providerChart) {
                    this.providerChart = ChartConfig.createProviderChart('providerChartCanvas', providerData.chart_data);
                } else {
                    ChartConfig.updateProviderChart(this.providerChart, providerData.chart_data);
                }
            }

            // 更新模型排行
            const tbody = document.getElementById('modelRankingBody');
            if (ranking.ranking && ranking.ranking.length > 0) {
                tbody.innerHTML = ranking.ranking.map((r, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td><span class="badge badge-info">${this.esc(r.provider)}</span></td>
                        <td>${this.esc(r.model)}</td>
                        <td>${this.formatNumber(r.requests)}</td>
                        <td>${this.formatNumber(r.input_tokens)}</td>
                        <td>${this.formatNumber(r.output_tokens)}</td>
                        <td>${this.formatCost(r.cost)}</td>
                        <td>${((r.avg_latency || 0) / 1000).toFixed(2)}s</td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="8" class="table-empty"><div class="empty-icon">📊</div>暂无数据</td></tr>';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) console.error('加载仪表盘数据失败:', e);
        }
    },

    // ========== 服务商管理页面 ==========
    async renderProviders() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>🔧 服务商管理</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>服务商列表</h3>
                    <button class="btn btn-primary" onclick="App.showAddProviderModal()">+ 添加服务商</button>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>名称</th><th>API格式</th><th>计费模式</th><th>Base URL</th><th>超时(秒)</th><th>最大连接</th><th>月使用次数</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody id="providerBody"><tr><td colspan="9" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadProviders();
    },

    async loadProviders() {
        try {
            const res = await this.api('GET', '/api/admin/providers');
            const tbody = document.getElementById('providerBody');
            const list = res.providers || res || [];
            if (Array.isArray(list) && list.length > 0) {
                tbody.innerHTML = list.map(p => `
                    <tr>
                        <td><strong>${this.esc(p.name)}</strong></td>
                        <td><span class="badge badge-info">${this.esc(p.api_format || 'openai')}</span></td>
                        <td><span class="badge ${p.billing_mode==='per_token'?'badge-success':p.billing_mode==='token_plan'?'badge-warning':p.billing_mode==='coding_plan'?'badge-info':'badge-info'}">${this.billingModeLabel(p.billing_mode)}</span></td>
                        <td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${this.esc(p.base_url || '')}</td>
                        <td>${p.timeout || 30}</td>
                        <td>${p.max_connections || 100}</td>
                        <td>${p.billing_mode === 'coding_plan' ? (p.current_monthly_used || 0) : '-'}</td>
                        <td><span class="badge ${p.is_active !== false ? 'badge-success' : 'badge-danger'}">${p.is_active !== false ? '启用' : '禁用'}</span></td>
                        <td>
                            <button class="btn-icon" onclick="App.showEditProviderModal('${this.esc(p.name)}')" title="编辑">✏️</button>
                            <button class="btn-icon danger" onclick="App.confirmDeleteProvider('${this.esc(p.name)}')" title="删除">🗑️</button>
                        </td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="empty-icon">🔧</div>暂无服务商，请点击"添加服务商"按钮</td></tr>';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) document.getElementById('providerBody').innerHTML = '<tr><td colspan="9" class="table-empty text-danger">加载失败: ' + this.esc(e.message) + '</td></tr>';
        }
    },

    showAddProviderModal() {
        this.showModal('添加服务商', `
            <form id="providerForm">
                <div class="form-group"><label>名称 <span class="required">*</span></label><input class="form-control" id="pName" placeholder="如: openai" required></div>
                <div class="form-group"><label>API格式 <span class="required">*</span></label>
                    <select class="form-control" id="pFormat"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option><option value="glm">GLM</option></select>
                </div>
                <div class="form-group"><label>计费模式</label>
                    <select class="form-control" id="pBillingMode">
                        <option value="per_token">按 Token 计费</option>
                        <option value="token_plan">Token Plan（积分制）</option>
                        <option value="coding_plan">Coding Plan（请求次数制）</option>
                    </select>
                    <div class="form-hint">按Token: 按输入/输出token量计费 | Token Plan: 按积分消耗计费 | Coding Plan: 按请求次数计费</div>
                </div>
                <div class="form-group"><label>Base URL <span class="required">*</span></label><input class="form-control" id="pBaseUrl" placeholder="https://api.openai.com"></div>
                <div class="form-row">
                    <div class="form-group"><label>超时(秒)</label><input class="form-control" id="pTimeout" type="number" value="60"></div>
                    <div class="form-group"><label>最大连接数</label><input class="form-control" id="pMaxConn" type="number" value="100"></div>
                </div>
                <div class="form-group"><label>API Key <span class="required">*</span></label><input class="form-control" id="pApiKey" placeholder="sk-..."></div>
                <div id="codingPlanFields" style="display:none;margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;">
                    <div style="font-weight:600;margin-bottom:8px;color:var(--accent-blue);">Coding Plan 设置</div>
                    <div class="form-group"><label>账号有效期</label><input class="form-control" id="pAccountValidUntil" type="date"></div>
                    <div class="form-row">
                        <div class="form-group"><label>5小时已用次数</label><input class="form-control" id="pFiveHourUsed" type="number" value="0"></div>
                        <div class="form-group"><label>周已用次数</label><input class="form-control" id="pWeeklyUsed" type="number" value="0"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>总已用次数</label><input class="form-control" id="pTotalUsed" type="number" value="0"></div>
                        <div class="form-group"><label>月已用次数</label><input class="form-control" id="pMonthlyUsed" type="number" value="0"></div>
                    </div>
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.submitProvider() }
        ]);
        setTimeout(() => {
            const bmSelect = document.getElementById('pBillingMode');
            if (bmSelect) bmSelect.addEventListener('change', function() {
                const cpf = document.getElementById('codingPlanFields');
                if (cpf) cpf.style.display = this.value === 'coding_plan' ? 'block' : 'none';
            });
        }, 100);
    },

    async showEditProviderModal(name) {
        try {
            const res = await this.api('GET', '/api/admin/providers/' + encodeURIComponent(name));
            const p = res.provider || res;
            this.showModal('编辑服务商 - ' + name, `
                <form id="providerForm">
                    <div class="form-group"><label>名称</label><input class="form-control" id="pName" value="${this.esc(p.name || '')}" readonly></div>
                    <div class="form-group"><label>API格式</label>
                        <select class="form-control" id="pFormat"><option value="openai" ${p.api_format==='openai'?'selected':''}>OpenAI</option><option value="anthropic" ${p.api_format==='anthropic'?'selected':''}>Anthropic</option><option value="deepseek" ${p.api_format==='deepseek'?'selected':''}>DeepSeek</option><option value="glm" ${p.api_format==='glm'?'selected':''}>GLM</option></select>
                    </div>
                    <div class="form-group"><label>计费模式</label>
                        <select class="form-control" id="pBillingMode">
                            <option value="per_token" ${p.billing_mode==='per_token'||!p.billing_mode?'selected':''}>按 Token 计费</option>
                            <option value="token_plan" ${p.billing_mode==='token_plan'?'selected':''}>Token Plan（积分制）</option>
                            <option value="coding_plan" ${p.billing_mode==='coding_plan'?'selected':''}>Coding Plan（请求次数制）</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Base URL</label><input class="form-control" id="pBaseUrl" value="${this.esc(p.base_url || '')}"></div>
                    <div class="form-row">
                        <div class="form-group"><label>超时(秒)</label><input class="form-control" id="pTimeout" type="number" value="${p.timeout || 60}"></div>
                        <div class="form-group"><label>最大连接数</label><input class="form-control" id="pMaxConn" type="number" value="${p.max_connections || 100}"></div>
                    </div>
                    <div class="form-group"><label>API Key</label><input class="form-control" id="pApiKey" value="${this.esc(p.api_key || '')}" placeholder="留空则不修改"></div>
                    <div id="codingPlanFields" style="display:${p.billing_mode==='coding_plan'?'block':'none'};margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;">
                        <div style="font-weight:600;margin-bottom:8px;color:var(--accent-blue);">Coding Plan 设置</div>
                        <div class="form-group"><label>账号有效期</label><input class="form-control" id="pAccountValidUntil" type="date" value="${p.account_valid_until ? this.formatDate(p.account_valid_until) : ''}"></div>
                        <div class="form-row">
                            <div class="form-group"><label>5小时已用次数</label><input class="form-control" id="pFiveHourUsed" type="number" value="${p.current_five_hour_used || 0}"></div>
                            <div class="form-group"><label>周已用次数</label><input class="form-control" id="pWeeklyUsed" type="number" value="${p.current_weekly_used || 0}"></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group"><label>总已用次数</label><input class="form-control" id="pTotalUsed" type="number" value="${p.current_total_used || 0}"></div>
                            <div class="form-group"><label>月已用次数</label><input class="form-control" id="pMonthlyUsed" type="number" value="${p.current_monthly_used || 0}"></div>
                        </div>
                    </div>
                </form>
            `, [
                { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
                { text: '保存', class: 'btn-primary', action: () => this.submitProvider(name) }
            ]);
            setTimeout(() => {
                const bmSelect = document.getElementById('pBillingMode');
                if (bmSelect) bmSelect.addEventListener('change', function() {
                    const cpf = document.getElementById('codingPlanFields');
                    if (cpf) cpf.style.display = this.value === 'coding_plan' ? 'block' : 'none';
                });
            }, 100);
        } catch (e) {
            this.showToast('加载服务商信息失败: ' + e.message, 'error');
        }
    },

    async submitProvider(existingName) {
        const name = document.getElementById('pName').value.trim();
        const apiFormat = document.getElementById('pFormat').value;
        const baseUrl = document.getElementById('pBaseUrl').value.trim();
        const timeout = parseInt(document.getElementById('pTimeout').value) || 60;
        const maxConn = parseInt(document.getElementById('pMaxConn').value) || 100;
        const apiKey = document.getElementById('pApiKey').value.trim();

        if (!name || !baseUrl) {
            this.showToast('名称和Base URL不能为空', 'error');
            return;
        }

        try {
            const body = { name, api_format: apiFormat, base_url: baseUrl, timeout, max_connections: maxConn, billing_mode: document.getElementById('pBillingMode')?.value || 'per_token' };
            if (apiKey) body.api_key = apiKey;

            const billingMode = document.getElementById('pBillingMode')?.value || 'per_token';
            if (billingMode === 'coding_plan') {
                const validUntil = document.getElementById('pAccountValidUntil')?.value;
                if (validUntil) body.account_valid_until = validUntil;
                const fiveHourUsed = parseInt(document.getElementById('pFiveHourUsed')?.value);
                const weeklyUsed = parseInt(document.getElementById('pWeeklyUsed')?.value);
                const totalUsed = parseInt(document.getElementById('pTotalUsed')?.value);
                const monthlyUsed = parseInt(document.getElementById('pMonthlyUsed')?.value);
                if (!isNaN(fiveHourUsed)) body.current_five_hour_used = fiveHourUsed;
                if (!isNaN(weeklyUsed)) body.current_weekly_used = weeklyUsed;
                if (!isNaN(totalUsed)) body.current_total_used = totalUsed;
                if (!isNaN(monthlyUsed)) body.current_monthly_used = monthlyUsed;
            }

            if (existingName) {
                await this.api('PUT', '/api/admin/providers/' + encodeURIComponent(existingName), body);
                this.showToast('服务商已更新', 'success');
            } else {
                await this.api('POST', '/api/admin/providers', body);
                this.showToast('服务商已创建', 'success');
            }
            this.closeModal();
            this.loadProviders();
        } catch (e) {
            this.showToast('操作失败: ' + e.message, 'error');
        }
    },

    confirmDeleteProvider(name) {
        this.showModal('确认删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除服务商 "${this.esc(name)}" 吗？</div>
                <div class="confirm-sub">此操作不可恢复，所有相关配置将被清除</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: async () => {
                try {
                    await this.api('DELETE', '/api/admin/providers/' + encodeURIComponent(name));
                    this.showToast('服务商已删除', 'success');
                    this.closeModal();
                    this.loadProviders();
                } catch (e) {
                    this.showToast('删除失败: ' + e.message, 'error');
                }
            }}
        ]);
    },

    // ========== API Key管理页面 ==========
    _apiKeyPage: 1,
    _apiKeyPageSize: 20,
    async renderApiKeys() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>🔑 API Key 管理</h2>
            </div>
            <div class="table-card" id="keyRequestsCard" style="display:none">
                <div class="table-header">
                    <h3>📝 待处理的 Key 申请</h3>
                    <span class="badge badge-warning" id="pendingCountBadge">0</span>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>申请ID</th><th>名称</th><th>计费模式</th><th>用途</th><th>申请人</th><th>邮箱</th><th>申请时间</th><th>操作</th></tr></thead>
                        <tbody id="keyRequestsBody"><tr><td colspan="8" class="table-empty">加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>API Key 列表</h3>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button class="btn btn-danger" id="batchDeleteApiKeysBtn" style="display:none" onclick="App.batchDeleteApiKeys()">🗑️ 删除选中</button>
                        <button class="btn btn-primary" onclick="App.showAddApiKeyModal()">+ 创建 API Key</button>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th><input type="checkbox" id="selectAllApiKeys" onchange="App.toggleSelectAllApiKeys(this.checked)"></th><th>名称</th><th>Key前缀</th><th>用户</th><th>计费模式</th><th>限流(次/分)</th><th>配额/余额</th><th>有效期</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody id="apikeyBody"><tr><td colspan="12" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
                <div id="apiKeyPagination" style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);"></div>
            </div>
        `;
        this.loadKeyRequests();
        await this.loadApiKeys();
    },

    async loadKeyRequests() {
        try {
            const data = await this.api('GET', '/api/admin/key-requests?status=pending');
            const tbody = document.getElementById('keyRequestsBody');
            const card = document.getElementById('keyRequestsCard');
            const badge = document.getElementById('pendingCountBadge');
            const list = data.requests || [];

            badge.textContent = list.length;

            if (list.length === 0) {
                card.style.display = 'none';
                return;
            }

            card.style.display = '';
            tbody.innerHTML = list.map(r => `
                <tr>
                    <td><code style="font-size:11px">${this.esc(r.id.substring(0,8))}</code></td>
                    <td><strong>${this.esc(r.name)}</strong></td>
                    <td><span class="badge ${r.billing_mode==='per_token'?'badge-success':r.billing_mode==='token_plan'?'badge-warning':'badge-info'}" style="font-size:11px">${this.billingModeLabel(r.billing_mode)}</span></td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${this.esc(r.purpose || '-')}</td>
                    <td>${this.esc(r.display_name || r.username)}</td>
                    <td class="text-muted">${this.esc(r.email || '-')}</td>
                    <td class="text-muted">${this.formatDateTime(r.created_at)}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="App.showBindRequestModal('${this.esc(r.id)}', '${this.esc(r.name)}', '${this.esc(r.display_name || r.username)}', '${this.esc(r.billing_mode)}', '${this.esc(r.purpose || '')}')">分配 Key</button>
                        <button class="btn btn-sm btn-danger" onclick="App.rejectKeyRequest('${this.esc(r.id)}', '${this.esc(r.name)}', '${this.esc(r.display_name || r.username)}')">拒绝</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            // 静默处理，不影响主页面
        }
    },

    async loadApiKeys() {
        try {
            this._selectedApiKeyIds = new Set();
            this.updateBatchDeleteApiKeysBtn();
            const res = await this.api('GET', '/api/admin/api-keys');
            const tbody = document.getElementById('apikeyBody');
            const pagination = document.getElementById('apiKeyPagination');
            const list = res.keys || res || [];
            this._apiKeyList = list;
            if (Array.isArray(list) && list.length > 0) {
                const total = list.length;
                const totalPages = Math.max(1, Math.ceil(total / this._apiKeyPageSize));
                if (this._apiKeyPage > totalPages) this._apiKeyPage = totalPages;
                const start = (this._apiKeyPage - 1) * this._apiKeyPageSize;
                const end = Math.min(start + this._apiKeyPageSize, total);
                const pageList = list.slice(start, end);

                tbody.innerHTML = pageList.map((k, idx) => {
                    const realIdx = start + idx;
                    const isZeroDate = k.expires_at && (k.expires_at.startsWith('0001-') || k.expires_at.startsWith('1-'));
                    const expiresText = k.expires_at && !isZeroDate ? this.formatDate(k.expires_at) : '永久';
                    const isExpired = k.expires_at && !isZeroDate && new Date(k.expires_at) < new Date();
                    const statusBadge = isExpired
                        ? '<span class="badge badge-danger">已过期</span>'
                        : `<span class="badge ${k.is_active !== false ? 'badge-success' : 'badge-danger'}">${k.is_active !== false ? '启用' : '禁用'}</span>`;
                    const fullKey = k.key || '';
                    const prefixEnd = fullKey.indexOf('-', fullKey.indexOf('-') + 1) + 1;
                    const keyPrefix = prefixEnd > 0 ? fullKey.substring(0, prefixEnd) : fullKey.substring(0, Math.min(8, fullKey.length));
                    return `<tr>
                        <td><input type="checkbox" class="apikey-checkbox" data-id="${this.esc(k.id || '')}" onchange="App.toggleApiKeySelection('${this.esc(k.id || '')}', this.checked)"></td>
                        <td><strong>${this.esc(k.name || '')}</strong></td>
                        <td>
                            <code style="color:var(--accent-green);font-size:11px;word-break:break-all" id="keyDisplay_${realIdx}">${this.esc(keyPrefix)}</code>
                            <button class="btn-icon" onclick="App.toggleKeyVisibility(${realIdx})" title="查看完整Key" style="margin-left:2px">👁️</button>
                            <button class="btn-icon" onclick="App.copyFullKey(${realIdx})" title="复制完整Key" style="margin-left:2px">📋</button>
                        </td>
                        <td>${k.portal_username ? this.esc(k.portal_username) : '<span class="text-muted">-</span>'}</td>
                        <td><span class="badge ${k.billing_mode==='per_token'?'badge-success':k.billing_mode==='per_request'?'badge-warning':k.billing_mode==='quota'?'badge-info':k.billing_mode==='coding_plan'?'badge-info':'badge-success'}" style="font-size:11px">${this.billingModeLabel(k.billing_mode)}</span></td>
                        <td>${k.rate_limit || '-'}</td>
                        <td style="font-size:12px">${this.formatQuotaInfo(k)}</td>
                        <td>
                            <span style="font-size:12px">${expiresText}</span>
                            <button class="btn-icon" onclick="App.showEditExpiryModal(${realIdx})" title="修改有效期" style="margin-left:2px">📅</button>
                        </td>
                        <td>${statusBadge}</td>
                        <td class="text-muted">${this.formatDate(k.created_at)}</td>
                        <td>
                            <button class="btn-icon" onclick="App.showViewApiKeyModal(${realIdx})" title="查看详情">📄</button>
                            <button class="btn-icon" onclick="App.showEditApiKeyModal(${realIdx})" title="修改">✏️</button>
                            <button class="btn-icon" onclick="App.toggleApiKey('${this.esc(k.id || '')}', ${k.is_active !== false})" title="${k.is_active !== false ? '禁用' : '启用'}">${k.is_active !== false ? '🔒' : '🔓'}</button>
                            <button class="btn-icon" onclick="App.resetQuota('${this.esc(k.id || '')}', '${this.esc(k.name || '')}')" title="重置配额">🔄</button>
                            <button class="btn-icon danger" onclick="App.confirmDeleteApiKey('${this.esc(k.id || '')}')" title="删除">🗑️</button>
                        </td>
                    </tr>`;
                }).join('');

                if (totalPages > 1) {
                    pagination.innerHTML = '<button class="btn btn-sm btn-outline" ' + (this._apiKeyPage <= 1 ? 'disabled' : 'onclick="App._apiKeyPage--;App.loadApiKeys()') + '">上一页</button>' +
                        '<span style="font-size:13px;color:var(--text-secondary);">第 ' + this._apiKeyPage + ' / ' + totalPages + ' 页 (共' + total + '个Key)</span>' +
                        '<button class="btn btn-sm btn-outline" ' + (this._apiKeyPage >= totalPages ? 'disabled' : 'onclick="App._apiKeyPage++;App.loadApiKeys()') + '">下一页</button>';
                } else {
                    pagination.innerHTML = '<span style="font-size:13px;color:var(--text-secondary);">共 ' + total + ' 个Key</span>';
                }
            } else {
                tbody.innerHTML = '<tr><td colspan="11" class="table-empty"><div class="empty-icon">🔑</div>暂无 API Key，请点击"创建 API Key"按钮</td></tr>';
                if (pagination) pagination.innerHTML = '';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) document.getElementById('apikeyBody').innerHTML = '<tr><td colspan="11" class="table-empty text-danger">加载失败: ' + this.esc(e.message) + '</td></tr>';
        }
    },

    _keyVisible: {},
    toggleKeyVisibility(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const el = document.getElementById('keyDisplay_' + idx);
        if (!el) return;
        const fullKey = k.key || '';
        const prefixEnd = fullKey.indexOf('-', fullKey.indexOf('-') + 1) + 1;
        const keyPrefix = prefixEnd > 0 ? fullKey.substring(0, prefixEnd) : fullKey.substring(0, Math.min(8, fullKey.length));
        const state = this._keyVisible[idx] || 0;
        if (state === 0) {
            el.textContent = keyPrefix + '****';
            this._keyVisible[idx] = 1;
        } else if (state === 1) {
            el.textContent = fullKey;
            this._keyVisible[idx] = 2;
        } else {
            el.textContent = keyPrefix;
            this._keyVisible[idx] = 0;
        }
    },

    // 复制完整 Key
    copyFullKey(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const text = k.key || '';
        navigator.clipboard.writeText(text).then(() => this.showToast('API Key 已复制', 'success')).catch(() => this.showToast('复制失败', 'error'));
    },

    // 修改有效期模态框
    showEditExpiryModal(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const currentExpiry = k.expires_at ? k.expires_at.substring(0, 10) : '';
        this.showModal('修改有效期', `
            <form id="editExpiryForm">
                <div class="form-group"><label>当前有效期</label>
                    <div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;font-size:13px">
                        ${k.expires_at ? this.formatDate(k.expires_at) : '永久（无过期时间）'}
                    </div>
                </div>
                <div class="form-group"><label>设置方式</label>
                    <select class="form-control" id="eeMode" onchange="document.getElementById('eeDateGroup').style.display=this.value==='date'?'block':'none';document.getElementById('eeDaysGroup').style.display=this.value==='days'?'block':'none'">
                        <option value="days">按天数</option>
                        <option value="date">指定日期</option>
                        <option value="permanent">永久</option>
                    </select>
                </div>
                <div class="form-group" id="eeDaysGroup">
                    <label>有效天数（从今天起）</label>
                    <input class="form-control" id="eeDays" type="number" value="30" min="1" placeholder="如 30">
                </div>
                <div class="form-group" id="eeDateGroup" style="display:none">
                    <label>过期日期</label>
                    <input class="form-control" id="eeDate" type="date" value="${currentExpiry}">
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '保存', class: 'btn-primary', action: () => this.submitEditExpiry(idx) }
        ]);
    },

    async submitEditExpiry(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const mode = document.getElementById('eeMode').value;
        let expiresAt = null;
        if (mode === 'days') {
            const days = parseInt(document.getElementById('eeDays').value) || 30;
            const d = new Date();
            d.setDate(d.getDate() + days);
            expiresAt = d.toISOString();
        } else if (mode === 'date') {
            const dateVal = document.getElementById('eeDate').value;
            if (!dateVal) { this.showToast('请选择日期', 'error'); return; }
            expiresAt = new Date(dateVal + 'T23:59:59').toISOString();
        }

        const body = {};
        if (mode === 'permanent') {
            body.clear_expiry = true;
        } else if (expiresAt) {
            body.expires_at = expiresAt;
        }

        try {
            await this.api('PUT', '/api/admin/api-keys/' + k.id, body);
            this.showToast('有效期已更新', 'success');
            this.closeModal();
            this.loadApiKeys();
        } catch (e) {
            this.showToast('更新失败: ' + e.message, 'error');
        }
    },

    async _ensureProviderList() {
        if (this._providerList && this._providerList.length > 0) return;
        try {
            const res = await this.api('GET', '/api/admin/providers');
            this._providerList = res.providers || res || [];
        } catch {}
    },

    _providerOptionsHtml(selectedValue) {
        const list = this._providerList || [];
        return list.map(p => {
            const name = p.name || p;
            const selected = name === selectedValue ? ' selected' : '';
            return `<option value="${this.esc(name)}"${selected}>${this.esc(name)}</option>`;
        }).join('') || '<option value="">暂无服务商</option>';
    },

    showViewApiKeyModal(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const fullKey = k.key || '';
        const prefixEnd = fullKey.indexOf('-', fullKey.indexOf('-') + 1) + 1;
        const keyPrefix = prefixEnd > 0 ? fullKey.substring(0, prefixEnd) : fullKey.substring(0, Math.min(8, fullKey.length));
        const requestUrl = window.location.origin + '/v1/chat/completions';
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const quotaResetTime = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0') + '-01 00:00:00';
        this.showModal('📋 API Key 详情 — ' + this.esc(k.name || ''), `
            <div style="font-size:13px;line-height:2">
                <div style="background:var(--bg-secondary);padding:16px;border-radius:8px;margin-bottom:16px">
                    <div><strong>🌐 请求地址</strong></div>
                    <code style="font-size:12px;word-break:break-all;color:var(--accent-blue)">${this.esc(requestUrl)}</code>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">将此地址配置为 OpenAI API 的请求地址</div>
                </div>
                <table style="width:100%;border-collapse:collapse">
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap;width:120px"><strong>客户端名称</strong></td>
                        <td style="padding:6px 12px">${this.esc(k.name || '-')}</td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>API Key</strong></td>
                        <td style="padding:6px 12px"><code id="viewKeyDisplay_${idx}" style="color:var(--accent-green);font-size:12px;word-break:break-all">${this.esc(keyPrefix)}</code> <button class="btn-icon" onclick="App.toggleViewKeyVisibility(${idx})" title="查看完整Key" style="margin-left:2px;font-size:14px">👁️</button> <button class="btn-icon" onclick="App.copyFullKey(${idx})" title="复制完整Key" style="font-size:14px">📋</button></td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>计费模式</strong></td>
                        <td style="padding:6px 12px"><span class="badge ${k.billing_mode==='per_token'?'badge-success':k.billing_mode==='per_request'?'badge-warning':k.billing_mode==='quota'?'badge-info':k.billing_mode==='coding_plan'?'badge-info':'badge-success'}" style="font-size:11px">${this.billingModeLabel(k.billing_mode)}</span></td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>限流</strong></td>
                        <td style="padding:6px 12px">${k.rate_limit || '不限'} 次/分钟</td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>状态</strong></td>
                        <td style="padding:6px 12px"><span class="badge ${k.is_active !== false ? 'badge-success' : 'badge-danger'}">${k.is_active !== false ? '启用' : '禁用'}</span></td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>下次配额重置</strong></td>
                        <td style="padding:6px 12px">${quotaResetTime}</td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>有效期</strong></td>
                        <td style="padding:6px 12px">${k.expires_at && !k.expires_at.startsWith('0001-') ? this.formatDate(k.expires_at) : '永久'}</td></tr>
                    <tr><td style="padding:6px 12px;color:var(--text-secondary);white-space:nowrap"><strong>创建时间</strong></td>
                        <td style="padding:6px 12px">${this.formatDate(k.created_at)}</td></tr>
                </table>
            </div>
        `, [
            { text: '关闭', class: 'btn-primary', action: () => this.closeModal() }
        ]);
    },

    toggleViewKeyVisibility(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const el = document.getElementById('viewKeyDisplay_' + idx);
        if (!el) return;
        const fullKey = k.key || '';
        const prefixEnd = fullKey.indexOf('-', fullKey.indexOf('-') + 1) + 1;
        const keyPrefix = prefixEnd > 0 ? fullKey.substring(0, prefixEnd) : fullKey.substring(0, Math.min(8, fullKey.length));
        if (!this._viewKeyVisible) this._viewKeyVisible = {};
        const state = this._viewKeyVisible[idx] || 0;
        if (state === 0) {
            el.textContent = fullKey;
            this._viewKeyVisible[idx] = 1;
        } else {
            el.textContent = keyPrefix;
            this._viewKeyVisible[idx] = 0;
        }
    },

    // 修改 API Key 模态框
    async showEditApiKeyModal(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        await this._ensureProviderList();
        if (!this._mappingList || this._mappingList.length === 0) {
            try {
                const data = await this.api('GET', '/api/admin/model-routes');
                this._mappingList = data.mappings || data || [];
            } catch {}
        }
        const currentAllowed = k.allowed_models || [];
        const mappingList = this._mappingList || [];
        const openaiMappings = mappingList.filter(m => m.api_format !== 'anthropic');
        const modelsCheckboxes = openaiMappings.map(m => {
            const checked = currentAllowed.length === 0 || currentAllowed.includes(m.client_model) ? 'checked' : '';
            return `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:13px;cursor:pointer">
                <input type="checkbox" class="ak-model-cb" value="${this.esc(m.client_model)}" ${checked}> ${this.esc(m.client_model)}
            </label>`;
        }).join('');
        this.showModal('修改 API Key', `
            <form id="editApiKeyForm">
                <div class="form-group"><label>名称 <span class="required">*</span></label>
                    <input class="form-control" id="eakName" value="${this.esc(k.name || '')}" required>
                </div>
                <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="eakClientIdFixed" ${k.client_id_fixed !== false ? 'checked' : ''} onchange="document.getElementById('eakPassthroughProviderGroup').style.display=this.checked?'none':'block';document.getElementById('akModelSection').style.display=this.checked?'block':'none'"> 固定客户端ID</label><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">关闭后，客户端请求的模型将直接发送给绑定的服务商（透传模式）</div></div>
                <div class="form-group" id="eakPassthroughProviderGroup" style="display:${k.client_id_fixed !== false ? 'none' : 'block'}"><label>绑定服务商 <span class="required">*</span></label>
                    <select class="form-control" id="eakPassthroughProvider">${this._providerOptionsHtml(k.client_id_fixed === false ? k.client_id : '')}</select>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">透传模式下，客户端请求的模型名将原样发送给此服务商</div>
                </div>
                <div class="form-group"><label>分配用户</label>
                    <div style="position:relative" id="eakPortalUserWrapper">
                        <input class="form-control" id="eakPortalUserSearch" type="text" placeholder="搜索用户名..." autocomplete="off" onfocus="App._showPortalUserDropdown()" oninput="App._filterPortalUserDropdown(this.value)">
                        <input type="hidden" id="eakPortalUserId" value="${k.portal_user_id || ''}">
                        <div id="eakPortalUserDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:1000;max-height:200px;overflow-y:auto;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15)"></div>
                    </div>
                    <div id="eakPortalUserBadge" style="margin-top:4px"></div>
                </div>
                <div class="form-group"><label>计费模式</label>
                    <select class="form-control" id="eakBilling" onchange="App._toggleEditBillingFields()">
                        <option value="per_token" ${k.billing_mode==='per_token'?'selected':''}>按 Token 计费</option>
                        <option value="per_request" ${k.billing_mode==='per_request'?'selected':''}>按请求计费</option>
                        <option value="quota" ${k.billing_mode==='quota'?'selected':''}>积分制</option>
                        <option value="coding_plan" ${k.billing_mode==='coding_plan'?'selected':''}>Coding Plan</option>
                    </select>
                </div>
                <div class="form-group"><label>速率限制 (请求/分钟)</label>
                    <input class="form-control" id="eakRateLimit" type="number" value="${k.rate_limit || 60}" min="1">
                </div>
                <div id="eakQuotaFields" style="display:${k.billing_mode==='per_token'||k.billing_mode==='per_request'||k.billing_mode==='coding_plan'?'block':'none'}">
                    <div class="form-group"><label>月度配额 (per_token: Token数, per_request: 请求次数)</label>
                        <input class="form-control" id="eakMonthlyQuota" type="number" value="${k.monthly_quota || 0}" min="0">
                    </div>
                </div>
                <div id="eakCreditsFields" style="display:${k.billing_mode==='quota'?'block':'none'}">
                    <div class="form-group"><label>积分余额 (quota模式)</label>
                        <input class="form-control" id="eakCredits" type="number" step="0.01" value="${k.credits_balance || 0}" min="0">
                    </div>
                </div>
                <div id="eakCodingPlanFields" style="display:${k.billing_mode==='coding_plan'?'block':'none'}">
                    <div class="form-row">
                        <div class="form-group"><label>5小时次数限制</label><input class="form-control" id="eakFiveHourLimit" type="number" value="${k.five_hour_limit || 0}" min="0" placeholder="0=不限"></div>
                        <div class="form-group"><label>周次数限制</label><input class="form-control" id="eakWeeklyLimit" type="number" value="${k.weekly_limit || 0}" min="0" placeholder="0=不限"></div>
                        <div class="form-group"><label>月次数限制</label><input class="form-control" id="eakMonthlyLimit" type="number" value="${k.monthly_limit || 0}" min="0" placeholder="0=不限"></div>
                    </div>
                </div>
                <div class="form-group" id="akModelSection" style="display:${k.client_id_fixed !== false ? 'block' : 'none'}"><label>允许的模型 <span style="font-weight:400;font-size:12px;color:var(--text-muted)">（不选=允许所有）</span></label>
                    <div style="display:flex;gap:8px;margin-bottom:6px">
                        <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.ak-model-cb').forEach(cb=>cb.checked=true)">全选</button>
                        <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.ak-model-cb').forEach(cb=>cb.checked=false)">全不选</button>
                    </div>
                    <div style="background:var(--bg-secondary);padding:10px;border-radius:6px;max-height:150px;overflow-y:auto">
                        ${modelsCheckboxes || '<span style="color:var(--text-muted)">暂无模型映射</span>'}
                    </div>
                </div>
                <div class="form-group"><label>状态</label>
                    <select class="form-control" id="eakActive">
                        <option value="true" ${k.is_active !== false ? 'selected' : ''}>启用</option>
                        <option value="false" ${k.is_active === false ? 'selected' : ''}>禁用</option>
                    </select>
                </div>
                <div class="form-group"><label>有效期</label>
                    <select class="form-control" id="eakExpiryMode" onchange="document.getElementById('eakExpiryDate').style.display=this.value==='date'?'block':'none'">
                        <option value="permanent">永久</option>
                        <option value="days30">30天</option>
                        <option value="days90">90天</option>
                        <option value="days365">365天</option>
                        <option value="date">自定义日期</option>
                    </select>
                    <input class="form-control" id="eakExpiryDate" type="date" style="display:none;margin-top:8px" value="">
                </div>
                <script>
                    (function() {
                        const exp = ${k.expires_at ? JSON.stringify(k.expires_at) : 'null'};
                        const isZero = exp && (exp.startsWith('0001-') || exp.startsWith('1-'));
                        const sel = document.getElementById('eakExpiryMode');
                        const dateInput = document.getElementById('eakExpiryDate');
                        if (!exp || isZero) {
                            sel.value = 'permanent';
                        } else {
                            sel.value = 'date';
                            dateInput.value = exp.substring(0, 10);
                            dateInput.style.display = 'block';
                        }
                        const currentUserId = ${k.portal_user_id ? JSON.stringify(k.portal_user_id) : '""'};
                        const currentUsername = ${k.portal_username ? JSON.stringify(k.portal_username) : '""'};
                        if (currentUserId && currentUsername) {
                            const searchInput = document.getElementById('eakPortalUserSearch');
                            const hiddenInput = document.getElementById('eakPortalUserId');
                            const badge = document.getElementById('eakPortalUserBadge');
                            searchInput.value = currentUsername;
                            hiddenInput.value = currentUserId;
                            badge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--accent-blue);color:#fff;border-radius:4px;font-size:12px">' + App.esc(currentUsername) + ' <button type="button" onclick="App._clearPortalUserSelection()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0 2px">&times;</button></span>';
                        }
                    })();
                </script>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '保存', class: 'btn-primary', action: () => this.submitEditApiKey(idx) }
        ]);
    },

    _portalUserCache: null,

    async _loadPortalUsers() {
        if (this._portalUserCache) return this._portalUserCache;
        try {
            const data = await this.api('GET', '/api/admin/portal-users?limit=500');
            this._portalUserCache = data.users || [];
        } catch (e) {
            this._portalUserCache = [];
        }
        return this._portalUserCache;
    },

    async _showPortalUserDropdown() {
        const dropdown = document.getElementById('eakPortalUserDropdown');
        if (!dropdown) return;
        const users = await this._loadPortalUsers();
        this._renderPortalUserDropdown(users, '');
        dropdown.style.display = 'block';
    },

    _filterPortalUserDropdown(query) {
        const users = this._portalUserCache || [];
        const filtered = query ? users.filter(u => u.username.toLowerCase().includes(query.toLowerCase()) || (u.display_name && u.display_name.toLowerCase().includes(query.toLowerCase()))) : users;
        this._renderPortalUserDropdown(filtered, query);
    },

    _renderPortalUserDropdown(users, query) {
        const dropdown = document.getElementById('eakPortalUserDropdown');
        if (!dropdown) return;
        const clearItem = `<div onclick="App._selectPortalUser('', '未分配')" style="padding:8px 12px;cursor:pointer;font-size:13px;color:var(--text-secondary);border-bottom:1px solid var(--border-color)">✕ 未分配（清除）</div>`;
        const items = users.slice(0, 50).map(u => `<div onclick="App._selectPortalUser('${this.esc(u.id)}', '${this.esc(u.username)}')" style="padding:8px 12px;cursor:pointer;font-size:13px">${this.esc(u.username)}${u.display_name ? ' <span style="color:var(--text-muted)">(' + this.esc(u.display_name) + ')</span>' : ''}</div>`).join('');
        dropdown.innerHTML = clearItem + (items || '<div style="padding:8px 12px;font-size:13px;color:var(--text-muted)">无匹配用户</div>');
    },

    _selectPortalUser(userId, username) {
        const searchInput = document.getElementById('eakPortalUserSearch');
        const hiddenInput = document.getElementById('eakPortalUserId');
        const badge = document.getElementById('eakPortalUserBadge');
        const dropdown = document.getElementById('eakPortalUserDropdown');
        if (!userId) {
            searchInput.value = '';
            hiddenInput.value = '';
            badge.innerHTML = '';
        } else {
            searchInput.value = username;
            hiddenInput.value = userId;
            badge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--accent-blue);color:#fff;border-radius:4px;font-size:12px">' + this.esc(username) + ' <button type="button" onclick="App._clearPortalUserSelection()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0 2px">&times;</button></span>';
        }
        if (dropdown) dropdown.style.display = 'none';
    },

    _clearPortalUserSelection() {
        this._selectPortalUser('', '');
    },

    _toggleEditBillingFields() {
        const mode = document.getElementById('eakBilling')?.value;
        const quotaFields = document.getElementById('eakQuotaFields');
        const creditsFields = document.getElementById('eakCreditsFields');
        const codingPlanFields = document.getElementById('eakCodingPlanFields');
        if (quotaFields) quotaFields.style.display = (mode === 'per_token' || mode === 'per_request' || mode === 'coding_plan') ? 'block' : 'none';
        if (creditsFields) creditsFields.style.display = mode === 'quota' ? 'block' : 'none';
        if (codingPlanFields) codingPlanFields.style.display = mode === 'coding_plan' ? 'block' : 'none';
    },

    async submitEditApiKey(idx) {
        const k = this._apiKeyList[idx];
        if (!k) return;
        const name = document.getElementById('eakName').value.trim();
        const clientIdFixed = document.getElementById('eakClientIdFixed').checked;
        const clientId = clientIdFixed ? name : (document.getElementById('eakPassthroughProvider')?.value || '');
        if (!name) { this.showToast('名称不能为空', 'error'); return; }
        if (!clientIdFixed && !clientId) { this.showToast('透传模式下请选择绑定服务商', 'error'); return; }

        const body = {
            name,
            client_id_fixed: clientIdFixed,
            billing_mode: document.getElementById('eakBilling').value,
            rate_limit: parseInt(document.getElementById('eakRateLimit').value) || 60,
            monthly_quota: parseInt(document.getElementById('eakMonthlyQuota').value) || 0,
            credits_balance: parseFloat(document.getElementById('eakCredits').value) || 0,
            is_active: document.getElementById('eakActive').value === 'true',
            allowed_models: clientIdFixed ? Array.from(document.querySelectorAll('.ak-model-cb:checked')).map(cb => cb.value) : [],
            portal_user_id: document.getElementById('eakPortalUserId')?.value || null,
            five_hour_limit: parseInt(document.getElementById('eakFiveHourLimit')?.value) || 0,
            weekly_limit: parseInt(document.getElementById('eakWeeklyLimit')?.value) || 0,
            monthly_limit: parseInt(document.getElementById('eakMonthlyLimit')?.value) || 0,
        };
        if (clientId) body.client_id = clientId;
        // 处理有效期
        const expiryMode = document.getElementById('eakExpiryMode').value;
        if (expiryMode === 'permanent') {
            body.clear_expiry = true;
        } else if (expiryMode === 'days30' || expiryMode === 'days90' || expiryMode === 'days365') {
            const days = {days30: 30, days90: 90, days365: 365}[expiryMode] || 30;
            const d = new Date(); d.setDate(d.getDate() + days);
            body.expires_at = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        } else if (expiryMode === 'date') {
            const dateVal = document.getElementById('eakExpiryDate').value;
            if (dateVal) { body.expires_at = dateVal; }
        }
        try {
            await this.api('PUT', '/api/admin/api-keys/' + k.id, body);
            this.showToast('API Key 已更新', 'success');
            this.closeModal();
            this.loadApiKeys();
        } catch (e) {
            this.showToast('更新失败: ' + e.message, 'error');
        }
    },

    async showAddApiKeyModal(keyRequestId, requestName, requestUser, requestBillingMode) {
        await this._ensureProviderList();
        const bindInfo = keyRequestId
            ? `<div class="form-group" style="background:rgba(79,195,247,0.1);padding:12px;border-radius:6px;border:1px solid rgba(79,195,247,0.3)">
                <label style="color:var(--accent-blue)">📌 绑定 Key 申请</label>
                <div style="font-size:13px;color:var(--text-secondary)">
                    <div>申请名称: <strong>${this.esc(requestName)}</strong></div>
                    <div>申请人: <strong>${this.esc(requestUser)}</strong></div>
                    <div>计费模式: ${this.billingModeLabel(requestBillingMode)}</div>
                </div>
                <input type="hidden" id="akKeyRequestId" value="${this.esc(keyRequestId)}">
               </div>`
            : '<input type="hidden" id="akKeyRequestId" value="">';
        const mappingList = this._mappingList || [];
        const openaiMappings = mappingList.filter(m => m.api_format !== 'anthropic');
        const modelsCheckboxes = openaiMappings.map(m => {
            return `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:13px;cursor:pointer">
                <input type="checkbox" class="ak-model-cb" value="${this.esc(m.client_model)}" checked> ${this.esc(m.client_model)}
            </label>`;
        }).join('');
        this.showModal('创建 API Key', `
            <form id="apikeyForm">
                ${bindInfo}
                <div class="form-group"><label>名称 <span class="required">*</span></label><input class="form-control" id="akName" placeholder="如: client-app-1" value="${this.esc(requestName || '')}" required></div>
                <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="akClientIdFixed" checked onchange="document.getElementById('akPassthroughProviderGroup').style.display=this.checked?'none':'block';document.getElementById('createAkModelSection').style.display=this.checked?'block':'none'"> 固定客户端ID</label><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">关闭后，客户端请求的模型将直接发送给绑定的服务商（透传模式）</div></div>
                <div class="form-group" id="akPassthroughProviderGroup" style="display:none"><label>绑定服务商 <span class="required">*</span></label>
                    <select class="form-control" id="akPassthroughProvider">${this._providerOptionsHtml('')}</select>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">透传模式下，客户端请求的模型名将原样发送给此服务商</div>
                </div>
                <div class="form-group"><label>Key 前缀</label><input class="form-control" id="akKeyPrefix" placeholder="如: sk-myapp-（留空则默认 sk-proj-）" style="font-family:monospace"></div>
                <div class="form-row">
                    <div class="form-group"><label>限流(次/分)</label><input class="form-control" id="akRateLimit" type="number" value="60"></div>
                    <div class="form-group"><label>有效期</label>
                        <select class="form-control" id="akExpires">
                            <option value="">永久</option>
                            <option value="7">7天</option>
                            <option value="30">30天</option>
                            <option value="90">90天</option>
                            <option value="365">1年</option>
                        </select>
                    </div>
                </div>
                <div class="form-group"><label>计费模式</label>
                    <select class="form-control" id="akBillingMode" onchange="App.toggleApiKeyBillingFields()">
                        <option value="per_token" ${requestBillingMode==='per_token'?'selected':''}>按 Token 计费</option>
                        <option value="per_request" ${requestBillingMode==='per_request'?'selected':''}>按请求计费</option>
                        <option value="quota" ${requestBillingMode==='quota'?'selected':''}>积分制</option>
                        <option value="token_plan" ${requestBillingMode==='token_plan'?'selected':''}>Token Plan</option>
                        <option value="coding_plan" ${requestBillingMode==='coding_plan'?'selected':''}>Coding Plan（请求次数制）</option>
                    </select>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>月度配额 (per_token:Token数, per_request:请求次数)</label><input class="form-control" id="akMonthlyQuota" type="number" value="0" placeholder="0=不限"></div>
                    <div class="form-group"><label>积分余额 (quota模式)</label><input class="form-control" id="akCreditsBalance" type="number" value="0" step="0.01" placeholder="积分制模式"></div>
                </div>
                <div id="akCodingPlanFields">
                    <div class="form-row">
                        <div class="form-group"><label>5小时次数限制</label><input class="form-control" id="akFiveHourLimit" type="number" value="0" placeholder="0=不限"></div>
                        <div class="form-group"><label>周次数限制</label><input class="form-control" id="akWeeklyLimit" type="number" value="0" placeholder="0=不限"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>月次数限制</label><input class="form-control" id="akMonthlyLimit" type="number" value="0" placeholder="0=不限"></div>
                    </div>
                </div>
                <div class="form-group" id="createAkModelSection"><label>允许的模型 <span style="font-weight:400;font-size:12px;color:var(--text-muted)">（不选=允许所有）</span></label>
                    <div style="display:flex;gap:8px;margin-bottom:6px">
                        <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.ak-model-cb').forEach(cb=>cb.checked=true)">全选</button>
                        <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.ak-model-cb').forEach(cb=>cb.checked=false)">全不选</button>
                    </div>
                    <div style="background:var(--bg-secondary);padding:10px;border-radius:6px;max-height:150px;overflow-y:auto">
                        ${modelsCheckboxes || '<span style="color:var(--text-muted)">暂无模型映射</span>'}
                    </div>
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.submitApiKey() }
        ]);
    },

    showBindRequestModal(requestId, requestName, requestUser, requestBillingMode, requestPurpose) {
        this.showModal('分配 Key 给申请', `
            <div style="background:rgba(79,195,247,0.1);padding:16px;border-radius:6px;border:1px solid rgba(79,195,247,0.3);margin-bottom:16px">
                <h4 style="color:var(--accent-blue);margin-bottom:8px">📌 申请信息</h4>
                <div style="font-size:13px;color:var(--text-secondary)">
                    <div>申请名称: <strong>${this.esc(requestName)}</strong></div>
                    <div>申请人: <strong>${this.esc(requestUser)}</strong></div>
                    <div>计费模式: ${this.billingModeLabel(requestBillingMode)}</div>
                    ${requestPurpose ? `<div>用途: ${this.esc(requestPurpose)}</div>` : ''}
                </div>
            </div>
            <p style="font-size:13px;color:var(--text-muted)">点击"创建并绑定"将为此申请创建一个 API Key 并自动绑定到申请人。</p>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建并绑定', class: 'btn-primary', action: () => { this.closeModal(); this.showAddApiKeyModal(requestId, requestName, requestUser, requestBillingMode); } }
        ]);
    },

    rejectKeyRequest(requestId, requestName, requestUser) {
        this.showModal('拒绝 Key 申请', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要拒绝来自 <strong>${this.esc(requestUser)}</strong> 的申请 <strong>${this.esc(requestName)}</strong> 吗？</div>
            </div>
            <div class="form-group" style="margin-top:16px">
                <label>拒绝原因（可选）</label>
                <textarea id="rejectNote" class="form-control" rows="3" placeholder="告知申请人拒绝的原因"></textarea>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '确认拒绝', class: 'btn-danger', action: () => this.doRejectKeyRequest(requestId) }
        ]);
    },

    async doRejectKeyRequest(requestId) {
        const note = document.getElementById('rejectNote')?.value?.trim() || '';
        try {
            await this.api('PUT', `/api/admin/key-requests/${requestId}/reject`, { admin_note: note });
            this.closeModal();
            this.showToast('已拒绝该申请', 'success');
            this.loadKeyRequests();
        } catch (e) {
            this.showToast('操作失败: ' + e.message, 'error');
        }
    },

    toggleApiKeyBillingFields() {
        const mode = document.getElementById('akBillingMode')?.value;
        const fields = document.getElementById('akCodingPlanFields');
        if (fields) fields.style.display = mode === 'coding_plan' ? 'block' : 'none';
    },

    async submitApiKey() {
        const name = document.getElementById('akName').value.trim();
        const clientIdFixed = document.getElementById('akClientIdFixed').checked;
        const clientId = clientIdFixed ? name : (document.getElementById('akPassthroughProvider')?.value || '');
        const keyPrefix = document.getElementById('akKeyPrefix')?.value?.trim() || '';
        const rateLimit = parseInt(document.getElementById('akRateLimit').value) || 60;
        const billingMode = document.getElementById('akBillingMode')?.value || 'per_token';
        const monthlyQuota = parseInt(document.getElementById('akMonthlyQuota')?.value) || 0;
        const creditsBalance = parseFloat(document.getElementById('akCreditsBalance')?.value) || 0;
        const expiresDays = document.getElementById('akExpires')?.value;
        const fiveHourLimit = parseInt(document.getElementById('akFiveHourLimit')?.value) || 0;
        const weeklyLimit = parseInt(document.getElementById('akWeeklyLimit')?.value) || 0;
        const monthlyLimit = parseInt(document.getElementById('akMonthlyLimit')?.value) || 0;

        if (!name) { this.showToast('名称不能为空', 'error'); return; }
        if (clientIdFixed && !clientId) { this.showToast('固定客户端ID模式下客户端ID不能为空', 'error'); return; }
        if (!clientIdFixed && !clientId) { this.showToast('透传模式下请选择绑定服务商', 'error'); return; }

        const body = { name, client_id_fixed: clientIdFixed, rate_limit: rateLimit, billing_mode: billingMode, monthly_quota: monthlyQuota, credits_balance: creditsBalance, five_hour_limit: fiveHourLimit, weekly_limit: weeklyLimit, monthly_limit: monthlyLimit, allowed_models: clientIdFixed ? Array.from(document.querySelectorAll('.ak-model-cb:checked')).map(cb => cb.value) : [] };
        if (clientId) body.client_id = clientId;
        if (keyPrefix) body.key_prefix = keyPrefix;
        if (expiresDays) {
            const d = new Date();
            d.setDate(d.getDate() + parseInt(expiresDays));
            body.expires_at = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
        // 绑定Key请求
        const keyRequestId = document.getElementById('akKeyRequestId')?.value;
        if (keyRequestId) body.key_request_id = keyRequestId;

        try {
            const res = await this.api('POST', '/api/admin/api-keys', body);
            this.closeModal();
            // 显示创建的Key
            const key = res.key || res.api_key || '';
            const bindMsg = keyRequestId ? '<div style="color:var(--accent-green);margin-bottom:12px">✅ 已自动绑定到申请并分配给用户</div>' : '';
            if (key) {
                this.showModal('API Key 创建成功', `
                    ${bindMsg}
                    <div class="key-display">${this.esc(key)}</div>
                    <div class="key-warning">⚠️ 请立即复制并保存此 Key，关闭后将无法再次查看完整内容</div>
                `, [
                    { text: '复制 Key', class: 'btn-primary', action: () => {
                        navigator.clipboard.writeText(key).then(() => this.showToast('已复制到剪贴板', 'success'));
                    }},
                    { text: '确定', class: 'btn-outline', action: () => { this.closeModal(); this.loadApiKeys(); this.loadKeyRequests(); }}
                ]);
            } else {
                this.showToast('API Key 创建成功', 'success');
                this.loadApiKeys();
            }
        } catch (e) {
            this.showToast('创建失败: ' + e.message, 'error');
        }
    },

    async toggleApiKey(id, isActive) {
        try {
            await this.api('PUT', '/api/admin/api-keys/' + id, { is_active: !isActive });
            this.showToast(isActive ? 'API Key 已禁用' : 'API Key 已启用', 'success');
            this.loadApiKeys();
        } catch (e) {
            this.showToast('操作失败: ' + e.message, 'error');
        }
    },

    toggleSelectAllApiKeys(checked) {
        this._selectedApiKeyIds = new Set();
        document.querySelectorAll('.apikey-checkbox').forEach(cb => {
            cb.checked = checked;
            if (checked) this._selectedApiKeyIds.add(cb.dataset.id);
        });
        this.updateBatchDeleteApiKeysBtn();
    },

    toggleApiKeySelection(id, checked) {
        if (checked) { this._selectedApiKeyIds.add(id); } else { this._selectedApiKeyIds.delete(id); }
        const allCbs = document.querySelectorAll('.apikey-checkbox');
        const selectAll = document.getElementById('selectAllApiKeys');
        if (selectAll) selectAll.checked = allCbs.length > 0 && Array.from(allCbs).every(cb => cb.checked);
        this.updateBatchDeleteApiKeysBtn();
    },

    updateBatchDeleteApiKeysBtn() {
        const btn = document.getElementById('batchDeleteApiKeysBtn');
        if (btn) {
            const count = this._selectedApiKeyIds ? this._selectedApiKeyIds.size : 0;
            btn.style.display = count > 0 ? '' : 'none';
            btn.textContent = '🗑️ 删除选中 (' + count + ')';
        }
    },

    async batchDeleteApiKeys() {
        const ids = Array.from(this._selectedApiKeyIds);
        if (ids.length === 0) return;
        this.showModal('确认批量删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除选中的 ${ids.length} 个 API Key 吗？</div>
                <div class="confirm-sub">使用这些 Key 的客户端将无法继续访问</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: async () => {
                try {
                    const res = await this.api('POST', '/api/admin/api-keys/batch-delete', { ids });
                    const msg = res.failed > 0 ? `已删除 ${res.deleted || 0} 个 API Key，${res.failed} 个删除失败` : `已删除 ${res.deleted || 0} 个 API Key`;
                    this.showToast(msg, res.failed > 0 ? 'error' : 'success');
                    this._selectedApiKeyIds.clear();
                    this.closeModal();
                    this.loadApiKeys();
                } catch (err) { this.showToast('批量删除失败: ' + err.message, 'error'); }
            }}
        ]);
    },

    confirmDeleteApiKey(id) {
        this.showModal('确认删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除此 API Key 吗？</div>
                <div class="confirm-sub">使用此 Key 的客户端将无法继续访问</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: async () => {
                try {
                    await this.api('DELETE', '/api/admin/api-keys/' + id);
                    this.showToast('API Key 已删除', 'success');
                    this.closeModal();
                    this.loadApiKeys();
                } catch (e) { this.showToast('删除失败: ' + e.message, 'error'); }
            }}
        ]);
    },

    // ========== 模型映射页面 ==========
    async renderMappings() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>🔄 模型映射</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>映射列表</h3>
                    <button class="btn btn-primary" onclick="App.showAddMappingModal()">+ 添加映射</button>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>客户端模型</th><th>服务商</th><th>服务商模型</th><th>服务商模型格式</th><th>操作</th></tr></thead>
                        <tbody id="mappingBody"><tr><td colspan="5" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadMappings();
    },

    async loadMappings() {
        try {
            const res = await this.api('GET', '/api/admin/model-routes');
            const tbody = document.getElementById('mappingBody');
            const list = res.mappings || res || [];
            if (Array.isArray(list) && list.length > 0) {
                // 缓存映射数据，供编辑时引用
                this._mappingList = list;
                tbody.innerHTML = list.map((m, idx) => {
                    const providerFmtLabel = m.provider_api_format ? (m.provider_api_format === 'openai' ? '🟢 OpenAI' : m.provider_api_format === 'anthropic' ? '🟠 Anthropic' : m.provider_api_format) : '🟢 OpenAI';
                    return `<tr>
                        <td><code style="color:var(--accent-blue)">${this.esc(m.client_model || '')}</code></td>
                        <td><span class="badge badge-info">${this.esc(m.provider || '')}</span></td>
                        <td><code style="color:var(--accent-green)">${this.esc(m.target_model || '')}</code></td>
                        <td>${providerFmtLabel}</td>
                        <td>
                            <button class="btn-icon" onclick="App.showMappingRef(${idx})" title="配置参考">📋</button>
                            <button class="btn-icon" onclick="App.showEditMappingModal(${idx})" title="修改">✏️</button>
                            <button class="btn-icon danger" onclick="App.confirmDeleteMapping('${this.esc(m.client_model || '')}')" title="删除">🗑️</button>
                        </td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="table-empty"><div class="empty-icon">🔄</div>暂无模型映射，请点击"添加映射"按钮</td></tr>';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) document.getElementById('mappingBody').innerHTML = '<tr><td colspan="5" class="table-empty text-danger">加载失败: ' + this.esc(e.message) + '</td></tr>';
        }
    },

    async showAddMappingModal() {
        this.showModal('添加模型映射', `
            <form id="mappingForm">
                <div class="form-group"><label>客户端模型名称 <span class="required">*</span></label><input class="form-control" id="mClient" placeholder="如: my-gpt4（客户端请求时使用的模型名）" required></div>
                <div class="form-group"><label>服务商 <span class="required">*</span></label>
                    <select class="form-control" id="mProvider"><option value="">加载中...</option></select>
                </div>
                <div class="form-group"><label>服务商模型 <span class="required">*</span></label><input class="form-control" id="mTarget" placeholder="如: gpt-4o（服务商实际的模型名）" required></div>
                <div class="form-hint" style="margin-top:8px">创建时将自动生成 OpenAI 和 Anthropic 两种 API 格式的映射</div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.submitMapping() }
        ]);
        await this.loadProviderOptions('mProvider');
    },

    async submitMapping() {
        const clientModel = document.getElementById('mClient').value.trim();
        const provider = document.getElementById('mProvider').value;
        const targetModel = document.getElementById('mTarget').value.trim();
        if (!clientModel || !targetModel) { this.showToast('请填写完整信息', 'error'); return; }

        try {
            await this.api('POST', '/api/admin/model-routes', {
                client_model: clientModel, provider, target_model: targetModel
            });
            this.showToast('映射已创建（OpenAI + Anthropic）', 'success');
            this.closeModal();
            this.loadMappings();
        } catch (e) {
            this.showToast('创建失败: ' + e.message, 'error');
        }
    },

    // 显示映射配置参考
    async showMappingRef(idx) {
        const m = this._mappingList[idx];
        if (!m) { this.showToast('映射数据不存在', 'error'); return; }

        const clientModel = (m.client_model || '').replace('@anthropic', '');
        const targetModel = m.target_model || '';
        const gatewayBase = window.location.origin;

        const chatCurl = `curl -X POST "${gatewayBase}/v1/chat/completions" \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify({ model: clientModel, max_tokens: 1024, messages: [{ role: "user", content: "你好" }] })}'`;

        const responsesCurl = `curl -X POST "${gatewayBase}/v1/responses" \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify({ model: clientModel, input: "你好" })}'`;

        const anthropicCurl = `curl -X POST "${gatewayBase}/anthropic" \\
  -H "x-api-key: YOUR_GATEWAY_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify({ model: clientModel, max_tokens: 1024, messages: [{ role: "user", content: "你好" }] })}'`;

        this.showModal('📋 配置参考 — ' + this.esc(clientModel), `
            <div style="max-height:70vh;overflow-y:auto">
                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px">📌 映射关系</label>
                    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;font-size:13px">
                        <div style="display:grid;grid-template-columns:100px 1fr;gap:6px 12px">
                            <span style="color:var(--text-secondary)">客户端模型</span><code style="color:var(--accent-blue)">${this.esc(clientModel)}</code>
                            <span style="color:var(--text-secondary)">服务商</span><span>${this.esc(m.provider || '')}</span>
                            <span style="color:var(--text-secondary)">服务商模型</span><code style="color:var(--accent-green)">${this.esc(targetModel)}</code>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px">🌐 请求地址</label>
                    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;font-size:13px">
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                            <span class="badge badge-info" style="width:90px;text-align:center">Chat</span>
                            <code style="flex:1;word-break:break-all">${gatewayBase}/v1/chat/completions</code>
                            <button class="btn-icon" onclick="App.copyText('${gatewayBase}/v1/chat/completions')" title="复制">📋</button>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                            <span class="badge badge-success" style="width:90px;text-align:center">Responses</span>
                            <code style="flex:1;word-break:break-all">${gatewayBase}/v1/responses</code>
                            <button class="btn-icon" onclick="App.copyText('${gatewayBase}/v1/responses')" title="复制">📋</button>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px">
                            <span class="badge badge-warning" style="width:90px;text-align:center">Anthropic</span>
                            <code style="flex:1;word-break:break-all">${gatewayBase}/anthropic</code>
                            <button class="btn-icon" onclick="App.copyText('${gatewayBase}/anthropic')" title="复制">📋</button>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px">📝 客户端模型名称</label>
                    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;font-size:13px">
                        <div style="display:flex;align-items:center;gap:6px">
                            <code style="color:var(--accent-blue);font-size:15px;font-weight:600">${this.esc(clientModel)}</code>
                            <button class="btn-icon" onclick="App.copyText('${this.esc(clientModel)}')" title="复制">📋</button>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px">📋 cURL 示例</label>
                    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;font-size:13px">
                        <div style="margin-bottom:12px">
                            <div style="color:var(--text-secondary);font-size:12px;margin-bottom:4px">Chat Completions (OpenAI 兼容)</div>
                            <pre style="background:var(--bg-primary);border-radius:6px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">${this.esc(chatCurl)}</pre>
                            <button class="btn btn-sm btn-outline" onclick="App.copyText(App._lastChatCurl)" style="margin-top:4px">📋 复制</button>
                        </div>
                        <div style="margin-bottom:12px">
                            <div style="color:var(--text-secondary);font-size:12px;margin-bottom:4px">Responses API (Codex 等 IDE)</div>
                            <pre style="background:var(--bg-primary);border-radius:6px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">${this.esc(responsesCurl)}</pre>
                            <button class="btn btn-sm btn-outline" onclick="App.copyText(App._lastResponsesCurl)" style="margin-top:4px">📋 复制</button>
                        </div>
                        <div>
                            <div style="color:var(--text-secondary);font-size:12px;margin-bottom:4px">Anthropic Messages (Claude Code 等)</div>
                            <pre style="background:var(--bg-primary);border-radius:6px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">${this.esc(anthropicCurl)}</pre>
                            <button class="btn btn-sm btn-outline" onclick="App.copyText(App._lastAnthropicCurl)" style="margin-top:4px">📋 复制</button>
                        </div>
                    </div>
                </div>
            </div>
        `, [{ text: '关闭', class: 'btn-outline', action: () => this.closeModal() }]);

        this._lastChatCurl = chatCurl;
        this._lastResponsesCurl = responsesCurl;
        this._lastAnthropicCurl = anthropicCurl;
    },

    // 通用文本复制
    copyText(text) {
        navigator.clipboard.writeText(text).then(() => this.showToast('已复制', 'success')).catch(() => this.showToast('复制失败', 'error'));
    },

    async showEditMappingModal(idx) {
        const m = this._mappingList[idx];
        if (!m) { this.showToast('映射数据不存在', 'error'); return; }
        this.showModal('修改模型映射', `
            <form id="editMappingForm">
                <div class="form-group"><label>客户端模型名称</label><input class="form-control" id="emClient" value="${this.esc(m.client_model || '')}" disabled></div>
                <div class="form-group"><label>服务商 <span class="required">*</span></label>
                    <select class="form-control" id="emProvider"><option value="">加载中...</option></select>
                </div>
                <div class="form-group"><label>服务商模型 <span class="required">*</span></label><input class="form-control" id="emTarget" value="${this.esc(m.target_model || '')}" required></div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '保存', class: 'btn-primary', action: () => this.submitEditMapping(m.client_model) }
        ]);
        await this.loadProviderOptions('emProvider');
        const sel = document.getElementById('emProvider');
        if (sel && m.provider) {
            sel.value = m.provider;
        }
    },

    async submitEditMapping(clientModel) {
        const provider = document.getElementById('emProvider').value;
        const targetModel = document.getElementById('emTarget').value.trim();
        if (!targetModel) { this.showToast('请填写服务商模型', 'error'); return; }

        const body = {};
        if (provider) body.provider = provider;
        if (targetModel) body.target_model = targetModel;

        try {
            await this.api('PUT', '/api/admin/model-routes/' + encodeURIComponent(clientModel), body);
            this.showToast('映射已更新', 'success');
            this.closeModal();
            this.loadMappings();
        } catch (e) {
            this.showToast('更新失败: ' + e.message, 'error');
        }
    },

    confirmDeleteMapping(clientModel) {
        this.showModal('确认删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除映射 "${this.esc(clientModel)}" 吗？</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: async () => {
                try {
                    await this.api('DELETE', '/api/admin/model-routes/' + encodeURIComponent(clientModel));
                    this.showToast('映射已删除', 'success');
                    this.closeModal();
                    this.loadMappings();
                } catch (e) { this.showToast('删除失败: ' + e.message, 'error'); }
            }}
        ]);
    },

    // ========== 价格管理页面 ==========
    async renderPricing() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>💰 价格管理</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>价格列表</h3>
                    <div class="table-actions">
                        <button class="btn btn-outline btn-sm" onclick="App.loadReferencePricing()">📊 价格参考</button>
                        <button class="btn btn-primary btn-sm" onclick="App.showAddPricingModal()">+ 添加价格</button>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>服务商</th><th>模型</th><th>输入价格</th><th>输出价格</th><th>每请求积分</th><th>月额度</th><th>月费</th><th>货币</th><th>操作</th></tr></thead>
                        <tbody id="pricingBody"><tr><td colspan="9" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadPricing();
    },

    async loadPricing() {
        try {
            const res = await this.api('GET', '/api/admin/pricing');
            const tbody = document.getElementById('pricingBody');
            const list = res.pricing || res || [];
            if (Array.isArray(list) && list.length > 0) {
                tbody.innerHTML = list.map(p => {
                    const cur = p.currency || 'USD';
                    const symbol = cur === 'CNY' ? '¥' : '$';
                    const isCNY = cur === 'CNY';
                    const inputUSD = isCNY ? (p.input_price / 7.25).toFixed(4) : p.input_price.toFixed(4);
                    const outputUSD = isCNY ? (p.output_price / 7.25).toFixed(4) : p.output_price.toFixed(4);
                    return `
                    <tr>
                        <td><span class="badge badge-info">${this.esc(p.provider || '')}</span></td>
                        <td>${this.esc(p.model || '')}</td>
                        <td>${symbol}${p.input_price.toFixed(4)}/1M${isCNY ? '<br><small style="color:var(--text-tertiary)">≈$'+inputUSD+'</small>' : ''}</td>
                        <td>${symbol}${p.output_price.toFixed(4)}/1M${isCNY ? '<br><small style="color:var(--text-tertiary)">≈$'+outputUSD+'</small>' : ''}</td>
                        <td>${p.credits_per_request > 0 ? p.credits_per_request : '-'}</td>
                        <td>${p.monthly_quota > 0 ? this.formatNumber(p.monthly_quota) : '-'}</td>
                        <td>${symbol}${(p.monthly_fee || 0).toFixed(2)}</td>
                        <td><span class="badge ${isCNY ? 'badge-warning' : 'badge-success'}">${this.esc(cur)}</span></td>
                        <td>
                            <button class="btn-icon" onclick="App.showEditPricingModal('${this.esc(p.provider || '')}','${this.esc(p.model || '')}')" title="编辑">✏️</button>
                            <button class="btn-icon danger" onclick="App.confirmDeletePricing('${this.esc(p.provider || '')}','${this.esc(p.model || '')}')" title="删除">🗑️</button>
                        </td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="empty-icon">💰</div>暂无价格配置</td></tr>';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) document.getElementById('pricingBody').innerHTML = '<tr><td colspan="9" class="table-empty text-danger">加载失败: ' + this.esc(e.message) + '</td></tr>';
        }
    },

    async loadReferencePricing() {
        this.showModal('📊 价格参考表', `
            <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">
                <button class="btn btn-primary btn-sm" id="fetchRefBtn" onclick="App.fetchReferencePricing()">🔄 从网上更新价格</button>
                <span style="color:var(--text-tertiary);font-size:12px;" id="refPricingStatus"></span>
            </div>
            <div style="margin-bottom:8px;display:flex;gap:8px;">
                <select class="form-control" id="refCategoryFilter" onchange="App.filterRefPricing()" style="width:auto;">
                    <option value="">全部</option>
                    <option value="international">国际模型 (USD)</option>
                    <option value="domestic">国产模型 (CNY)</option>
                </select>
            </div>
            <div style="max-height:500px;overflow-y:auto;">
                <table style="width:100%;">
                    <thead><tr><th>服务商</th><th>模型</th><th>输入价格</th><th>输出价格</th><th>货币</th><th>分类</th><th>操作</th></tr></thead>
                    <tbody id="refPricingBody"><tr><td colspan="7" class="table-empty">加载中...</td></tr></tbody>
                </table>
            </div>
        `, [
            { text: '关闭', class: 'btn-outline', action: () => this.closeModal() }
        ], 'large');
        await this._loadRefPricingData();
    },

    async _loadRefPricingData() {
        try {
            const res = await this.api('GET', '/api/admin/reference-pricing');
            const tbody = document.getElementById('refPricingBody');
            if (!tbody) return;
            this._refPricingData = res.pricing || [];
            this.filterRefPricing();
        } catch (e) {
            const tbody = document.getElementById('refPricingBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="table-empty text-danger">加载失败</td></tr>';
        }
    },

    filterRefPricing() {
        const filter = document.getElementById('refCategoryFilter')?.value || '';
        const tbody = document.getElementById('refPricingBody');
        if (!tbody || !this._refPricingData) return;
        let list = this._refPricingData;
        if (filter) list = list.filter(p => p.category === filter);
        if (list.length > 0) {
            tbody.innerHTML = list.map(p => {
                const symbol = p.currency === 'CNY' ? '¥' : '$';
                const isCNY = p.currency === 'CNY';
                const inputUSD = isCNY ? (p.input_price / 7.25).toFixed(4) : p.input_price.toFixed(4);
                const outputUSD = isCNY ? (p.output_price / 7.25).toFixed(4) : p.output_price.toFixed(4);
                return `
                <tr>
                    <td><span class="badge badge-info">${this.esc(p.provider)}</span></td>
                    <td>${this.esc(p.model)}</td>
                    <td>${symbol}${p.input_price.toFixed(4)}/1M${isCNY ? '<br><small style="color:var(--text-tertiary)">≈$'+inputUSD+'</small>' : ''}</td>
                    <td>${symbol}${p.output_price.toFixed(4)}/1M${isCNY ? '<br><small style="color:var(--text-tertiary)">≈$'+outputUSD+'</small>' : ''}</td>
                    <td><span class="badge ${isCNY ? 'badge-warning' : 'badge-success'}">${this.esc(p.currency)}</span></td>
                    <td><span class="badge ${p.category==='domestic'?'badge-warning':'badge-success'}">${p.category==='domestic'?'国产':'国际'}</span></td>
                    <td><button class="btn btn-sm btn-outline" onclick="App.applyRefPricing('${this.esc(p.provider)}','${this.esc(p.model)}',${p.input_price},${p.output_price},'${p.currency}','${p.category}')">采用</button></td>
                </tr>`;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="table-empty">暂无参考价格，请点击"从网上更新价格"</td></tr>';
        }
    },

    async fetchReferencePricing() {
        const btn = document.getElementById('fetchRefBtn');
        const status = document.getElementById('refPricingStatus');
        if (btn) btn.disabled = true;
        if (status) status.textContent = '正在更新...';
        try {
            const res = await this.api('POST', '/api/admin/reference-pricing/fetch');
            if (status) status.textContent = `已更新 ${res.total_count || 0} 个模型价格`;
            this.showToast(`已更新 ${res.international_count||0} 个国际模型 + ${res.domestic_count||0} 个国产模型价格`, 'success');
            await this._loadRefPricingData();
        } catch (e) {
            if (status) status.textContent = '更新失败';
            this.showToast('更新参考价格失败: ' + e.message, 'error');
        }
        if (btn) btn.disabled = false;
    },

    applyRefPricing(provider, model, inputPrice, outputPrice, currency, category) {
        this.closeModal();
        this.showAddPricingModal(provider, model, inputPrice, outputPrice, currency, category);
    },

    async showAddPricingModal(prefillProvider, prefillModel, prefillInput, prefillOutput, prefillCurrency, prefillCategory) {
        this.showModal('添加价格配置', `
            <form id="pricingForm">
                <div class="form-row">
                    <div class="form-group"><label>服务商 <span class="required">*</span></label>
                        <select class="form-control" id="prProvider"><option value="">加载中...</option></select>
                    </div>
                    <div class="form-group"><label>模型 <span class="required">*</span></label><input class="form-control" id="prModel" placeholder="如: gpt-4o" value="${this.esc(prefillModel || '')}" required></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>输入价格(/1M tokens)</label><input class="form-control" id="prInput" type="number" step="0.0001" value="${prefillInput != null ? prefillInput : 0.03}"></div>
                    <div class="form-group"><label>输出价格(/1M tokens)</label><input class="form-control" id="prOutput" type="number" step="0.0001" value="${prefillOutput != null ? prefillOutput : 0.06}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>每请求积分</label><input class="form-control" id="prCredits" type="number" step="1" value="0" placeholder="Token Plan 模式"></div>
                    <div class="form-group"><label>月请求额度</label><input class="form-control" id="prQuota" type="number" step="1" value="0" placeholder="Coding Plan 模式"></div>
                    <div class="form-group"><label>月费</label><input class="form-control" id="prFee" type="number" step="0.01" value="0" placeholder="Plan 月费"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>货币</label>
                        <select class="form-control" id="prCurrency" onchange="App._updatePriceLabel()">
                            <option value="USD" ${(!prefillCurrency||prefillCurrency==='USD')?'selected':''}>USD (美元)</option>
                            <option value="CNY" ${prefillCurrency==='CNY'?'selected':''}>CNY (人民币)</option>
                        </select>
                    </div>
                    <div class="form-group"><label>分类</label>
                        <select class="form-control" id="prCategory">
                            <option value="international" ${(!prefillCategory||prefillCategory==='international')?'selected':''}>国际模型</option>
                            <option value="domestic" ${prefillCategory==='domestic'?'selected':''}>国产模型</option>
                        </select>
                    </div>
                </div>
                <div id="priceConversionHint" style="margin-top:8px;padding:8px;background:var(--bg-tertiary);border-radius:6px;font-size:12px;color:var(--text-secondary);display:none;"></div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.submitPricing() }
        ]);
        await this.loadProviderOptions('prProvider');
        if (prefillProvider) {
            const sel = document.getElementById('prProvider');
            if (sel) { const opt = Array.from(sel.options).find(o => o.value === prefillProvider); if (opt) opt.selected = true; }
        }
        this._updatePriceLabel();
    },

    _updatePriceLabel() {
        const currency = document.getElementById('prCurrency')?.value || 'USD';
        const hint = document.getElementById('priceConversionHint');
        if (!hint) return;
        if (currency === 'CNY') {
            const inputPrice = parseFloat(document.getElementById('prInput')?.value) || 0;
            const outputPrice = parseFloat(document.getElementById('prOutput')?.value) || 0;
            hint.style.display = 'block';
            hint.innerHTML = `💡 人民币价格参考: 输入 ¥${inputPrice.toFixed(4)}/1M ≈ $${(inputPrice/7.25).toFixed(4)}/1M | 输出 ¥${outputPrice.toFixed(4)}/1M ≈ $${(outputPrice/7.25).toFixed(4)}/1M <br>系统内部计费统一使用USD，CNY价格会按汇率(1USD=7.25CNY)自动转换`;
        } else {
            hint.style.display = 'none';
        }
    },

    async showEditPricingModal(provider, model) {
        try {
            const res = await this.api('GET', '/api/admin/pricing');
            const list = res.pricing || res || [];
            const p = list.find(x => x.provider === provider && x.model === model);
            if (!p) { this.showToast('未找到价格配置', 'error'); return; }
            const cur = p.currency || 'USD';
            const symbol = cur === 'CNY' ? '¥' : '$';
            this.showModal('编辑价格 - ' + provider + '/' + model, `
                <form id="pricingForm">
                    <div class="form-row">
                        <div class="form-group"><label>服务商</label><input class="form-control" value="${this.esc(provider)}" readonly></div>
                        <div class="form-group"><label>模型</label><input class="form-control" value="${this.esc(model)}" readonly></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>输入价格(${symbol}/1M tokens)</label><input class="form-control" id="prInput" type="number" step="0.0001" value="${p.input_price || 0}"></div>
                        <div class="form-group"><label>输出价格(${symbol}/1M tokens)</label><input class="form-control" id="prOutput" type="number" step="0.0001" value="${p.output_price || 0}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>每请求积分</label><input class="form-control" id="prCredits" type="number" step="1" value="${p.credits_per_request || 0}"></div>
                        <div class="form-group"><label>月请求额度</label><input class="form-control" id="prQuota" type="number" step="1" value="${p.monthly_quota || 0}"></div>
                        <div class="form-group"><label>月费(${symbol})</label><input class="form-control" id="prFee" type="number" step="0.01" value="${p.monthly_fee || 0}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>货币</label>
                            <select class="form-control" id="prCurrency" onchange="App._updatePriceLabel()"><option value="USD" ${cur==='USD'?'selected':''}>USD (美元)</option><option value="CNY" ${cur==='CNY'?'selected':''}>CNY (人民币)</option></select>
                        </div>
                        <div class="form-group"><label>分类</label>
                            <select class="form-control" id="prCategory"><option value="international" ${(!p.category||p.category==='international')?'selected':''}>国际模型</option><option value="domestic" ${p.category==='domestic'?'selected':''}>国产模型</option></select>
                        </div>
                    </div>
                    <div id="priceConversionHint" style="margin-top:8px;padding:8px;background:var(--bg-tertiary);border-radius:6px;font-size:12px;color:var(--text-secondary);display:none;"></div>
                    <div style="margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;">
                        <div style="font-weight:600;margin-bottom:8px;color:var(--accent-blue);">Coding Plan 限制</div>
                        <div class="form-row">
                            <div class="form-group"><label>5小时次数限制</label><input class="form-control" id="prFiveHourLimit" type="number" value="${p.five_hour_limit || 0}"></div>
                            <div class="form-group"><label>周次数限制</label><input class="form-control" id="prWeeklyLimit" type="number" value="${p.weekly_limit || 0}"></div>
                            <div class="form-group"><label>总次数限制</label><input class="form-control" id="prTotalLimit" type="number" value="${p.total_limit || 0}"></div>
                        </div>
                    </div>
                </form>
            `, [
                { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
                { text: '保存', class: 'btn-primary', action: () => this.submitPricing(provider, model) }
            ]);
            this._updatePriceLabel();
        } catch (e) {
            if (!this._isCancelledError(e)) this.showToast('加载失败: ' + e.message, 'error');
        }
    },

    async submitPricing(existingProvider, existingModel) {
        const provider = document.getElementById('prProvider')?.value || existingProvider;
        const model = document.getElementById('prModel')?.value || existingModel;
        const inputPrice = parseFloat(document.getElementById('prInput').value) || 0;
        const outputPrice = parseFloat(document.getElementById('prOutput').value) || 0;
        const currency = document.getElementById('prCurrency').value;
        const category = document.getElementById('prCategory')?.value || 'international';
        const creditsPerRequest = parseFloat(document.getElementById('prCredits')?.value) || 0;
        const monthlyQuota = parseInt(document.getElementById('prQuota')?.value) || 0;
        const monthlyFee = parseFloat(document.getElementById('prFee')?.value) || 0;

        if (!provider || !model) { this.showToast('请填写完整信息', 'error'); return; }

        try {
            const body = { provider, model, input_price: inputPrice, output_price: outputPrice, currency, category, credits_per_request: creditsPerRequest, monthly_quota: monthlyQuota, monthly_fee: monthlyFee, five_hour_limit: parseInt(document.getElementById('prFiveHourLimit')?.value) || 0, weekly_limit: parseInt(document.getElementById('prWeeklyLimit')?.value) || 0, total_limit: parseInt(document.getElementById('prTotalLimit')?.value) || 0 };
            if (existingProvider && existingModel) {
                await this.api('PUT', '/api/admin/pricing/' + encodeURIComponent(existingProvider) + '/' + encodeURIComponent(existingModel), body);
                this.showToast('价格已更新', 'success');
            } else {
                await this.api('POST', '/api/admin/pricing', body);
                this.showToast('价格已创建', 'success');
            }
            this.closeModal();
            this.loadPricing();
        } catch (e) {
            this.showToast('操作失败: ' + e.message, 'error');
        }
    },

    confirmDeletePricing(provider, model) {
        this.showModal('确认删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除 ${this.esc(provider)}/${this.esc(model)} 的价格配置吗？</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: async () => {
                try {
                    await this.api('DELETE', '/api/admin/pricing/' + encodeURIComponent(provider) + '/' + encodeURIComponent(model));
                    this.showToast('价格配置已删除', 'success');
                    this.closeModal();
                    this.loadPricing();
                } catch (e) { this.showToast('删除失败: ' + e.message, 'error'); }
            }}
        ]);
    },

    // ========== 请求日志页面 ==========
    async renderLogs() {
        this.logOffset = 0;
        this.logStatusFilter = '';
        this.logKeyFilter = '';
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>📋 请求日志</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>日志列表</h3>
                    <div class="table-actions">
                        <div class="filter-bar">
                            <select id="logKeyFilter" onchange="App.filterLogs()">
                                <option value="">全部 Key</option>
                            </select>
                            <select id="logStatusFilter" onchange="App.filterLogs()">
                                <option value="">全部状态</option>
                                <option value="success">成功</option>
                                <option value="error">失败</option>
                            </select>
                            <button class="btn btn-outline btn-sm" onclick="App.loadLogs()">🔄 刷新</button>
                            <button class="btn btn-danger btn-sm" onclick="App.showClearLogsModal()">🗑️ 清空日志</button>
                        </div>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>请求ID</th><th>API Key</th><th>服务商</th><th>模型</th><th>计费模式</th><th>输入Token</th><th>输出Token</th><th>费用</th><th>延迟</th><th>状态</th><th>时间</th><th>详情</th></tr></thead>
                        <tbody id="logBody"><tr><td colspan="12" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
                <div class="pagination">
                    <div class="pagination-info" id="logInfo">第 1 页</div>
                    <div class="pagination-buttons">
                        <button class="page-btn" onclick="App.prevLogPage()">上一页</button>
                        <button class="page-btn" onclick="App.nextLogPage()">下一页</button>
                    </div>
                </div>
            </div>
        `;
        this.loadLogKeyOptions();
        await this.loadLogs();
    },

    async showLogDetail(requestId) {
        if (!requestId) { this.showToast('请求ID为空', 'error'); return; }
        try {
            const res = await this.api('GET', '/api/logs/' + encodeURIComponent(requestId));
            const reqBody = res.request_body ? this.esc(this.formatJSON(res.request_body)) : '（未记录）';
            const respBody = res.response_body ? this.esc(this.formatJSON(res.response_body)) : '（未记录）';
            const chatHtml = this.renderChatView(res);

            this.showModal('请求详情 - ' + requestId.substring(0, 8), `
                <div style="display:flex;gap:8px;margin-bottom:10px;font-size:12px;color:var(--text-secondary)">
                    <span>${this.esc(res.provider)} / ${this.esc(res.model)}</span>
                    <span>${res.status === 'success' ? '✅' : '❌'} ${res.status}</span>
                    <span>⏱ ${((res.latency_ms || 0) / 1000).toFixed(2)}s</span>
                    <span>💰 ${this.formatCost(res.cost || 0)}</span>
                    <span>📅 ${this.formatDate(res.created_at)}</span>
                </div>
                <div style="display:flex;gap:0;margin-bottom:10px;border:1px solid var(--border-color);border-radius:6px;overflow:hidden">
                    <button id="tabChat" onclick="App._switchLogTab('chat')" style="flex:1;padding:6px 12px;border:none;background:var(--accent-blue);color:#fff;cursor:pointer;font-size:13px;font-weight:500">💬 对话视图</button>
                    <button id="tabRaw" onclick="App._switchLogTab('raw')" style="flex:1;padding:6px 12px;border:none;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:13px;font-weight:500">📄 原文视图</button>
                </div>
                <div id="logTabChat" style="max-height:60vh;overflow-y:auto">
                    ${chatHtml}
                </div>
                <div id="logTabRaw" style="display:none;max-height:60vh;overflow-y:auto">
                    <div style="margin-bottom:12px">
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:12px;font-weight:600;color:#60b0f0">📤 请求体</span><button onclick="App.copyLogBody('logReqBody')" style="background:#eff1f3;border:1px solid #d0d7de;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;color:#6a737d;transition:background 0.2s" onmouseover="this.style.background='#d0d7de'" onmouseout="this.style.background='#eff1f3'">📋 复制</button></div>
                        <pre id="logReqBody" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px;font-size:11px;line-height:1.4;overflow:auto;max-height:25vh;margin:0;white-space:pre-wrap;word-break:break-all;color:#24292e">${reqBody}</pre>
                    </div>
                    <div>
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:12px;font-weight:600;color:#60d070">📥 响应体</span><button onclick="App.copyLogBody('logRespBody')" style="background:#eff1f3;border:1px solid #d0d7de;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;color:#6a737d;transition:background 0.2s" onmouseover="this.style.background='#d0d7de'" onmouseout="this.style.background='#eff1f3'">📋 复制</button></div>
                        <pre id="logRespBody" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px;font-size:11px;line-height:1.4;overflow:auto;max-height:25vh;margin:0;white-space:pre-wrap;word-break:break-all;color:#24292e">${respBody}</pre>
                    </div>
                </div>
                ${res.error_message ? `<div style="margin-top:8px;padding:8px;background:rgba(243,80,80,0.1);border-radius:6px;border:1px solid rgba(243,80,80,0.2);color:#f35050;font-size:12px">❌ ${this.esc(res.error_message)}</div>` : ''}
            `, [
                { text: '导出 Markdown', class: 'btn-outline', action: () => this.exportLogMarkdown(res) },
                { text: '删除', class: 'btn-danger', action: () => this.showDeleteLogModal(requestId) },
                { text: '关闭', class: 'btn-outline', action: () => this.closeModal() }
            ]);
        } catch (e) {
            if (!this._isCancelledError(e)) this.showToast('加载失败: ' + e.message, 'error');
        }
    },

    _switchLogTab(tab) {
        const chatEl = document.getElementById('logTabChat');
        const rawEl = document.getElementById('logTabRaw');
        const chatBtn = document.getElementById('tabChat');
        const rawBtn = document.getElementById('tabRaw');
        if (tab === 'chat') {
            chatEl.style.display = ''; rawEl.style.display = 'none';
            chatBtn.style.background = 'var(--accent-blue)'; chatBtn.style.color = '#fff';
            rawBtn.style.background = 'var(--bg-secondary)'; rawBtn.style.color = 'var(--text-primary)';
        } else {
            chatEl.style.display = 'none'; rawEl.style.display = '';
            rawBtn.style.background = 'var(--accent-blue)'; rawBtn.style.color = '#fff';
            chatBtn.style.background = 'var(--bg-secondary)'; chatBtn.style.color = 'var(--text-primary)';
        }
    },

    _parseStreamResponse(body) {
        if (!body || !body.includes('data: ')) return null;
        const lines = body.split('\n');
        let inputTokens = 0, outputTokens = 0;
        const contentParts = [];
        const toolCalls = {};
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') continue;
            try {
                const chunk = JSON.parse(dataStr);
                if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens || chunk.usage.input_tokens || inputTokens;
                    outputTokens = chunk.usage.completion_tokens || chunk.usage.output_tokens || outputTokens;
                }
                if (chunk.choices && chunk.choices[0]) {
                    const delta = chunk.choices[0].delta;
                    if (delta) {
                        if (delta.content) contentParts.push(delta.content);
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index || 0;
                                if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || '', name: '', arguments: '' };
                                if (tc.id) toolCalls[idx].id = tc.id;
                                if (tc.function) {
                                    if (tc.function.name) toolCalls[idx].name = tc.function.name;
                                    if (tc.function.arguments) toolCalls[idx].arguments += tc.function.arguments;
                                }
                            }
                        }
                    }
                    if (chunk.choices[0].message) {
                        const msg = chunk.choices[0].message;
                        if (msg.content && !contentParts.length) contentParts.push(msg.content);
                        if (msg.tool_calls) {
                            for (const tc of msg.tool_calls) {
                                const idx = tc.index || Object.keys(toolCalls).length;
                                toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: tc.function?.arguments || '' };
                            }
                        }
                    }
                }
                if (chunk.type === 'content_block_delta' && chunk.delta) {
                    if (chunk.delta.type === 'text_delta' && chunk.delta.text) contentParts.push(chunk.delta.text);
                }
                if (chunk.type === 'message_start' && chunk.message) {
                    if (chunk.message.usage) {
                        inputTokens = chunk.message.usage.input_tokens || inputTokens;
                    }
                }
                if (chunk.type === 'message_delta' && chunk.usage) {
                    outputTokens = chunk.usage.output_tokens || outputTokens;
                }
            } catch {}
        }
        if (contentParts.length === 0 && Object.keys(toolCalls).length === 0) return null;
        const result = { choices: [{ message: { role: 'assistant', content: contentParts.join('') } }] };
        if (Object.keys(toolCalls).length > 0) {
            result.choices[0].message.tool_calls = Object.values(toolCalls).map(tc => ({
                id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
            }));
        }
        result.usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens };
        return result;
    },

    renderChatView(res) {
        let reqObj = null, respObj = null;
        try { reqObj = typeof res.request_body === 'string' ? JSON.parse(res.request_body) : res.request_body; } catch {}
        try { respObj = typeof res.response_body === 'string' ? JSON.parse(res.response_body) : res.response_body; } catch {}
        if (!respObj && typeof res.response_body === 'string') {
            respObj = this._parseStreamResponse(res.response_body);
        }

        if (!reqObj && !respObj) {
            return '<div style="text-align:center;padding:40px;color:var(--text-secondary)">📋 对话内容未记录</div>';
        }

        const bubbles = [];

        if (reqObj) {
            if (reqObj.system && typeof reqObj.system === 'string') {
                bubbles.push({ role: 'system', content: reqObj.system });
            }
            if (reqObj.messages && Array.isArray(reqObj.messages)) {
                for (const msg of reqObj.messages) {
                    bubbles.push({ role: msg.role, content: msg.content, tool_calls: msg.tool_calls, tool_call_id: msg.tool_call_id, name: msg.name });
                }
            }
            if (reqObj.input && typeof reqObj.input === 'string') {
                bubbles.push({ role: 'user', content: reqObj.input });
            } else if (reqObj.input && Array.isArray(reqObj.input)) {
                for (const item of reqObj.input) {
                    if (typeof item === 'string') { bubbles.push({ role: 'user', content: item }); }
                    else if (item.role === 'system') { bubbles.push({ role: 'system', content: item.content || item.text || '' }); }
                    else if (item.type === 'message' && item.role) { bubbles.push({ role: item.role, content: item.content || '' }); }
                    else { bubbles.push({ role: 'user', content: JSON.stringify(item, null, 2) }); }
                }
            }
            if (!reqObj.messages && !reqObj.input && reqObj.prompt) {
                bubbles.push({ role: 'user', content: reqObj.prompt });
            }
        }

        if (respObj) {
            if (respObj.choices && Array.isArray(respObj.choices)) {
                for (const choice of respObj.choices) {
                    if (choice.message) {
                        bubbles.push({ role: choice.message.role || 'assistant', content: choice.message.content, tool_calls: choice.message.tool_calls });
                    } else if (choice.text) {
                        bubbles.push({ role: 'assistant', content: choice.text });
                    }
                }
            } else if (respObj.output) {
                const outputs = Array.isArray(respObj.output) ? respObj.output : [respObj.output];
                for (const item of outputs) {
                    if (item.type === 'message' && item.content) {
                        const texts = Array.isArray(item.content) ? item.content.filter(c => c.type === 'output_text').map(c => c.text).join('\n') : (typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2));
                        bubbles.push({ role: item.role || 'assistant', content: texts });
                    } else if (item.type === 'function_call') {
                        bubbles.push({ role: 'tool_call', content: item.name + '(' + (item.arguments || item.call_id || '') + ')' });
                    } else if (typeof item === 'string') {
                        bubbles.push({ role: 'assistant', content: item });
                    } else if (item.content) {
                        bubbles.push({ role: 'assistant', content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2) });
                    }
                }
            } else if (respObj.content && Array.isArray(respObj.content)) {
                for (const block of respObj.content) {
                    if (block.type === 'text') { bubbles.push({ role: 'assistant', content: block.text }); }
                    else if (block.type === 'tool_use') { bubbles.push({ role: 'tool_call', content: block.name + ': ' + JSON.stringify(block.input, null, 2) }); }
                    else { bubbles.push({ role: 'assistant', content: JSON.stringify(block, null, 2) }); }
                }
            } else if (respObj.response) {
                const r = respObj.response;
                if (r.output_text) { bubbles.push({ role: 'assistant', content: r.output_text }); }
                else if (r.content) { bubbles.push({ role: 'assistant', content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content, null, 2) }); }
            } else if (typeof respObj === 'string') {
                bubbles.push({ role: 'assistant', content: respObj });
            }
        }

        if (bubbles.length === 0) {
            return '<div style="text-align:center;padding:40px;color:var(--text-secondary)">📋 无法解析为对话格式，请查看原文视图</div>';
        }

        return bubbles.map(b => this._renderBubble(b)).join('');
    },

    _renderBubble(b) {
        const roleConfig = {
            system:     { icon: '⚙️', label: '系统', bg: '#2d2a1e', border: '#5c5332', color: '#f0d060', align: 'center' },
            user:       { icon: '👤', label: '用户', bg: '#1a2a3a', border: '#2a4a6a', color: '#60b0f0', align: 'flex-end' },
            assistant:  { icon: '🤖', label: '助手', bg: '#1a2a1e', border: '#2a5a32', color: '#60d070', align: 'flex-start' },
            tool:       { icon: '🔧', label: '工具结果', bg: '#2a1a2a', border: '#5a2a5a', color: '#c080d0', align: 'flex-start' },
            tool_call:  { icon: '📞', label: '工具调用', bg: '#2a1a1e', border: '#5a2a32', color: '#f08090', align: 'flex-start' },
            developer:  { icon: '💻', label: '开发者', bg: '#1e1a2a', border: '#3a2a5a', color: '#9080f0', align: 'center' },
            context:    { icon: '📎', label: '上下文', bg: '#2a2520', border: '#5a4a3a', color: '#c0a080', align: 'center' },
        };
        const cfg = roleConfig[b.role] || { icon: '❓', label: b.role, bg: '#222', border: '#444', color: '#aaa', align: 'flex-start' };
        const content = this._renderBubbleContent(b);
        const isWide = b.role === 'system' || b.role === 'developer' || b.role === 'context' || b.role === 'tool_call' || b.role === 'tool';
        return `<div style="display:flex;justify-content:${isWide ? 'center' : cfg.align};margin-bottom:10px">
            <div style="max-width:${isWide ? '100%' : '85%'};background:${cfg.bg};border:1px solid ${cfg.border};border-radius:10px;padding:10px 14px;position:relative">
                <div style="font-size:11px;font-weight:600;color:${cfg.color};margin-bottom:4px">${cfg.icon} ${cfg.label}${b.name ? ' · ' + this.esc(b.name) : ''}</div>
                <div style="font-size:13px;line-height:1.6;color:#d4d4d4;word-break:break-word">${content}</div>
            </div>
        </div>`;
    },

    _renderBubbleContent(b) {
        if (b.tool_calls && Array.isArray(b.tool_calls) && b.tool_calls.length > 0) {
            let html = b.tool_calls.map(tc => {
                const args = tc.function?.arguments || '';
                const name = tc.function?.name || tc.name || 'unknown';
                let parsed = args;
                try { parsed = JSON.stringify(JSON.parse(args), null, 2); } catch {}
                return `<div style="margin-bottom:6px;padding:6px 8px;background:rgba(255,255,255,0.06);border-radius:4px;font-size:12px"><strong style="color:#f08090">${this.esc(name)}</strong><pre style="margin:4px 0 0;white-space:pre-wrap;font-size:11px;color:#9a9a9a">${this.esc(parsed)}</pre></div>`;
            }).join('');
            if (b.content && b.content !== '' && b.content !== null) {
                html += `<div style="margin-top:6px">${this._renderTextContent(b.content)}</div>`;
            }
            return html;
        }
        if (b.tool_call_id) {
            let html = `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">ID: ${this.esc(b.tool_call_id)}</div>`;
            if (b.content !== null && b.content !== undefined && b.content !== '') {
                html += this._renderTextContent(b.content);
            }
            return html;
        }
        if (b.content === null || b.content === undefined) return '<span style="color:var(--text-secondary)">（空）</span>';
        return this._renderTextContent(b.content);
    },

    _renderTextContent(content) {
        if (content === null || content === undefined || content === '') return '<span style="color:var(--text-secondary)">（空）</span>';
        if (typeof content === 'string') {
            if (content.length > 5000) {
                return `<div class="collapsible-content"><div class="content-preview">${this.esc(content.substring(0, 3000))}<span style="color:#9a9a9a">... (共${content.length}字符)</span></div><div class="content-full" style="display:none">${this.esc(content)}</div><button onclick="this.previousElementSibling.style.display='none';this.previousElementSibling.previousElementSibling.style.display='none';this.nextElementSibling.style.display='';this.style.display='none'" style="color:#60b0f0;background:none;border:none;cursor:pointer;font-size:12px;padding:4px 0">展开全部</button><div style="display:none">${this.esc(content)}</div><button onclick="this.previousElementSibling.style.display='none';this.previousElementSibling.previousElementSibling.previousElementSibling.style.display='';this.previousElementSibling.previousElementSibling.style.display='';this.style.display='none'" style="color:#60b0f0;background:none;border:none;cursor:pointer;font-size:12px;padding:4px 0;display:none">收起</button></div>`;
            }
            return this.esc(content).replace(/\n/g, '<br>');
        }
        if (Array.isArray(content)) {
            const parts = content.map(c => {
                if (typeof c === 'string') return this.esc(c).replace(/\n/g, '<br>');
                if (!c || typeof c !== 'object') return '';
                if (c.type === 'text') return this.esc(c.text || '').replace(/\n/g, '<br>');
                if (c.type === 'image_url') return `<div style="padding:4px 8px;background:rgba(255,255,255,0.06);border-radius:4px;font-size:12px;color:#9a9a9a">🖼️ 图片: ${this.esc(c.image_url?.url?.substring(0, 80) || '(base64)')}</div>`;
                if (c.type === 'input_text' || c.type === 'output_text') return this.esc(c.text || '').replace(/\n/g, '<br>');
                if (c.type === 'tool_use') return `<div style="padding:4px 8px;background:rgba(255,255,255,0.06);border-radius:4px;font-size:12px;color:#9a9a9a">📞 ${this.esc(c.name || 'tool')}: <pre style="margin:2px 0 0;white-space:pre-wrap;font-size:11px;color:#9a9a9a">${this.esc(JSON.stringify(c.input || c.arguments || {}, null, 2))}</pre></div>`;
                if (c.type === 'tool_result') return this._renderTextContent(c.content);
                if (c.text) return this.esc(c.text).replace(/\n/g, '<br>');
                return '';
            }).filter(s => s !== '');
            return parts.length > 0 ? parts.join('') : '<span style="color:var(--text-secondary)">（空）</span>';
        }
        if (typeof content === 'object') {
            if (content.type === 'text' && content.text) return this.esc(content.text).replace(/\n/g, '<br>');
            if (content.type === 'tool_result') return this._renderTextContent(content.content);
            const str = JSON.stringify(content, null, 2);
            if (str === '{}') return '<span style="color:var(--text-secondary)">（空）</span>';
            return `<div style="padding:4px 8px;background:rgba(255,255,255,0.06);border-radius:4px;font-size:12px;color:#9a9a9a"><pre style="margin:0;white-space:pre-wrap;font-size:11px">${this.esc(str)}</pre></div>`;
        }
        return '<span style="color:var(--text-secondary)">（空）</span>';
    },

    exportLogMarkdown(res) {
        let reqObj = null, respObj = null;
        try { reqObj = typeof res.request_body === 'string' ? JSON.parse(res.request_body) : res.request_body; } catch {}
        try { respObj = typeof res.response_body === 'string' ? JSON.parse(res.response_body) : res.response_body; } catch {}

        const lines = [];
        lines.push(`# 对话记录`);
        lines.push('');
        lines.push(`- **服务商**: ${res.provider || ''}`);
        lines.push(`- **模型**: ${res.model || ''}`);
        lines.push(`- **状态**: ${res.status === 'success' ? '✅ 成功' : '❌ 失败'}`);
        lines.push(`- **延迟**: ${((res.latency_ms || 0) / 1000).toFixed(2)}s`);
        lines.push(`- **输入Token**: ${res.input_tokens || 0}`);
        lines.push(`- **输出Token**: ${res.output_tokens || 0}`);
        lines.push(`- **费用**: $${(res.cost || 0).toFixed(6)}`);
        lines.push(`- **时间**: ${this.formatDateTime(res.created_at)}`);
        if (res.error_message) lines.push(`- **错误**: ${res.error_message}`);
        lines.push('');
        lines.push('---');
        lines.push('');

        const bubbles = [];
        if (reqObj) {
            if (reqObj.system && typeof reqObj.system === 'string') {
                bubbles.push({ role: 'system', content: reqObj.system });
            }
            if (reqObj.messages && Array.isArray(reqObj.messages)) {
                for (const msg of reqObj.messages) {
                    bubbles.push({ role: msg.role, content: msg.content, tool_calls: msg.tool_calls, tool_call_id: msg.tool_call_id, name: msg.name });
                }
            }
            if (reqObj.input && typeof reqObj.input === 'string') {
                bubbles.push({ role: 'user', content: reqObj.input });
            } else if (reqObj.input && Array.isArray(reqObj.input)) {
                for (const item of reqObj.input) {
                    if (typeof item === 'string') { bubbles.push({ role: 'user', content: item }); }
                    else if (item.role === 'system') { bubbles.push({ role: 'system', content: item.content || item.text || '' }); }
                    else if (item.type === 'message' && item.role) { bubbles.push({ role: item.role, content: item.content || '' }); }
                    else { bubbles.push({ role: 'user', content: JSON.stringify(item, null, 2) }); }
                }
            }
            if (!reqObj.messages && !reqObj.input && reqObj.prompt) {
                bubbles.push({ role: 'user', content: reqObj.prompt });
            }
        }
        if (respObj) {
            if (respObj.choices && Array.isArray(respObj.choices)) {
                for (const choice of respObj.choices) {
                    if (choice.message) { bubbles.push({ role: choice.message.role || 'assistant', content: choice.message.content, tool_calls: choice.message.tool_calls }); }
                    else if (choice.text) { bubbles.push({ role: 'assistant', content: choice.text }); }
                }
            } else if (respObj.output) {
                const outputs = Array.isArray(respObj.output) ? respObj.output : [respObj.output];
                for (const item of outputs) {
                    if (item.type === 'message' && item.content) {
                        const texts = Array.isArray(item.content) ? item.content.filter(c => c.type === 'output_text').map(c => c.text).join('\n') : (typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2));
                        bubbles.push({ role: item.role || 'assistant', content: texts });
                    } else if (typeof item === 'string') { bubbles.push({ role: 'assistant', content: item }); }
                }
            } else if (respObj.content && Array.isArray(respObj.content)) {
                for (const block of respObj.content) {
                    if (block.type === 'text') { bubbles.push({ role: 'assistant', content: block.text }); }
                    else if (block.type === 'tool_use') { bubbles.push({ role: 'tool_call', content: block.name + ': ' + JSON.stringify(block.input, null, 2) }); }
                }
            } else if (respObj.response) {
                const r = respObj.response;
                if (r.output_text) { bubbles.push({ role: 'assistant', content: r.output_text }); }
                else if (r.content) { bubbles.push({ role: 'assistant', content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content, null, 2) }); }
            }
        }

        const roleLabel = { system: '⚙️ 系统', user: '👤 用户', assistant: '🤖 助手', tool: '🔧 工具结果', tool_call: '📞 工具调用', developer: '💻 开发者' };
        for (const b of bubbles) {
            const label = roleLabel[b.role] || b.role;
            lines.push(`### ${label}${b.name ? ' · ' + b.name : ''}`);
            lines.push('');
            if (b.tool_calls && Array.isArray(b.tool_calls)) {
                for (const tc of b.tool_calls) {
                    const name = tc.function?.name || tc.name || 'unknown';
                    const args = tc.function?.arguments || '';
                    let parsed = args;
                    try { parsed = JSON.stringify(JSON.parse(args), null, 2); } catch {}
                    lines.push(`**${name}**:`);
                    lines.push('```json');
                    lines.push(parsed);
                    lines.push('```');
                    lines.push('');
                }
                if (b.content) { lines.push(this._extractText(b.content)); lines.push(''); }
            } else if (b.tool_call_id) {
                lines.push(`*ID: ${b.tool_call_id}*`);
                lines.push('');
                lines.push(this._extractText(b.content));
                lines.push('');
            } else {
                lines.push(this._extractText(b.content));
                lines.push('');
            }
        }

        const md = lines.join('\n');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-${(res.request_id || 'unknown').substring(0, 8)}-${new Date().toISOString().slice(0, 10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('已导出 Markdown 文件', 'success');
    },

    _extractText(content) {
        if (content === null || content === undefined) return '（空）';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content.map(c => {
                if (typeof c === 'string') return c;
                if (c.type === 'text') return c.text || '';
                if (c.type === 'image_url') return `![图片](${c.image_url?.url || ''})`;
                if (c.type === 'input_text' || c.type === 'output_text') return c.text || '';
                return JSON.stringify(c, null, 2);
            }).join('\n');
        }
        return JSON.stringify(content, null, 2);
    },

    formatJSON(str) {
        try {
            return JSON.stringify(JSON.parse(str), null, 2);
        } catch {
            return str;
        }
    },

    copyLogBody(elId) {
        const el = document.getElementById(elId);
        if (!el) return;
        const text = el.textContent || el.innerText;
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('已复制到剪贴板', 'success');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this.showToast('已复制到剪贴板', 'success');
        });
    },

    async loadLogs() {
        try {
            this.logStatusFilter = document.getElementById('logStatusFilter')?.value || '';
            this.logKeyFilter = document.getElementById('logKeyFilter')?.value || '';
            let url = '/api/logs/recent?limit=50&offset=' + this.logOffset;
            if (this.logStatusFilter) url += '&status=' + this.logStatusFilter;
            if (this.logKeyFilter) url += '&key_id=' + encodeURIComponent(this.logKeyFilter);
            const res = await this.api('GET', url);
            const tbody = document.getElementById('logBody');
            const list = res.logs || res || [];
            if (Array.isArray(list) && list.length > 0) {
                tbody.innerHTML = list.map(l => {
                    const bm = l.billing_mode || 'per_token';
                    const keyDisplay = l.key_name ? this.esc(l.key_name) : '<span class="text-muted">-</span>';
                    return `<tr>
                        <td class="text-muted" style="font-size:11px">${this.esc((l.request_id || l.id || '').substring(0, 8))}</td>
                        <td>${keyDisplay}</td>
                        <td><span class="badge badge-info">${this.esc(l.provider || '')}</span></td>
                        <td>${this.esc(l.model || '')}</td>
                        <td><span class="badge ${bm==='per_token'?'badge-success':bm==='token_plan'?'badge-warning':bm==='coding_plan'?'badge-info':'badge-info'}" style="font-size:11px">${this.billingModeLabel(bm)}</span></td>
                        <td>${l.input_tokens != null ? this.formatNumber(l.input_tokens) : '<span class="text-muted">-</span>'}</td>
                        <td>${l.output_tokens != null ? this.formatNumber(l.output_tokens) : '<span class="text-muted">-</span>'}</td>
                        <td>${this.formatCost(l.cost || 0)}</td>
                        <td>${((l.latency_ms || 0) / 1000).toFixed(2)}s</td>
                        <td><span class="badge ${l.status === 'success' ? 'badge-success' : 'badge-danger'}">${l.status === 'success' ? '成功' : '失败'}</span></td>
                        <td class="text-muted">${this.formatDateTime(l.created_at)}</td>
                        <td><button class="btn-icon" onclick="App.showLogDetail('${this.esc(l.request_id || '')}')" title="${l.has_request_body || l.has_response_body ? '查看对话详情' : '无对话记录'}" style="${l.has_request_body || l.has_response_body ? '' : 'opacity:0.4'}">${l.has_request_body || l.has_response_body ? '💬' : '📋'}</button></td>
                    </tr>`;
                }).join('');
                document.getElementById('logInfo').textContent = `显示 ${this.logOffset + 1}-${this.logOffset + list.length} 条，共 ${res.total || list.length} 条`;
            } else {
                tbody.innerHTML = '<tr><td colspan="12" class="table-empty"><div class="empty-icon">📋</div>暂无日志记录</td></tr>';
                document.getElementById('logInfo').textContent = '暂无数据';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) document.getElementById('logBody').innerHTML = '<tr><td colspan="12" class="table-empty text-danger">加载失败: ' + this.esc(e.message) + '</td></tr>';
        }
    },

    async loadLogKeyOptions() {
        try {
            const res = await this.api('GET', '/api/admin/api-keys?limit=200');
            const sel = document.getElementById('logKeyFilter');
            if (!sel) return;
            const keys = res.keys || res || [];
            const current = this.logKeyFilter;
            sel.innerHTML = '<option value="">全部 Key</option>';
            if (Array.isArray(keys)) {
                keys.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k.id;
                    opt.textContent = k.name || k.key_prefix || k.id.substring(0, 8);
                    if (k.id === current) opt.selected = true;
                    sel.appendChild(opt);
                });
            }
        } catch (e) {
            if (!this._isCancelledError(e)) console.error('加载Key列表失败:', e);
        }
    },

    filterLogs() { this.logOffset = 0; this.loadLogs(); },
    prevLogPage() { if (this.logOffset >= 50) { this.logOffset -= 50; this.loadLogs(); } },
    nextLogPage() { this.logOffset += 50; this.loadLogs(); },

    showDeleteLogModal(requestId) {
        this.showModal('⚠️ 确认删除日志', `
            <div style="color: var(--danger-color); margin-bottom: 16px;">
                <strong>警告：此操作不可恢复！</strong><br>
                确定要删除此条日志吗？
            </div>
            <div class="form-group">
                <label>请输入管理员密码以确认：</label>
                <input type="password" id="deleteLogPassword" class="form-control" placeholder="输入密码">
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '确认删除', class: 'btn-danger', action: () => this.confirmDeleteLog(requestId) }
        ]);
    },

    async confirmDeleteLog(requestId) {
        const password = document.getElementById('deleteLogPassword').value;
        if (!password) { this.showToast('请输入密码', 'error'); return; }
        try {
            await this.api('DELETE', '/api/admin/logs/' + encodeURIComponent(requestId), { password });
            this.closeModal();
            this.showToast('日志已删除', 'success');
            this.loadLogs();
        } catch (e) {
            this.showToast('删除失败: ' + e.message, 'error');
        }
    },

    // 显示清空日志确认模态框
    showClearLogsModal() {
        this.showModal('⚠️ 确认清空日志', `
            <div style="color: var(--danger-color); margin-bottom: 16px;">
                <strong>警告：此操作不可恢复！</strong><br>
                清空后将删除所有请求日志记录。
            </div>
            <div class="form-group">
                <label>请输入管理员密码以确认：</label>
                <input type="password" id="clearLogsPassword" class="form-control" placeholder="输入密码">
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '确认清空', class: 'btn-danger', action: () => this.confirmClearLogs() }
        ]);
    },

    // 确认清空日志
    async confirmClearLogs() {
        const password = document.getElementById('clearLogsPassword').value;
        if (!password) {
            this.showToast('请输入密码', 'error');
            return;
        }
        try {
            const res = await this.api('POST', '/api/admin/logs/clear', { password });
            this.closeModal();
            this.showToast(`已清空 ${res.deleted_count} 条日志`, 'success');
            this.loadLogs();
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    },

    // ========== 用户管理页面 ==========
    async renderUsers() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>👥 用户管理</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>用户列表</h3>
                    <button class="btn btn-primary" onclick="App.showAddUserModal()">+ 添加用户</button>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody id="userBody"><tr><td colspan="5" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadUsers();
    },

    async loadUsers() {
        try {
            const res = await this.api('GET', '/api/admin/users');
            const tbody = document.getElementById('userBody');
            const list = res.users || res || [];
            if (Array.isArray(list) && list.length > 0) {
                tbody.innerHTML = list.map(u => `
                    <tr>
                        <td><strong>${this.esc(u.username || '')}</strong></td>
                        <td><span class="badge ${u.role === 'admin' ? 'badge-purple' : 'badge-info'}">${u.role === 'admin' ? '管理员' : '观察者'}</span></td>
                        <td><span class="badge ${u.is_active !== false ? 'badge-success' : 'badge-danger'}">${u.is_active !== false ? '启用' : '禁用'}</span></td>
                        <td class="text-muted">${this.formatDate(u.created_at)}</td>
                        <td>
                            <button class="btn-icon" onclick="App.showEditUserModal('${this.esc(u.id || '')}','${this.esc(u.username || '')}','${u.role || ''}',${u.is_active !== false})" title="编辑">✏️</button>
                            <button class="btn-icon" onclick="App.showResetUserPasswordModal('${this.esc(u.id || '')}','${this.esc(u.username || '')}')" title="重置密码">🔑</button>
                            <button class="btn-icon danger" onclick="App.confirmDeleteUser('${this.esc(u.id || '')}','${this.esc(u.username || '')}')" title="删除">🗑️</button>
                        </td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="table-empty"><div class="empty-icon">👥</div>暂无用户</td></tr>';
            }
        } catch (e) {
            if (!this._isCancelledError(e)) document.getElementById('userBody').innerHTML = '<tr><td colspan="5" class="table-empty text-danger">加载失败: ' + this.esc(e.message) + '</td></tr>';
        }
    },

    showAddUserModal() {
        this.showModal('添加用户', `
            <form id="userForm">
                <div class="form-group"><label>用户名 <span class="required">*</span></label><input class="form-control" id="uName" placeholder="请输入用户名" required></div>
                <div class="form-group"><label>密码 <span class="required">*</span></label><input class="form-control" id="uPwd" type="password" placeholder="请输入密码" required></div>
                <div class="form-group"><label>角色</label>
                    <select class="form-control" id="uRole"><option value="admin">管理员</option><option value="viewer">观察者</option></select>
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.submitUser() }
        ]);
    },

    async submitUser() {
        const username = document.getElementById('uName').value.trim();
        const password = document.getElementById('uPwd').value;
        const role = document.getElementById('uRole').value;
        if (!username || !password) { this.showToast('用户名和密码不能为空', 'error'); return; }

        try {
            await this.api('POST', '/api/admin/users', { username, password, role });
            this.showToast('用户已创建', 'success');
            this.closeModal();
            this.loadUsers();
        } catch (e) {
            this.showToast('创建失败: ' + e.message, 'error');
        }
    },

    showEditUserModal(id, username, role, isActive) {
        this.showModal('编辑用户 - ' + username, `
            <form id="userForm">
                <div class="form-group"><label>用户名</label><input class="form-control" value="${this.esc(username)}" readonly></div>
                <div class="form-group"><label>角色</label>
                    <select class="form-control" id="uRole"><option value="admin" ${role==='admin'?'selected':''}>管理员</option><option value="viewer" ${role==='viewer'?'selected':''}>观察者</option></select>
                </div>
                <div class="form-group"><label>状态</label>
                    <select class="form-control" id="uActive"><option value="true" ${isActive?'selected':''}>启用</option><option value="false" ${!isActive?'selected':''}>禁用</option></select>
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '保存', class: 'btn-primary', action: async () => {
                try {
                    await this.api('PUT', '/api/admin/users/' + id, {
                        role: document.getElementById('uRole').value,
                        is_active: document.getElementById('uActive').value === 'true'
                    });
                    this.showToast('用户已更新', 'success');
                    this.closeModal();
                    this.loadUsers();
                } catch (e) { this.showToast('更新失败: ' + e.message, 'error'); }
            }}
        ]);
    },

    showResetUserPasswordModal(userId, username) {
        this.showModal('重置密码', `
            <div style="background:rgba(79,195,247,0.1);padding:12px;border-radius:6px;border:1px solid rgba(79,195,247,0.3);margin-bottom:16px">
                <label style="color:var(--accent-blue)">📌 用户: ${this.esc(username)}</label>
            </div>
            <form id="resetPwdForm">
                <div class="form-group"><label>新密码 <span class="required">*</span></label><input class="form-control" id="rpNewPwd" type="password" placeholder="至少8位" required minlength="8"></div>
                <div class="form-group"><label>确认密码 <span class="required">*</span></label><input class="form-control" id="rpConfirmPwd" type="password" placeholder="再次输入新密码" required minlength="8"></div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '重置', class: 'btn-warning', action: () => this.submitResetUserPassword(userId) }
        ]);
    },

    async submitResetUserPassword(userId) {
        const newPwd = document.getElementById('rpNewPwd').value;
        const confirmPwd = document.getElementById('rpConfirmPwd').value;
        if (newPwd.length < 8) { this.showToast('密码长度至少8位', 'error'); return; }
        if (newPwd !== confirmPwd) { this.showToast('两次输入的密码不一致', 'error'); return; }
        try {
            await this.api('POST', '/api/admin/users/' + userId + '/reset-password', { new_password: newPwd });
            this.closeModal();
            this.showToast('密码已重置', 'success');
        } catch (e) {
            this.showToast('重置失败: ' + e.message, 'error');
        }
    },

    confirmDeleteUser(id, username) {
        this.showModal('确认删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除用户 "${this.esc(username)}" 吗？</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: async () => {
                try {
                    await this.api('DELETE', '/api/admin/users/' + id);
                    this.showToast('用户已删除', 'success');
                    this.closeModal();
                    this.loadUsers();
                } catch (e) { this.showToast('删除失败: ' + e.message, 'error'); }
            }}
        ]);
    },

    async changePassword(event) {
        event.preventDefault();
        const oldPwd = document.getElementById('cpOld').value;
        const newPwd = document.getElementById('cpNew').value;
        if (!oldPwd || !newPwd) { this.showToast('请填写完整', 'error'); return false; }
        try {
            await this.api('POST', '/api/auth/change-password', { old_password: oldPwd, new_password: newPwd });
            this.showToast('密码修改成功', 'success');
            document.getElementById('cpOld').value = '';
            document.getElementById('cpNew').value = '';
        } catch (e) {
            this.showToast('修改失败: ' + e.message, 'error');
        }
        return false;
    },

    // ========== 系统状态页面 ==========
    async renderSystem() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>⚙️ 系统状态</h2>
            </div>
            <div class="status-grid" id="statusGrid">
                <div class="status-card"><h4>版本</h4><div class="status-value" id="sysVersion">-</div></div>
                <div class="status-card"><h4>运行时间</h4><div class="status-value" id="sysUptime">-</div></div>
                <div class="status-card"><h4>监听端口</h4><div class="status-value" id="sysPort">-</div></div>
            </div>
            <div class="status-grid">
                <div class="status-card"><h4>数据库状态</h4><div class="status-value" id="sysDb">-</div></div>
                <div class="status-card"><h4>Redis 状态</h4><div class="status-value" id="sysRedis">-</div></div>
                <div class="status-card"><h4>服务商数量</h4><div class="status-value" id="sysProviders">-</div></div>
            </div>
            <div class="status-grid">
                <div class="status-card" style="grid-column:span 1">
                    <h4>CPU 使用率</h4>
                    <div class="status-value" id="sysCpuPercent">-</div>
                    <div id="sysCpuDetail" style="font-size:12px;color:var(--text-secondary);margin-top:4px"></div>
                </div>
                <div class="status-card" style="grid-column:span 1">
                    <h4>系统内存</h4>
                    <div class="status-value" id="sysMemInfo">-</div>
                    <div id="sysMemBar" style="margin-top:6px"></div>
                </div>
                <div class="status-card" style="grid-column:span 1">
                    <h4>平台进程内存</h4>
                    <div class="status-value" id="sysProcMem">-</div>
                    <div id="sysProcMemDetail" style="font-size:12px;color:var(--text-secondary);margin-top:4px"></div>
                </div>
            </div>
            <div class="table-card">
                <div class="table-header"><h3>🗄️ 数据库连接</h3></div>
                <div style="padding:20px">
                    <div id="dbConnInfo" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;font-size:13px">
                        <div><span class="text-muted">主机:</span> <span id="sysDbHost">-</span></div>
                        <div><span class="text-muted">端口:</span> <span id="sysDbPort">-</span></div>
                        <div><span class="text-muted">数据库:</span> <span id="sysDbName">-</span></div>
                        <div><span class="text-muted">最大连接数:</span> <span id="sysDbMaxConns">-</span></div>
                        <div><span class="text-muted">请求日志:</span> <span id="sysUsageLogCount">-</span> 条 / <span id="sysUsageLogStorage">-</span></div>
                        <div><span class="text-muted">访问日志:</span> <span id="sysAccessLogCount">-</span> 条 / <span id="sysAccessLogStorage">-</span></div>
                    </div>
                </div>
            </div>
            <div class="table-card mt-16">
                <div class="table-header"><h3>⚡ Redis 连接</h3></div>
                <div style="padding:20px">
                    <div id="redisConnInfo" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;font-size:13px">
                        <div><span class="text-muted">主机:</span> <span id="sysRedisHost">-</span></div>
                        <div><span class="text-muted">端口:</span> <span id="sysRedisPort">-</span></div>
                        <div><span class="text-muted">版本:</span> <span id="sysRedisVersion">-</span></div>
                        <div><span class="text-muted">内存使用:</span> <span id="sysRedisMemory">-</span></div>
                        <div><span class="text-muted">连接数:</span> <span id="sysRedisClients">-</span></div>
                        <div><span class="text-muted">Key 数量:</span> <span id="sysRedisKeys">-</span></div>
                        <div><span class="text-muted">运行时间:</span> <span id="sysRedisUptime">-</span></div>
                    </div>
                </div>
            </div>
            <div class="table-card mt-16">
                <div class="table-header"><h3>📡 服务商详情</h3></div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>名称</th><th>状态</th><th>Base URL</th><th>API Key</th><th>超时</th><th>适配格式</th></tr></thead>
                        <tbody id="sysProvidersBody"></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadSystemStatus();
        this.refreshTimer = setInterval(() => this.loadSystemStatus(), 10000);
    },

    async loadSystemStatus() {
        try {
            const res = await this.api('GET', '/api/dashboard/system-status');
            const ver = res.version || '-';
            const buildVer = res.build_version || '';
            document.getElementById('sysVersion').textContent = buildVer ? `${ver} (${buildVer})` : ver;
            document.getElementById('sysUptime').textContent = res.uptime || '-';
            document.getElementById('sysPort').textContent = res.port || '-';

            const dbEl = document.getElementById('sysDb');
            const dbStatus = res.database || 'unknown';
            const dbOk = dbStatus === 'ok' || dbStatus === 'connected';
            dbEl.innerHTML = `<span class="status-indicator"><span class="status-dot ${dbOk ? 'online' : 'offline'}"></span>${dbOk ? '正常' : dbStatus === 'unavailable' ? '未连接' : '异常'}</span>`;

            const redisEl = document.getElementById('sysRedis');
            const redisStatus = res.redis || 'unknown';
            const redisOk = redisStatus === 'ok' || redisStatus === 'connected';
            redisEl.innerHTML = `<span class="status-indicator"><span class="status-dot ${redisOk ? 'online' : 'offline'}"></span>${redisOk ? '正常' : redisStatus === 'unavailable' ? '未连接' : '异常'}</span>`;

            const dbHostEl = document.getElementById('sysDbHost');
            if (dbHostEl) dbHostEl.textContent = res.db_host || '-';
            const dbPortEl = document.getElementById('sysDbPort');
            if (dbPortEl) dbPortEl.textContent = res.db_port || '-';
            const dbNameEl = document.getElementById('sysDbName');
            if (dbNameEl) dbNameEl.textContent = res.db_name || '-';
            const dbMaxConnsEl = document.getElementById('sysDbMaxConns');
            if (dbMaxConnsEl) dbMaxConnsEl.textContent = res.db_max_conns || '-';
            const redisAddrEl = document.getElementById('sysRedisHost');
            if (redisAddrEl) {
                const addr = res.redis_addr || '-';
                const parts = addr.split(':');
                redisAddrEl.textContent = parts[0] || '-';
            }
            const redisPortEl = document.getElementById('sysRedisPort');
            if (redisPortEl) {
                const addr = res.redis_addr || '';
                const parts = addr.split(':');
                redisPortEl.textContent = parts[1] || '-';
            }
            const redisVerEl = document.getElementById('sysRedisVersion');
            if (redisVerEl) redisVerEl.textContent = res.redis_version || '-';
            const redisMemEl = document.getElementById('sysRedisMemory');
            if (redisMemEl) {
                const used = res.redis_used_memory || '';
                const max = res.redis_max_memory || '';
                if (used && max && max !== '0B') {
                    redisMemEl.textContent = used + ' / ' + max;
                } else if (used) {
                    redisMemEl.textContent = used;
                } else {
                    redisMemEl.textContent = '-';
                }
            }
            const redisClientsEl = document.getElementById('sysRedisClients');
            if (redisClientsEl) redisClientsEl.textContent = res.redis_connected_clients || '-';
            const redisKeysEl = document.getElementById('sysRedisKeys');
            if (redisKeysEl) {
                const ks = res.redis_keyspace || '';
                if (ks) {
                    const match = ks.match(/keys=(\d+)/);
                    redisKeysEl.textContent = match ? match[1] : ks;
                } else {
                    redisKeysEl.textContent = '-';
                }
            }
            const redisUptimeEl = document.getElementById('sysRedisUptime');
            if (redisUptimeEl) {
                const sec = parseInt(res.redis_uptime_in_seconds) || 0;
                if (sec > 0) {
                    const days = Math.floor(sec / 86400);
                    const hours = Math.floor((sec % 86400) / 3600);
                    const mins = Math.floor((sec % 3600) / 60);
                    redisUptimeEl.textContent = days > 0 ? `${days}天 ${hours}小时` : hours > 0 ? `${hours}小时 ${mins}分` : `${mins}分`;
                } else {
                    redisUptimeEl.textContent = '-';
                }
            }

            const logCountEl = document.getElementById('sysUsageLogCount');
            if (logCountEl) logCountEl.textContent = res.usage_log_count != null ? this.formatNumber(res.usage_log_count) : '-';
            const logStorageEl = document.getElementById('sysUsageLogStorage');
            if (logStorageEl) logStorageEl.textContent = res.usage_log_storage_bytes != null ? this.formatBytes(res.usage_log_storage_bytes) : '-';
            const accessCountEl = document.getElementById('sysAccessLogCount');
            if (accessCountEl) accessCountEl.textContent = res.access_log_count != null ? this.formatNumber(res.access_log_count) : '-';
            const accessStorageEl = document.getElementById('sysAccessLogStorage');
            if (accessStorageEl) accessStorageEl.textContent = res.access_log_storage_bytes != null ? this.formatBytes(res.access_log_storage_bytes) : '-';

            const providers = res.providers || [];
            document.getElementById('sysProviders').textContent = providers.length + ' 个';

            const cpuPercentEl = document.getElementById('sysCpuPercent');
            const cpuDetailEl = document.getElementById('sysCpuDetail');
            if (cpuPercentEl) {
                if (res.cpu_percent != null && res.cpu_percent >= 0) {
                    const cpuPct = res.cpu_percent.toFixed(1);
                    const cpuColor = res.cpu_percent > 90 ? 'var(--accent-red)' : res.cpu_percent > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
                    cpuPercentEl.innerHTML = `<span style="color:${cpuColor};font-size:28px;font-weight:700">${cpuPct}%</span>`;
                } else {
                    cpuPercentEl.textContent = res.cpu_cores ? res.cpu_cores + ' 核心' : '-';
                }
            }
            if (cpuDetailEl) {
                const parts = [];
                if (res.cpu_cores) parts.push(res.cpu_cores + ' 核心');
                if (res.proc_cpu_percent != null && res.proc_cpu_percent >= 0) {
                    parts.push('平台占用 ' + res.proc_cpu_percent.toFixed(1) + '%');
                }
                cpuDetailEl.textContent = parts.join(' · ');
            }

            const memInfoEl = document.getElementById('sysMemInfo');
            const memBarEl = document.getElementById('sysMemBar');
            if (memInfoEl) {
                if (res.sys_mem_available && res.sys_mem_total_mb > 0) {
                    const totalMB = res.sys_mem_total_mb;
                    const availMB = res.sys_mem_available_mb;
                    const usedMB = totalMB - availMB;
                    const pct = (usedMB / totalMB * 100).toFixed(1);
                    memInfoEl.textContent = this.formatBytes(usedMB * 1024 * 1024) + ' / ' + this.formatBytes(totalMB * 1024 * 1024);
                    if (memBarEl) {
                        const barColor = pct > 90 ? 'var(--accent-red)' : pct > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
                        memBarEl.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span>已用 ${pct}%</span><span>可用 ${this.formatBytes(availMB * 1024 * 1024)}</span></div><div style="background:var(--bg-tertiary);border-radius:4px;height:8px;overflow:hidden"><div style="width:${Math.min(100, pct)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s"></div></div>`;
                    }
                } else {
                    memInfoEl.textContent = res.sys_mb != null ? this.formatBytes(res.sys_mb * 1024 * 1024) : '-';
                }
            }

            const procMemEl = document.getElementById('sysProcMem');
            const procMemDetailEl = document.getElementById('sysProcMemDetail');
            if (procMemEl) {
                procMemEl.textContent = res.heap_alloc_mb != null ? this.formatBytes(res.heap_alloc_mb * 1024 * 1024) : '-';
            }
            if (procMemDetailEl) {
                const parts = [];
                if (res.sys_mb != null) parts.push('总分配 ' + this.formatBytes(res.sys_mb * 1024 * 1024));
                if (res.stack_inuse_mb != null) parts.push('栈 ' + this.formatBytes(res.stack_inuse_mb * 1024 * 1024));
                procMemDetailEl.textContent = parts.join(' · ');
            }
            const pBody = document.getElementById('sysProvidersBody');
            pBody.innerHTML = providers.map(p => {
                const statusBadge = p.status === 'active' ? 'badge-success' : p.status === 'configured' ? 'badge-warning' : 'badge-danger';
                const statusLabel = p.status === 'active' ? '已启用' : p.status === 'configured' ? '已配置' : p.status === 'not_configured' ? '未在数据库中' : this.esc(p.status);
                const hasKey = p.has_api_key ? '✅ 已配置' : '❌ 未配置';
                return `<tr>
                    <td>${this.esc(p.name || '')}</td>
                    <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
                    <td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${this.esc(p.base_url || '')}">${this.esc(p.base_url || '-')}</td>
                    <td>${hasKey}</td>
                    <td>${this.esc(p.timeout || '-')}</td>
                    <td>${this.esc(p.api_format || '-')}</td>
                </tr>`;
            }).join('') || '<tr><td colspan="6" class="table-empty">暂无</td></tr>';
        } catch (e) {
            console.error('加载系统状态失败:', e);
        }
    },

    // ========== 通用工具 ==========
    showModal(title, bodyHtml, buttons) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = bodyHtml;
        const footer = document.getElementById('modalFooter');
        footer.innerHTML = '';
        if (buttons && buttons.length > 0) {
            buttons.forEach(btn => {
                const el = document.createElement('button');
                el.className = 'btn ' + (btn.class || 'btn-outline');
                el.textContent = btn.text;
                el.onclick = btn.action;
                footer.appendChild(el);
            });
        }
        document.getElementById('modalOverlay').classList.add('active');
    },

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('active');
    },

    showToast(message, type) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.className = 'toast toast-' + (type || 'info');
        toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${this.esc(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    formatNumber(num) {
        if (num == null) return '0';
        return Number(num).toLocaleString('zh-CN');
    },

    formatReadableToken(num) {
        if (num == null || num === 0) return '0';
        const abs = Math.abs(num);
        const sign = num < 0 ? '-' : '';
        if (abs >= 1e8) return sign + (abs / 1e8).toFixed(3) + '亿';
        if (abs >= 1e6) return sign + (abs / 1e6).toFixed(3) + '百万';
        if (abs >= 1e4) return sign + (abs / 1e4).toFixed(3) + '万';
        return Number(num).toLocaleString('zh-CN');
    },

    formatBytes(bytes) {
        if (bytes == null || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
    },

    formatCost(cost) {
        if (cost == null) return '$0.0000';
        return '$' + Number(cost).toFixed(4);
    },

    formatCostCNY(cost) {
        if (cost == null) return '0.00';
        return Number(cost).toFixed(2);
    },

    _ensureUTC(s) {
        s = String(s);
        if (s.includes('Z') || /\+\d{2}:\d{2}$/.test(s) || /-\d{2}:\d{2}$/.test(s)) return s;
        if (s.length >= 19) {
            s = s.replace(' ', 'T');
            const dotIdx = s.indexOf('.', 11);
            if (dotIdx > 0) s = s.substring(0, dotIdx);
            if (!s.endsWith('Z')) s = s + 'Z';
        }
        return s;
    },
    formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(this._ensureUTC(dateStr));
            return d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
        } catch { return dateStr; }
    },

    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(this._ensureUTC(dateStr));
            const pad = n => String(n).padStart(2, '0');
            return d.getFullYear() + '-' +
                pad(d.getMonth() + 1) + '-' +
                pad(d.getDate()) + ' ' +
                pad(d.getHours()) + ':' +
                pad(d.getMinutes()) + ':' +
                pad(d.getSeconds());
        } catch { return dateStr; }
    },

    esc(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML.replace(/'/g, '&#39;');
    },

    billingModeLabel(mode) {
        const labels = { per_token: '按Token', per_request: '按请求', quota: '积分制', token_plan: 'Token Plan', coding_plan: 'Coding Plan' };
        return labels[mode] || mode || '按Token';
    },

    formatQuotaInfo(k) {
        const bm = k.billing_mode || 'per_token';
        const limitParts = [];
        if (k.five_hour_limit > 0) limitParts.push(`5h限${k.five_hour_limit}`);
        if (k.weekly_limit > 0) limitParts.push(`周限${k.weekly_limit}`);
        if (k.monthly_limit > 0) limitParts.push(`月限${k.monthly_limit}`);
        const limitStr = limitParts.length > 0 ? ' ' + limitParts.join(' ') : '';
        if (bm === 'per_token') {
            const quota = k.monthly_quota || 0;
            return (quota > 0 ? `${this.formatNumber(quota)} tokens/月` : '无限制') + limitStr;
        } else if (bm === 'per_request') {
            const quota = k.monthly_quota || 0;
            return (quota > 0 ? `${this.formatNumber(quota)} 次/月` : '无限制') + limitStr;
        } else if (bm === 'quota') {
            const bal = k.credits_balance || 0;
            const init = k.initial_credits_balance || 0;
            return `余额 ${bal.toFixed(2)}${init > 0 ? ' (初始'+init.toFixed(2)+')' : ''}` + limitStr;
        } else if (bm === 'token_plan') {
            const quota = k.monthly_quota || 0;
            const bal = k.credits_balance || 0;
            return (quota > 0 ? `积分 ${bal.toFixed(1)}/${quota}` : `积分 ${bal.toFixed(1)}`) + limitStr;
        } else if (bm === 'coding_plan') {
            const parts = [];
            if (k.five_hour_used != null && k.five_hour_limit > 0) parts.push(`5h:${k.five_hour_used}/${k.five_hour_limit}`);
            else if (k.five_hour_used != null) parts.push(`5h:${k.five_hour_used}`);
            if (k.weekly_used != null && k.weekly_limit > 0) parts.push(`周:${k.weekly_used}/${k.weekly_limit}`);
            else if (k.weekly_used != null) parts.push(`周:${k.weekly_used}`);
            if (k.total_used != null && k.monthly_limit > 0) parts.push(`月:${k.total_used}/${k.monthly_limit}`);
            else if (k.total_used != null) parts.push(`总:${k.total_used}`);
            return parts.length > 0 ? parts.join(' ') : '次数制';
        }
        return '-';
    },

    async resetQuota(keyId, keyName) {
        if (!confirm(`确定要重置 "${keyName}" 的配额吗？\n\n- 按Token/按请求模式：清除当月已用计数\n- 积分制模式：恢复初始余额`)) return;
        try {
            const res = await this.api('POST', `/api/admin/api-keys/${keyId}/reset-quota`, {});
            if (res.status === 'success') {
                this.showToast('配额已重置', 'success');
                this.loadApiKeys();
            } else {
                this.showToast(res.error || '重置失败', 'error');
            }
        } catch (e) {
            this.showToast('重置失败: ' + e.message, 'error');
        }
    },

    // ========== 动态服务商加载 ==========
    async loadProviderOptions(selectId, selectedValue) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        try {
            const res = await this.api('GET', '/api/admin/providers');
            const list = res.providers || res || [];
            const currentVal = sel.value;
            sel.innerHTML = list.map(p =>
                `<option value="${this.esc(p.name)}" ${p.name === (selectedValue || currentVal) ? 'selected' : ''}>${this.esc(p.name)}</option>`
            ).join('');
        } catch (e) {
            if (!this._isCancelledError(e)) console.error('加载服务商列表失败:', e);
        }
    },

    // ========== API测试页面 ==========
    async renderApiTest() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>🧪 API 测试</h2>
            </div>
            <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;height:calc(100vh - 140px)">
                <!-- 左侧：参数面板 -->
                <div class="table-card" style="display:flex;flex-direction:column;overflow:hidden">
                    <div class="table-header"><h3>测试参数</h3></div>
                    <div style="padding:16px;flex:1;overflow-y:auto">
                        <!-- 测试模式切换 -->
                        <div class="form-group">
                            <label>测试模式</label>
                            <div style="display:flex;gap:4px">
                                <button class="btn btn-sm ${this.testMode !== 'proxy' ? 'btn-primary' : 'btn-outline'}" id="testModeDirect" onclick="App.setTestMode('direct')" style="flex:1">🔌 直连服务商</button>
                                <button class="btn btn-sm ${this.testMode === 'proxy' ? 'btn-primary' : 'btn-outline'}" id="testModeProxy" onclick="App.setTestMode('proxy')" style="flex:1">🌐 代理网关</button>
                            </div>
                            <div class="form-hint" id="testModeHint">直接发送请求到服务商，测试连通性</div>
                        </div>
                        <!-- 代理模式：映射模型选择 -->
                        <div class="form-group" id="testMappingGroup" style="display:none">
                            <label>映射模型 <span class="required">*</span></label>
                            <select class="form-control" id="testMappingSelect">
                                <option value="">加载中...</option>
                            </select>
                            <div class="form-hint">从模型映射列表中选择，将走完整代理链路</div>
                        </div>
                        <!-- 模型（直连模式手动输入 / 代理模式自动填充） -->
                        <div class="form-group" id="testModelGroup">
                            <label>模型 <span class="required">*</span></label>
                            <div style="display:flex;gap:6px">
                                <input class="form-control" id="testModel" placeholder="如: gpt-4o 或 provider/model" value="${this.esc(this.testModel)}" style="flex:1">
                            </div>
                        </div>
                        <!-- 直连模式：服务商选择 -->
                        <div class="form-group" id="testProviderGroup">
                            <label>服务商</label>
                            <select class="form-control" id="testProvider">
                                <option value="">自动推断</option>
                            </select>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Temperature</label>
                                <input class="form-control" id="testTemp" type="number" step="0.1" min="0" max="2" value="0.7">
                            </div>
                            <div class="form-group">
                                <label>Max Tokens</label>
                                <input class="form-control" id="testMaxTokens" type="number" value="0">
                            </div>
                        </div>
                        <div class="form-group">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                                <input type="checkbox" id="testStream" ${this.testStream ? 'checked' : ''}> 流式输出
                            </label>
                        </div>
                        <div class="form-group">
                            <label>客户端模拟</label>
                            <select class="form-control" id="testClientPreset">
                                <option value="">不模拟（默认）</option>
                                <option value="openclaw">🦞 OpenClaw</option>
                                <option value="hermes">🤖 Hermes Agent</option>
                            </select>
                            <div class="form-hint">模拟知名客户端的请求特征头，避免被服务商检测为非法应用</div>
                        </div>
                        <div class="form-group">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                                <input type="checkbox" id="testThinking" onchange="App.toggleThinking()"> 💡 启用思考模式
                            </label>
                            <div id="testThinkingOptions" style="display:none;margin-top:8px">
                                <select class="form-control" id="testThinkingLevel">
                                    <option value="low">低 (low) - 简单推理</option>
                                    <option value="medium" selected>中 (medium) - 均衡</option>
                                    <option value="high">高 (high) - 深度推理</option>
                                </select>
                                <div class="form-hint">部分模型支持（如 DeepSeek-R1、o1/o3 等）</div>
                            </div>
                        </div>
                        <div style="border-top:1px solid var(--border-color);padding-top:12px;margin-top:8px">
                            <button class="btn btn-danger btn-sm" onclick="App.clearTestChat()" style="width:100%">清空对话</button>
                        </div>
                    </div>
                </div>
                <!-- 右侧：对话区域 -->
                <div class="table-card" style="display:flex;flex-direction:column;overflow:hidden">
                    <div class="table-header">
                        <h3>对话</h3>
                        <div class="table-actions">
                            <span class="badge badge-info" id="testStatus"></span>
                        </div>
                    </div>
                    <div id="testChatArea" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px">
                        <div class="table-empty"><div class="empty-icon">💬</div>输入消息开始测试</div>
                    </div>
                    <!-- 多模态输入区 -->
                    <div style="border-top:1px solid var(--border-color);padding:12px">
                        <div id="testImagePreview" style="display:none;margin-bottom:8px;position:relative">
                            <img id="testImageImg" style="max-height:80px;border-radius:6px;border:1px solid var(--border-color)">
                            <button onclick="App.removeTestImage()" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--accent-red);color:#fff;border:none;cursor:pointer;font-size:12px;line-height:20px">&times;</button>
                        </div>
                        <div style="display:flex;gap:8px;align-items:flex-end">
                            <div id="testToolbarBtns" style="display:flex;gap:4px">
                                <button class="btn-icon" id="testImageBtn" onclick="App.addTestImage()" title="添加图片（模型需支持多模态）" style="display:none">🖼️</button>
                                <input type="file" id="testImageInput" accept="image/*" style="display:none" onchange="App.handleTestImage(event)">
                            </div>
                            <textarea class="form-control" id="testInput" placeholder="输入消息... (Enter发送, Shift+Enter换行)" rows="2" style="flex:1;resize:none" onkeydown="App.testInputKeydown(event)" oninput="App.onTestModelChange()"></textarea>
                            <button class="btn btn-primary" id="testSendBtn" onclick="App.sendTestMessage()">发送</button>
                            <button class="btn btn-danger" id="testStopBtn" onclick="App.stopTestStream()" style="display:none">停止</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        // 加载服务商下拉
        await this.loadProviderOptions('testProvider');
        // 加载 API Key 列表
        await this.loadMappingOptions();
        // 根据模式更新 UI
        this.updateTestModeUI();
        // 检查模型能力（显示/隐藏图片按钮等）
        this.onTestModelChange();
        // 渲染历史消息
        this.renderTestMessages();
        // 恢复保存的测试参数
        this.restoreTestParams();
    },

    saveTestParams() {
        try {
            const gv = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
            const gc = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
            const params = {
                mode: this.testMode,
                provider: gv('testProvider'),
                model: gv('testModel'),
                stream: gc('testStream'),
                temp: gv('testTemp') || '0.7',
                maxTokens: gv('testMaxTokens') || '0',
                thinking: gc('testThinking'),
                thinkingLevel: gv('testThinkingLevel') || 'medium',
                clientPreset: gv('testClientPreset'),
                mappingSelect: gv('testMappingSelect'),
            };
            localStorage.setItem('ai_gateway_test_params', JSON.stringify(params));
        } catch {}
    },

    restoreTestParams() {
        try {
            const raw = localStorage.getItem('ai_gateway_test_params');
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p.mode) { this.testMode = p.mode; this.updateTestModeUI(); }
            if (p.provider) { const el = document.getElementById('testProvider'); if (el) el.value = p.provider; }
            if (p.model) { const el = document.getElementById('testModel'); if (el) el.value = p.model; }

            if (p.stream) { const el = document.getElementById('testStream'); if (el) el.checked = true; }
            if (p.temp) { const el = document.getElementById('testTemp'); if (el) el.value = p.temp; }
            if (p.maxTokens) { const el = document.getElementById('testMaxTokens'); if (el) el.value = p.maxTokens; }
            if (p.thinking) { const el = document.getElementById('testThinking'); if (el) el.checked = true; this.toggleThinking(); }
            if (p.thinkingLevel) { const el = document.getElementById('testThinkingLevel'); if (el) el.value = p.thinkingLevel; }
            if (p.clientPreset) { const el = document.getElementById('testClientPreset'); if (el) el.value = p.clientPreset; }
            if (p.mappingSelect) { const el = document.getElementById('testMappingSelect'); if (el) el.value = p.mappingSelect; }
        } catch {}
    },

    setTestMode(mode) {
        this.testMode = mode;
        this.updateTestModeUI();
    },

    updateTestModeUI() {
        const isProxy = this.testMode === 'proxy';
        const providerGroup = document.getElementById('testProviderGroup');
        const mappingGroup = document.getElementById('testMappingGroup');
        const modelGroup = document.getElementById('testModelGroup');
        const modeHint = document.getElementById('testModeHint');
        const clientPresetGroup = document.getElementById('testClientPreset')?.closest('.form-group');
        if (providerGroup) providerGroup.style.display = isProxy ? 'none' : 'block';
        if (mappingGroup) mappingGroup.style.display = isProxy ? 'block' : 'none';
        if (modelGroup) modelGroup.style.display = isProxy ? 'none' : 'block';
        if (modeHint) modeHint.textContent = isProxy
            ? '通过代理网关转发，测试完整链路（映射、适配、转发）'
            : '直接发送请求到服务商，测试连通性';
        // 客户端模拟仅在直连模式显示（代理模式从映射继承）
        if (clientPresetGroup) clientPresetGroup.style.display = isProxy ? 'none' : 'block';
        // 更新按钮样式
        const btnDirect = document.getElementById('testModeDirect');
        const btnProxy = document.getElementById('testModeProxy');
        if (btnDirect) { btnDirect.className = `btn btn-sm ${!isProxy ? 'btn-primary' : 'btn-outline'}`; }
        if (btnProxy) { btnProxy.className = `btn btn-sm ${isProxy ? 'btn-primary' : 'btn-outline'}`; }
    },

    async loadMappingOptions() {
        const sel = document.getElementById('testMappingSelect');
        if (!sel) return;
        try {
            const res = await this.api('GET', '/api/admin/model-routes');
            const list = res.mappings || [];
            if (list.length === 0) {
                sel.innerHTML = '<option value="">暂无映射配置</option>';
                return;
            }
            sel.innerHTML = '<option value="">-- 选择映射模型 --</option>' +
                list.filter(m => m.api_format !== 'anthropic').map(m => {
                    return `<option value="${this.esc(m.client_model)}">${this.esc(m.client_model)} → ${this.esc(m.provider)}/${this.esc(m.target_model)}</option>`;
                }).join('');
            // 选择映射时自动检测能力
            sel.onchange = () => {
                const capsDiv = document.getElementById('testCapabilities');
                if (capsDiv) capsDiv.style.display = 'none';
            };
        } catch (e) {
            if (!this._isCancelledError(e)) sel.innerHTML = '<option value="">加载失败</option>';
        }
    },

    testInputKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendTestMessage();
        }
    },

    addTestImage() {
        document.getElementById('testImageInput').click();
    },

    handleTestImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('testImageImg').src = e.target.result;
            document.getElementById('testImagePreview').style.display = 'block';
        };
        reader.readAsDataURL(file);
    },

    removeTestImage() {
        document.getElementById('testImagePreview').style.display = 'none';
        document.getElementById('testImageImg').src = '';
        document.getElementById('testImageInput').value = '';
    },

    toggleThinking() {
        const checked = document.getElementById('testThinking').checked;
        document.getElementById('testThinkingOptions').style.display = checked ? 'block' : 'none';
    },

    // 已知支持多模态的模型关键词
    visionModelPatterns: ['gpt-4o', 'gpt-4-turbo', 'claude-3', 'claude-4', 'gemini', 'qwen-vl', 'glm-4v', 'vision', 'astron'],

    // 已知支持思考/推理的模型关键词
    reasoningModelPatterns: ['deepseek-reasoner', 'deepseek-r1', 'o1', 'o3', 'o4-mini', 'reasoner', 'reasoning', 'think', 'qwq', 'hunyuan-think'],

    checkModelCapabilities(modelName) {
        const m = modelName.toLowerCase();
        return {
            vision: this.visionModelPatterns.some(p => m.includes(p)),
            reasoning: this.reasoningModelPatterns.some(p => m.includes(p)),
        };
    },

    onTestModelChange() {
        // 根据模型名动态显示/隐藏图片按钮
        const model = document.getElementById('testModel')?.value?.trim() || '';
        const caps = this.checkModelCapabilities(model);
        const imgBtn = document.getElementById('testImageBtn');
        if (imgBtn) imgBtn.style.display = caps.vision ? 'inline-flex' : 'none';
    },

    // 模型能力数据库（已知模型的能力信息，作为 API 查询失败时的回退）
    modelCapabilitiesDB: {
        'gpt-4o': { vision: true, context: 128000, reasoning: false },
        'gpt-4o-mini': { vision: true, context: 128000, reasoning: false },
        'gpt-4-turbo': { vision: true, context: 128000, reasoning: false },
        'o1': { vision: false, context: 200000, reasoning: true },
        'o3': { vision: false, context: 200000, reasoning: true },
        'o4-mini': { vision: false, context: 200000, reasoning: true },
        'claude-3-opus': { vision: true, context: 200000, reasoning: false },
        'claude-3-sonnet': { vision: true, context: 200000, reasoning: false },
        'claude-3-haiku': { vision: true, context: 200000, reasoning: false },
        'claude-3.5-sonnet': { vision: true, context: 200000, reasoning: false },
        'claude-4-sonnet': { vision: true, context: 200000, reasoning: true },
        'gemini-2.0-flash': { vision: true, context: 1048576, reasoning: false },
        'gemini-2.5-pro': { vision: true, context: 1048576, reasoning: true },
        'deepseek-reasoner': { vision: false, context: 64000, reasoning: true },
        'deepseek-r1': { vision: false, context: 64000, reasoning: true },
        'deepseek-chat': { vision: false, context: 64000, reasoning: false },
        'qwen-vl-max': { vision: true, context: 32000, reasoning: false },
        'glm-4v': { vision: true, context: 128000, reasoning: false },
    },

    async detectModelCapabilities() {
        const capsDiv = document.getElementById('testCapabilities');
        if (!capsDiv) return;

        // 获取当前模型名称和服务商
        let model, provider;
        if (this.testMode === 'proxy') {
            const mappingModel = document.getElementById('testMappingSelect')?.value?.trim();
            if (!mappingModel) { this.showToast('请先选择映射模型', 'error'); return; }
            // 从映射列表中查找服务商和目标模型
            const mapping = (this._mappingList || []).find(m => m.client_model === mappingModel);
            if (mapping) {
                model = mapping.target_model;
                provider = mapping.provider;
            } else {
                model = mappingModel;
            }
        } else {
            model = document.getElementById('testModel')?.value?.trim();
            provider = document.getElementById('testProvider')?.value;
        }

        if (!model) { this.showToast('请先输入模型名称', 'error'); return; }

        // 显示加载状态
        capsDiv.innerHTML = '⏳ 正在从服务商 API 查询模型信息...';
        capsDiv.style.display = 'block';

        // 尝试从服务商 API 获取模型列表
        let caps = null;
        if (provider) {
            try {
                const resp = await this.api('GET', `/api/admin/providers/${encodeURIComponent(provider)}/models`);
                if (resp && resp.data) {
                    const models = resp.data;
                    // 查找匹配的模型
                    const modelInfo = models.find(m => m.id === model || m.id === model.toLowerCase());
                    if (modelInfo) {
                        // 从 API 返回的模型信息推断能力
                        caps = this.inferCapabilitiesFromModel(modelInfo);
                    }
                    // 即使没找到精确匹配，也显示模型列表数量
                    if (!caps) {
                        capsDiv.innerHTML = `📡 服务商返回 ${models.length} 个模型，未找到精确匹配 "${this.esc(model)}"，使用本地推断`;
                        caps = this.inferCapabilitiesLocal(model);
                    }
                }
            } catch (e) {
                // API 查询失败，回退到本地推断
                caps = this.inferCapabilitiesLocal(model);
            }
        } else {
            caps = this.inferCapabilitiesLocal(model);
        }

        if (!caps) { capsDiv.innerHTML = '❓ 无法推断模型能力'; return; }

        const items = [];
        items.push(caps.vision ? '✅ 支持图片输入' : '❌ 不支持图片');
        items.push(`📏 上下文: ${typeof caps.context === 'number' ? (caps.context >= 1000000 ? (caps.context/1000000)+'M' : (caps.context/1000)+'K') : caps.context}`);
        items.push(caps.reasoning ? '💡 支持思考/推理' : '🚫 不支持思考');

        capsDiv.innerHTML = items.join('&nbsp;&nbsp;|&nbsp;&nbsp;');
        capsDiv.style.display = 'block';

        // 更新图片按钮
        const imgBtn = document.getElementById('testImageBtn');
        if (imgBtn) imgBtn.style.display = caps.vision ? 'inline-flex' : 'none';
    },

    // 从服务商 API 返回的模型信息推断能力
    inferCapabilitiesFromModel(modelInfo) {
        const id = (modelInfo.id || '').toLowerCase();
        const caps = { vision: false, context: '未知', reasoning: false };

        // 从模型 ID 推断
        if (id.includes('vision') || id.includes('vl') || id.includes('4o') || id.includes('gpt-4-turbo') ||
            id.includes('claude-3') || id.includes('gemini') || id.includes('glm-4v') || id.includes('qwen-vl')) {
            caps.vision = true;
        }
        if (id.includes('o1') || id.includes('o3') || id.includes('o4') || id.includes('r1') || id.includes('reasoner') ||
            id.includes('deepseek-r') || id.includes('think') || id.includes('claude-4')) {
            caps.reasoning = true;
        }

        // 从模型元数据推断（如果有）
        if (modelInfo.context_window || modelInfo.max_context_length) {
            caps.context = modelInfo.context_window || modelInfo.max_context_length;
        } else {
            caps.context = caps.vision ? '128K+' : '32K+';
        }

        return caps;
    },

    // 本地推断模型能力（回退方案）
    inferCapabilitiesLocal(model) {
        const modelLower = model.toLowerCase();
        // 先精确匹配
        let caps = this.modelCapabilitiesDB[modelLower];
        // 再模糊匹配
        if (!caps) {
            for (const [key, val] of Object.entries(this.modelCapabilitiesDB)) {
                if (modelLower.includes(key) || key.includes(modelLower)) { caps = val; break; }
            }
        }
        // 最后用关键词推断
        if (!caps) {
            caps = this.checkModelCapabilities(modelLower);
            caps = { ...caps, context: caps.vision ? '128K+' : '32K+', reasoning: caps.reasoning };
        }
        return caps;
    },

    clearTestChat() {
        this.testMessages = [];
        this._userScrolled = false;
        this.renderTestMessages();
    },

    renderTestMessages() {
        const area = document.getElementById('testChatArea');
        if (!area) return;
        if (this.testMessages.length === 0) {
            area.innerHTML = '<div class="table-empty"><div class="empty-icon">💬</div>输入消息开始测试</div>';
            this._userScrolled = false;
            return;
        }
        if (!this._scrollListenerAttached) {
            this._scrollListenerAttached = true;
            area.addEventListener('scroll', () => {
                const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 40;
                this._userScrolled = !atBottom;
            });
        }
        area.innerHTML = this.testMessages.map((msg, i) => {
            if (msg.role === 'user') {
                let contentHtml = '';
                if (typeof msg.content === 'string') {
                    contentHtml = this.esc(msg.content);
                } else if (Array.isArray(msg.content)) {
                    contentHtml = msg.content.map(part => {
                        if (part.type === 'text') return `<p>${this.esc(part.text)}</p>`;
                        if (part.type === 'image_url') return `<img src="${this.esc(part.image_url.url)}" style="max-width:200px;max-height:150px;border-radius:6px;margin:4px 0">`;
                        return '';
                    }).join('');
                }
                return `<div class="message-wrapper user"><div class="user-message"><div class="message-content">${contentHtml}</div></div></div>`;
            } else if (msg.role === 'assistant') {
                let html = '';
                if (msg.thinking) {
                    const thinkId = `think-${i}`;
                    const isCollapsed = msg.thinkingCollapsed !== false;
                    html += `<div style="margin-bottom:8px">
                        <div onclick="App.toggleThinkingBlock('${thinkId}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border-color)">
                            <span id="${thinkId}-arrow">${isCollapsed ? '▶' : '▼'}</span>
                            <span>💭 思考过程 (${msg.thinking.length}字)</span>
                        </div>
                        <div id="${thinkId}-content" style="display:${isCollapsed ? 'none' : 'block'};margin-top:4px;padding:8px 12px;background:rgba(79,195,247,0.04);border-radius:6px;border:1px solid var(--border-color);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;max-height:300px;overflow-y:auto">${this.esc(msg.thinking)}</div>
                    </div>`;
                }
                const content = msg.content || '';
                html += `<div class="assistant-message"><div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);padding:2px 8px 0 8px">💬 回答 (${content.length}字)</div><div class="message-content">${this.renderContent(content)}</div></div>`;
                return `<div class="message-wrapper assistant"><div style="display:flex;flex-direction:column;max-width:85%;gap:0">${html}</div></div>`;
            } else if (msg.role === 'error') {
                return `<div style="text-align:center"><span class="badge badge-danger" style="font-size:12px">${this.esc(msg.content || '请求失败')}</span></div>`;
            }
            return '';
        }).join('');
        if (!this._userScrolled) {
            area.scrollTop = area.scrollHeight;
        }
        this.testMessages.forEach((msg, i) => {
            if (msg.thinking && msg.thinkingCollapsed === false) {
                const thinkEl = document.getElementById(`think-${i}-content`);
                if (thinkEl && !this._userScrolled) {
                    thinkEl.scrollTop = thinkEl.scrollHeight;
                }
            }
        });
    },

    toggleThinkingBlock(id) {
        const content = document.getElementById(id + '-content');
        const arrow = document.getElementById(id + '-arrow');
        if (!content) return;
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
    },

    // Markdown渲染：使用marked.js + highlight.js
    // 注意：marked.use() 只应在全局初始化时调用一次，不能在每次渲染时重复调用
    _markedInitialized: false,

    _initMarked() {
        if (this._markedInitialized) return;
        if (typeof marked === 'undefined') return;
        try {
            if (marked.use) {
                marked.use({
                    breaks: true,
                    gfm: true,
                    renderer: {
                        code(code, language, escaped) {
                            const lang = language || '';
                            let highlighted = '';
                            if (typeof hljs !== 'undefined') {
                                if (lang && hljs.getLanguage(lang)) {
                                    try { highlighted = hljs.highlight(code, { language: lang }).value; } catch (e) {}
                                }
                                if (!highlighted) {
                                    try { highlighted = hljs.highlightAuto(code).value; } catch (e) {}
                                }
                            }
                            if (!highlighted) {
                                highlighted = App.esc(code);
                            }
                            const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
                            const langLabel = lang ? `<span class="code-lang">${App.esc(lang)}</span>` : '';
                            return `<div class="code-block-wrapper">${langLabel}<button class="code-copy-btn" onclick="App.copyCode('${codeId}')" title="复制代码">📋</button><pre id="${codeId}-pre"><code id="${codeId}" class="hljs language-${lang}">${highlighted}</code></pre></div>`;
                        }
                    }
                });
            } else {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                    mangle: false
                });
            }
            this._markedInitialized = true;
        } catch (e) {
            console.warn('marked init error:', e);
        }
    },

    copyCode(codeId) {
        const codeEl = document.getElementById(codeId);
        if (!codeEl) return;
        const text = codeEl.textContent || codeEl.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const btn = codeEl.closest('.code-block-wrapper')?.querySelector('.code-copy-btn');
            if (btn) { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    },

    renderContent(text) {
        if (!text) return '';
        if (typeof marked === 'undefined') return this.esc(text).replace(/\n/g, '<br>');
        this._initMarked();
        try {
            const html = marked.parse(text);
            return html;
        } catch (e) {
            console.warn('marked parse error:', e);
            return this.esc(text).replace(/\n/g, '<br>');
        }
    },

    async sendTestMessage() {
        this.saveTestParams();
        const input = document.getElementById('testInput');
        const text = input.value.trim();
        if (!text && document.getElementById('testImagePreview').style.display === 'none') return;

        // 根据模式获取模型名称
        let model;
        if (this.testMode === 'proxy') {
            const mappingEl = document.getElementById('testMappingSelect');
            model = mappingEl ? mappingEl.value.trim() : '';
            if (!model) { this.showToast('代理模式请选择映射模型', 'error'); return; }
        } else {
            model = document.getElementById('testModel').value.trim();
            if (!model) { this.showToast('请输入模型名称', 'error'); return; }
        }

        this.testModel = model;
        this.testStream = document.getElementById('testStream').checked;

        // 构建用户消息
        let userContent;
        const imgPreview = document.getElementById('testImagePreview');
        const hasImage = imgPreview && imgPreview.style.display !== 'none';
        if (hasImage) {
            userContent = [];
            if (text) userContent.push({ type: 'text', text });
            userContent.push({ type: 'image_url', image_url: { url: document.getElementById('testImageImg').src, detail: 'auto' } });
        } else {
            userContent = text;
        }

        this.testMessages.push({ role: 'user', content: userContent });
        this.removeTestImage();
        input.value = '';
        this.renderTestMessages();

        // 根据模式构建请求
        const isProxy = this.testMode === 'proxy';
        let reqModel, url, headers;

        const chatBase = this._apiBase || window.location.origin;
        if (isProxy) {
            reqModel = document.getElementById('testMappingSelect').value;
            url = new URL('/api/admin/test-chat', chatBase).href;
            headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.token,
            };
        } else {
            const provider = document.getElementById('testProvider').value;
            reqModel = provider ? provider + '/' + model : model;
            url = new URL('/api/admin/test-chat', chatBase).href;
            headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.token,
            };
        }

        const messages = this.testMessages.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content }));
        const body = {
            model: reqModel,
            messages,
            stream: this.testStream,
            temperature: parseFloat(document.getElementById('testTemp').value) || 0.7,
            max_tokens: parseInt(document.getElementById('testMaxTokens').value) || 0,
            proxy_mode: isProxy,
        };

        // 思考模式参数
        if (document.getElementById('testThinking') && document.getElementById('testThinking').checked) {
            const level = document.getElementById('testThinkingLevel') ? document.getElementById('testThinkingLevel').value : 'medium';
            body.thinking_enabled = true;
            body.reasoning_effort = level;
            // 思考模式下降低 temperature
            body.temperature = Math.min(body.temperature, 0.3);
        }

        // 注入客户端模拟头（仅直连模式）
        if (!isProxy) {
            const presetEl = document.getElementById('testClientPreset');
            const preset = presetEl ? presetEl.value : '';
            if (preset === 'openclaw') {
                body.extra_headers = {
                    'User-Agent': 'openclaw',
                    'X-OpenRouter-Title': 'OpenClaw',
                };
            } else if (preset === 'hermes') {
                body.extra_headers = {
                    'User-Agent': 'HermesAgent/1.0',
                    'copilot-integration-id': 'hermes-agent',
                };
            }
        }

        document.getElementById('testSendBtn').style.display = 'none';
        document.getElementById('testStopBtn').style.display = 'inline-flex';
        const modeLabel = isProxy ? '🌐 代理' : '🔌 直连';
        document.getElementById('testStatus').textContent = `${modeLabel} 请求中...`;
        document.getElementById('testStatus').className = 'badge badge-warning';
        this.testLoading = true;

        const inputCharCount = this.testMessages
            .filter(m => m.role === 'user')
            .reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
        let _lastStatusUpdate = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const updateStreamStatus = () => {
            const now = Date.now();
            if (now - _lastStatusUpdate < 200) return;
            _lastStatusUpdate = now;
            const lastMsg = this.testMessages[this.testMessages.length - 1];
            const thinkingLen = (lastMsg && lastMsg.thinking) ? lastMsg.thinking.length : 0;
            const contentLen = (lastMsg && lastMsg.content) ? lastMsg.content.length : 0;
            let statusText = `${modeLabel} 输入${inputCharCount}字`;
            if (totalInputTokens > 0 || totalOutputTokens > 0) statusText += ` | ↑${totalInputTokens} ↓${totalOutputTokens} tokens`;
            if (thinkingLen > 0) statusText += ` | 思考${thinkingLen}字`;
            if (contentLen > 0) statusText += ` | 输出${contentLen}字`;
            document.getElementById('testStatus').textContent = statusText;
        };

        // 添加空的助手消息用于流式追加
        this.testMessages.push({ role: 'assistant', content: '' });
        this.renderTestMessages();

        const maxContinueRounds = 5;
        const maxRetries = 3;
        let continueRound = 0;
        let retryCount = 0;

        try {
            let currentBody = { ...body };

            while (true) {
                let truncated = false;
                let streamError = null;
                this._continuationCleaned = false;
                this._continuationBuffer = '';

                if (this.testStream) {
                    this.testAbortCtrl = new AbortController();
                    try {
                        const resp = await fetch(url, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(currentBody),
                            signal: this.testAbortCtrl.signal,
                        });

                        if (!resp.ok) {
                            const errData = await resp.json().catch(() => ({}));
                            const errMsg = (errData.error && errData.error.message) || errData.error || errData.message || JSON.stringify(errData);
                            throw new Error('HTTP ' + resp.status + ': ' + errMsg);
                        }

                        const reader = resp.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                        let isAnthropicStream = false;
                        let lastFinishReason = '';
                        let lastStopReason = '';

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (line.startsWith('event: ')) {
                                    if (line.includes('message_start') || line.includes('content_block_delta') || line.includes('message_delta')) {
                                        isAnthropicStream = true;
                                    }
                                    continue;
                                }
                                if (!line.startsWith('data: ')) continue;
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') continue;
                                try {
                                    const parsed = JSON.parse(data);

                                    if (isAnthropicStream) {
                                        const type = parsed.type;
                                        if (type === 'message_start' && parsed.message && parsed.message.usage) {
                                            totalInputTokens = parsed.message.usage.input_tokens || 0;
                                        }
                                        if (type === 'content_block_delta') {
                                            const delta = parsed.delta || {};
                                            if (delta.type === 'text_delta' && delta.text) {
                                                const ct = this._applyContinuationClean(delta.text);
                                                if (ct) { this.testMessages[this.testMessages.length - 1].content += ct; this.renderTestMessages(); updateStreamStatus(); }
                                            } else if (delta.type === 'thinking_delta' && delta.thinking) {
                                                if (!this.testMessages[this.testMessages.length - 1].thinking) {
                                                    this.testMessages[this.testMessages.length - 1].thinking = '';
                                                }
                                                this.testMessages[this.testMessages.length - 1].thinking += delta.thinking;
                                                this.testMessages[this.testMessages.length - 1].thinkingCollapsed = false;
                                                this.renderTestMessages();
                                                updateStreamStatus();
                                            }
                                        } else if (type === 'message_delta') {
                                            const delta = parsed.delta || {};
                                            if (delta.stop_reason) {
                                                lastStopReason = delta.stop_reason;
                                            }
                                            if (parsed.usage && parsed.usage.output_tokens) {
                                                totalOutputTokens = parsed.usage.output_tokens;
                                                updateStreamStatus();
                                            }
                                        }
                                    } else {
                                        const choice = parsed.choices && parsed.choices[0];
                                        const anthropicContent = (parsed.content && parsed.content[0] && parsed.content[0].text) || '';
                                        if (!choice && anthropicContent) {
                                            const ct = this._applyContinuationClean(anthropicContent);
                                            if (ct) { this.testMessages[this.testMessages.length - 1].content += ct; this.renderTestMessages(); updateStreamStatus(); }
                                            continue;
                                        }
                                        if (!choice) continue;
                                        if (choice.finish_reason) {
                                            lastFinishReason = choice.finish_reason;
                                        }
                                        if (parsed.usage) {
                                            if (parsed.usage.prompt_tokens) totalInputTokens = parsed.usage.prompt_tokens;
                                            if (parsed.usage.completion_tokens) totalOutputTokens = parsed.usage.completion_tokens;
                                            updateStreamStatus();
                                        }
                                        const delta = choice.delta || {};
                                        const msgContent = (choice.message && choice.message.content) || '';
                                        const msgReasoning = (choice.message && (choice.message.reasoning_content || choice.message.thinking || choice.message.reasoning)) || '';
                                        const reasoning = delta.reasoning_content || delta.thinking || delta.reasoning || msgReasoning || parsed.reasoning_content || parsed.thinking || parsed.reasoning || '';
                                        if (reasoning) {
                                            if (!this.testMessages[this.testMessages.length - 1].thinking) {
                                                this.testMessages[this.testMessages.length - 1].thinking = '';
                                            }
                                            this.testMessages[this.testMessages.length - 1].thinking += reasoning;
                                            this.testMessages[this.testMessages.length - 1].thinkingCollapsed = false;
                                            this.renderTestMessages();
                                            updateStreamStatus();
                                        }
                                        const content = delta.content || msgContent || '';
                                        if (content) {
                                            const ct = this._applyContinuationClean(content);
                                            if (ct) { this.testMessages[this.testMessages.length - 1].content += ct; this.renderTestMessages(); updateStreamStatus(); }
                                        }
                                    }
                                } catch {}
                            }
                        }

                        truncated = (lastFinishReason === 'length' || lastStopReason === 'max_tokens');
                        if (!truncated) {
                            const lastMsg = this.testMessages[this.testMessages.length - 1];
                            if (lastMsg && lastMsg.thinking && !lastMsg.content) {
                                truncated = true;
                            }
                        }
                    } catch (e) {
                        if (e.name === 'AbortError') throw e;
                        streamError = e;
                    }
                } else {
                    try {
                        const resp = await fetch(url, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(currentBody),
                        });
                        const res = await resp.json();
                        if (!resp.ok) {
                            const errMsg = (res.error && res.error.message) || res.error || res.message || JSON.stringify(res);
                            throw new Error('HTTP ' + resp.status + ': ' + errMsg);
                        }
                        let content = '';
                        let thinking = '';
                        let inputTokens = 0;
                        let outputTokens = 0;
                        let finishReason = '';
                        if (res.choices) {
                            const message = res.choices[0] && res.choices[0].message;
                            content = (message && message.content) || '';
                            thinking = (message && (message.reasoning_content || message.thinking || message.reasoning)) || '';
                            inputTokens = (res.usage && res.usage.prompt_tokens) || 0;
                            outputTokens = (res.usage && res.usage.completion_tokens) || 0;
                            totalInputTokens = inputTokens;
                            totalOutputTokens = outputTokens;
                            finishReason = (res.choices[0] && res.choices[0].finish_reason) || '';
                        } else if (res.content) {
                            const textBlocks = res.content.filter(b => b.type === 'text');
                            content = textBlocks.map(b => b.text).join('');
                            thinking = res.thinking || res.reasoning_content || '';
                            inputTokens = (res.usage && res.usage.input_tokens) || 0;
                            outputTokens = (res.usage && res.usage.output_tokens) || 0;
                            totalInputTokens = inputTokens;
                            totalOutputTokens = outputTokens;
                            finishReason = res.stop_reason || '';
                        }
                        this.testMessages[this.testMessages.length - 1].content += this._applyContinuationClean(content);
                        if (thinking) {
                                            if (!this.testMessages[this.testMessages.length - 1].thinking) {
                                                this.testMessages[this.testMessages.length - 1].thinking = '';
                                            }
                            this.testMessages[this.testMessages.length - 1].thinking += thinking;
                        }
                        this.renderTestMessages();
                        truncated = (finishReason === 'length' || finishReason === 'max_tokens');
                        if (!truncated) {
                            const lastMsg = this.testMessages[this.testMessages.length - 1];
                            if (lastMsg && lastMsg.thinking && !lastMsg.content) {
                                truncated = true;
                            }
                        }
                    } catch (e) {
                        streamError = e;
                    }
                }

                if (streamError) {
                    retryCount++;
                    if (retryCount <= maxRetries) {
                        document.getElementById('testStatus').textContent = `${modeLabel} 出错，重试 ${retryCount}/${maxRetries}...`;
                        document.getElementById('testStatus').className = 'badge badge-warning';
                        await new Promise(r => setTimeout(r, 1000 * retryCount));
                        continue;
                    }
                    throw streamError;
                }

                retryCount = 0;

                if (truncated && continueRound < maxContinueRounds) {
                    continueRound++;
                    const allAssistantContent = this.testMessages
                        .filter(m => m.role === 'assistant')
                        .reduce((acc, m) => acc + (m.content || ''), '');
                    const allAssistantThinking = this.testMessages
                        .filter(m => m.role === 'assistant')
                        .reduce((acc, m) => acc + (m.thinking || ''), '');
                    const openTicks = (allAssistantContent.match(/```/g) || []).length;
                    const inCodeBlock = openTicks % 2 === 1;
                    const continueMessages = this.testMessages
                        .filter(m => m.role !== 'error')
                        .map(m => ({ role: m.role, content: m.content }));
                    let mergedContent = allAssistantContent;
                    if (inCodeBlock) {
                        mergedContent += '\n```';
                    }
                    continueMessages[continueMessages.length - 1].content = mergedContent;
                    let continueSuffix = '';
                    if (inCodeBlock) {
                        const lastTickIdx = allAssistantContent.lastIndexOf('```');
                        const afterTick = allAssistantContent.slice(lastTickIdx + 3);
                        const nlIdx = afterTick.indexOf('\n');
                        const codeLang = nlIdx > 0 ? afterTick.slice(0, nlIdx).trim() : '';
                        const lastLines = allAssistantContent.split('\n').slice(-5).join('\n');
                        continueSuffix = '\n\n[IMPORTANT CONTINUATION RULES:\n1. Your previous response was cut off inside a code block. The code block has been closed.\n2. You MUST output ONLY the remaining code content. Start with a new ```' + codeLang + ' block if you need to continue code.\n3. Do NOT write any transitional text like "我继续", "以下是", "继续完成", "接下来", "Here is the continuation", etc.\n4. Do NOT repeat any code that was already output.\n5. Last few lines before cutoff:\n' + lastLines + '\n]';
                    } else if (allAssistantContent.length > 0) {
                        const tailLen = Math.min(allAssistantContent.length, 500);
                        const tail = allAssistantContent.slice(-tailLen);
                        continueSuffix = '\n\n[IMPORTANT CONTINUATION RULES:\n1. Your previous response was cut off due to length limit.\n2. You MUST continue EXACTLY from where you left off. Do NOT add any transitional text.\n3. Do NOT write "我继续", "以下是", "继续完成", "接下来", "Here is the continuation", etc.\n4. Do NOT repeat any content already output.\n5. End of previous output:\n' + tail + '\n]';
                    } else {
                        continueSuffix = '\n\n[IMPORTANT: Your previous response was cut off. Continue outputting content directly. Do NOT add transitional text. Do NOT re-think.]';
                    }
                    continueMessages[continueMessages.length - 1].content += continueSuffix;
                    currentBody = { ...body, messages: continueMessages };
                    currentBody.thinking_enabled = false;
                    currentBody.reasoning_effort = '';
                    currentBody.thinking_budget = 0;
                    this.testMessages[this.testMessages.length - 1].content = allAssistantContent;
                    this.testMessages[this.testMessages.length - 1].thinking = allAssistantThinking;
                    this._continueRound = continueRound;
                    this._prevContentLen = allAssistantContent.length;
                    this._prevContent = allAssistantContent;
                    this._wasInCodeBlock = inCodeBlock;
                    document.getElementById('testStatus').textContent = `${modeLabel} 续写中... (第${continueRound}次)`;
                    document.getElementById('testStatus').className = 'badge badge-warning';
                    continue;
                }

                break;
            }

            const totalContent = this.testMessages
                .filter(m => m.role === 'assistant')
                .reduce((sum, m) => sum + (m.content || '').length, 0);
            const suffix = continueRound > 0 ? ` (续写${continueRound}次)` : '';
            const tokenInfo = (totalInputTokens > 0 || totalOutputTokens > 0) ? ` ↑${totalInputTokens} ↓${totalOutputTokens} tokens` : '';
            document.getElementById('testStatus').textContent = `${modeLabel} 完成${tokenInfo} (${totalContent}字符)${suffix}`;
            document.getElementById('testStatus').className = 'badge badge-success';
        } catch (e) {
            if (e.name === 'AbortError') {
                document.getElementById('testStatus').textContent = '已停止';
                document.getElementById('testStatus').className = 'badge badge-warning';
            } else {
                const lastAssistant = this.testMessages[this.testMessages.length - 1];
                if (lastAssistant && lastAssistant.role === 'assistant' && !lastAssistant.content) {
                    this.testMessages.pop();
                }
                this.testMessages.push({ role: 'error', content: e.message });
                this.renderTestMessages();
                document.getElementById('testStatus').textContent = '失败';
                document.getElementById('testStatus').className = 'badge badge-danger';
            }
        } finally {
            this.testLoading = false;
            this.testAbortCtrl = null;
            document.getElementById('testSendBtn').style.display = 'inline-flex';
            document.getElementById('testStopBtn').style.display = 'none';
        }
    },

    _cleanContinuationText(text, prevContent, wasInCodeBlock) {
        if (!this._continueRound || this._continueRound <= 0) return text;
        let cleaned = text;
        const transitionPatterns = [
            /^[\s]*我继续[^\n]*\n?/,
            /^[\s]*继续完成[^\n]*\n?/,
            /^[\s]*接下来[^\n]*\n?/,
            /^[\s]*以下是[^\n]*\n?/,
            /^[\s]*下面是[^\n]*\n?/,
            /^[\s]*Here\s+is\s+the\s+continuation[^\n]*\n?/i,
            /^[\s]*Continuing[^\n]*\n?/i,
            /^[\s]*I'll\s+continue[^\n]*\n?/i,
            /^[\s]*Let\s+me\s+continue[^\n]*\n?/i,
            /^[\s]*Now\s+I'll\s+continue[^\n]*\n?/i,
            /^[\s]*The\s+rest\s+of[^\n]*\n?/i,
            /^[\s]*剩余[^\n]*\n?/,
            /^[\s]*接着[^\n]*\n?/,
            /^[\s]*然后[^\n]*\n?/,
        ];
        for (const pat of transitionPatterns) {
            cleaned = cleaned.replace(pat, '');
        }
        if (wasInCodeBlock) {
            cleaned = cleaned.replace(/^[\s]*```[a-zA-Z]*\s*\n?/, '');
        }
        if (prevContent && prevContent.length > 20) {
            const prevTail = prevContent.slice(-50).trim();
            const cleanedStart = cleaned.slice(0, Math.min(100, cleaned.length));
            if (prevTail.length > 10 && cleanedStart.includes(prevTail.slice(0, 30))) {
                const overlapIdx = cleaned.indexOf(prevTail.slice(-20));
                if (overlapIdx >= 0 && overlapIdx < 80) {
                    cleaned = cleaned.slice(overlapIdx + prevTail.slice(-20).length);
                }
            }
        }
        return cleaned;
    },

    _applyContinuationClean(deltaText) {
        if (!this._continueRound || this._continueRound <= 0) return deltaText;
        if (!this._continuationCleaned) {
            this._continuationBuffer = (this._continuationBuffer || '') + deltaText;
            if (this._continuationBuffer.length > 200) {
                const cleaned = this._cleanContinuationText(
                    this._continuationBuffer,
                    this._prevContent || '',
                    this._wasInCodeBlock || false
                );
                this._continuationCleaned = true;
                this._continuationBuffer = '';
                return cleaned;
            }
            return '';
        }
        return deltaText;
    },

    stopTestStream() {
        if (this.testAbortCtrl) {
            this.testAbortCtrl.abort();
        }
    },

    // ========== 门户用户管理 ==========
    _portalUserPage: 1,
    _portalUserPageSize: 20,
    async renderPortalUsers() {
        this._selectedPortalUsers = new Set();
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>👤 门户用户管理</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>用户列表</h3>
                    <div style="display:flex;gap:8px;align-items:center">
                        <button class="btn btn-danger" id="batchDeletePortalUsersBtn" style="display:none" onclick="App.batchDeletePortalUsers()">🗑️ 批量删除 (<span id="selectedPortalUserCount">0</span>)</button>
                        <button class="btn btn-primary" onclick="App.showCreatePortalUserModal()">+ 创建用户</button>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th><input type="checkbox" id="portalUserSelectAll" onchange="App.toggleSelectAllPortalUsers(this.checked)"></th><th>用户名</th><th>显示名称</th><th>邮箱</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody id="portalUsersBody"><tr><td colspan="7" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
                <div id="portalUsersPagination" style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--border-color);"></div>
            </div>
        `;
        await this.loadPortalUsers();
    },

    async loadPortalUsers() {
        try {
            const data = await this.api('GET', '/api/admin/portal-users');
            const body = document.getElementById('portalUsersBody');
            const pagination = document.getElementById('portalUsersPagination');
            if (data.users && data.users.length > 0) {
                const total = data.users.length;
                const totalPages = Math.max(1, Math.ceil(total / this._portalUserPageSize));
                if (this._portalUserPage > totalPages) this._portalUserPage = totalPages;
                const start = (this._portalUserPage - 1) * this._portalUserPageSize;
                const end = Math.min(start + this._portalUserPageSize, total);
                const pageUsers = data.users.slice(start, end);

                body.innerHTML = pageUsers.map(u => `
                    <tr>
                        <td><input type="checkbox" class="portal-user-checkbox" data-id="${u.id}" onchange="App.togglePortalUserSelection('${u.id}', this.checked)" ${this._selectedPortalUsers.has(u.id) ? 'checked' : ''}></td>
                        <td>${this.esc(u.username)}</td>
                        <td>${this.esc(u.display_name || '-')}</td>
                        <td>${this.esc(u.email || '-')}</td>
                        <td><span class="badge ${u.is_active ? 'badge-success' : 'badge-danger'}">${u.is_active ? '启用' : '禁用'}</span></td>
                        <td class="text-muted">${this.formatDateTime(u.created_at)}</td>
                        <td>
                            <button class="btn btn-sm btn-outline" onclick="App.showEditPortalUserModal('${u.id}', '${this.esc(u.username)}', '${this.esc(u.display_name || '')}', '${this.esc(u.email || '')}')">编辑</button>
                            <button class="btn btn-sm btn-outline" onclick="App.togglePortalUser('${u.id}', ${u.is_active})">${u.is_active ? '禁用' : '启用'}</button>
                            <button class="btn btn-sm btn-danger" onclick="App.deletePortalUser('${u.id}', '${this.esc(u.username)}')">删除</button>
                        </td>
                    </tr>
                `).join('');

                if (totalPages > 1) {
                    pagination.innerHTML = '<button class="btn btn-sm btn-outline" ' + (this._portalUserPage <= 1 ? 'disabled' : 'onclick="App._portalUserPage--;App.loadPortalUsers()') + '">上一页</button>' +
                        '<span style="font-size:13px;color:var(--text-secondary);">第 ' + this._portalUserPage + ' / ' + totalPages + ' 页 (共' + total + '个用户)</span>' +
                        '<button class="btn btn-sm btn-outline" ' + (this._portalUserPage >= totalPages ? 'disabled' : 'onclick="App._portalUserPage++;App.loadPortalUsers()') + '">下一页</button>';
                } else {
                    pagination.innerHTML = '<span style="font-size:13px;color:var(--text-secondary);">共 ' + total + ' 个用户</span>';
                }
            } else {
                body.innerHTML = '<tr><td colspan="6" class="text-center text-muted">暂无用户</td></tr>';
                if (pagination) pagination.innerHTML = '';
            }
        } catch (err) {
            if (!this._isCancelledError(err)) this.showToast('加载失败: ' + err.message, 'error');
        }
    },

    showEditPortalUserModal(id, username, displayName, email) {
        this.showModal('编辑门户用户', `
            <form id="editPortalUserForm">
                <div class="form-group"><label>用户名</label><input type="text" class="form-control" value="${this.esc(username)}" disabled></div>
                <div class="form-group"><label>显示名称</label><input type="text" id="editPuDisplayName" class="form-control" value="${this.esc(displayName)}" placeholder="显示名称"></div>
                <div class="form-group"><label>邮箱</label><input type="email" id="editPuEmail" class="form-control" value="${this.esc(email)}" placeholder="邮箱地址"></div>
                <div class="form-group">
                    <label>重置密码</label>
                    <input type="password" id="editPuNewPassword" class="form-control" placeholder="留空则不修改密码">
                    <small style="color: var(--text-muted); margin-top: 4px; display: block;">如需重置密码请输入新密码（至少6位），留空则不修改</small>
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '保存', class: 'btn-primary', action: () => this.updatePortalUser(id) }
        ]);
    },

    async updatePortalUser(id) {
        const displayName = document.getElementById('editPuDisplayName').value.trim();
        const email = document.getElementById('editPuEmail').value.trim();
        const newPassword = document.getElementById('editPuNewPassword').value;

        if (newPassword && newPassword.length < 6) {
            this.showToast('新密码至少6位', 'error');
            return;
        }

        try {
            const payload = { display_name: displayName, email };
            if (newPassword) payload.new_password = newPassword;
            await this.api('PUT', `/api/admin/portal-users/${id}`, payload);
            this.closeModal();
            this.showToast('用户信息已更新', 'success');
            this.loadPortalUsers();
        } catch (err) {
            this.showToast('更新失败: ' + err.message, 'error');
        }
    },

    showCreatePortalUserModal() {
        this.showModal('创建门户用户', `
            <form id="createPortalUserForm">
                <div class="form-group"><label>用户名 *</label><input type="text" id="puUsername" placeholder="用户名" required></div>
                <div class="form-group"><label>密码 *</label><input type="password" id="puPassword" placeholder="密码（至少6位）" required></div>
                <div class="form-group"><label>显示名称</label><input type="text" id="puDisplayName" placeholder="显示名称"></div>
                <div class="form-group"><label>邮箱</label><input type="email" id="puEmail" placeholder="邮箱地址"></div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.createPortalUser() }
        ]);
    },

    async createPortalUser() {
        const username = document.getElementById('puUsername').value.trim();
        const password = document.getElementById('puPassword').value;
        const displayName = document.getElementById('puDisplayName').value.trim();
        const email = document.getElementById('puEmail').value.trim();

        if (!username || !password) {
            this.showToast('用户名和密码不能为空', 'error');
            return;
        }
        if (password.length < 6) {
            this.showToast('密码至少6位', 'error');
            return;
        }

        try {
            await this.api('POST', '/api/admin/portal-users', { username, password, display_name: displayName, email });
            this.closeModal();
            this.showToast('用户创建成功', 'success');
            this.loadPortalUsers();
        } catch (err) {
            this.showToast('创建失败: ' + err.message, 'error');
        }
    },

    async togglePortalUser(id, isActive) {
        try {
            await this.api('PUT', `/api/admin/portal-users/${id}/toggle`, { is_active: !isActive });
            this.showToast(isActive ? '已禁用' : '已启用', 'success');
            this.loadPortalUsers();
        } catch (err) {
            this.showToast('操作失败: ' + err.message, 'error');
        }
    },

    async deletePortalUser(id, username) {
        if (!confirm(`确定要删除用户 "${username}" 吗？此操作不可恢复。`)) return;
        try {
            await this.api('DELETE', `/api/admin/portal-users/${id}`);
            this.showToast('已删除', 'success');
            this.loadPortalUsers();
        } catch (err) {
            this.showToast('删除失败: ' + err.message, 'error');
        }
    },

    togglePortalUserSelection(id, checked) {
        if (checked) { this._selectedPortalUsers.add(id); } else { this._selectedPortalUsers.delete(id); }
        this.updatePortalUserSelectionUI();
    },

    toggleSelectAllPortalUsers(checked) {
        document.querySelectorAll('.portal-user-checkbox').forEach(cb => {
            const id = cb.dataset.id;
            if (checked) { this._selectedPortalUsers.add(id); cb.checked = true; } else { this._selectedPortalUsers.delete(id); cb.checked = false; }
        });
        this.updatePortalUserSelectionUI();
    },

    updatePortalUserSelectionUI() {
        const count = this._selectedPortalUsers.size;
        const btn = document.getElementById('batchDeletePortalUsersBtn');
        const countEl = document.getElementById('selectedPortalUserCount');
        if (btn) btn.style.display = count > 0 ? 'inline-flex' : 'none';
        if (countEl) countEl.textContent = count;
    },

    async batchDeletePortalUsers() {
        const ids = Array.from(this._selectedPortalUsers);
        if (ids.length === 0) { this.showToast('请选择要删除的用户', 'error'); return; }
        if (!confirm(`确定要删除选中的 ${ids.length} 个用户吗？此操作不可恢复。`)) return;
        try {
            const res = await this.api('POST', '/api/admin/portal-users/batch-delete', { ids });
            const msg = res.failed > 0 ? `已删除 ${res.deleted_count} 个用户，${res.failed} 个删除失败` : `已删除 ${res.deleted_count} 个用户`;
            this.showToast(msg, res.failed > 0 ? 'error' : 'success');
            this._selectedPortalUsers.clear();
            this.loadPortalUsers();
        } catch (err) {
            this.showToast('批量删除失败: ' + err.message, 'error');
        }
    },

    _accessLogOffset: 0,
    async renderAccessLogs() {
        this._accessLogOffset = 0;
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>📝 管理后台访问日志</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>访问记录</h3>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        <input type="text" id="accessLogUserFilter" placeholder="按用户名筛选" class="form-control" style="width:130px" onkeydown="if(event.key==='Enter')App.loadAccessLogs()">
                        <input type="text" id="accessLogActionFilter" placeholder="按操作筛选" class="form-control" style="width:130px" onkeydown="if(event.key==='Enter')App.loadAccessLogs()">
                        <input type="date" id="accessLogStartDate" class="form-control" style="width:140px" title="开始日期">
                        <span style="color:var(--text-secondary)">至</span>
                        <input type="date" id="accessLogEndDate" class="form-control" style="width:140px" title="结束日期">
                        <button class="btn btn-outline" onclick="App.loadAccessLogs()">刷新</button>
                        <button class="btn btn-danger" onclick="App.deleteAccessLogsByDateRange()">🗑️ 删除日期范围</button>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>时间</th><th>用户</th><th>角色</th><th>操作</th><th>IP</th><th>状态码</th></tr></thead>
                        <tbody id="accessLogBody"><tr><td colspan="6" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0" id="accessLogPagination"></div>
            </div>
        `;
        await this.loadAccessLogs();
    },

    async loadAccessLogs() {
        const username = document.getElementById('accessLogUserFilter')?.value?.trim() || '';
        const action = document.getElementById('accessLogActionFilter')?.value?.trim() || '';
        try {
            let url = `/api/admin/audit-logs?limit=50&offset=${this._accessLogOffset}`;
            if (username) url += `&username=${encodeURIComponent(username)}`;
            if (action) url += `&action=${encodeURIComponent(action)}`;
            const res = await this.api('GET', url);
            const tbody = document.getElementById('accessLogBody');
            if (!tbody) return;
            const list = res.logs || [];
            if (list.length > 0) {
                tbody.innerHTML = list.map(l => {
                    const actionDesc = l.action || (l.method + ' ' + l.path);
                    return `<tr>
                        <td class="text-muted" style="white-space:nowrap">${this.formatDateTime(l.created_at)}</td>
                        <td><strong>${this.esc(l.username)}</strong></td>
                        <td><span class="badge ${l.role === 'admin' ? 'badge-success' : 'badge-info'}">${this.esc(l.role)}</span></td>
                        <td style="font-size:12px">${this.esc(actionDesc)}</td>
                        <td style="font-size:12px">${this.esc(l.ip || '-')}</td>
                        <td><span style="font-size:12px;color:${l.status_code >= 400 ? '#e74c3c' : '#27ae60'}">${l.status_code}</span></td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><div class="empty-icon">📝</div>暂无访问记录</td></tr>';
            }
            const total = res.total || 0;
            const pg = document.getElementById('accessLogPagination');
            if (pg) {
                const page = Math.floor(this._accessLogOffset / 50) + 1;
                const totalPages = Math.ceil(total / 50);
                pg.innerHTML = `<span class="text-muted">共 ${total} 条记录，第 ${page}/${totalPages || 1} 页</span>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-sm btn-outline" ${this._accessLogOffset <= 0 ? 'disabled' : ''} onclick="App._accessLogOffset-=50;App.loadAccessLogs()">上一页</button>
                        <button class="btn btn-sm btn-outline" ${this._accessLogOffset + 50 >= total ? 'disabled' : ''} onclick="App._accessLogOffset+=50;App.loadAccessLogs()">下一页</button>
                    </div>`;
            }
        } catch (err) {
            console.error('loadAccessLogs error:', err);
            const tbody = document.getElementById('accessLogBody');
            if (tbody && !this._isCancelledError(err)) tbody.innerHTML = '<tr><td colspan="6" class="table-empty text-danger">加载失败: ' + this.esc(err.message) + '</td></tr>';
        }
    },

    _inviteTab: 'templates',
    _inviteTemplateOffset: 0,

    async deleteAccessLogsByDateRange() {
        const startDate = document.getElementById('accessLogStartDate')?.value;
        const endDate = document.getElementById('accessLogEndDate')?.value;
        if (!startDate || !endDate) { this.showToast('请选择开始和结束日期', 'error'); return; }
        if (startDate > endDate) { this.showToast('开始日期不能大于结束日期', 'error'); return; }
        if (!confirm(`确定要删除 ${startDate} 到 ${endDate} 之间的所有访问日志吗？此操作不可恢复。`)) return;
        try {
            const res = await this.api('POST', '/api/admin/audit-logs/delete-by-date', { start_date: startDate, end_date: endDate });
            this.showToast(`已删除 ${res.deleted_count} 条日志`, 'success');
            this.loadAccessLogs();
        } catch (err) {
            this.showToast('删除失败: ' + err.message, 'error');
        }
    },

    _inviteCodeOffset: 0,

    async renderInvites() {
        this._inviteTab = this._inviteTab || 'templates';
        document.getElementById('mainContent').innerHTML = `
            <div class="page-header">
                <h2>🎫 邀请码管理</h2>
            </div>
            <div class="tab-bar" style="display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border-color)">
                <div class="tab-item ${this._inviteTab === 'templates' ? 'active' : ''}" onclick="App._inviteTab='templates';App.renderInvites()" style="padding:10px 20px;cursor:pointer;border-bottom:2px solid ${this._inviteTab === 'templates' ? 'var(--accent-blue)' : 'transparent'};color:${this._inviteTab === 'templates' ? 'var(--accent-blue)' : 'var(--text-secondary)'}">邀请模板</div>
                <div class="tab-item ${this._inviteTab === 'codes' ? 'active' : ''}" onclick="App._inviteTab='codes';App.renderInvites()" style="padding:10px 20px;cursor:pointer;border-bottom:2px solid ${this._inviteTab === 'codes' ? 'var(--accent-blue)' : 'transparent'};color:${this._inviteTab === 'codes' ? 'var(--accent-blue)' : 'var(--text-secondary)'}">邀请码</div>
            </div>
            <div id="inviteContent"></div>
        `;
        if (this._inviteTab === 'templates') {
            await this.renderInviteTemplates();
        } else {
            await this.renderInviteCodes();
        }
    },

    async renderInviteTemplates() {
        const content = document.getElementById('inviteContent');
        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <span class="text-muted">管理邀请模板，定义通过邀请码注册后创建的 API Key 参数</span>
                <button class="btn btn-primary" onclick="App.showCreateInviteTemplateModal()">+ 创建模板</button>
            </div>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>名称</th><th>计费模式</th><th>月度配额</th><th>积分余额</th><th>5h次数</th><th>周次数</th><th>月次数</th><th>限流</th><th>已生成/已使用</th><th>上限</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody id="inviteTemplateBody"><tr><td colspan="12" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                </table>
            </div>
        `;
        try {
            const res = await this.api('GET', '/api/admin/invite-templates');
            const tbody = document.getElementById('inviteTemplateBody');
            if (res.templates && res.templates.length > 0) {
                tbody.innerHTML = res.templates.map(t => `
                    <tr>
                        <td><strong>${this.esc(t.name)}</strong>${t.client_id_fixed !== false ? '' : '<br><span style="color:var(--accent-orange);font-size:11px">🔓 透传 → ' + this.esc(t.client_id || '') + '</span>'}${t.description ? '<br><span class="text-muted" style="font-size:12px">' + this.esc(t.description) + '</span>' : ''}</td>
                        <td><span class="badge badge-${t.billing_mode === 'per_token' ? 'blue' : t.billing_mode === 'per_request' ? 'green' : t.billing_mode === 'coding_plan' ? 'orange' : 'purple'}">${this.billingModeLabel(t.billing_mode)}</span></td>
                        <td>${t.monthly_quota || '不限'}</td>
                        <td>${t.credits_balance || '-'}</td>
                        <td>${t.billing_mode === 'coding_plan' ? (t.quota_5h || '不限') : '-'}</td>
                        <td>${t.billing_mode === 'coding_plan' ? (t.quota_weekly || '不限') : '-'}</td>
                        <td>${t.billing_mode === 'coding_plan' ? (t.quota_monthly || '不限') : '-'}</td>
                        <td>${t.rate_limit}/分</td>
                        <td>${t.total_generated} / ${t.total_used}</td>
                        <td>${t.max_uses || '不限'}</td>
                        <td><span class="badge badge-${t.is_active ? 'green' : 'red'}">${t.is_active ? '启用' : '停用'}</span></td>
                        <td>
                            <button class="btn btn-sm btn-outline" onclick="App.showGenerateInviteCodesModal('${t.id}','${this.esc(t.name)}')">生成码</button>
                            <button class="btn btn-sm btn-outline" onclick="App.showEditInviteTemplateModal('${t.id}')">编辑</button>
                            <button class="btn btn-sm btn-danger" onclick="App.deleteInviteTemplate('${t.id}','${this.esc(t.name)}')">删除</button>
                        </td>
                    </tr>`).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="empty-icon">🎫</div>暂无邀请模板</td></tr>';
            }
        } catch (err) {
            if (!this._isCancelledError(err)) document.getElementById('inviteTemplateBody').innerHTML = '<tr><td colspan="9" class="table-empty text-danger">加载失败: ' + this.esc(err.message) + '</td></tr>';
        }
    },

    async renderInviteCodes() {
        const content = document.getElementById('inviteContent');
        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <div style="display:flex;gap:10px;align-items:center">
                    <select id="inviteCodeFilter" class="form-control" style="width:120px" onchange="App.loadInviteCodes()">
                        <option value="">全部</option>
                        <option value="false">未使用</option>
                        <option value="true">已使用</option>
                    </select>
                    <button class="btn btn-sm btn-danger" id="batchDeleteBtn" style="display:none" onclick="App.batchDeleteInviteCodes()">删除选中</button>
                </div>
                <button class="btn btn-outline" onclick="App.loadInviteCodes()">刷新</button>
            </div>
            <div class="table-wrapper">
                <table>
                    <thead><tr>
                        <th style="width:30px"><input type="checkbox" id="selectAllCodes" onchange="App.toggleSelectAllCodes(this.checked)"></th>
                        <th>邀请码</th><th>模板</th><th>状态</th><th>用户</th><th>有效期</th><th>创建时间</th><th>使用时间</th><th>链接</th><th>操作</th>
                    </tr></thead>
                    <tbody id="inviteCodeBody"><tr><td colspan="10" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                </table>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0" id="inviteCodePagination"></div>
        `;
        this._selectedCodeIds = new Set();
        await this.loadInviteCodes();
    },

    toggleSelectAllCodes(checked) {
        const cbs = document.querySelectorAll('.code-checkbox');
        cbs.forEach(cb => { cb.checked = checked; if (checked) this._selectedCodeIds.add(cb.dataset.id); else this._selectedCodeIds.delete(cb.dataset.id); });
        this._updateBatchDeleteBtn();
    },

    toggleCodeSelect(id, checked) {
        if (checked) this._selectedCodeIds.add(id); else this._selectedCodeIds.delete(id);
        this._updateBatchDeleteBtn();
    },

    _updateBatchDeleteBtn() {
        const btn = document.getElementById('batchDeleteBtn');
        if (btn) { btn.style.display = this._selectedCodeIds.size > 0 ? 'inline-flex' : 'none'; btn.textContent = `删除选中(${this._selectedCodeIds.size})`; }
    },

    async batchDeleteInviteCodes() {
        const ids = Array.from(this._selectedCodeIds);
        if (ids.length === 0) return;
        if (!confirm(`确定要删除选中的 ${ids.length} 个邀请码吗？（已使用的不会被删除）`)) return;
        try {
            const res = await this.api('POST', '/api/admin/invite-codes/batch-delete', { ids });
            this.showToast(`已删除 ${res.deleted || 0} 个邀请码`, 'success');
            this._selectedCodeIds.clear();
            this.loadInviteCodes();
        } catch (err) {
            this.showToast('批量删除失败: ' + err.message, 'error');
        }
    },

    async loadInviteCodes() {
        const isUsed = document.getElementById('inviteCodeFilter')?.value || '';
        try {
            const params = new URLSearchParams();
            if (isUsed) params.set('is_used', isUsed);
            params.set('limit', '50');
            params.set('offset', String(this._inviteCodeOffset));
            const res = await this.api('GET', '/api/admin/invite-codes?' + params.toString());
            const tbody = document.getElementById('inviteCodeBody');
            if (res.codes && res.codes.length > 0) {
                tbody.innerHTML = res.codes.map(c => {
                    const expiresStr = c.expires_at ? this.formatDate(c.expires_at) : '-';
                    const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                    const expiryBadge = c.expires_at ? (isExpired ? '<span class="badge badge-red">已过期</span>' : '<span style="font-size:11px;color:var(--accent-green);">' + expiresStr + '</span>') : '-';
                    const shareBtn = c.invite_url ? `<button class="btn btn-sm btn-outline" onclick="App.shareInviteCode('${this.esc(c.invite_url)}','${this.esc(c.code)}')">🔗分享</button>` : '';
                    const editBtn = !c.is_used ? `<button class="btn btn-sm btn-outline" onclick="App.showEditInviteCodeModal('${c.id}','${this.esc(c.code)}',${c.expiry_days || 30})">修改</button>` : '';
                    const delBtn = !c.is_used ? `<button class="btn btn-sm btn-danger" onclick="App.deleteInviteCode('${c.id}','${this.esc(c.code)}')">删除</button>` : '';
                    return `<tr>
                        <td>${!c.is_used ? '<input type="checkbox" class="code-checkbox" data-id="' + c.id + '" ' + (this._selectedCodeIds.has(c.id) ? 'checked' : '') + ' onchange="App.toggleCodeSelect(\'' + c.id + '\',this.checked)">' : ''}</td>
                        <td><code style="font-size:14px;letter-spacing:1px;background:var(--bg-secondary);padding:2px 8px;border-radius:4px">${this.esc(c.code)}</code></td>
                        <td>${this.esc(c.template_name)}</td>
                        <td><span class="badge badge-${c.is_used ? 'red' : 'green'}">${c.is_used ? '已使用' : '未使用'}</span></td>
                        <td>${c.username || '-'}</td>
                        <td>${expiryBadge}</td>
                        <td style="font-size:12px">${this.formatDate(c.created_at)}</td>
                        <td style="font-size:12px">${c.used_at ? this.formatDate(c.used_at) : '-'}</td>
                        <td>${shareBtn}</td>
                        <td style="white-space:nowrap">${editBtn} ${delBtn}</td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="10" class="table-empty"><div class="empty-icon">🎫</div>暂无邀请码</td></tr>';
            }
            const total = res.total || 0;
            const pg = document.getElementById('inviteCodePagination');
            if (pg) {
                const page = Math.floor(this._inviteCodeOffset / 50) + 1;
                const totalPages = Math.ceil(total / 50);
                pg.innerHTML = `<span class="text-muted">共 ${total} 个邀请码，第 ${page}/${totalPages || 1} 页</span>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-sm btn-outline" ${this._inviteCodeOffset <= 0 ? 'disabled' : ''} onclick="App._inviteCodeOffset-=50;App.loadInviteCodes()">上一页</button>
                        <button class="btn btn-sm btn-outline" ${this._inviteCodeOffset + 50 >= total ? 'disabled' : ''} onclick="App._inviteCodeOffset+=50;App.loadInviteCodes()">下一页</button>
                    </div>`;
            }
            this._updateBatchDeleteBtn();
        } catch (err) {
            if (!this._isCancelledError(err)) document.getElementById('inviteCodeBody').innerHTML = '<tr><td colspan="10" class="table-empty text-danger">加载失败: ' + this.esc(err.message) + '</td></tr>';
        }
    },

    shareInviteCode(urlOrPath, code) {
        const fullUrl = urlOrPath.startsWith('http') ? urlOrPath : (window.location.origin + urlOrPath);
        this.showModal('分享邀请码', `
            <div style="text-align:center;margin-bottom:16px">
                <div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px">邀请码: <strong>${this.esc(code)}</strong></div>
                <div style="background:var(--bg-secondary);padding:12px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;border:1px solid var(--border-color)">${this.esc(fullUrl)}</div>
            </div>
            <div style="color:var(--text-muted);font-size:13px;text-align:center">用户点击链接可直接进入注册页面</div>
        `, [
            { text: '复制链接', class: 'btn-primary', action: () => { navigator.clipboard.writeText(fullUrl).then(() => { this.showToast('链接已复制到剪贴板', 'success'); this.closeModal(); }); } },
            { text: '关闭', class: 'btn-outline', action: () => this.closeModal() }
        ]);
    },

    showEditInviteCodeModal(codeId, code, currentExpiryDays) {
        this.showModal('修改邀请码', `
            <div style="background:var(--bg-secondary);padding:12px;border-radius:6px;margin-bottom:16px;font-family:monospace;letter-spacing:1px;text-align:center;font-size:16px">${this.esc(code)}</div>
            <div class="form-group"><label>有效期</label><select class="form-control" id="editCodeExpiry"><option value="7" ${currentExpiryDays===7?'selected':''}>7天</option><option value="15" ${currentExpiryDays===15?'selected':''}>15天</option><option value="30" ${currentExpiryDays===30?'selected':''}>30天</option></select></div>
            <div style="color:var(--text-muted);font-size:13px">⚠️ 修改有效期将从当前时间重新计算</div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '保存', class: 'btn-primary', action: () => this.submitEditInviteCode(codeId) }
        ]);
    },

    async submitEditInviteCode(codeId) {
        const expiryDays = parseInt(document.getElementById('editCodeExpiry').value) || 30;
        try {
            await this.api('PUT', '/api/admin/invite-codes/' + codeId, { expiry_days: expiryDays });
            this.closeModal();
            this.showToast('邀请码已更新', 'success');
            this.loadInviteCodes();
        } catch (err) {
            this.showToast('修改失败: ' + err.message, 'error');
        }
    },

    async showEditInviteTemplateModal(templateId) {
        try {
            if (!this._mappingList || this._mappingList.length === 0) {
                try {
                    const data = await this.api('GET', '/api/admin/model-routes');
                    this._mappingList = data.mappings || data || [];
                } catch {}
            }
            const res = await this.api('GET', '/api/admin/invite-templates');
            const t = res.templates.find(t => t.id === templateId);
            if (!t) { this.showToast('模板不存在', 'error'); return; }
            await this._ensureProviderList();
            const currentAllowed = t.allowed_models || [];
            const isFixed = t.client_id_fixed !== false;
            const mappingList = this._mappingList || [];
            const openaiMappings = mappingList.filter(m => m.api_format !== 'anthropic');
            const modelsCheckboxes = openaiMappings.map(m => {
                const checked = currentAllowed.length === 0 || currentAllowed.includes(m.client_model) ? 'checked' : '';
                return `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:13px;cursor:pointer">
                    <input type="checkbox" class="it-model-cb" value="${this.esc(m.client_model)}" ${checked}> ${this.esc(m.client_model)}
                </label>`;
            }).join('');
            this.showModal('编辑邀请模板', `
                <form id="inviteTemplateForm">
                    <div class="form-group"><label>模板名称 <span class="required">*</span></label><input class="form-control" id="itName" value="${this.esc(t.name)}" required></div>
                    <div class="form-group"><label>描述</label><input class="form-control" id="itDesc" value="${this.esc(t.description || '')}"></div>
                    <div class="form-group"><label>计费模式</label>
                        <select class="form-control" id="itBillingMode" onchange="App.toggleCodingPlanFields()">
                            <option value="per_token" ${t.billing_mode==='per_token'?'selected':''}>按 Token 计费</option>
                            <option value="per_request" ${t.billing_mode==='per_request'?'selected':''}>按请求计费</option>
                            <option value="quota" ${t.billing_mode==='quota'?'selected':''}>积分制</option>
                            <option value="token_plan" ${t.billing_mode==='token_plan'?'selected':''}>Token Plan</option>
                            <option value="coding_plan" ${t.billing_mode==='coding_plan'?'selected':''}>Coding Plan（请求次数制）</option>
                        </select>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>月度配额</label><input class="form-control" id="itMonthlyQuota" type="number" value="${t.monthly_quota || 0}" placeholder="0=不限"></div>
                        <div class="form-group"><label>积分余额</label><input class="form-control" id="itCreditsBalance" type="number" value="${t.credits_balance || 0}" step="0.01"></div>
                    </div>
                    <div id="codingPlanFields" style="display:${t.billing_mode==='coding_plan'?'block':'none'}">
                        <div class="form-row">
                            <div class="form-group"><label>5小时次数限制</label><input class="form-control" id="itQuota5h" type="number" value="${t.quota_5h || 0}" placeholder="0=不限"></div>
                            <div class="form-group"><label>周次数限制</label><input class="form-control" id="itQuotaWeekly" type="number" value="${t.quota_weekly || 0}" placeholder="0=不限"></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group"><label>月次数限制</label><input class="form-control" id="itQuotaMonthly" type="number" value="${t.quota_monthly || 0}" placeholder="0=不限"></div>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>限流(次/分)</label><input class="form-control" id="itRateLimit" type="number" value="${t.rate_limit || 60}"></div>
                        <div class="form-group"><label>Key 前缀</label><input class="form-control" id="itKeyPrefix" value="${this.esc(t.key_prefix || 'sk-')}" style="font-family:monospace"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>最大使用次数</label><input class="form-control" id="itMaxUses" type="number" value="${t.max_uses || 0}" placeholder="0=不限"></div>
                        <div class="form-group"><label>状态</label><select class="form-control" id="itIsActive"><option value="true" ${t.is_active?'selected':''}>启用</option><option value="false" ${!t.is_active?'selected':''}>停用</option></select></div>
                    </div>
                    <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="itClientIdFixed" ${isFixed ? 'checked' : ''} onchange="document.getElementById('itPassthroughProviderGroup').style.display=this.checked?'none':'block';document.getElementById('itModelSection').style.display=this.checked?'block':'none'"> 固定客户端ID</label><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">关闭后，客户端请求的模型将直接发送给绑定的服务商（透传模式）</div></div>
                    <div class="form-group" id="itPassthroughProviderGroup" style="display:${isFixed ? 'none' : 'block'}"><label>绑定服务商 <span class="required">*</span></label>
                        <select class="form-control" id="itPassthroughProvider">${this._providerOptionsHtml(!isFixed ? (t.client_id || '') : '')}</select>
                        <div class="form-hint">透传模式下，所有请求将发送给此服务商</div>
                    </div>
                    <div id="itModelSection" style="display:${isFixed ? 'block' : 'none'}">
                    <div class="form-group"><label>允许的模型 <span style="font-weight:400;font-size:12px;color:var(--text-muted)">（不选=允许所有，注册的Key将继承此设置）</span></label>
                        <div style="display:flex;gap:8px;margin-bottom:6px">
                            <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.it-model-cb').forEach(cb=>cb.checked=true)">全选</button>
                            <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.it-model-cb').forEach(cb=>cb.checked=false)">全不选</button>
                        </div>
                        <div style="background:var(--bg-secondary);padding:10px;border-radius:6px;max-height:150px;overflow-y:auto">
                            ${modelsCheckboxes || '<span style="color:var(--text-muted)">暂无模型映射</span>'}
                        </div>
                    </div>
                    </div>
                </form>
            `, [
                { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
                { text: '保存', class: 'btn-primary', action: () => this.submitEditInviteTemplate(templateId) }
            ]);
        } catch (err) {
            this.showToast('加载模板失败: ' + err.message, 'error');
        }
    },

    async submitEditInviteTemplate(templateId) {
        const clientIdFixed = document.getElementById('itClientIdFixed').checked;
        const itName = document.getElementById('itName').value.trim();
        const clientId = clientIdFixed ? itName : (document.getElementById('itPassthroughProvider')?.value || '');
        if (!clientIdFixed && !clientId) { this.showToast('透传模式下请选择服务商', 'error'); return; }
        const body = {
            name: itName,
            description: document.getElementById('itDesc').value.trim(),
            billing_mode: document.getElementById('itBillingMode').value,
            monthly_quota: parseInt(document.getElementById('itMonthlyQuota').value) || 0,
            credits_balance: parseFloat(document.getElementById('itCreditsBalance').value) || 0,
            rate_limit: parseInt(document.getElementById('itRateLimit').value) || 60,
            key_prefix: document.getElementById('itKeyPrefix').value.trim() || 'sk-',
            max_uses: parseInt(document.getElementById('itMaxUses').value) || 0,
            quota_5h: parseInt(document.getElementById('itQuota5h')?.value) || 0,
            quota_weekly: parseInt(document.getElementById('itQuotaWeekly')?.value) || 0,
            quota_monthly: parseInt(document.getElementById('itQuotaMonthly')?.value) || 0,
            is_active: document.getElementById('itIsActive').value === 'true',
            allowed_models: Array.from(document.querySelectorAll('.it-model-cb:checked')).map(cb => cb.value),
            client_id_fixed: clientIdFixed,
            client_id: clientId
        };
        if (!body.name) { this.showToast('模板名称不能为空', 'error'); return; }
        try {
            await this.api('PUT', '/api/admin/invite-templates/' + templateId, body);
            this.closeModal();
            this.showToast('模板已更新', 'success');
            this.renderInviteTemplates();
        } catch (err) {
            this.showToast('更新失败: ' + err.message, 'error');
        }
    },

    async showCreateInviteTemplateModal() {
        if (!this._mappingList || this._mappingList.length === 0) {
            try {
                const data = await this.api('GET', '/api/admin/model-routes');
                this._mappingList = data.mappings || data || [];
            } catch {}
        }
        await this._ensureProviderList();
        const mappingList = this._mappingList || [];
        const openaiMappings = mappingList.filter(m => m.api_format !== 'anthropic');
        const modelsCheckboxes = openaiMappings.map(m => {
            return `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:13px;cursor:pointer">
                <input type="checkbox" class="it-model-cb" value="${this.esc(m.client_model)}" checked> ${this.esc(m.client_model)}
            </label>`;
        }).join('');
        this.showModal('创建邀请模板', `
            <form id="inviteTemplateForm">
                <div class="form-group"><label>模板名称 <span class="required">*</span></label><input class="form-control" id="itName" placeholder="如: 标准用户邀请" required></div>
                <div class="form-group"><label>描述</label><input class="form-control" id="itDesc" placeholder="模板用途说明"></div>
                <div class="form-group"><label>计费模式</label>
                    <select class="form-control" id="itBillingMode" onchange="App.toggleCodingPlanFields()">
                        <option value="per_token">按 Token 计费</option>
                        <option value="per_request">按请求计费</option>
                        <option value="quota">积分制</option>
                        <option value="token_plan">Token Plan</option>
                        <option value="coding_plan">Coding Plan（请求次数制）</option>
                    </select>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>月度配额</label><input class="form-control" id="itMonthlyQuota" type="number" value="0" placeholder="0=不限"></div>
                    <div class="form-group"><label>积分余额</label><input class="form-control" id="itCreditsBalance" type="number" value="0" step="0.01"></div>
                </div>
                <div id="codingPlanFields" style="display:none">
                    <div class="form-row">
                        <div class="form-group"><label>5小时次数限制</label><input class="form-control" id="itQuota5h" type="number" value="0" placeholder="0=不限"></div>
                        <div class="form-group"><label>周次数限制</label><input class="form-control" id="itQuotaWeekly" type="number" value="0" placeholder="0=不限"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>月次数限制</label><input class="form-control" id="itQuotaMonthly" type="number" value="0" placeholder="0=不限"></div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>限流(次/分)</label><input class="form-control" id="itRateLimit" type="number" value="60"></div>
                    <div class="form-group"><label>Key 前缀</label><input class="form-control" id="itKeyPrefix" value="sk-" style="font-family:monospace"></div>
                </div>
                <div class="form-group"><label>最大使用次数</label><input class="form-control" id="itMaxUses" type="number" value="0" placeholder="0=不限"></div>
                <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="itClientIdFixed" checked onchange="document.getElementById('itPassthroughProviderGroup').style.display=this.checked?'none':'block';document.getElementById('itModelSection').style.display=this.checked?'block':'none'"> 固定客户端ID</label><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">关闭后，客户端请求的模型将直接发送给绑定的服务商（透传模式）</div></div>
                <div class="form-group" id="itPassthroughProviderGroup" style="display:none"><label>绑定服务商 <span class="required">*</span></label>
                    <select class="form-control" id="itPassthroughProvider">${this._providerOptionsHtml('')}</select>
                    <div class="form-hint">透传模式下，所有请求将发送给此服务商</div>
                </div>
                <div id="itModelSection">
                <div class="form-group"><label>允许的模型 <span style="font-weight:400;font-size:12px;color:var(--text-muted)">（不选=允许所有，注册的Key将继承此设置）</span></label>
                    <div style="display:flex;gap:8px;margin-bottom:6px">
                        <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.it-model-cb').forEach(cb=>cb.checked=true)">全选</button>
                        <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.it-model-cb').forEach(cb=>cb.checked=false)">全不选</button>
                    </div>
                    <div style="background:var(--bg-secondary);padding:10px;border-radius:6px;max-height:150px;overflow-y:auto">
                        ${modelsCheckboxes || '<span style="color:var(--text-muted)">暂无模型映射</span>'}
                    </div>
                </div>
                </div>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '创建', class: 'btn-primary', action: () => this.submitInviteTemplate() }
        ]);
    },

    toggleCodingPlanFields() {
        const mode = document.getElementById('itBillingMode')?.value;
        const fields = document.getElementById('codingPlanFields');
        if (fields) fields.style.display = mode === 'coding_plan' ? 'block' : 'none';
    },

    async submitInviteTemplate() {
        const clientIdFixed = document.getElementById('itClientIdFixed').checked;
        const itName = document.getElementById('itName').value.trim();
        const clientId = clientIdFixed ? itName : (document.getElementById('itPassthroughProvider')?.value || '');
        if (!clientIdFixed && !clientId) { this.showToast('透传模式下请选择服务商', 'error'); return; }
        const body = {
            name: itName,
            description: document.getElementById('itDesc').value.trim(),
            billing_mode: document.getElementById('itBillingMode').value,
            monthly_quota: parseInt(document.getElementById('itMonthlyQuota').value) || 0,
            credits_balance: parseFloat(document.getElementById('itCreditsBalance').value) || 0,
            rate_limit: parseInt(document.getElementById('itRateLimit').value) || 60,
            key_prefix: document.getElementById('itKeyPrefix').value.trim() || 'sk-',
            max_uses: parseInt(document.getElementById('itMaxUses').value) || 0,
            quota_5h: parseInt(document.getElementById('itQuota5h')?.value) || 0,
            quota_weekly: parseInt(document.getElementById('itQuotaWeekly')?.value) || 0,
            quota_monthly: parseInt(document.getElementById('itQuotaMonthly')?.value) || 0,
            allowed_models: Array.from(document.querySelectorAll('.it-model-cb:checked')).map(cb => cb.value),
            client_id_fixed: clientIdFixed,
            client_id: clientId
        };
        if (!body.name) { this.showToast('模板名称不能为空', 'error'); return; }
        try {
            await this.api('POST', '/api/admin/invite-templates', body);
            this.closeModal();
            this.showToast('模板创建成功', 'success');
            this.renderInviteTemplates();
        } catch (err) {
            this.showToast('创建失败: ' + err.message, 'error');
        }
    },

    showGenerateInviteCodesModal(templateId, templateName) {
        this.showModal('批量生成邀请码', `
            <div style="background:rgba(79,195,247,0.1);padding:12px;border-radius:6px;border:1px solid rgba(79,195,247,0.3);margin-bottom:16px">
                <label style="color:var(--accent-blue)">📌 模板: ${this.esc(templateName)}</label>
            </div>
            <div class="form-group"><label>生成数量 <span class="required">*</span></label><input class="form-control" id="genCodeCount" type="number" value="5" min="1" max="100" placeholder="1-100"></div>
            <div class="form-group"><label>有效期</label><select class="form-control" id="genCodeExpiry"><option value="7">7天</option><option value="15">15天</option><option value="30" selected>30天</option></select></div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '生成', class: 'btn-primary', action: () => this.submitGenerateInviteCodes(templateId) }
        ]);
    },

    async submitGenerateInviteCodes(templateId) {
        const count = parseInt(document.getElementById('genCodeCount').value) || 0;
        const expiryDays = parseInt(document.getElementById('genCodeExpiry').value) || 30;
        if (count <= 0 || count > 100) { this.showToast('数量需在1-100之间', 'error'); return; }
        try {
            const res = await this.api('POST', '/api/admin/invite-codes/generate', { template_id: templateId, count, expiry_days: expiryDays });
            this.closeModal();
            const codesArr = res.codes || [];
            const codesHtml = codesArr.map(c => {
                const code = (c && typeof c === 'object') ? String(c.code || '') : String(c || '');
                const url = (c && typeof c === 'object' && c.invite_url) ? String(c.invite_url) : '';
                const expires = (c && typeof c === 'object' && c.expires_at) ? this.formatDate(c.expires_at) : '';
                let html = '<div style="font-family:monospace;font-size:16px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin:6px 0;letter-spacing:2px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border-color);">';
                html += '<span style="font-size:16px;font-weight:600;">' + this.esc(code) + '</span>';
                html += '<div style="display:flex;gap:8px;align-items:center;">';
                if (expires) html += '<span style="font-size:11px;color:var(--text-secondary);">有效期至' + expires + '</span>';
                if (url) html += '<button class="btn btn-sm btn-outline" onclick="App.shareInviteCode(\'' + this.esc(url).replace(/'/g, "\\'") + '\',\'' + this.esc(code) + '\')">🔗分享</button>';
                html += '</div></div>';
                return html;
            }).join('');
            this.showModal('邀请码生成成功', `
                <div style="margin-bottom:12px;color:var(--text-secondary)">已生成 ${res.count || codesArr.length} 个邀请码（有效期${expiryDays}天）：</div>
                <div style="max-height:300px;overflow-y:auto">${codesHtml}</div>
                <div style="margin-top:12px;color:var(--text-muted);font-size:13px">⚠️ 请复制保存邀请码，关闭后仍可在邀请码列表中查看</div>
            `, [
                { text: '全部复制', class: 'btn-primary', action: () => {
                    const codesText = codesArr.map(c => (c && typeof c === 'object') ? String(c.code || '') : String(c || '')).join('\n');
                    navigator.clipboard.writeText(codesText).then(() => this.showToast('已复制到剪贴板', 'success'));
                }},
                { text: '确定', class: 'btn-outline', action: () => { this.closeModal(); if (this._inviteTab === 'codes') this.loadInviteCodes(); else this.renderInviteTemplates(); } }
            ]);
        } catch (err) {
            this.showToast('生成失败: ' + err.message, 'error');
        }
    },

    async deleteInviteTemplate(id, name) {
        if (!confirm(`确定要删除模板 "${name}" 吗？未使用的邀请码也会被删除。`)) return;
        try {
            await this.api('DELETE', '/api/admin/invite-templates/' + id);
            this.showToast('模板已删除', 'success');
            this.renderInviteTemplates();
        } catch (err) {
            this.showToast('删除失败: ' + err.message, 'error');
        }
    },

    async deleteInviteCode(id, code) {
        if (!confirm(`确定要删除邀请码 "${code}" 吗？`)) return;
        try {
            await this.api('DELETE', '/api/admin/invite-codes/' + id);
            this.showToast('邀请码已删除', 'success');
            this.loadInviteCodes();
        } catch (err) {
            this.showToast('删除失败: ' + err.message, 'error');
        }
    },

    _usageView: 'provider',
    _usageBillingMode: '',
    _usageSearch: '',
    _usagePage: 1,
    _usagePageSize: 20,
    async renderUsageAnalysis() {
        const content = document.getElementById('mainContent');
        content.innerHTML = `
            <div class="page-header">
                <h2>📊 用量分析</h2>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="text" id="usageSearchInput" placeholder="搜索用户名/Key名..." value="${this.esc(this._usageSearch)}" oninput="App._usageSearch=this.value;App._usagePage=1;App.renderUsageContent(App._usageData)" style="padding:8px 12px;border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);width:200px;font-size:13px;">
                    <select id="usageBillingSelect" onchange="App._usageBillingMode=this.value;App._usagePage=1;App.loadUsageData()" style="padding:8px 12px;border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);">
                        <option value="">全部计费模式</option>
                        <option value="per_token" ${this._usageBillingMode==='per_token'?'selected':''}>按Token计费</option>
                        <option value="token_plan" ${this._usageBillingMode==='token_plan'?'selected':''}>Token Plan</option>
                        <option value="coding_plan" ${this._usageBillingMode==='coding_plan'?'selected':''}>Coding Plan</option>
                    </select>
                </div>
            </div>
            <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border-color);">
                <div id="usageTabProvider" class="usage-tab ${this._usageView==='provider'?'usage-tab-active':''}" onclick="App.switchUsageTab('provider')" style="padding:10px 24px;cursor:pointer;font-size:14px;font-weight:500;border-bottom:2px solid ${this._usageView==='provider'?'var(--accent-blue)':'transparent'};margin-bottom:-2px;color:${this._usageView==='provider'?'var(--accent-blue)':'var(--text-secondary)'};transition:all 0.2s;">🖥️ 服务商</div>
                <div id="usageTabUser" class="usage-tab ${this._usageView==='user'?'usage-tab-active':''}" onclick="App.switchUsageTab('user')" style="padding:10px 24px;cursor:pointer;font-size:14px;font-weight:500;border-bottom:2px solid ${this._usageView==='user'?'var(--accent-blue)':'transparent'};margin-bottom:-2px;color:${this._usageView==='user'?'var(--accent-blue)':'var(--text-secondary)'};transition:all 0.2s;">👤 用户</div>
            </div>
            <div id="usageContent">
                <div style="text-align:center;padding:40px;color:var(--text-secondary);">加载中...</div>
            </div>
        `;
        this.loadUsageData();
    },

    switchUsageTab(tab) {
        this._usageView = tab;
        const tabProvider = document.getElementById('usageTabProvider');
        const tabUser = document.getElementById('usageTabUser');
        if (tabProvider) {
            tabProvider.style.borderBottomColor = tab === 'provider' ? 'var(--accent-blue)' : 'transparent';
            tabProvider.style.color = tab === 'provider' ? 'var(--accent-blue)' : 'var(--text-secondary)';
        }
        if (tabUser) {
            tabUser.style.borderBottomColor = tab === 'user' ? 'var(--accent-blue)' : 'transparent';
            tabUser.style.color = tab === 'user' ? 'var(--accent-blue)' : 'var(--text-secondary)';
        }
        this.loadUsageData();
    },

    async loadUsageData() {
        try {
            let url = '/api/admin/usage-analysis?view=' + this._usageView;
            if (this._usageBillingMode) url += '&billing_mode=' + this._usageBillingMode;
            const result = await this.api('GET', url);
            this._usageData = result;
            this.renderUsageContent(result);
        } catch (err) {
            if (!this._isCancelledError(err)) document.getElementById('usageContent').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">加载失败: ' + err.message + '</div>';
        }
    },

    renderUsageContent(result) {
        const container = document.getElementById('usageContent');
        if (!result || !result.data || result.data.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">暂无数据</div>';
            return;
        }

        if (result.view === 'provider') {
            let html = '<div style="display:grid;gap:12px;">';
            result.data.forEach(item => {
                html += this._renderProviderCard(item);
            });
            html += '</div>';
            container.innerHTML = html;
        } else {
            let filtered = result.data;
            const search = (this._usageSearch || '').toLowerCase().trim();
            if (search) {
                filtered = filtered.filter(item => {
                    const uname = (item.username || '').toLowerCase();
                    const kname = (item.key_name || '').toLowerCase();
                    const cid = (item.client_id || '').toLowerCase();
                    return uname.includes(search) || kname.includes(search) || cid.includes(search);
                });
            }

            const groups = {};
            const groupOrder = ['per_token', 'token_plan', 'coding_plan'];
            const groupLabels = {per_token: '按Token计费', token_plan: 'Token Plan', coding_plan: 'Coding Plan'};
            filtered.forEach(item => {
                const mode = item.billing_mode || 'per_token';
                if (!groups[mode]) groups[mode] = [];
                groups[mode].push(item);
            });

            let allItems = [];
            groupOrder.forEach(mode => {
                const items = groups[mode];
                if (!items || items.length === 0) return;
                allItems.push({mode, items});
            });
            Object.keys(groups).forEach(mode => {
                if (groupOrder.includes(mode)) return;
                allItems.push({mode, items: groups[mode]});
            });

            const totalItems = filtered.length;
            const totalPages = Math.max(1, Math.ceil(totalItems / this._usagePageSize));
            if (this._usagePage > totalPages) this._usagePage = totalPages;
            const startIdx = (this._usagePage - 1) * this._usagePageSize;
            const endIdx = Math.min(startIdx + this._usagePageSize, totalItems);

            let paginatedItems = [];
            let skipped = 0, taken = 0;
            for (const group of allItems) {
                if (taken >= this._usagePageSize) break;
                for (const item of group.items) {
                    if (skipped < startIdx) { skipped++; continue; }
                    if (taken >= this._usagePageSize) break;
                    paginatedItems.push({...item, _groupMode: group.mode, _groupLabel: groupLabels[group.mode] || group.mode});
                    taken++;
                }
            }

            let html = '';
            if (search) {
                html += '<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary);">找到 ' + totalItems + ' 个匹配结果</div>';
            }

            let currentGroup = '';
            paginatedItems.forEach(item => {
                if (item._groupMode !== currentGroup) {
                    if (currentGroup !== '') html += '</div></div>';
                    currentGroup = item._groupMode;
                    const groupCount = groups[item._groupMode] ? groups[item._groupMode].length : 0;
                    html += '<div style="margin-bottom:20px;">';
                    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">';
                    html += '<span style="font-size:15px;font-weight:600;color:var(--text-primary);">' + item._groupLabel + '</span>';
                    html += '<span style="font-size:12px;color:var(--text-secondary);">(' + groupCount + '个用户)</span>';
                    html += '</div>';
                    html += '<div style="display:grid;gap:12px;">';
                }
                html += this._renderUserCard(item);
            });
            if (currentGroup !== '') html += '</div></div>';

            if (totalPages > 1) {
                html += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color);">';
                html += '<button class="btn btn-sm btn-outline" ' + (this._usagePage <= 1 ? 'disabled' : 'onclick="App._usagePage--;App.renderUsageContent(App._usageData)"') + '>上一页</button>';
                html += '<span style="font-size:13px;color:var(--text-secondary);">第 ' + this._usagePage + ' / ' + totalPages + ' 页 (共' + totalItems + '条)</span>';
                html += '<button class="btn btn-sm btn-outline" ' + (this._usagePage >= totalPages ? 'disabled' : 'onclick="App._usagePage++;App.renderUsageContent(App._usageData)"') + '>下一页</button>';
                html += '</div>';
            }

            container.innerHTML = html;
        }
    },

    _renderProviderCard(item) {
        const billingLabel = {per_token:'按Token计费',token_plan:'Token Plan',coding_plan:'Coding Plan'}[item.billing_mode] || item.billing_mode;
        let html = '<div style="background:var(--bg-secondary);border-radius:10px;padding:16px;border:1px solid var(--border-color);">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
        html += '<div><span style="font-weight:600;font-size:15px;">' + this.esc(item.provider) + '</span>';
        html += '<span style="margin-left:8px;color:var(--text-secondary);">' + this.esc(item.model) + '</span>';
        html += '<span style="margin-left:8px;padding:2px 8px;border-radius:4px;font-size:12px;background:var(--bg-tertiary);color:var(--accent-blue);">' + billingLabel + '</span></div>';
        if (item.account_valid_until) {
            const validUntil = new Date(item.account_valid_until);
            const isExpired = validUntil < new Date();
            html += '<span style="font-size:12px;color:' + (isExpired ? 'var(--accent-red)' : 'var(--accent-green)') + ';">有效期至: ' + this.formatDate(item.account_valid_until) + '</span>';
        }
        html += '</div>';
        html += this._renderBillingStats(item);
        html += '</div>';
        return html;
    },

    _renderUserCard(item) {
        const billingLabel = {per_token:'按Token计费',token_plan:'Token Plan',coding_plan:'Coding Plan'}[item.billing_mode] || item.billing_mode;
        let html = '<div style="background:var(--bg-secondary);border-radius:10px;padding:16px;border:1px solid var(--border-color);">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<div><span style="font-weight:600;font-size:15px;">' + this.esc(item.username || '未知用户') + '</span>';
        html += '<span style="margin-left:8px;color:var(--text-secondary);">' + this.esc(item.key_name || '') + '</span>';
        html += '<span style="margin-left:8px;padding:2px 8px;border-radius:4px;font-size:12px;background:var(--bg-tertiary);color:var(--accent-blue);">' + billingLabel + '</span></div>';
        if (item.expires_at) {
            const exp = new Date(item.expires_at);
            const isExpired = exp < new Date();
            html += '<span style="font-size:12px;color:' + (isExpired ? 'var(--accent-red)' : 'var(--accent-green)') + ';">有效期至: ' + this.formatDate(item.expires_at) + '</span>';
        }
        html += '</div>';
        html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Client ID: ' + this.esc(item.client_id || '-') + '</div>';
        html += this._renderBillingStats(item);
        html += '</div>';
        return html;
    },

    _renderBillingStats(item) {
        let html = '';
        if (item.billing_mode === 'per_token') {
            html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">';
            html += this._usageStatCard('请求数', (item.requests || 0).toLocaleString(), '');
            html += this._usageStatCard('输入Token', this._formatTokens(item.input_tokens || 0), '');
            html += this._usageStatCard('输出Token', this._formatTokens(item.output_tokens || 0), '');
            html += this._usageStatCard('费用', '$' + (item.cost || 0).toFixed(4), '');
            html += '</div>';
        } else if (item.billing_mode === 'token_plan') {
            const quota = item.monthly_quota || 1;
            const usedCredits = (item.credits_used || 0) * (item.requests || 0);
            const pct = Math.min(100, (usedCredits / quota) * 100);
            html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">';
            html += this._usageStatCard('请求数', (item.requests || 0).toLocaleString(), '');
            html += this._usageStatCard('输入Token', this._formatTokens(item.input_tokens || 0), '');
            html += this._usageStatCard('输出Token', this._formatTokens(item.output_tokens || 0), '');
            html += '</div>';
            html += this._usageBar('积分消耗', usedCredits.toFixed(1), quota, pct);
        } else if (item.billing_mode === 'coding_plan') {
            html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">';
            html += this._usageStatCard('请求数', (item.requests || 0).toLocaleString(), '');
            html += this._usageStatCard('输入Token', this._formatTokens(item.input_tokens || 0), '');
            html += this._usageStatCard('输出Token', this._formatTokens(item.output_tokens || 0), '');
            html += '</div>';
        }
        const isCodingPlan = item.billing_mode === 'coding_plan';
        const show5h = isCodingPlan || item.five_hour_limit > 0 || (item.five_hour_used > 0);
        const showW = isCodingPlan || item.weekly_limit > 0 || (item.weekly_used > 0);
        const showM = isCodingPlan || item.monthly_limit > 0 || (item.monthly_used > 0);
        if (show5h || showW || showM) {
            if (show5h) {
                const pct5h = item.five_hour_limit > 0 ? Math.min(100, ((item.five_hour_used || 0) / item.five_hour_limit) * 100) : 0;
                html += this._usageBar('5小时次数', item.five_hour_used || 0, item.five_hour_limit || '-', pct5h);
            }
            if (showW) {
                const pctW = item.weekly_limit > 0 ? Math.min(100, ((item.weekly_used || 0) / item.weekly_limit) * 100) : 0;
                html += this._usageBar('周次数', item.weekly_used || 0, item.weekly_limit || '-', pctW);
            }
            if (showM) {
                const pctM = item.monthly_limit > 0 ? Math.min(100, ((item.monthly_used || 0) / item.monthly_limit) * 100) : 0;
                html += this._usageBar('月次数', item.monthly_used || 0, item.monthly_limit || '-', pctM);
            }
        }
        return html;
    },

    _usageStatCard(label, value, unit) {
        return '<div style="background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center;">' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">' + label + '</div>' +
            '<div style="font-size:16px;font-weight:600;">' + value + (unit ? ' <span style="font-size:12px;color:var(--text-secondary);">' + unit + '</span>' : '') + '</div></div>';
    },

    _usageBar(label, used, limit, pct) {
        const barColor = pct > 90 ? 'var(--accent-red)' : pct > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
        return '<div style="margin-top:4px;">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">' +
            '<span style="color:var(--text-secondary);">' + label + '</span>' +
            '<span>' + used + ' / ' + limit + ' <span style="color:var(--text-secondary);">(' + pct.toFixed(1) + '%)</span></span></div>' +
            '<div style="background:var(--bg-tertiary);border-radius:4px;height:8px;overflow:hidden;">' +
            '<div style="width:' + Math.min(100, pct) + '%;height:100%;background:' + barColor + ';border-radius:4px;transition:width 0.3s;"></div></div></div>';
    },

    _formatTokens(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toFixed(0);
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => App.init());
