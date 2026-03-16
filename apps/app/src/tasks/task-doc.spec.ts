import * as Y from 'yjs';

import {
  appendOutputRow,
  buildTaskMeta,
  readTaskMeta,
  updateTaskMeta,
  writeTaskMetaToDoc,
  YDOC_TASK_META_KEY,
} from './task-doc';
import type { CreateTaskMetaParams } from './task-doc';
import type { TaskMeta } from './task-meta';

// ── Helpers ──────────────────────────────────────────────────────────

const baseParams: CreateTaskMetaParams = {
  taskId: 'task_test123456',
  userId: '@yousef:ixo.world',
  taskType: 'research',
  hasPage: true,
  timezone: 'Africa/Cairo',
  channelType: 'custom',
  customRoomId: '!room:ixo.world',
  scheduleCron: '0 9 * * 1',
};

function buildMeta(overrides?: Partial<CreateTaskMetaParams>): TaskMeta {
  return buildTaskMeta({ ...baseParams, ...overrides });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('buildTaskMeta', () => {
  it('maps research task type to flow/high/medium defaults', () => {
    const meta = buildMeta();
    expect(meta.jobPattern).toBe('flow');
    expect(meta.modelTier).toBe('high');
    expect(meta.complexityTier).toBe('medium');
    expect(meta.bufferMinutes).toBe(30);
    expect(meta.notificationPolicy).toBe('channel_only');
  });

  it('maps reminder task type to simple/low/trivial defaults', () => {
    const meta = buildMeta({ taskType: 'reminder', channelType: 'main' });
    expect(meta.jobPattern).toBe('simple');
    expect(meta.modelTier).toBe('low');
    expect(meta.complexityTier).toBe('trivial');
    expect(meta.bufferMinutes).toBe(2);
    expect(meta.notificationPolicy).toBe('channel_and_mention');
  });

  it('complexity override drives buffer minutes', () => {
    const meta = buildMeta({ complexityTier: 'heavy' });
    expect(meta.complexityTier).toBe('heavy');
    expect(meta.bufferMinutes).toBe(60);
  });
});

describe('Y.Doc round-trip', () => {
  it('writeTaskMetaToDoc + readTaskMeta preserves all fields', () => {
    const doc = new Y.Doc();
    const meta = buildMeta();

    writeTaskMetaToDoc(doc, meta);
    const read = readTaskMeta(doc);

    // Spot-check across different field groups
    expect(read.taskId).toBe(meta.taskId);
    expect(read.timezone).toBe(meta.timezone);
    expect(read.jobPattern).toBe(meta.jobPattern);
    expect(read.recentOutput).toEqual([]);
    expect(read.status).toBe('active');
  });

  it('does not overwrite existing editor keys in the Y.Doc', () => {
    const doc = new Y.Doc();
    doc.getMap('root').set('editorData', 'hello');

    writeTaskMetaToDoc(doc, buildMeta());

    expect(doc.getMap('root').get('editorData')).toBe('hello');
    expect(doc.getMap(YDOC_TASK_META_KEY).get('taskId')).toBe(
      'task_test123456',
    );
  });

  it('updateTaskMeta partially updates without clobbering', () => {
    const doc = new Y.Doc();
    writeTaskMetaToDoc(doc, buildMeta());

    updateTaskMeta(doc, { status: 'paused', totalRuns: 5 });

    const read = readTaskMeta(doc);
    expect(read.status).toBe('paused');
    expect(read.totalRuns).toBe(5);
    expect(read.taskId).toBe('task_test123456');
  });

  it('writeTaskMetaToDoc + readTaskMeta works for tasks without pages', () => {
    const doc = new Y.Doc();
    const meta = buildMeta({ hasPage: false, taskType: 'reminder' });
    writeTaskMetaToDoc(doc, meta);
    const read = readTaskMeta(doc);
    expect(read.taskType).toBe('reminder');
    expect(read.hasPage).toBe(false);
  });
});

describe('appendOutputRow', () => {
  it('prepends newest row and trims to 5', () => {
    const doc = new Y.Doc();
    writeTaskMetaToDoc(doc, buildMeta());

    for (let i = 0; i < 7; i++) {
      appendOutputRow(doc, {
        when: `run-${i}`,
        summary: `s-${i}`,
        link: `#${i}`,
      });
    }

    const rows = readTaskMeta(doc).recentOutput;
    expect(rows).toHaveLength(5);
    expect(rows[0].when).toBe('run-6'); // newest first
    expect(rows[4].when).toBe('run-2'); // oldest kept
  });
});
