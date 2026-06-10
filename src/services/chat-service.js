const { getDb, save } = require('../db/init');

class ChatService {
  // Create a new AI chat
  async createChat(projectId, topic, roleA, roleB, systemA, systemB, maxTurns) {
    const db = await getDb();
    await db.run(
      `INSERT INTO ai_chats (project_id, topic, role_a, role_b, system_a, system_b, max_turns)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [projectId || null, topic, roleA || 'AI-A', roleB || 'AI-B', systemA || null, systemB || null, maxTurns || 0]
    );
    const result = await db.exec('SELECT last_insert_rowid()');
    const id = result[0].values[0][0];
    save();
    return id;
  }

  // Get chat by ID
  async getChatById(chatId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, project_id, topic, role_a, role_b, system_a, system_b, summary, status, max_turns, turn_count, created_at, updated_at, archive_vote_a, archive_vote_b
       FROM ai_chats WHERE id = ?`, [chatId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], project_id: row[1], topic: row[2], role_a: row[3], role_b: row[4],
      system_a: row[5], system_b: row[6], summary: row[7], status: row[8],
      max_turns: row[9], turn_count: row[10], created_at: row[11], updated_at: row[12],
      archive_vote_a: !!row[13], archive_vote_b: !!row[14]
    };
  }

  // List chats, optionally filtered by project and/or status
  async getChats(projectId = null, status = null) {
    const db = await getDb();
    let sql = `SELECT id, project_id, topic, role_a, role_b, status, max_turns, turn_count, created_at, updated_at
               FROM ai_chats`;
    const params = [];
    const conditions = [];
    if (projectId) {
      conditions.push('project_id = ?');
      params.push(projectId);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY updated_at DESC';
    const result = await db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], project_id: row[1], topic: row[2], role_a: row[3], role_b: row[4],
      status: row[5], max_turns: row[6], turn_count: row[7],
      created_at: row[8], updated_at: row[9]
    }));
  }

  // Get messages for a chat
  async getMessages(chatId, limit = 100, offset = 0) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, chat_id, role, content, turn_number, reply_to, read_by_a, read_by_b, created_at
       FROM ai_messages WHERE chat_id = ?
       ORDER BY turn_number ASC LIMIT ? OFFSET ?`,
      [chatId, limit, offset]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], chat_id: row[1], role: row[2], content: row[3],
      turn_number: row[4], reply_to: row[5], read_by_a: !!row[6], read_by_b: !!row[7], created_at: row[8]
    }));
  }

  // Get the latest message in a chat
  async getLatestMessage(chatId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, chat_id, role, content, turn_number, reply_to, read_by_a, read_by_b, created_at
       FROM ai_messages WHERE chat_id = ?
       ORDER BY turn_number DESC LIMIT 1`,
      [chatId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], chat_id: row[1], role: row[2], content: row[3],
      turn_number: row[4], reply_to: row[5], read_by_a: !!row[6], read_by_b: !!row[7], created_at: row[8]
    };
  }

  // Get unread messages for a role (messages from the OTHER role that this role hasn't read)
  async getUnreadMessages(chatId, role) {
    const db = await getDb();
    const readCol = role === 'a' ? 'read_by_a' : 'read_by_b';
    const otherRole = role === 'a' ? 'b' : 'a';
    const result = await db.exec(
      `SELECT id, chat_id, role, content, turn_number, reply_to, read_by_a, read_by_b, created_at
       FROM ai_messages WHERE chat_id = ? AND role = ? AND ${readCol} = 0
       ORDER BY turn_number ASC`,
      [chatId, otherRole]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], chat_id: row[1], role: row[2], content: row[3],
      turn_number: row[4], reply_to: row[5], read_by_a: !!row[6], read_by_b: !!row[7], created_at: row[8]
    }));
  }

  // Mark all messages from other role as read
  async markAsRead(chatId, role) {
    const db = await getDb();
    const readCol = role === 'a' ? 'read_by_a' : 'read_by_b';
    const otherRole = role === 'a' ? 'b' : 'a';
    await db.run(
      `UPDATE ai_messages SET ${readCol} = 1 WHERE chat_id = ? AND role = ? AND ${readCol} = 0`,
      [chatId, otherRole]
    );
    save();
  }

  // Post a message from a role, optionally update summary
  // No strict turn order — either role can post anytime
  // When max_turns reached: triggers archive_needed signal (not a hard stop)
  async postMessage(chatId, role, content, summary = null, replyTo = null) {
    const db = await getDb();
    const chat = await this.getChatById(chatId);
    if (!chat) throw new Error('Chat not found');
    if (chat.status !== 'active') throw new Error(`Chat is ${chat.status}`);

    // Determine turn number (still incremental for ordering)
    const latest = await this.getLatestMessage(chatId);
    const turnNumber = latest ? latest.turn_number + 1 : 1;

    // The sender has read their own message, mark accordingly
    const readByA = role === 'a' ? 1 : 0;
    const readByB = role === 'b' ? 1 : 0;

    await db.run(
      `INSERT INTO ai_messages (chat_id, role, content, turn_number, reply_to, read_by_a, read_by_b) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [chatId, role, content, turnNumber, replyTo, readByA, readByB]
    );

    // Update turn count and optionally summary
    if (summary) {
      await db.run(
        `UPDATE ai_chats SET turn_count = ?, summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [turnNumber, summary, chatId]
      );
    } else {
      await db.run(
        `UPDATE ai_chats SET turn_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [turnNumber, chatId]
      );
    }
    save();

    // Check if max_turns reached — signal archive needed (but don't block)
    const archiveNeeded = chat.max_turns > 0 && turnNumber >= chat.max_turns;

    return {
      turn_number: turnNumber,
      role,
      chat_status: chat.status,
      archive_needed: archiveNeeded
    };
  }

  // Propose archive — both roles must agree
  // When a role proposes, it's stored. When both have proposed, chat is archived.
  async proposeArchive(chatId, role, archiveSummary) {
    const db = await getDb();
    const chat = await this.getChatById(chatId);
    if (!chat) throw new Error('Chat not found');

    const archiveCol = role === 'a' ? 'archive_vote_a' : 'archive_vote_b';
    const otherCol = role === 'a' ? 'archive_vote_b' : 'archive_vote_a';

    // Set this role's archive vote
    await db.run(
      `UPDATE ai_chats SET ${archiveCol} = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [chatId]
    );

    // Check if other role already voted
    const updated = await this.getChatById(chatId);
    const otherVoted = role === 'a' ? updated.archive_vote_b : updated.archive_vote_a;

    if (otherVoted) {
      // Both agreed — archive the chat
      await db.run(
        `UPDATE ai_chats SET status = 'archived', summary = ?, archive_vote_a = 0, archive_vote_b = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [archiveSummary || chat.summary, chatId]
      );
      save();
      return { archived: true, message: 'Both roles agreed. Chat archived.' };
    }

    save();
    return { archived: false, message: `Archive proposed by role ${role}. Waiting for other role to agree.` };
  }

  // Continue an archived chat (creates new active state, keeps messages)
  async continueChat(chatId) {
    const db = await getDb();
    const chat = await this.getChatById(chatId);
    if (!chat) throw new Error('Chat not found');
    if (chat.status !== 'archived') throw new Error('Chat is not archived');

    await db.run(
      `UPDATE ai_chats SET status = 'active', archive_vote_a = 0, archive_vote_b = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [chatId]
    );
    save();
    return { status: 'active' };
  }

  // Update summary separately
  async updateSummary(chatId, summary) {
    const db = await getDb();
    await db.run(
      `UPDATE ai_chats SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [summary, chatId]
    );
    save();
  }

  // Check for unread messages and return context for this role
  async getNextTurn(chatId, role) {
    const chat = await this.getChatById(chatId);
    if (!chat) return { error: 'Chat not found' };
    if (chat.status !== 'active') return { status: chat.status, waiting: false, done: true };

    const unread = await this.getUnreadMessages(chatId, role);
    const latest = await this.getLatestMessage(chatId);
    const nextTurn = latest ? latest.turn_number + 1 : 1;

    const hasUnread = unread.length > 0;

    // Check if other role proposed archive
    const archivePending = role === 'a' ? chat.archive_vote_b : chat.archive_vote_a;

    if (!hasUnread) {
      return {
        waiting: true,
        your_turn: false,
        next_turn: nextTurn,
        unread_count: 0,
        archive_pending: !!archivePending
      };
    }

    // There are unread messages — this role should respond
    const lastUnread = unread[unread.length - 1];
    const allUnreadContent = unread.map(m => m.content).join('\n---\n');

    return {
      waiting: false,
      your_turn: true,
      next_turn: nextTurn,
      unread_count: unread.length,
      respond_to: allUnreadContent,
      respond_to_role: lastUnread.role === 'a' ? chat.role_a : chat.role_b,
      summary: chat.summary,
      chat_topic: chat.topic,
      your_role_name: role === 'a' ? chat.role_a : chat.role_b,
      other_role_name: role === 'a' ? chat.role_b : chat.role_a,
      system_prompt: role === 'a' ? chat.system_a : chat.system_b,
      turn_count: chat.turn_count,
      archive_pending: !!archivePending,
      archive_needed: chat.max_turns > 0 && chat.turn_count >= chat.max_turns
    };
  }

  // Long-poll: wait until there are unread messages for this role
  async waitForTurn(chatId, role, timeoutMs = 30000, intervalMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await this.getNextTurn(chatId, role);
      if (result.your_turn || result.done || result.error) return result;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return { waiting: true, your_turn: false, timeout: true };
  }

  // Get live feed — all recent messages across all active chats, newest first
  async getLiveFeed(limit = 50) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT m.id, m.chat_id, m.role, m.content, m.turn_number, m.reply_to, m.created_at,
              c.topic, c.role_a, c.role_b, c.project_id,
              p.name as project_name
       FROM ai_messages m
       JOIN ai_chats c ON m.chat_id = c.id
       LEFT JOIN projects p ON c.project_id = p.id
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [limit]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], chat_id: row[1], role: row[2], content: row[3],
      turn_number: row[4], reply_to: row[5], created_at: row[6],
      chat_topic: row[7], role_a: row[8], role_b: row[9],
      project_id: row[10], project_name: row[11],
      role_name: row[2] === 'a' ? row[8] : row[9]
    }));
  }

  // Update chat status
  async updateStatus(chatId, status) {
    const db = await getDb();
    await db.run(
      `UPDATE ai_chats SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, chatId]
    );
    save();
  }

  // Delete chat and its messages
  async deleteChat(chatId) {
    const db = await getDb();
    await db.run('DELETE FROM ai_messages WHERE chat_id = ?', [chatId]);
    await db.run('DELETE FROM ai_chats WHERE id = ?', [chatId]);
    save();
  }
}

module.exports = new ChatService();
