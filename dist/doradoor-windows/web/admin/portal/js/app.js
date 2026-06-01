/* ============================================
   Portal - 用户自助服务前端应用
   样式对齐 admin 后台
   ============================================ */

const Portal = {
    _apiBase: '',
    token: null,
    user: null,
    currentPage: 'dashboard',
    refreshTimer: null,
    costChart: null,
    logOffset: 0,
    logStatusFilter: '',
    currentPeriod: 'day',

    // ========== 初始化 ==========
    init() {
        const apiBaseMeta = document.querySelector('meta[name="api-base"]');
        if (apiBaseMeta && apiBaseMeta.content) this._apiBase = apiBaseMeta.content;
        const urlParams = new URLSearchParams(window.location.search);
        const inviteCode = urlParams.get('invite') || urlParams.get('code');
        if (inviteCode) {
            this.showInviteRegister(inviteCode.toUpperCase());
            return;
        }
        const savedToken = localStorage.getItem('portal_token');
        const savedUser = localStorage.getItem('portal_user');
        if (savedToken && savedUser && savedUser !== 'undefined') {
            try {
                this.token = savedToken;
                this.user = JSON.parse(savedUser);
                this.showApp();
            } catch(e) {
                localStorage.removeItem('portal_token');
                localStorage.removeItem('portal_user');
            }
        }
    },

    // ========== 认证 ==========
    async login(e) {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');

        if (!username || !password) {
            errorEl.textContent = '请输入用户名和密码';
            errorEl.style.display = 'block';
            return false;
        }

        try {
            const res = await this.api('POST', '/api/portal/auth/login', { username, password });
            this.token = res.token;
            this.user = res.user;
            localStorage.setItem('portal_token', this.token);
            localStorage.setItem('portal_user', JSON.stringify(this.user));
            errorEl.style.display = 'none';
            this.showApp();
            this.showToast('登录成功', 'success');
        } catch (err) {
            errorEl.textContent = err.message || '登录失败';
            errorEl.style.display = 'block';
        }
        return false;
    },

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('portal_token');
        localStorage.removeItem('portal_user');
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('appLayout').classList.add('hidden');
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
    },

    showApp() {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('appLayout').classList.remove('hidden');
        const name = this.user.display_name || this.user.username;
        document.getElementById('sidebarUserName').textContent = name;
        document.getElementById('userAvatar').textContent = name[0].toUpperCase();
        this.navigate('dashboard');
    },

    // ========== API请求封装 ==========
    async api(method, path, body) {
        const base = this._apiBase || window.location.origin;
        const url = new URL(path, base).href;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (this.token) xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
            xhr.onload = function() {
                if (xhr.status === 401) { Portal.logout(); reject(new Error('未授权')); return; }
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status >= 400) { reject(new Error(data.error || data.message || '请求失败')); return; }
                    resolve(data);
                } catch(e) { reject(new Error('响应解析失败')); }
            };
            xhr.onerror = function() { reject(new Error('网络请求失败')); };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    },

    // ========== 导航 ==========
    navigate(page) {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.currentPage = page;
        this.costChart = null;

        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('active');

        const renderers = {
            dashboard: () => this.renderDashboard(),
            apikeys: () => this.renderApiKeys(),
            stats: () => this.renderStats(),
            logs: () => this.renderLogs(),
            settings: () => this.renderSettings()
        };
        const renderer = renderers[page];
        if (renderer) renderer();
    },

    toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebarOverlay').classList.toggle('active');
    },

    // ========== 概览仪表盘 ==========
    async renderDashboard() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <div class="page-header-left"><h2>📊 概览</h2><p>查看您的 API 使用情况</p></div>
            </div>
            <div class="stat-cards" id="statCards">
                <div class="stat-card">
                    <div class="stat-header"><div class="stat-icon blue">📡</div><span class="stat-label">总请求数</span></div>
                    <div class="stat-value" id="statRequests">-</div>
                    <div class="stat-sub" id="statRequestsSub"></div>
                </div>
                <div class="stat-card">
                    <div class="stat-header"><div class="stat-icon green">🔤</div><span class="stat-label">总 Token</span></div>
                    <div class="stat-value" id="statTokens">-</div>
                    <div class="stat-sub" id="statTokensSub"></div>
                </div>
                <div class="stat-card">
                    <div class="stat-header"><div class="stat-icon red">💰</div><span class="stat-label">总费用</span></div>
                    <div class="stat-value" id="statCost">-</div>
                    <div class="stat-sub" id="statCostSub"></div>
                </div>
                <div class="stat-card">
                    <div class="stat-header"><div class="stat-icon yellow">✅</div><span class="stat-label">成功率</span></div>
                    <div class="stat-value" id="statSuccess">-</div>
                    <div class="stat-sub" id="statSuccessSub"></div>
                </div>
            </div>
            <div class="charts-row">
                <div class="chart-card">
                    <h3>📈 费用趋势（24小时）</h3>
                    <div class="chart-container"><canvas id="costChartCanvas"></canvas></div>
                </div>
            </div>
            <div class="card" style="margin-top:20px">
                <div class="card-header"><h3>🔑 按 Key 统计</h3></div>
                <div class="card-body" id="keyStatsBody" style="padding:0">
                    <table style="width:100%;border-collapse:collapse">
                        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.08)">
                            <th style="padding:12px 16px;text-align:left;font-size:13px;color:var(--text-secondary)">Key 名称</th>
                            <th style="padding:12px 16px;text-align:right;font-size:13px;color:var(--text-secondary)">请求数</th>
                            <th style="padding:12px 16px;text-align:right;font-size:13px;color:var(--text-secondary)">输入Token</th>
                            <th style="padding:12px 16px;text-align:right;font-size:13px;color:var(--text-secondary)">输出Token</th>
                            <th style="padding:12px 16px;text-align:right;font-size:13px;color:var(--text-secondary)">费用</th>
                        </tr></thead>
                        <tbody id="keyStatsTbody"><tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-secondary)">加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadDashboardData();
        this.refreshTimer = setInterval(() => this.loadDashboardData(), 30000);
    },

    async loadDashboardData() {
        try {
            const [overview, costData, keyStats] = await Promise.all([
                this.api('GET', '/api/portal/stats/overview?period=day'),
                this.api('GET', '/api/portal/stats/cost-trend?hours=24'),
                this.api('GET', '/api/portal/stats/by-key')
            ]);

            document.getElementById('statRequests').textContent = this.formatNumber(overview.today_requests || 0);
            document.getElementById('statTokens').textContent = this.formatReadableToken(overview.today_tokens || 0);
            document.getElementById('statCost').textContent = this.formatCost(overview.today_cost || 0);
            document.getElementById('statSuccess').textContent = (overview.success_rate != null ? Number(overview.success_rate).toFixed(1) : '0.0') + '%';

            document.getElementById('statRequestsSub').textContent = `当日 ${this.formatNumber(overview.today_requests || 0)} | 当月 ${this.formatNumber(overview.month_requests || 0)} | 总计 ${this.formatNumber(overview.all_requests || 0)}`;
            document.getElementById('statTokensSub').textContent = `当日 ${this.formatReadableToken(overview.today_tokens || 0)} | 当月 ${this.formatReadableToken(overview.month_tokens || 0)} | 总计 ${this.formatReadableToken(overview.all_tokens || 0)}`;
            document.getElementById('statCostSub').textContent = `当日 ${this.formatCost(overview.today_cost || 0)} ≈¥${this.formatCostCNY(overview.today_cost_cny || (overview.today_cost || 0) * 7.25)} | 当月 ${this.formatCost(overview.month_cost || 0)} ≈¥${this.formatCostCNY(overview.month_cost_cny || (overview.month_cost || 0) * 7.25)} | 总计 ${this.formatCost(overview.all_cost || 0)} ≈¥${this.formatCostCNY(overview.all_cost_cny || (overview.all_cost || 0) * 7.25)}`;
            document.getElementById('statSuccessSub').textContent = `平均延迟 ${overview.avg_latency_ms || 0}ms`;

            // 费用趋势图
            const chartItems = costData.chart_data || costData.trend || [];
            if (!this.costChart) {
                const ctx = document.getElementById('costChartCanvas').getContext('2d');
                this.costChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: chartItems.map(d => d.time || d.hour),
                        datasets: [{
                            label: '费用 ($)',
                            data: chartItems.map(d => d.cost),
                            borderColor: '#4fc3f7',
                            backgroundColor: 'rgba(79, 195, 247, 0.1)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 2,
                            pointHoverRadius: 5
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#6c6c80', font: { size: 11 } } },
                            y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#6c6c80', font: { size: 11 } } }
                        }
                    }
                });
            } else {
                this.costChart.data.labels = chartItems.map(d => d.time || d.hour);
                this.costChart.data.datasets[0].data = chartItems.map(d => d.cost);
                this.costChart.update();
            }

            const tbody = document.getElementById('keyStatsTbody');
            if (tbody && keyStats && keyStats.stats && keyStats.stats.length > 0) {
                tbody.innerHTML = keyStats.stats.map(s => `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                        <td style="padding:10px 16px;font-size:13px">${this.esc(s.key_name)}</td>
                        <td style="padding:10px 16px;text-align:right;font-size:13px">${this.formatNumber(s.requests)}</td>
                        <td style="padding:10px 16px;text-align:right;font-size:13px">${this.formatNumber(s.input_tokens)}</td>
                        <td style="padding:10px 16px;text-align:right;font-size:13px">${this.formatNumber(s.output_tokens)}</td>
                        <td style="padding:10px 16px;text-align:right;font-size:13px">${this.formatCost(s.cost)}</td>
                    </tr>
                `).join('');
            } else if (tbody) {
                tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-secondary)">暂无使用数据</td></tr>';
            }
        } catch (err) {
            this.showToast('加载数据失败: ' + err.message, 'error');
        }
    },

    // ========== API Key 管理 ==========
    async renderApiKeys() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <h2>🔑 我的 API Key</h2>
            </div>
            <div class="table-card">
                <div class="table-header">
                    <h3>API Key 列表</h3>
                    <button class="btn btn-primary" onclick="Portal.showCreateKeyModal()">+ 申请 Key</button>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>名称</th><th>Key</th><th>计费模式</th><th>限流</th><th>配额/余额</th><th>有效期</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody id="portalApiKeyBody"><tr><td colspan="9" class="table-empty"><div class="empty-icon">⏳</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadApiKeys();
    },

    async loadApiKeys() {
        try {
            const data = await this.api('GET', '/api/portal/api-keys');
            const tbody = document.getElementById('portalApiKeyBody');
            const list = data.keys || [];

            if (list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="empty-icon">🔑</div>您还没有 API Key<button class="btn btn-primary" style="margin-top:12px" onclick="Portal.showCreateKeyModal()">申请 Key</button></td></tr>';
                return;
            }

            tbody.innerHTML = list.map(key => {
                const hasKey = !!key.key_prefix;
                const isActive = key.is_active !== false;
                const statusBadge = !hasKey
                    ? (key.status === 'pending' ? '<span class="badge badge-warning">⏳ 待审核</span>' : key.status === 'rejected' ? '<span class="badge badge-danger">❌ 已拒绝</span>' : '<span class="badge badge-info">' + this.esc(key.status) + '</span>')
                    : (isActive ? '<span class="badge badge-success">启用</span>' : '<span class="badge badge-danger">禁用</span>');

                const isZeroDate = key.expires_at && (key.expires_at.startsWith('0001-') || key.expires_at.startsWith('1-'));
                const expiresText = key.expires_at && !isZeroDate ? this.formatDate(key.expires_at) : '永久';

                let quotaText = '-';
                if (key.billing_mode === 'coding_plan') {
                    const parts = [];
                    if (key.five_hour_limit > 0) parts.push('5h:' + (key.five_hour_used||0) + '/' + key.five_hour_limit);
                    if (key.weekly_limit > 0) parts.push('周:' + (key.weekly_used||0) + '/' + key.weekly_limit);
                    if (key.monthly_limit > 0) parts.push('月:' + (key.total_used||0) + '/' + key.monthly_limit);
                    quotaText = parts.length ? parts.join(' ') : '-';
                } else if (key.billing_mode === 'quota') {
                    quotaText = '💰 ' + (key.credits_balance || 0).toFixed(2);
                } else if ((key.billing_mode === 'per_token' || key.billing_mode === 'token_plan') && key.monthly_quota > 0) {
                    quotaText = key.monthly_quota + ' 次/月';
                }

                const bmLabel = this.billingModeLabel(key.billing_mode);
                const bmClass = key.billing_mode==='per_token'?'badge-success':key.billing_mode==='token_plan'?'badge-warning':key.billing_mode==='coding_plan'?'badge-info':'badge-success';

                if (hasKey) {
                    const maskedKey = (key.key_prefix || '').substring(0, 8) + '••••••••••••';
                    return `<tr>
                        <td><strong>${this.esc(key.name)}</strong></td>
                        <td>
                            <code id="keyVal_${key.id}" style="color:var(--accent-green);font-size:11px;word-break:break-all">${maskedKey}</code>
                            <button class="btn-icon" onclick="Portal.toggleKeyVisibility('${key.id}')" title="显示/隐藏Key">👁️</button>
                            <button class="btn-icon" onclick="Portal.copyKeyToClipboard('${key.id}')" title="复制Key">📋</button>
                        </td>
                        <td><span class="badge ${bmClass}" style="font-size:11px">${bmLabel}</span></td>
                        <td>${key.rate_limit || '-'} 次/分</td>
                        <td style="font-size:12px">${quotaText}</td>
                        <td style="font-size:12px">${expiresText}</td>
                        <td>${statusBadge}</td>
                        <td class="text-muted">${this.formatDate(key.created_at)}</td>
                        <td>
                            <button class="btn-icon" onclick="Portal.showKeyConfig('${key.id}','${this.esc(key.name)}')" title="配置参考">📖</button>
                        </td>
                    </tr>`;
                }

                return `<tr style="opacity:${key.status === 'rejected' ? '0.6' : '1'}">
                    <td><strong>${this.esc(key.name)}</strong></td>
                    <td>-</td>
                    <td><span class="badge ${bmClass}" style="font-size:11px">${bmLabel}</span></td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>${statusBadge}</td>
                    <td class="text-muted">${this.formatDateTime(key.request_created_at || key.created_at)}</td>
                    <td>-</td>
                </tr>`;
            }).join('');
        } catch (err) {
            this.showToast('加载失败: ' + err.message, 'error');
        }
    },

    _keyPlaintextCache: {},

    async toggleKeyVisibility(keyId) {
        const el = document.getElementById('keyVal_' + keyId);
        if (!el) return;
        if (el.dataset.visible === 'true') {
            const prefix = (el.dataset.plaintext || '').substring(0, 8);
            el.textContent = prefix + '••••••••••••';
            el.dataset.visible = 'false';
            return;
        }
        try {
            let plaintext = this._keyPlaintextCache[keyId];
            if (!plaintext) {
                const res = await this.api('GET', '/api/portal/api-keys/' + keyId + '/plaintext');
                plaintext = res.api_key;
                this._keyPlaintextCache[keyId] = plaintext;
            }
            el.dataset.plaintext = plaintext;
            el.textContent = plaintext;
            el.dataset.visible = 'true';
        } catch(e) {
            this.showToast('获取Key失败: ' + e.message, 'error');
        }
    },

    async togglePortalKeyVisibility(keyId) {
        const el = document.getElementById('portalKeyDisplay_' + keyId);
        if (!el) return;
        if (!this._portalKeyVisible) this._portalKeyVisible = {};
        const state = this._portalKeyVisible[keyId] || 0;
        if (state === 0) {
            try {
                let plaintext = this._keyPlaintextCache[keyId];
                if (!plaintext) {
                    const res = await this.api('GET', '/api/portal/api-keys/' + keyId + '/plaintext');
                    plaintext = res.api_key;
                    this._keyPlaintextCache[keyId] = plaintext;
                }
                el.textContent = plaintext;
                this._portalKeyVisible[keyId] = 1;
            } catch(e) {
                this.showToast('获取Key失败', 'error');
            }
        } else {
            const keysRes = await this.api('GET', '/api/portal/api-keys');
            const currentKey = (keysRes.keys || []).find(k => k.id === keyId);
            const fullKey = currentKey ? (currentKey.key || '') : '';
            const prefixEnd = fullKey.indexOf('-', fullKey.indexOf('-') + 1) + 1;
            const keyPrefix = prefixEnd > 0 ? fullKey.substring(0, prefixEnd) : fullKey.substring(0, Math.min(8, fullKey.length));
            el.textContent = keyPrefix + '...';
            this._portalKeyVisible[keyId] = 0;
        }
    },

    async copyKeyToClipboard(keyId) {
        try {
            let plaintext = this._keyPlaintextCache[keyId];
            if (!plaintext) {
                const res = await this.api('GET', '/api/portal/api-keys/' + keyId + '/plaintext');
                plaintext = res.api_key;
                this._keyPlaintextCache[keyId] = plaintext;
            }
            await navigator.clipboard.writeText(plaintext);
            this.showToast('已复制到剪贴板', 'success');
        } catch(e) {
            this.showToast('复制失败: ' + e.message, 'error');
        }
    },

    async showKeyConfig(keyId, keyName) {
        const baseUrl = window.location.origin;
        let modelListHtml = '<div style="color:var(--text-muted)">加载中...</div>';
        let allowedModels = null;
        let keyDisplay = '';
        try {
            const keysRes = await this.api('GET', '/api/portal/api-keys');
            const currentKey = (keysRes.keys || []).find(k => k.id === keyId);
            if (currentKey && currentKey.client_id_fixed !== false && currentKey.allowed_models && currentKey.allowed_models.length > 0) {
                allowedModels = currentKey.allowed_models;
            }
            if (currentKey) {
                const fullKey = currentKey.key || '';
                const prefixEnd = fullKey.indexOf('-', fullKey.indexOf('-') + 1) + 1;
                const keyPrefix = prefixEnd > 0 ? fullKey.substring(0, prefixEnd) : fullKey.substring(0, Math.min(8, fullKey.length));
                keyDisplay = `<div style="margin-bottom:16px">
                    <div style="font-weight:600;margin-bottom:6px;color:var(--accent-blue)">🔑 API Key</div>
                    <div style="background:var(--bg-tertiary);padding:12px;border-radius:8px;font-size:12px;display:flex;align-items:center;gap:8px">
                        <code id="portalKeyDisplay_${keyId}" style="flex:1;word-break:break-all;color:var(--accent-green)">${this.esc(keyPrefix)}...</code>
                        <button class="btn-icon" onclick="Portal.togglePortalKeyVisibility('${keyId}')" title="查看完整Key">👁️</button>
                        <button class="btn-icon" onclick="Portal.copyKeyToClipboard('${keyId}')" title="复制完整Key">📋</button>
                    </div>
                </div>`;
            }
        } catch(e) {}
        try {
            const res = await this.api('GET', '/api/portal/models');
            let models = res.models || [];
            if (allowedModels) {
                models = models.filter(m => allowedModels.includes(m.id));
            }
            if (models.length > 0) {
                modelListHtml = models.map(m => `<span style="display:inline-block;background:var(--bg-tertiary);padding:3px 8px;border-radius:4px;font-size:12px;margin:2px;cursor:pointer" onclick="navigator.clipboard.writeText('${this.esc(m.id)}');Portal.showToast('已复制模型名','success')" title="点击复制">${this.esc(m.id)}</span>`).join('');
            } else {
                modelListHtml = '<div style="color:var(--text-muted)">暂无可用模型</div>';
            }
        } catch(e) {
            modelListHtml = '<div style="color:var(--text-muted)">获取失败</div>';
        }
        this.showModal('📖 配置参考 — ' + keyName, `
            <div style="font-size:13px;line-height:1.8">
                ${keyDisplay}
                <div style="margin-bottom:16px">
                    <div style="font-weight:600;margin-bottom:6px;color:var(--accent-blue)">🔗 请求地址</div>
                    <div style="background:var(--bg-tertiary);padding:12px;border-radius:8px;font-size:12px">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><strong style="width:80px">Chat:</strong> <code style="flex:1">${baseUrl}/v1/chat/completions</code> <button class="btn-icon" onclick="navigator.clipboard.writeText('${baseUrl}/v1/chat/completions');Portal.showToast('已复制','success')">📋</button></div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><strong style="width:80px">Responses:</strong> <code style="flex:1">${baseUrl}/v1/responses</code> <button class="btn-icon" onclick="navigator.clipboard.writeText('${baseUrl}/v1/responses');Portal.showToast('已复制','success')">📋</button></div>
                        <div style="display:flex;align-items:center;gap:8px"><strong style="width:80px">Anthropic:</strong> <code style="flex:1">${baseUrl}/anthropic</code> <button class="btn-icon" onclick="navigator.clipboard.writeText('${baseUrl}/anthropic');Portal.showToast('已复制','success')">📋</button></div>
                    </div>
                </div>

                <div style="margin-bottom:16px">
                    <div style="font-weight:600;margin-bottom:6px;color:var(--accent-blue)">📝 客户端格式</div>
                    <div style="background:var(--bg-tertiary);padding:12px;border-radius:8px;font-size:12px">
                        <div style="margin-bottom:6px"><strong>OpenAI 兼容:</strong> <code>${baseUrl}/v1</code> <button class="btn-icon" onclick="navigator.clipboard.writeText('${baseUrl}/v1');Portal.showToast('已复制','success')">📋</button>（适用于 Cursor、Continue、OpenClaw、Hermes 等 IDE 和客户端）</div>
                        <div><strong>Anthropic 兼容:</strong> <code>${baseUrl}/anthropic</code> <button class="btn-icon" onclick="navigator.clipboard.writeText('${baseUrl}/anthropic');Portal.showToast('已复制','success')">📋</button>（适用于 Claude Code 等 Anthropic 客户端）</div>
                    </div>
                </div>

                <div style="margin-bottom:16px">
                    <div style="font-weight:600;margin-bottom:6px;color:var(--accent-blue)">🤖 客户端模型名称 <span style="font-weight:400;font-size:11px;color:var(--text-muted)">（点击复制）</span></div>
                    <div style="background:var(--bg-tertiary);padding:12px;border-radius:8px">${modelListHtml}</div>
                </div>

                <div style="font-size:12px;color:var(--accent-orange);margin-top:12px">⚠️ 请妥善保管您的 API Key，不要泄露给他人</div>
            </div>
        `, [
            { text: '关闭', class: 'btn-outline', action: () => this.closeModal() }
        ]);
    },

    showCreateKeyModal() {
        this.showModal('申请 API Key', `
            <form id="createKeyForm">
                <div class="form-group">
                    <label>Key 名称 <span class="required">*</span></label>
                    <input type="text" id="newKeyName" class="form-control" placeholder="如: my-app-key" value="my-key">
                </div>
                <div class="form-group">
                    <label>计费模式</label>
                    <select id="newKeyBilling" class="form-control">
                        <option value="coding_plan">Coding Plan（请求次数制）</option>
                        <option value="per_token">按 Token 计费</option>
                        <option value="token_plan">Token Plan（积分制）</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>用途说明</label>
                    <textarea id="newKeyPurpose" class="form-control" rows="3" placeholder="请简要说明此 Key 的用途，方便管理员审核"></textarea>
                </div>
                <p class="form-hint">提交后需等待管理员审核并分配 Key，审核通过后您将在此页面看到 Key 详情。</p>
            </form>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '提交申请', class: 'btn-primary', action: () => this.createKey() }
        ]);
    },

    async createKey() {
        const name = document.getElementById('newKeyName').value.trim() || 'my-key';
        const billingMode = document.getElementById('newKeyBilling').value;
        const purpose = document.getElementById('newKeyPurpose').value.trim();

        try {
            const data = await this.api('POST', '/api/portal/api-keys', { name, billing_mode: billingMode, purpose });
            this.closeModal();
            this.showToast('申请已提交，请等待管理员审核', 'success');
            this.loadApiKeys();
        } catch (err) {
            this.showToast('提交失败: ' + err.message, 'error');
        }
    },

    async toggleKey(id, currentStatus) {
        try {
            await this.api('PUT', `/api/portal/api-keys/${id}/toggle`);
            this.showToast(currentStatus ? '已禁用' : '已启用', 'success');
            this.loadApiKeys();
        } catch (err) {
            this.showToast('操作失败: ' + err.message, 'error');
        }
    },

    confirmDeleteKey(id, name) {
        this.showModal('确认删除', `
            <div class="confirm-content">
                <div class="confirm-icon">⚠️</div>
                <div class="confirm-text">确定要删除 Key "${this.esc(name)}" 吗？</div>
                <div class="confirm-sub">此操作不可恢复，使用该 Key 的应用将无法继续访问。</div>
            </div>
        `, [
            { text: '取消', class: 'btn-outline', action: () => this.closeModal() },
            { text: '删除', class: 'btn-danger', action: () => this.deleteKey(id) }
        ]);
    },

    async deleteKey(id) {
        try {
            await this.api('DELETE', `/api/portal/api-keys/${id}`);
            this.closeModal();
            this.showToast('已删除', 'success');
            this.loadApiKeys();
        } catch (err) {
            this.showToast('删除失败: ' + err.message, 'error');
        }
    },

    // ========== 用量统计 ==========
    async renderStats() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <div class="page-header-left"><h2>📈 用量统计</h2></div>
                <div class="period-selector">
                    <button class="period-btn ${this.currentPeriod === 'day' ? 'active' : ''}" onclick="Portal.setPeriod('day')">今日</button>
                    <button class="period-btn ${this.currentPeriod === 'week' ? 'active' : ''}" onclick="Portal.setPeriod('week')">本周</button>
                    <button class="period-btn ${this.currentPeriod === 'month' ? 'active' : ''}" onclick="Portal.setPeriod('month')">本月</button>
                </div>
            </div>
            <div class="card">
                <div class="card-header"><h3>📊 按模型统计</h3></div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>模型</th><th>请求数</th><th>输入Token</th><th>输出Token</th><th>费用</th></tr></thead>
                        <tbody id="modelStatsBody"><tr><td colspan="5" class="table-empty"><div class="empty-icon">📊</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
            <div class="card" style="margin-top: 24px;">
                <div class="card-header"><h3>🔑 按 Key 统计</h3></div>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>Key 名称</th><th>请求数</th><th>输入Token</th><th>输出Token</th><th>费用</th></tr></thead>
                        <tbody id="keyStatsBody"><tr><td colspan="5" class="table-empty"><div class="empty-icon">🔑</div>加载中...</td></tr></tbody>
                    </table>
                </div>
            </div>
        `;
        await this.loadStats();
    },

    setPeriod(period) {
        this.currentPeriod = period;
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent === { day: '今日', week: '本周', month: '本月' }[period]);
        });
        this.loadStats();
    },

    async loadStats() {
        try {
            const [modelData, keyData] = await Promise.all([
                this.api('GET', `/api/portal/stats/by-model?period=${this.currentPeriod}`),
                this.api('GET', `/api/portal/stats/by-key?period=${this.currentPeriod}`)
            ]);

            const modelBody = document.getElementById('modelStatsBody');
            if (modelData.stats && modelData.stats.length > 0) {
                modelBody.innerHTML = modelData.stats.map(s => `
                    <tr>
                        <td>${this.esc(s.model)}</td>
                        <td>${this.formatNumber(s.requests)}</td>
                        <td>${this.formatNumber(s.input_tokens)}</td>
                        <td>${this.formatNumber(s.output_tokens)}</td>
                        <td>${this.formatCost(s.cost)}</td>
                    </tr>
                `).join('');
            } else {
                modelBody.innerHTML = '<tr><td colspan="5" class="table-empty"><div class="empty-icon">📊</div>暂无数据</td></tr>';
            }

            const keyBody = document.getElementById('keyStatsBody');
            if (keyData.stats && keyData.stats.length > 0) {
                keyBody.innerHTML = keyData.stats.map(s => `
                    <tr>
                        <td>${this.esc(s.key_name)}</td>
                        <td>${this.formatNumber(s.requests)}</td>
                        <td>${this.formatNumber(s.input_tokens)}</td>
                        <td>${this.formatNumber(s.output_tokens)}</td>
                        <td>${this.formatCost(s.cost)}</td>
                    </tr>
                `).join('');
            } else {
                keyBody.innerHTML = '<tr><td colspan="5" class="table-empty"><div class="empty-icon">🔑</div>暂无数据</td></tr>';
            }
        } catch (err) {
            this.showToast('加载失败: ' + err.message, 'error');
        }
    },

    // ========== 请求日志 ==========
    async renderLogs() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <div class="page-header-left"><h2>📋 请求日志</h2></div>
                <div class="filter-bar">
                    <select id="logStatusFilter" class="form-control" onchange="Portal.filterLogs()">
                        <option value="">全部状态</option>
                        <option value="success">成功</option>
                        <option value="error">失败</option>
                    </select>
                    <button class="btn btn-outline" onclick="Portal.loadLogs()">🔄 刷新</button>
                </div>
            </div>
            <div class="card">
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>时间</th><th>模型</th><th>输入</th><th>输出</th><th>费用</th><th>延迟</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody id="logsBody"><tr><td colspan="8" class="table-empty"><div class="empty-icon">📋</div>加载中...</td></tr></tbody>
                    </table>
                </div>
                <div class="pagination" id="logsPagination"></div>
            </div>
        `;
        this.logOffset = 0;
        this.logStatusFilter = '';
        await this.loadLogs();
    },

    filterLogs() {
        this.logStatusFilter = document.getElementById('logStatusFilter').value;
        this.logOffset = 0;
        this.loadLogs();
    },

    async loadLogs() {
        try {
            let url = `/api/portal/logs?limit=20&offset=${this.logOffset}`;
            if (this.logStatusFilter) url += `&status=${this.logStatusFilter}`;

            const data = await this.api('GET', url);
            const body = document.getElementById('logsBody');

            if (data.logs && data.logs.length > 0) {
                body.innerHTML = data.logs.map(l => `
                    <tr>
                        <td class="text-muted">${this.formatDateTime(l.created_at)}</td>
                        <td>${this.esc(l.model)}</td>
                        <td>${this.formatNumber(l.input_tokens)}</td>
                        <td>${this.formatNumber(l.output_tokens)}</td>
                        <td>${this.formatCost(l.cost)}</td>
                        <td>${l.latency_ms}ms</td>
                        <td><span class="badge ${l.status === 'success' ? 'badge-success' : 'badge-danger'}">${l.status === 'success' ? '成功' : '失败'}</span></td>
                        <td><button class="btn btn-sm btn-outline" onclick="Portal.showLogDetail('${l.request_id}')">详情</button></td>
                    </tr>
                `).join('');
            } else {
                body.innerHTML = '<tr><td colspan="8" class="table-empty"><div class="empty-icon">📋</div>暂无日志</td></tr>';
            }
        } catch (err) {
            this.showToast('加载失败: ' + err.message, 'error');
        }
    },

    async showLogDetail(id) {
        try {
            const res = await this.api('GET', `/api/portal/logs/${id}`);
            const reqBody = res.request_body ? this.esc(this.formatJSON(res.request_body)) : '（未记录）';
            const respBody = res.response_body ? this.esc(this.formatJSON(res.response_body)) : '（未记录）';
            const chatHtml = this.renderChatView(res);

            this.showModal('请求详情 - ' + id.substring(0, 8), `
                <div style="display:flex;gap:8px;margin-bottom:10px;font-size:12px;color:var(--text-secondary)">
                    <span>${this.esc(res.provider)} / ${this.esc(res.model)}</span>
                    <span>${res.status === 'success' ? '✅' : '❌'} ${res.status}</span>
                    <span>⏱ ${((res.latency_ms || 0) / 1000).toFixed(2)}s</span>
                    <span>💰 ${this.formatCost(res.cost || 0)}</span>
                    <span>📅 ${this.formatDate(res.created_at)}</span>
                </div>
                <div style="display:flex;gap:0;margin-bottom:10px;border:1px solid var(--border-color);border-radius:6px;overflow:hidden">
                    <button id="tabChat" onclick="Portal._switchLogTab('chat')" style="flex:1;padding:6px 12px;border:none;background:var(--accent-blue);color:#fff;cursor:pointer;font-size:13px;font-weight:500">💬 对话视图</button>
                    <button id="tabRaw" onclick="Portal._switchLogTab('raw')" style="flex:1;padding:6px 12px;border:none;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:13px;font-weight:500">📄 原文视图</button>
                </div>
                <div id="logTabChat" style="max-height:60vh;overflow-y:auto">
                    ${chatHtml}
                </div>
                <div id="logTabRaw" style="display:none;max-height:60vh;overflow-y:auto">
                    <div style="margin-bottom:12px">
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:12px;font-weight:600;color:#60b0f0">📤 请求体</span></div>
                        <pre id="logReqBody" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px;font-size:11px;line-height:1.4;overflow:auto;max-height:25vh;margin:0;white-space:pre-wrap;word-break:break-all;color:#24292e">${reqBody}</pre>
                    </div>
                    <div>
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:12px;font-weight:600;color:#60d070">📥 响应体</span></div>
                        <pre id="logRespBody" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px;font-size:11px;line-height:1.4;overflow:auto;max-height:25vh;margin:0;white-space:pre-wrap;word-break:break-all;color:#24292e">${respBody}</pre>
                    </div>
                </div>
                ${res.error_message ? `<div style="margin-top:8px;padding:8px;background:rgba(243,80,80,0.1);border-radius:6px;border:1px solid rgba(243,80,80,0.2);color:#f35050;font-size:12px">❌ ${this.esc(res.error_message)}</div>` : ''}
            `, [{ text: '关闭', class: 'btn-outline', action: () => this.closeModal() }]);
        } catch (err) {
            this.showToast('加载详情失败: ' + err.message, 'error');
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
                    if (chunk.message.usage) { inputTokens = chunk.message.usage.input_tokens || inputTokens; }
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
        if (!respObj && typeof res.response_body === 'string') { respObj = this._parseStreamResponse(res.response_body); }

        if (!reqObj && !respObj) {
            return '<div style="text-align:center;padding:40px;color:var(--text-secondary)">📋 对话内容未记录</div>';
        }

        const bubbles = [];

        if (reqObj) {
            if (reqObj.system && typeof reqObj.system === 'string') { bubbles.push({ role: 'system', content: reqObj.system }); }
            if (reqObj.messages && Array.isArray(reqObj.messages)) {
                for (const msg of reqObj.messages) { bubbles.push({ role: msg.role, content: msg.content, tool_calls: msg.tool_calls, tool_call_id: msg.tool_call_id, name: msg.name }); }
            }
            if (reqObj.input && typeof reqObj.input === 'string') { bubbles.push({ role: 'user', content: reqObj.input }); }
            else if (reqObj.input && Array.isArray(reqObj.input)) {
                for (const item of reqObj.input) {
                    if (typeof item === 'string') { bubbles.push({ role: 'user', content: item }); }
                    else if (item.role === 'system') { bubbles.push({ role: 'system', content: item.content || item.text || '' }); }
                    else if (item.type === 'message' && item.role) { bubbles.push({ role: item.role, content: item.content || '' }); }
                    else { bubbles.push({ role: 'user', content: JSON.stringify(item, null, 2) }); }
                }
            }
            if (!reqObj.messages && !reqObj.input && reqObj.prompt) { bubbles.push({ role: 'user', content: reqObj.prompt }); }
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
                    } else if (item.type === 'function_call') { bubbles.push({ role: 'tool_call', content: item.name + '(' + (item.arguments || item.call_id || '') + ')' }); }
                    else if (typeof item === 'string') { bubbles.push({ role: 'assistant', content: item }); }
                    else if (item.content) { bubbles.push({ role: 'assistant', content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2) }); }
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
            } else if (typeof respObj === 'string') { bubbles.push({ role: 'assistant', content: respObj }); }
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
            if (b.content && b.content !== '' && b.content !== null) { html += `<div style="margin-top:6px">${this._renderTextContent(b.content)}</div>`; }
            return html;
        }
        if (b.tool_call_id) {
            let html = `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">ID: ${this.esc(b.tool_call_id)}</div>`;
            if (b.content !== null && b.content !== undefined && b.content !== '') { html += this._renderTextContent(b.content); }
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

    formatJSON(str) {
        try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
    },

    // ========== 个人设置 ==========
    async renderSettings() {
        const mc = document.getElementById('mainContent');
        mc.innerHTML = `
            <div class="page-header">
                <div class="page-header-left"><h2>⚙️ 个人设置</h2><p>管理您的账户信息</p></div>
            </div>
            <div class="settings-section">
                <div class="settings-section-header"><h3>📝 账户信息</h3></div>
                <div class="settings-section-body">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" id="settingsUsername" class="form-control" disabled value="${this.esc(this.user.username)}">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>显示名称</label>
                            <input type="text" id="settingsDisplayName" class="form-control" placeholder="显示名称" value="${this.esc(this.user.display_name || '')}">
                        </div>
                        <div class="form-group">
                            <label>邮箱</label>
                            <input type="email" id="settingsEmail" class="form-control" placeholder="邮箱地址" value="${this.esc(this.user.email || '')}">
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="Portal.updateProfile()">保存资料</button>
                </div>
            </div>
            <div class="settings-section">
                <div class="settings-section-header"><h3>🔒 修改密码</h3></div>
                <div class="settings-section-body">
                    <div class="form-group">
                        <label>当前密码</label>
                        <input type="password" id="oldPassword" class="form-control" placeholder="当前密码">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>新密码</label>
                            <input type="password" id="newPassword" class="form-control" placeholder="新密码（至少6位）">
                        </div>
                        <div class="form-group">
                            <label>确认新密码</label>
                            <input type="password" id="confirmPassword" class="form-control" placeholder="再次输入新密码">
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="Portal.changePassword()">修改密码</button>
                </div>
            </div>
        `;
    },

    async updateProfile() {
        const displayName = document.getElementById('settingsDisplayName').value.trim();
        const email = document.getElementById('settingsEmail').value.trim();

        try {
            await this.api('PUT', '/api/portal/auth/profile', { display_name: displayName, email });
            this.user.display_name = displayName;
            this.user.email = email;
            localStorage.setItem('portal_user', JSON.stringify(this.user));
            const name = displayName || this.user.username;
            document.getElementById('sidebarUserName').textContent = name;
            document.getElementById('userAvatar').textContent = name[0].toUpperCase();
            this.showToast('资料已更新', 'success');
        } catch (err) {
            this.showToast('更新失败: ' + err.message, 'error');
        }
    },

    async changePassword() {
        const oldPwd = document.getElementById('oldPassword').value;
        const newPwd = document.getElementById('newPassword').value;
        const confirmPwd = document.getElementById('confirmPassword').value;

        if (!oldPwd || !newPwd || !confirmPwd) {
            this.showToast('请填写所有密码字段', 'error');
            return;
        }
        if (newPwd.length < 6) {
            this.showToast('新密码至少6位', 'error');
            return;
        }
        if (newPwd !== confirmPwd) {
            this.showToast('两次输入的新密码不一致', 'error');
            return;
        }

        try {
            await this.api('PUT', '/api/portal/auth/password', { old_password: oldPwd, new_password: newPwd });
            this.showToast('密码已修改', 'success');
            document.getElementById('oldPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
        } catch (err) {
            this.showToast('修改失败: ' + err.message, 'error');
        }
    },

    // ========== 工具函数 ==========
    showModal(title, bodyHtml, buttons) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = bodyHtml;
        const footer = document.getElementById('modalFooter');
        footer.innerHTML = '';
        if (buttons) {
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
        const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
        toast.className = 'toast toast-' + (type || 'info');
        toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${this.esc(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => { toast.classList.add('toast-out'); setTimeout(() => toast.remove(), 300); }, 3000);
    },

    formatNumber(n) { return Number(n || 0).toLocaleString('zh-CN'); },
    formatCost(c) { return '$' + Number(c || 0).toFixed(4); },
    formatCostCNY(cost) { if (cost == null) return '0.00'; return Number(cost).toFixed(2); },
    formatReadableToken(num) {
        if (num == null || num === 0) return '0';
        const abs = Math.abs(num);
        const sign = num < 0 ? '-' : '';
        if (abs >= 1e8) return sign + (abs / 1e8).toFixed(3) + '亿';
        if (abs >= 1e6) return sign + (abs / 1e6).toFixed(3) + '百万';
        if (abs >= 1e4) return sign + (abs / 1e4).toFixed(3) + '万';
        return Number(num).toLocaleString('zh-CN');
    },
    _toUTC(s) {
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
    formatDate(d) {
        if (!d) return '-';
        const date = new Date(this._toUTC(d));
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    },
    formatDateTime(d) {
        if (!d) return '-';
        const date = new Date(this._toUTC(d));
        return this.formatDate(d) + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') + ':' + String(date.getSeconds()).padStart(2, '0');
    },
    esc(s) {
        const div = document.createElement('div');
        div.textContent = String(s || '');
        return div.innerHTML;
    },
    billingModeLabel(mode) {
        const labels = { per_token: '按Token', token_plan: 'Token Plan', coding_plan: 'Coding Plan', per_request: '按请求', quota: '积分制' };
        return labels[mode] || mode || '按Token';
    },

    showInviteRegister(prefillCode) {
        const code = prefillCode || '';
        const loginPage = document.getElementById('loginPage');
        loginPage.innerHTML = `
            <div class="login-container">
                <div class="login-logo">
                    <div class="logo-icon">🎫</div>
                    <h1>邀请码注册</h1>
                    <p>使用邀请码创建账户并获取 API Key</p>
                </div>
                <div id="inviteError" class="login-error"></div>
                <div id="inviteCodeStatus" style="display:none;text-align:center;font-size:13px;margin-bottom:8px;"></div>
                <form id="inviteForm" class="login-form" onsubmit="return Portal.registerWithInvite(event)">
                    <div class="form-group">
                        <label>邀请码 <span class="required">*</span></label>
                        <input type="text" id="inviteCode" placeholder="请输入6位邀请码" required maxlength="6" style="text-transform:uppercase" autocomplete="off" value="${this.esc(code)}" ${code ? 'readonly style="text-transform:uppercase;background:var(--bg-tertiary);cursor:not-allowed"' : ''}>
                    </div>
                    <div class="form-group">
                        <label>用户名 <span class="required">*</span></label>
                        <input type="text" id="inviteUsername" placeholder="请输入用户名" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label>密码 <span class="required">*</span></label>
                        <input type="password" id="invitePassword" placeholder="至少8位" required minlength="8" autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label>邮箱（可选）</label>
                        <input type="email" id="inviteEmail" placeholder="可选填写" autocomplete="email">
                    </div>
                    <div class="form-group">
                        <label>显示名称（可选）</label>
                        <input type="text" id="inviteDisplayName" placeholder="可选填写" autocomplete="name">
                    </div>
                    <button type="submit" class="btn-login" style="margin-top:8px;background:var(--accent-blue)">注 册</button>
                </form>
                <div style="text-align:center;margin-top:16px">
                    <a href="#" onclick="Portal.backToLogin();return false" style="color:var(--text-muted);font-size:14px;text-decoration:none">← 返回登录</a>
                </div>
            </div>
        `;
        if (code) this.validateInviteCode(code);
    },

    async validateInviteCode(code) {
        const statusEl = document.getElementById('inviteCodeStatus');
        if (!statusEl) return;
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = '验证邀请码中...';
        try {
            const res = await this.api('GET', '/api/portal/verify-invite?code=' + encodeURIComponent(code));
            statusEl.style.color = 'var(--accent-green)';
            statusEl.textContent = '✅ 邀请码有效 — ' + this.esc(res.template_name || '') + ' (' + (res.billing_mode || '') + ')';
        } catch(e) {
            statusEl.style.color = 'var(--accent-red)';
            statusEl.textContent = '❌ ' + (e.message || '邀请码无效');
        }
    },

    backToLogin() {
        document.getElementById('loginPage').innerHTML = `
            <div class="login-container">
                <div class="login-logo">
                    <div class="logo-icon">🚀</div>
                    <h1>DoraDoor</h1>
                    <p>用户自助服务平台</p>
                </div>
                <div id="loginError" class="login-error"></div>
                <form id="loginForm" class="login-form" onsubmit="return Portal.login(event)">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" id="loginUsername" placeholder="请输入用户名" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label>密码</label>
                        <input type="password" id="loginPassword" placeholder="请输入密码" required autocomplete="current-password">
                    </div>
                    <button type="submit" class="btn-login">登 录</button>
                </form>
                <div style="text-align:center;margin-top:16px">
                    <a href="#" onclick="Portal.showInviteRegister();return false" style="color:var(--accent-blue);font-size:14px;text-decoration:none">🎫 使用邀请码注册</a>
                </div>
            </div>
        `;
    },

    async registerWithInvite(e) {
        e.preventDefault();
        const inviteCode = document.getElementById('inviteCode').value.trim().toUpperCase();
        const username = document.getElementById('inviteUsername').value.trim();
        const password = document.getElementById('invitePassword').value;
        const email = document.getElementById('inviteEmail').value.trim();
        const displayName = document.getElementById('inviteDisplayName').value.trim();
        const errorEl = document.getElementById('inviteError');

        if (!inviteCode || !username || !password) {
            errorEl.textContent = '邀请码、用户名和密码不能为空';
            errorEl.style.display = 'block';
            return false;
        }
        if (password.length < 8) {
            errorEl.textContent = '密码长度至少8位';
            errorEl.style.display = 'block';
            return false;
        }

        try {
            const res = await this.api('POST', '/api/portal/register-invite', {
                invite_code: inviteCode, username, password, email, display_name: displayName
            });
            this.token = res.token;
            this.user = { id: res.user_id, username: res.username, display_name: displayName };
            localStorage.setItem('portal_token', this.token);
            localStorage.setItem('portal_user', JSON.stringify(this.user));
            errorEl.style.display = 'none';

            this.showApp();
            if (res.api_key) {
                this.showModal('🎉 注册成功', `
                    <div style="text-align:center;margin-bottom:16px">
                        <div style="font-size:14px;color:var(--text-secondary)">您已获得以下 API Key，请立即复制保存：</div>
                        <div style="background:var(--bg-card);padding:12px;border-radius:8px;font-family:monospace;margin:8px 0;word-break:break-all">${this.esc(res.api_key)}</div>
                        <div style="font-size:12px;color:var(--accent-orange);margin-top:8px">⚠️ 请妥善保存此 Key，也可在「我的 Key」页面随时查看完整内容</div>
                    </div>
                `, [
                    { text: '复制 Key', class: 'btn-primary', action: () => {
                        navigator.clipboard.writeText(res.api_key).then(() => this.showToast('已复制到剪贴板', 'success'));
                    }},
                    { text: '关闭', class: 'btn-outline', action: () => this.closeModal() }
                ]);
            } else {
                this.showToast('注册成功', 'success');
            }
        } catch (err) {
            errorEl.textContent = err.message || '注册失败';
            errorEl.style.display = 'block';
        }
        return false;
    },

    async showKeyPlaintext(keyId) {
        try {
            const res = await this.api('GET', '/api/portal/api-keys/' + keyId + '/plaintext');
            this.showModal('🔑 查看 Key 明文', `
                <div style="text-align:center;margin-bottom:16px">
                    <div style="font-size:14px;color:var(--text-secondary)">以下是您 API Key 的完整明文，请妥善保存：</div>
                    <div style="background:var(--bg-card);padding:12px;border-radius:8px;font-family:monospace;margin:8px 0;word-break:break-all">${this.esc(res.api_key)}</div>
                    <div style="font-size:12px;color:var(--accent-orange);margin-top:8px">⚠️ 请勿泄露此 Key</div>
                </div>
            `, [
                { text: '复制 Key', class: 'btn-primary', action: () => {
                    navigator.clipboard.writeText(res.api_key).then(() => this.showToast('已复制到剪贴板', 'success'));
                }},
                { text: '关闭', class: 'btn-outline', action: () => this.closeModal() }
            ]);
        } catch (err) {
            this.showToast('查看失败: ' + err.message, 'error');
        }
    }
};

// 初始化
Portal.init();
