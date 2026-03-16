import {
  buildTaskPageParams,
  formatOutputTable,
  generateTaskPage,
} from './task-page-template';
import type { TaskPageParams } from './task-page-template';
import type { TaskMeta } from './task-meta';
import { buildTaskMeta } from './task-doc';

// ── Helpers ──────────────────────────────────────────────────────────

const sampleParams: TaskPageParams = {
  title: 'Oil Price Monitor',
  scheduleDescription: 'Every 30 minutes during London market hours',
  channelName: '[Task] Oil Price Monitor',
  status: '\u2705 Active',
  whatToDo: 'Monitor Brent crude oil prices.',
  howToReport: 'Short summary with current price.',
};

function buildSampleMeta(
  recentOutput: TaskMeta['recentOutput'] = [],
): TaskMeta {
  const meta = buildTaskMeta({
    taskId: 'task_test123456',
    userId: '@yousef:ixo.world',
    taskType: 'monitor',
    hasPage: true,
    timezone: 'Africa/Cairo',
    channelType: 'custom',
    scheduleCron: '*/30 * * * *',
  });
  meta.recentOutput = recentOutput;
  return meta;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('generateTaskPage', () => {
  it('includes Constraints section only when provided', () => {
    const without = generateTaskPage(sampleParams);
    expect(without).not.toContain('## Constraints');

    const withConstraints = generateTaskPage({
      ...sampleParams,
      constraints: 'Use Reuters only.',
    });
    expect(withConstraints).toContain('## Constraints');
    expect(withConstraints).toContain('Use Reuters only.');
  });
});

describe('buildTaskPageParams', () => {
  it('prefixes custom channel with [Task], uses "Main chat" for main', () => {
    const custom = buildTaskPageParams({
      title: 'AI Digest',
      taskType: 'report',
      channelType: 'custom',
      scheduleDescription: 'Daily',
      whatToDo: 'Summarize.',
      howToReport: 'Bullets.',
    });
    expect(custom.channelName).toBe('[Task] AI Digest');

    const main = buildTaskPageParams({
      title: 'Quick Check',
      taskType: 'quick_lookup',
      channelType: 'main',
      scheduleDescription: 'Once',
      whatToDo: 'Check.',
      howToReport: 'One line.',
    });
    expect(main.channelName).toBe('Main chat');
  });
});

describe('formatOutputTable', () => {
  it('renders rows from taskMeta.recentOutput', () => {
    const meta = buildSampleMeta([
      { when: 'Mar 16, 2:30 PM', summary: 'Brent $86', link: '#evt1' },
      { when: 'Mar 16, 2:00 PM', summary: 'Brent $82', link: '#evt2' },
    ]);

    const table = formatOutputTable(meta);
    expect(table).toContain(
      '| Mar 16, 2:30 PM | Brent $86 | [View](#evt1) |',
    );
    expect(table).toContain(
      '| Mar 16, 2:00 PM | Brent $82 | [View](#evt2) |',
    );
  });

  it('respects maxRows limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      when: `row-${i}`,
      summary: `s-${i}`,
      link: `#${i}`,
    }));

    const table = formatOutputTable(buildSampleMeta(rows), 2);
    const dataLines = table.split('\n').slice(2); // skip header + separator
    expect(dataLines).toHaveLength(2);
  });
});
