const logService = require('./log-service');
const patternService = require('./pattern-service');
const searchService = require('./search-service');
const planService = require('./plan-service');
const noteService = require('./note-service');
const { detectFrustration } = require('../utils/analyzer');

class ContextService {
  async getProjectContext(projectName, projectPath) {
    const projectId = await logService.ensureProject(projectName, projectPath);

    const [patterns, recentPrompts, stats, topics, allTasks, pinnedNotes] = await Promise.all([
      patternService.getPatterns(projectId),
      logService.getRecentPrompts(projectId, 10),
      logService.getSessionStats(projectId),
      searchService.getFrequentTopics(projectId, 5),
      planService.getTasks(projectId).catch(() => []),
      noteService.getPinnedNotes(projectId).catch(() => [])
    ]);

    const rules = patterns.filter(p => p.type === 'rule');
    const mistakes = patterns.filter(p => p.type === 'mistake');
    const preferences = patterns.filter(p => p.type === 'preference');
    const activeTasks = allTasks.filter(t => t.status === 'in_progress');

    return {
      project: { id: projectId, name: projectName, path: projectPath },
      stats,
      rules: rules.map(r => `- ${r.title}${r.description ? ': ' + r.description : ''}`),
      mistakes: mistakes.map(m => `- ${m.title}${m.description ? ': ' + m.description : ''}`),
      preferences: preferences.map(p => `- ${p.title}${p.description ? ': ' + p.description : ''}`),
      pinned_notes: pinnedNotes,
      active_tasks: activeTasks,
      recent_topics: topics.map(t => t.tag),
      recent_history: recentPrompts.slice(0, 5).map(p => ({
        role: p.role,
        content: p.content.substring(0, 200),
        category: p.category
      }))
    };
  }

  async analyzePrompt(projectId, content) {
    // Check for frustration
    const frustration = detectFrustration(content);

    // Find relevant patterns
    let relevantPatterns = [];
    try {
      relevantPatterns = await patternService.searchPatterns(content.substring(0, 100));
    } catch (e) { /* search may fail on short content */ }

    // Check if this is a repeated request
    const similarPrompts = await searchService.searchPrompts(
      content.substring(0, 50),
      projectId,
      5
    );
    const isRepeated = similarPrompts.length > 1;

    const warnings = [];
    if (frustration > 0.5) {
      warnings.push('User seems frustrated. Review recent actions for possible mistakes.');
    }
    if (isRepeated) {
      warnings.push(`Similar request found ${similarPrompts.length} times before. Check if previous attempts had issues.`);
    }

    // Check for active tasks (in_progress)
    let activeTasks = [];
    try {
      const tasks = await planService.getTasks(projectId);
      activeTasks = tasks.filter(t => t.status === 'in_progress');
    } catch (e) { /* roadmap may not exist */ }

    return {
      frustration_score: frustration,
      relevant_patterns: relevantPatterns.slice(0, 5),
      is_repeated: isRepeated,
      similar_count: similarPrompts.length,
      warnings,
      active_tasks: activeTasks
    };
  }

  async checkRules(projectId, actionDescription) {
    const patterns = await patternService.getPatterns(projectId, 'rule');
    const violations = [];

    const lower = actionDescription.toLowerCase();

    for (const rule of patterns) {
      const ruleWords = rule.title.toLowerCase().split(/\s+/);
      const matchCount = ruleWords.filter(w => lower.includes(w)).length;
      const matchRatio = matchCount / ruleWords.length;

      if (matchRatio > 0.4) {
        violations.push({
          rule_id: rule.id,
          rule_title: rule.title,
          rule_description: rule.description,
          confidence: rule.confidence,
          match_score: matchRatio
        });
      }
    }

    return {
      has_potential_violations: violations.length > 0,
      violations,
      total_rules_checked: patterns.length
    };
  }

  formatContextForClaude(context) {
    const lines = [];

    if (context.stats.session_count > 0) {
      lines.push(`[ClaudeManager] Project: ${context.project.name} | Sessions: ${context.stats.session_count} | Prompts: ${context.stats.prompt_count}`);
    }

    if (context.rules.length > 0) {
      lines.push('');
      lines.push('## Learned Rules:');
      lines.push(...context.rules);
    }

    if (context.mistakes.length > 0) {
      lines.push('');
      lines.push('## Past Mistakes (AVOID):');
      lines.push(...context.mistakes);
    }

    if (context.preferences.length > 0) {
      lines.push('');
      lines.push('## User Preferences:');
      lines.push(...context.preferences);
    }

    if (context.pinned_notes && context.pinned_notes.length > 0) {
      lines.push('');
      lines.push('## Project Notes:');
      for (const note of context.pinned_notes) {
        lines.push(`- **${note.title}**${note.content ? ': ' + note.content : ''}`);
      }
    }

    if (context.active_tasks && context.active_tasks.length > 0) {
      lines.push('');
      lines.push('## Active Tasks (in_progress):');
      for (const t of context.active_tasks) {
        lines.push(`- [${t.task_no}] ${t.title}`);
        if (t.detail) lines.push(`  Detail: ${t.detail.substring(0, 300)}`);
      }
    }

    if (context.recent_topics.length > 0) {
      lines.push('');
      lines.push(`Recent topics: ${context.recent_topics.join(', ')}`);
    }

    return lines.join('\n');
  }
}

module.exports = new ContextService();
