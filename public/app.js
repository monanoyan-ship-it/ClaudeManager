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
      <div class="card">
        <div class="card-header">
          <div class="card-click" onclick="app.openProject(${p.id}, '${this.esc(p.name)}')">
            <h3>${this.esc(p.name)}</h3>
            <div class="path">${this.esc(p.path)}</div>
          </div>
          <button class="btn-sm btn-danger card-delete" onclick="event.stopPropagation(); app.deleteProject(${p.id}, '${this.esc(p.name)}')" title="Projeyi Sil">&#10005;</button>
        </div>
        <div class="stats-row" onclick="app.openProject(${p.id}, '${this.esc(p.name)}')">
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
    const baseUrl = 'http://127.0.0.1:41847';
    statsEl.innerHTML = `
      <div class="stat-box"><div class="stat-value">${s.session_count}</div><div class="stat-label">Session</div></div>
      <div class="stat-box"><div class="stat-value">${s.prompt_count}</div><div class="stat-label">Prompt</div></div>
      <div class="stat-box"><div class="stat-value">${s.tool_count}</div><div class="stat-label">Tool Kullanimi</div></div>
      <div class="stat-box curl-buttons-box">
        <div class="stat-label" style="margin-bottom:4px;">Claude'a Kopyala</div>
        <div class="curl-buttons">
          <button class="btn-sm" onclick="app.copyText('curl -s ${baseUrl}/api/projects/${id}/patterns')" title="Pattern'leri oku">Pattern Oku</button>
          <button class="btn-sm" onclick="app.copyText('curl -s ${baseUrl}/api/projects/${id}/analytics')" title="Analitik verileri cek">Analitik</button>
          <button class="btn-sm" onclick="app.copyText('curl -X POST ${baseUrl}/api/patterns -H &quot;Content-Type: application/json&quot; -d \\'{&quot;project_id&quot;:${id},&quot;type&quot;:&quot;rule&quot;,&quot;title&quot;:&quot;KURAL_BASLIGI&quot;,&quot;description&quot;:&quot;ACIKLAMA&quot;}\\'')" title="Yeni pattern ekle">Pattern Ekle</button>
          <button class="btn-sm" onclick="app.copyText('curl -s ${baseUrl}/api/projects/${id}/prompts?limit=10')" title="Son prompt'lari oku">Prompt'lar</button>
          <button class="btn-sm" onclick="app.copyText('curl -s ${baseUrl}/api/projects/${id}/tool-uses?limit=10')" title="Son tool kullanimlarini oku">Tool'lar</button>
          <button class="btn-sm" onclick="app.copyText('curl -s ${baseUrl}/api/projects/${id}/roadmap')" title="Yol haritasini oku">Yol Haritasi</button>
          <button class="btn-sm" onclick="app.copyText('curl -X PUT ${baseUrl}/api/tasks/GOREV_ID -H &quot;Content-Type: application/json&quot; -d \\'{&quot;status&quot;:&quot;completed&quot;}\\'')" title="Gorev tamamla">Gorev Tamamla</button>
        </div>
      </div>
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
      roadmap: () => this.loadRoadmap(),
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

  // --- Delete Project ---
  async deleteProject(id, name) {
    if (!confirm(`"${name}" projesi ve TUM verileri silinecek. Emin misiniz?`)) return;
    await this.api(`/projects/${id}`, { method: 'DELETE' });
    this.loadProjects();
  },

  // --- Merge ---
  mergeProjects: [],

  async showMergeModal() {
    const { data } = await this.api('/projects');
    this.mergeProjects = data;
    if (data.length < 2) {
      alert('Birlestirme icin en az 2 proje olmali.');
      return;
    }

    // Populate target dropdown
    const targetEl = document.getElementById('mergeTarget');
    targetEl.innerHTML = data.map(p =>
      `<option value="${p.id}">${this.esc(p.name)} (${p.prompt_count} prompt, ${p.tool_count} tool)</option>`
    ).join('');

    // Populate source checkboxes
    this.updateMergeSources();
    targetEl.onchange = () => this.updateMergeSources();

    document.getElementById('mergeModal').classList.add('active');
  },

  updateMergeSources() {
    const targetId = parseInt(document.getElementById('mergeTarget').value);
    const el = document.getElementById('mergeSourceList');
    const sources = this.mergeProjects.filter(p => p.id !== targetId);
    el.innerHTML = sources.map(p => `
      <div class="merge-source-item">
        <label>
          <input type="checkbox" value="${p.id}" />
          <span><strong>${this.esc(p.name)}</strong></span>
          <span class="merge-path">${this.esc(p.path)}</span>
        </label>
        <span class="merge-stats">${p.session_count}s / ${p.prompt_count}p / ${p.tool_count}t</span>
      </div>
    `).join('');
  },

  closeMergeModal() {
    document.getElementById('mergeModal').classList.remove('active');
  },

  async executeMerge() {
    const targetId = parseInt(document.getElementById('mergeTarget').value);
    const checkboxes = document.querySelectorAll('#mergeSourceList input[type="checkbox"]:checked');
    const sourceIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (!sourceIds.length) {
      alert('En az bir kaynak proje secin.');
      return;
    }

    const targetName = this.mergeProjects.find(p => p.id === targetId)?.name || '';
    const sourceNames = sourceIds.map(id => this.mergeProjects.find(p => p.id === id)?.name || id).join(', ');

    if (!confirm(`"${sourceNames}" projeleri "${targetName}" ile birlestirilecek. Kaynak projeler silinecek. Emin misiniz?`)) {
      return;
    }

    const result = await this.api('/projects/merge', {
      method: 'POST',
      body: { target_id: targetId, source_ids: sourceIds }
    });

    this.closeMergeModal();
    alert('Projeler basariyla birlestirildi!');
    this.loadProjects();
  },

  // --- Roadmap ---
  async loadRoadmap() {
    const id = this.currentProject.id;
    const [roadmap, stats] = await Promise.all([
      this.api(`/projects/${id}/roadmap`),
      this.api(`/projects/${id}/roadmap/stats`)
    ]);

    // Progress bar
    const progressEl = document.getElementById('roadmapProgress');
    progressEl.innerHTML = `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${stats.percent}%"></div>
        <div class="progress-text">${stats.completed}/${stats.total} gorev (%${stats.percent})</div>
      </div>
    `;

    // Phases
    const el = document.getElementById('roadmapContent');
    if (!roadmap.data.length) {
      el.innerHTML = '<div class="empty-state">Henuz yol haritasi yok. "Yeni Faz" ile baslayin veya XML import edin.</div>';
      return;
    }

    el.innerHTML = roadmap.data.map(phase => `
      <div class="phase-card" id="phase-${phase.id}">
        <div class="phase-header" onclick="app.togglePhase(${phase.id})">
          <div class="phase-title-group">
            <span class="phase-chevron" id="chevron-${phase.id}">&#9660;</span>
            <h4>Faz ${this.esc(phase.phase_no)} - ${this.esc(phase.title)}</h4>
            <span class="status-badge status-${phase.status}">${this.statusLabel(phase.status)}</span>
          </div>
          <div class="phase-header-actions">
            <span class="phase-task-count">${phase.tasks.filter(t => t.status === 'completed').length}/${phase.tasks.length}</span>
            <button class="btn-sm" onclick="event.stopPropagation(); app.editPhase(${phase.id})" title="Duzenle">&#9998;</button>
            <button class="btn-sm btn-danger" onclick="event.stopPropagation(); app.deletePhaseConfirm(${phase.id})" title="Sil">&#10005;</button>
          </div>
        </div>
        <div class="phase-body" id="phase-body-${phase.id}">
          ${phase.tasks.map(task => this.renderTask(task)).join('')}
          <button class="add-task-btn" onclick="app.showTaskModal(${phase.id})">+ Gorev Ekle</button>
        </div>
      </div>
    `).join('');
  },

  renderTask(task) {
    const statusIcon = task.status === 'completed' ? '&#10003;' : task.status === 'in_progress' ? '&#9654;' : task.status === 'cancelled' ? '&#10007;' : '';
    const hasDetail = task.detail || task.risks;
    return `
      <div class="task-item">
        <button class="task-status-btn ${task.status}" onclick="app.cycleTaskStatus(${task.id}, '${task.status}')" title="Durum degistir">${statusIcon}</button>
        <div class="task-info">
          <div class="task-info-header">
            <span class="task-no">${this.esc(task.task_no)}</span>
            <span class="task-name ${task.status}">${this.esc(task.title)}</span>
          </div>
          ${hasDetail ? `<button class="task-detail-toggle" onclick="app.toggleTaskDetail(${task.id})">Detay goster</button>` : ''}
          <div class="task-detail-content hidden" id="task-detail-${task.id}">
            ${task.detail ? `<div>${this.esc(task.detail)}</div>` : ''}
            ${task.risks ? `<div class="task-risks">${this.esc(task.risks)}</div>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-sm" onclick="app.editTask(${task.id}, ${task.phase_id})" title="Duzenle">&#9998;</button>
          <button class="btn-sm btn-danger" onclick="app.deleteTaskConfirm(${task.id})" title="Sil">&#10005;</button>
        </div>
      </div>
    `;
  },

  statusLabel(status) {
    return { planned: 'Planli', in_progress: 'Devam Ediyor', completed: 'Tamamlandi', cancelled: 'Iptal' }[status] || status;
  },

  togglePhase(phaseId) {
    const body = document.getElementById(`phase-body-${phaseId}`);
    const chevron = document.getElementById(`chevron-${phaseId}`);
    body.classList.toggle('collapsed');
    chevron.innerHTML = body.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
  },

  toggleTaskDetail(taskId) {
    const el = document.getElementById(`task-detail-${taskId}`);
    const btn = el.previousElementSibling;
    el.classList.toggle('hidden');
    btn.textContent = el.classList.contains('hidden') ? 'Detay goster' : 'Detay gizle';
  },

  async cycleTaskStatus(taskId, currentStatus) {
    const cycle = { planned: 'in_progress', in_progress: 'completed', completed: 'planned', cancelled: 'planned' };
    const newStatus = cycle[currentStatus] || 'planned';
    await this.api(`/tasks/${taskId}`, { method: 'PUT', body: { status: newStatus } });
    this.loadRoadmap();
  },

  // Phase CRUD
  showPhaseModal(phase = null) {
    document.getElementById('phaseModalTitle').textContent = phase ? 'Faz Duzenle' : 'Yeni Faz';
    document.getElementById('phaseId').value = phase ? phase.id : '';
    document.getElementById('phaseNo').value = phase ? phase.phase_no : '';
    document.getElementById('phaseTitle').value = phase ? phase.title : '';
    document.getElementById('phaseStatus').value = phase ? phase.status : 'planned';
    document.getElementById('phaseModal').classList.add('active');
  },

  closePhaseModal() {
    document.getElementById('phaseModal').classList.remove('active');
  },

  async savePhase(e) {
    e.preventDefault();
    const id = document.getElementById('phaseId').value;
    const body = {
      phase_no: document.getElementById('phaseNo').value,
      title: document.getElementById('phaseTitle').value,
      status: document.getElementById('phaseStatus').value
    };

    if (id) {
      await this.api(`/phases/${id}`, { method: 'PUT', body });
    } else {
      await this.api(`/projects/${this.currentProject.id}/phases`, { method: 'POST', body });
    }

    this.closePhaseModal();
    this.loadRoadmap();
  },

  async editPhase(phaseId) {
    const roadmap = await this.api(`/projects/${this.currentProject.id}/roadmap`);
    const phase = roadmap.data.find(p => p.id === phaseId);
    if (phase) this.showPhaseModal(phase);
  },

  async deletePhaseConfirm(phaseId) {
    if (!confirm('Bu faz ve tum gorevleri silinecek. Emin misiniz?')) return;
    await this.api(`/phases/${phaseId}`, { method: 'DELETE' });
    this.loadRoadmap();
  },

  // Task CRUD
  showTaskModal(phaseId, task = null) {
    document.getElementById('taskModalTitle').textContent = task ? 'Gorev Duzenle' : 'Yeni Gorev';
    document.getElementById('taskId').value = task ? task.id : '';
    document.getElementById('taskPhaseId').value = phaseId;
    document.getElementById('taskNo').value = task ? task.task_no : '';
    document.getElementById('taskTitle').value = task ? task.title : '';
    document.getElementById('taskDetail').value = task ? (task.detail || '') : '';
    document.getElementById('taskRisks').value = task ? (task.risks || '') : '';
    document.getElementById('taskStatus').value = task ? task.status : 'planned';
    document.getElementById('taskModal').classList.add('active');
  },

  closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
  },

  async saveTask(e) {
    e.preventDefault();
    const id = document.getElementById('taskId').value;
    const phaseId = document.getElementById('taskPhaseId').value;
    const body = {
      task_no: document.getElementById('taskNo').value,
      title: document.getElementById('taskTitle').value,
      detail: document.getElementById('taskDetail').value || null,
      risks: document.getElementById('taskRisks').value || null,
      status: document.getElementById('taskStatus').value
    };

    if (id) {
      await this.api(`/tasks/${id}`, { method: 'PUT', body });
    } else {
      body.project_id = this.currentProject.id;
      await this.api(`/phases/${phaseId}/tasks`, { method: 'POST', body });
    }

    this.closeTaskModal();
    this.loadRoadmap();
  },

  async editTask(taskId, phaseId) {
    const roadmap = await this.api(`/projects/${this.currentProject.id}/roadmap`);
    for (const phase of roadmap.data) {
      const task = phase.tasks.find(t => t.id === taskId);
      if (task) { this.showTaskModal(phaseId, task); return; }
    }
  },

  async deleteTaskConfirm(taskId) {
    if (!confirm('Bu gorev silinecek. Emin misiniz?')) return;
    await this.api(`/tasks/${taskId}`, { method: 'DELETE' });
    this.loadRoadmap();
  },

  // Import
  showImportModal() {
    document.getElementById('xmlContent').value = '';
    document.getElementById('xmlFileInput').value = '';
    document.getElementById('importModal').classList.add('active');
  },

  closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
  },

  loadXmlFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('xmlContent').value = e.target.result;
    };
    reader.readAsText(file);
  },

  async executeImport() {
    const xml = document.getElementById('xmlContent').value.trim();
    if (!xml) {
      alert('XML icerik giriniz.');
      return;
    }
    const result = await this.api(`/projects/${this.currentProject.id}/roadmap/import`, {
      method: 'POST',
      body: { xml }
    });
    this.closeImportModal();
    alert(`Import tamamlandi: ${result.imported.phases} faz, ${result.imported.tasks} gorev`);
    this.loadRoadmap();
  },

  // --- Setup ---
  async showSetup() {
    this.showView('setupView');
    // Check API health
    try {
      const health = await fetch('/health').then(r => r.json());
      const el = document.getElementById('apiStatus');
      el.textContent = `Calisiyor - v${health.version}`;
      el.className = 'setup-status ok';
    } catch {
      const el = document.getElementById('apiStatus');
      el.textContent = 'API erisilemedi!';
      el.className = 'setup-status fail';
    }
    // Load hook config
    try {
      const hookRes = await fetch('/setup-hooks.json');
      if (hookRes.ok) {
        const hookText = await hookRes.text();
        document.getElementById('hookContent').textContent = hookText;
      }
    } catch {}
  },

  copyCmd(elementId) {
    const el = document.getElementById(elementId);
    const text = el.textContent || el.innerText;
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.createElement('div');
      toast.className = 'copied-toast';
      toast.textContent = 'Kopyalandi!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    });
  },

  copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.createElement('div');
      toast.className = 'copied-toast';
      toast.textContent = 'Kopyalandi!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    });
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
