const db = require('../utils/db');
const memory = require('./memoryService');
const interventionService = require('./interventionService');

async function getUserMemoryOverview({ userId, limit = 30 }) {
  const [[user]] = await db.execute(
    'SELECT memory_enabled FROM users WHERE id = ? LIMIT 1',
    [userId]
  );

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  const memories = await memory.listUserMemories({
    userId,
    status: 'active',
    limit,
  });
  const activeLoops = await memory.listUserActiveLoops({
    userId,
    status: 'active',
    limit: Math.min(Number(limit) || 30, 12),
  });
  const interventionOverview = await interventionService.getUserInterventionOverview({
    userId,
    limit: 8,
  });

  return {
    enabled: user.memory_enabled == null ? true : Boolean(Number(user.memory_enabled)),
    memories,
    activeLoops,
    interventionOverview,
  };
}

async function changeUserMemoryStatus({ userId, memoryId, status }) {
  if (!['deleted', 'suppressed', 'active'].includes(status)) {
    const error = new Error('Invalid memory status');
    error.statusCode = 400;
    throw error;
  }

  return memory.updateUserMemoryStatus({
    userId,
    memoryId,
    status,
  });
}

async function changeUserActiveLoopStatus({ userId, loopId, status }) {
  if (!['active', 'resolved', 'dismissed'].includes(status)) {
    const error = new Error('Invalid active loop status');
    error.statusCode = 400;
    throw error;
  }

  const result = await memory.updateUserActiveLoopStatus({
    userId,
    loopId,
    status,
  });

  if (status === 'resolved') {
    interventionService.recordBehaviorEvent({
      userId,
      eventType: 'active_loop_resolved',
      eventPayload: {
        loopId,
      },
    }).catch((error) => {
      console.error('[UserMemory] Intervention active loop outcome error:', error.message);
    });
  }

  return result;
}

module.exports = {
  getUserMemoryOverview,
  changeUserMemoryStatus,
  changeUserActiveLoopStatus,
};
