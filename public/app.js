const app = {
  currentProject: null,
  currentTab: 'overview',
  charts: {},

  async init() {
    this.applyTheme();
    await this.loadProjects();
    document.getElementById('globalSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.globalSearch();
    });
  },

  // --- Theme ---
  applyTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('themeIcon').textContent = theme === 'dark' ? '\u2600' : '\u263E';
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    document.getElementById('themeIcon').textContent = next === 'dark' ? '\u2600' : '\u263E';
    // Re-render charts with new colors if on analytics tab
    if (this.currentTab === 'analytics' && this.currentProject) {
      this.loadAnalytics();
    }
  },

  // --- API ---
  async api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'API error');
    }
    return res.json();
  },

  // --- Views ---
  showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  showProjects() {
    this.currentProject = null;
    this.showView('projectsView');
    this.loadProjects();
  },

  // --- Projects ---
  async loadProjects() {
    const { data } = await this.api('/projects');
    const el = document.getElementById('projectsList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">Henuz proje yok. Claude Code session\'i baslatarak veri toplanmaya baslayin.</div>';
      return;
    }
    el.innerHTML = data.map(p => `
      <div class="card" onclick="app.openProject(${p.id}, '${this.esc(p.name)}')">
        <h3>${this.esc(p.name)}</h3>
        <div class="path">${this.esc(p.path)}</div>
        <div class="stats-row">
          <span class="stat-item"><strong>${p.session_count}</strong> session</span>
          <span class="stat-item"><strong>${p.prompt_count}</strong> prompt</span>
          <span class="stat-item"><strong>${p.pattern_count}</strong> pattern</span>
          <span class="stat-item"><strong>${p.tool_count}</strong> tool</span>
        </div>
      </div>
    `).join('');
  },

  async openProject(id, name) {
    this.currentProject = { id, name };
    document.getElementById('projectName').textContent = name;
    this.showView('projectView');
    this.switchTab('overview');

    // Load stats
    const project = await this.api(`/projects/${id}`);
    const statsEl = document.getElementById('projectStats');
    const s = project.stats;
    statsEl.innerHTML = `
      <div class="stat-box"><div class="stat-value">${s.session_count}</div><div class="stat-label">Session</div></div>
      <div class="stat-box"><div class="stat-value">${s.prompt_count}</div><div class="stat-label">Prompt</div></div>
      <div class="stat-box"><div class="stat-value">${s.tool_count}</div><div class="stat-label">Tool Kullanimi</div></div>
    `;
  },

  // --- Tabs ---
  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));

    if (!this.currentProject) return;
    const loaders = {
      overview: () => this.loadOverview(),
      sessions: () => this.loadSessions(),
      prompts: () => this.loadPrompts(),
      patterns: () => this.loadPatterns(),
      tools: () => this.loadToolUses(),
      analytics: () => this.loadAnalytics()
    };
    if (loaders[tab]) loaders[tab]();
  },

  // --- Overview ---
  async loadOverview() {
    const id = this.currentProject.id;
    const [patternsRes, analyticsRes] = await Promise.all([
      this.api(`/projects/${id}/patterns`),
      this.api(`/projects/${id}/analytics?days=7`)
    ]);

    const el = document.getElementById('overviewContent');
    const patterns = patternsRes.data;
    const rules = patterns.filter(p => p.type === 'rule');
    const mistakes = patterns.filter(p => p.type === 'mistake');
    const prefs = patterns.filter(p => p.type === 'preference');

    let html = '';

    if (rules.length) {
      html += `<div class="overview-card"><h3>Kurallar (${rules.length})</h3><ul>
        ${rules.map(r => `<li>${this.esc(r.title)}</li>`).join('')}</ul></div>`;
    }
    if (mistakes.length) {
      html += `<div class="overview-card"><h3>Hatalar (${mistakes.length})</h3><ul>
        ${mistakes.map(m => `<li>${this.esc(m.title)}</li>`).join('')}</ul></div>`;
    }
    if (prefs.length) {
      html += `<div class="overview-card"><h3>Tercihler (${prefs.length})</h3><ul>
        ${prefs.map(p => `<li>${this.esc(p.title)}</li>`).join('')}</ul></div>`;
    }

    if (analyticsRes.categories.length) {
      html += `<div class="overview-card"><h3>Son 7 Gun Kategori Dagilimi</h3><ul>
        ${analyticsRes.categories.map(c => `<li>${c.category}: <strong>${c.count}</strong></li>`).join('')}</ul></div>`;
    }

    if (analyticsRes.tools.length) {
      html += `<div class="overview-card"><h3>En Cok Kullanilan Tool'lar</h3><ul>
        ${analyticsRes.tools.slice(0, 5).map(t => `<li>${t.tool_name}: <strong>${t.count}</strong></li>`).join('')}</ul></div>`;
    }

    if (!html) {
      html = '<div class="empty-state">Henuz veri yok.</div>';
    }
    el.innerHTML = html;
  },

  // --- Sessions ---
  async loadSessions(page = 1) {
    const { data, total, limit } = await this.api(`/projects/${this.currentProject.id}/sessions?page=${page}&limit=20`);
    const el = document.getElementById('sessionsList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">Henuz session yok.</div>';
      document.getElementById('sessionsPagination').innerHTML = '';
      return;
    }
    el.innerHTML = `<table>
      <thead><tr><th>Session ID</th><th>Baslangic</th><th>Bitis</th><th>Prompt</th><th>Tool</th></tr></thead>
      <tbody>${data.map(s => `<tr>
        <td>${this.esc((s.session_id || '').substring(0, 12))}...</td>
        <td>${this.formatDate(s.started_at)}</td>
        <td>${s.ended_at ? this.formatDate(s.ended_at) : '<em>aktif</em>'}</td>
        <td>${s.prompt_count}</td>
        <td>${s.tool_count}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    this.renderPagination('sessionsPagination', page, total, limit, p => this.loadSessions(p));
  },

  // --- Prompts ---
  async loadPrompts(page = 1) {
    const category = document.getElementById('categoryFilter').value;
    const search = document.getElementById('promptSearch').value;
    let url = `/projects/${this.currentProject.id}/prompts?page=${page}&limit=20`;
    if (category) url += `&category=${category}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const { data, total, limit } = await this.api(url);
    const el = document.getElementById('promptsList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">Prompt bulunamadi.</div>';
      document.getElementById('promptsPagination').innerHTML = '';
      return;
    }
    el.innerHTML = `<table>
      <thead><tr><th></th><th>Kategori</th><th>Icerik</th><th>Tarih</th></tr></thead>
      <tbody>${data.map(p => {
        const fClass = this.frustrationClass(p.content);
        return `<tr>
          <td><span class="frustration-dot ${fClass}" title="Frustration"></span></td>
          <td>${this.categoryBadge(p.category)}</td>
          <td class="content-cell" title="${this.esc(p.content)}">${this.esc(p.content)}</td>
          <td>${this.formatDate(p.created_at)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
    this.renderPagination('promptsPagination', page, total, limit, p => this.loadPrompts(p));
  },

  // --- Patterns ---
  patternFilter: '',
  async loadPatterns() {
    let url = `/projects/${this.currentProject.id}/patterns`;
    if (this.patternFilter) url += `?type=${this.patternFilter}`;
    const { data } = await this.api(url);
    const el = document.getElementById('patternsList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">Henuz pattern yok.</div>';
      return;
    }
    el.innerHTML = data.map(p => `
      <div class="pattern-card ${p.type}">
        <div class="pattern-header">
          <div>
            <span class="pattern-title">${this.esc(p.title)}</span>
            <span class="badge badge-${this.typeBadgeClass(p.type)}">${p.type}</span>
          </div>
          <div class="pattern-meta">
            Guven: ${p.confidence} | Referans: ${p.times_referenced}x
          </div>
        </div>
        ${p.description ? `<div class="pattern-desc">${this.esc(p.description)}</div>` : ''}
        <div class="pattern-actions">
          <button class="btn-sm" onclick="app.editPattern(${p.id})">Duzenle</button>
          <button class="btn-sm btn-danger" onclick="app.deletePattern(${p.id})">Sil</button>
        </div>
      </div>
    `).join('');
  },

  filterPatterns(type) {
    this.patternFilter = type;
    document.querySelectorAll('.pattern-filters .pill').forEach(p =>
      p.classList.toggle('active', p.dataset.type === type)
    );
    this.loadPatterns();
  },

  showPatternModal(pattern = null) {
    document.getElementById('modalTitle').textContent = pattern ? 'Pattern Duzenle' : 'Yeni Pattern';
    document.getElementById('patternId').value = pattern ? pattern.id : '';
    document.getElementById('patternType').value = pattern ? pattern.type : 'rule';
    document.getElementById('patternTitle').value = pattern ? pattern.title : '';
    document.getElementById('patternDescription').value = pattern ? (pattern.description || '') : '';
    document.getElementById('patternConfidence').value = pattern ? pattern.confidence : 1;
    document.getElementById('confidenceValue').textContent = pattern ? pattern.confidence : '1';
    document.getElementById('patternModal').classList.add('active');
  },

  closePatternModal() {
    document.getElementById('patternModal').classList.remove('active');
  },

  async savePattern(e) {
    e.preventDefault();
    const id = document.getElementById('patternId').value;
    const body = {
      type: document.getElementById('patternType').value,
      title: document.getElementById('patternTitle').value,
      description: document.getElementById('patternDescription').value || null,
      confidence: parseFloat(document.getElementById('patternConfidence').value)
    };

    if (id) {
      await this.api(`/patterns/${id}`, { method: 'PUT', body });
    } else {
      body.project_id = this.currentProject.id;
      await this.api('/patterns', { method: 'POST', body });
    }

    this.closePatternModal();
    this.loadPatterns();
  },

  async editPattern(id) {
    const { data } = await this.api(`/projects/${this.currentProject.id}/patterns`);
    const pattern = data.find(p => p.id === id);
    if (pattern) this.showPatternModal(pattern);
  },

  async deletePattern(id) {
    if (!confirm('Bu pattern silinecek. Emin misiniz?')) return;
    await this.api(`/patterns/${id}`, { method: 'DELETE' });
    this.loadPatterns();
  },

  // --- Tool Uses ---
  async loadToolUses(page = 1) {
    const { data, total, limit } = await this.api(`/projects/${this.currentProject.id}/tool-uses?page=${page}&limit=20`);
    const el = document.getElementById('toolsList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">Henuz tool kullanimi yok.</div>';
      document.getElementById('toolsPagination').innerHTML = '';
      return;
    }
    el.innerHTML = `<table>
      <thead><tr><th>Tool</th><th>Dosya</th><th>Durum</th><th>Tarih</th></tr></thead>
      <tbody>${data.map(t => `<tr>
        <td><strong>${this.esc(t.tool_name)}</strong></td>
        <td class="content-cell">${t.file_path ? this.esc(t.file_path) : '-'}</td>
        <td>${t.success ? '<span class="success-icon">&#10003;</span>' : '<span class="failure-icon">&#10007;</span>'}</td>
        <td>${this.formatDate(t.created_at)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    this.renderPagination('toolsPagination', page, total, limit, p => this.loadToolUses(p));
  },

  // --- Analytics ---
  async loadAnalytics() {
    const data = await this.api(`/projects/${this.currentProject.id}/analytics?days=30`);
    this.destroyCharts();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
    const defaultOpts = {
      responsive: true,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor }, grid: { color: gridColor } }
      }
    };

    // Frustration chart
    if (data.frustration.length) {
      this.charts.frustration = new Chart(document.getElementById('frustrationChart'), {
        type: 'line',
        data: {
          labels: data.frustration.map(d => d.date),
          datasets: [{
            label: 'Ortalama Frustration',
            data: data.frustration.map(d => d.avg_frustration),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            fill: true, tension: 0.3
          }]
        },
        options: { ...defaultOpts, scales: { ...defaultOpts.scales, y: { ...defaultOpts.scales.y, min: 0, max: 1 } } }
      });
    }

    // Tool usage pie chart
    if (data.tools.length) {
      const colors = ['#6366f1','#ec4899','#f59e0b','#22c55e','#06b6d4','#8b5cf6','#f97316','#14b8a6'];
      this.charts.tools = new Chart(document.getElementById('toolChart'), {
        type: 'doughnut',
        data: {
          labels: data.tools.map(t => t.tool_name),
          datasets: [{ data: data.tools.map(t => t.count), backgroundColor: colors }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
      });
    }

    // Category bar chart
    if (data.categories.length) {
      const catColors = {
        feature_request: '#3b82f6', bug_fix: '#ef4444', question: '#f59e0b',
        refactor: '#8b5cf6', feedback: '#ec4899', general: '#6b7280'
      };
      this.charts.categories = new Chart(document.getElementById('categoryChart'), {
        type: 'bar',
        data: {
          labels: data.categories.map(c => c.category),
          datasets: [{
            label: 'Prompt Sayisi',
            data: data.categories.map(c => c.count),
            backgroundColor: data.categories.map(c => catColors[c.category] || '#6b7280')
          }]
        },
        options: defaultOpts
      });
    }

    // Activity timeline
    if (data.activity.length) {
      this.charts.activity = new Chart(document.getElementById('activityChart'), {
        type: 'bar',
        data: {
          labels: data.activity.map(a => a.date),
          datasets: [{
            label: 'Prompt Sayisi',
            data: data.activity.map(a => a.count),
            backgroundColor: '#6366f1'
          }]
        },
        options: defaultOpts
      });
    }
  },

  destroyCharts() {
    Object.values(this.charts).forEach(c => c.destroy());
    this.charts = {};
  },

  // --- Search ---
  async globalSearch() {
    const q = document.getElementById('globalSearch').value.trim();
    if (!q) return;
    const results = await this.api(`/search?q=${encodeURIComponent(q)}`);
    this.showView('searchView');

    const el = document.getElementById('searchResults');
    let html = `<h2>Arama: "${this.esc(q)}"</h2>`;

    if (results.patterns.length) {
      html += `<div class="search-group"><h3>Pattern'ler (${results.patterns.length})</h3>`;
      html += results.patterns.map(p => `
        <div class="pattern-card ${p.type}">
          <span class="badge badge-${this.typeBadgeClass(p.type)}">${p.type}</span>
          <strong>${this.esc(p.title)}</strong>
          ${p.description ? `<div class="pattern-desc">${this.esc(p.description)}</div>` : ''}
        </div>
      `).join('');
      html += '</div>';
    }

    if (results.prompts.length) {
      html += `<div class="search-group"><h3>Prompt'lar (${results.prompts.length})</h3>`;
      html += `<table>
        <thead><tr><th>Proje</th><th>Kategori</th><th>Icerik</th><th>Tarih</th></tr></thead>
        <tbody>${results.prompts.map(p => `<tr>
          <td>${this.esc(p.project_name || '-')}</td>
          <td>${this.categoryBadge(p.category)}</td>
          <td class="content-cell">${this.esc(p.content)}</td>
          <td>${this.formatDate(p.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
      html += '</div>';
    }

    if (!results.patterns.length && !results.prompts.length) {
      html += '<div class="empty-state">Sonuc bulunamadi.</div>';
    }

    el.innerHTML = html;
  },

  // --- Helpers ---
  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'Z'));
    return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  categoryBadge(cat) {
    const map = {
      feature_request: 'feature', bug_fix: 'bug', question: 'question',
      refactor: 'refactor', feedback: 'feedback', general: 'general'
    };
    const cls = map[cat] || 'general';
    return `<span class="badge badge-${cls}">${cat || 'general'}</span>`;
  },

  typeBadgeClass(type) {
    return { rule: 'feature', mistake: 'bug', preference: 'question', pattern: 'refactor' }[type] || 'general';
  },

  frustrationClass(content) {
    if (!content) return 'frustration-low';
    const patterns = [/yanl/i, /hata/i, /bozuk/i, /cal.*m.*yor/i, /tekrar/i, /yine/i, /wrong/i, /broken/i, /again/i, /!{2,}/, /\?{2,}/];
    let score = 0;
    for (const p of patterns) { if (p.test(content)) score++; }
    const normalized = Math.min(score / 3, 1);
    if (normalized > 0.5) return 'frustration-high';
    if (normalized > 0.2) return 'frustration-mid';
    return 'frustration-low';
  },

  renderPagination(containerId, currentPage, total, limit, onClick) {
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) {
      document.getElementById(containerId).innerHTML = '';
      return;
    }
    let html = `<button ${currentPage <= 1 ? 'disabled' : ''} onclick="void(0)" data-page="${currentPage - 1}">&laquo; Onceki</button>`;
    html += `<span>${currentPage} / ${totalPages} (${total} kayit)</span>`;
    html += `<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="void(0)" data-page="${currentPage + 1}">Sonraki &raquo;</button>`;

    const container = document.getElementById(containerId);
    container.innerHTML = html;
    container.querySelectorAll('button:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => onClick(parseInt(btn.dataset.page)));
    });
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => app.init());
