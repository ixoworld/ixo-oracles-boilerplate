import {
  buildTaskPageParams,
  formatOutputSection,
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
    userDid: 'did:ixo:ixo1abc',
    matrixUserId: '@did-ixo-ixo1abc:ixo.world',
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

  it('shows "No output yet." placeholder in Recent Output', () => {
    const page = generateTaskPage(sampleParams);
    expect(page).toContain('*No output yet.*');
    expect(page).not.toContain('| When |');
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

describe('formatOutputSection', () => {
  it('returns placeholder when no output rows', () => {
    const result = formatOutputSection(buildSampleMeta([]));
    expect(result).toBe('*No output yet.*');
  });

  it('renders entries as bold timestamp + summary + link', () => {
    const meta = buildSampleMeta([
      { when: 'Mar 16, 2:30 PM', summary: 'Brent $86', link: '#evt1' },
      { when: 'Mar 16, 2:00 PM', summary: 'Brent $82', link: '#evt2' },
    ]);

    const output = formatOutputSection(meta);
    expect(output).toContain(
      '**Mar 16, 2:30 PM** — Brent $86 — [View](#evt1)',
    );
    expect(output).toContain(
      '**Mar 16, 2:00 PM** — Brent $82 — [View](#evt2)',
    );
  });

  it('omits link portion when link is empty', () => {
    const meta = buildSampleMeta([
      { when: 'Mar 16, 2:30 PM', summary: 'Brent $86', link: '' },
    ]);

    const output = formatOutputSection(meta);
    expect(output).toBe('**Mar 16, 2:30 PM** — Brent $86');
    expect(output).not.toContain('[View]');
  });

  it('respects maxRows limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      when: `row-${i}`,
      summary: `s-${i}`,
      link: `#${i}`,
    }));

    const output = formatOutputSection(buildSampleMeta(rows), 2);
    const entries = output.split('\n\n');
    expect(entries).toHaveLength(2);
  });

  it('handles summaries with pipes and markdown safely', () => {
    const meta = buildSampleMeta([
      {
        when: 'Mar 17, 2:45 PM',
        summary: 'S&P 500 – 4,835.04 (-2.13%) – Iran headlines',
        link: '#evt3',
      },
    ]);

    const output = formatOutputSection(meta);
    // Should render as a single clean line, no table breakage
    expect(output).not.toContain('|');
    expect(output).toContain('S&P 500');
  });
});
