import { StreamTagProcessor } from './thinking-filter-factory';

describe('StreamTagProcessor', () => {
  let processor: StreamTagProcessor;
  let emitted: string[];
  const emitFn = (text: string) => {
    if (text) {
      // Only push non-empty strings
      emitted.push(text);
    }
  };

  beforeEach(() => {
    processor = new StreamTagProcessor();
    emitted = [];
  });

  it('should process a simple chunk with one answer', () => {
    processor.processChunk(
      '<thinking>blah</thinking><answer>Hello</answer>',
      emitFn,
    );
    processor.flush(emitFn);
    expect(emitted).toEqual(['Hello']);
  });

  it('should handle answer split across chunks', () => {
    processor.processChunk('<answer>Part1', emitFn);
    processor.processChunk(' Part2</answer>', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['Part1', ' Part2']);
  });

  it('should handle tags split across chunks', () => {
    processor.processChunk('<ans', emitFn);
    processor.processChunk('wer>Content</answ', emitFn);
    processor.processChunk('er>', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['Content']);
  });

  it('should handle multiple answers in one chunk', () => {
    processor.processChunk(
      '<answer>One</answer><thinking>...</thinking><answer>Two</answer>',
      emitFn,
    );
    processor.flush(emitFn);
    expect(emitted).toEqual(['One', 'Two']);
  });

  it('should handle multiple answers across chunks', () => {
    processor.processChunk('<answer>One</answer><thi', emitFn);
    processor.processChunk('nking>...</thinking><answer>Two', emitFn);
    processor.processChunk('</answer>', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['One', 'Two']);
  });

  it('should ignore content outside answer tags', () => {
    processor.processChunk(
      'Ignore this. <answer>Keep this.</answer> Ignore this too.',
      emitFn,
    );
    processor.flush(emitFn);
    expect(emitted).toEqual(['Keep this.']);
  });

  it('should handle stream ending mid-answer (flush)', () => {
    processor.processChunk('Text <answer>Partial', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['Partial']);
  });

  it('should handle empty answer', () => {
    processor.processChunk('<answer></answer>', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual([]); // Expecting no non-empty strings
  });

  it('should handle content before first answer and after last answer', () => {
    processor.processChunk('Before <answer>Middle</answer> After', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['Middle']);
  });

  it('should handle only thinking tags (no answer)', () => {
    processor.processChunk(
      '<thinking>Blah</thinking><thinking>Another</thinking>',
      emitFn,
    );
    processor.flush(emitFn);
    expect(emitted).toEqual([]);
  });

  it('should handle chunk ending exactly at closing tag', () => {
    processor.processChunk('<answer>End', emitFn);
    processor.processChunk('</answer>', emitFn);
    processor.processChunk('Next bit', emitFn); // Ensures buffer is cleared correctly
    processor.flush(emitFn);
    expect(emitted).toEqual(['End']);
  });

  it('should handle chunk ending exactly at opening tag', () => {
    processor.processChunk('<answer>', emitFn);
    processor.processChunk('Content</answer>', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['Content']);
  });

  it('should handle user example with thinking tags', () => {
    const chunk1 =
      "\t<thinking>\n[CLARIFICATION] The user is asking for the signup process for the e-commerce store.\n\n[SCRATCHPAD]  \nStep 1: Identify the typical signup process for e-commerce platforms.  \nStep 2: Check the knowledge base for specific instructions on signing up.  \nStep 3: Prepare to summarize the signup steps for the user.  \n\n[REFLECTION] I need to ensure I provide clear and accurate signup instructions.\n</thinking>\n\t<answer>\nI will check the knowledge base for specific instructions on how to sign up for the e-commerce store. Please hold on for a moment.\n</answer>\n</response><response>\n\t<thinking>\n[CLARIFICATION] The user is asking for information on how to sign up for the e-commerce store.\n\n[SCRATCHPAD]  \nStep 1: The user needs to create an account to sign up.  \nStep 2: Typically, this involves providing personal information such as name, email, and password.  \nStep 3: After filling out the required information, the user would usually need to confirm their email address.\n\n[REFLECTION] I need to inform the user that I couldn't find specific details on the signup process.\n</thinking>\n\t<answer>\nI'm sorry, but I couldn't find specific information on the signup process for our e-commerce store. Would you like me to create a support ticket to get more detailed assistance on this? \n</answer>";
    processor.processChunk(chunk1, emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual([
      '\nI will check the knowledge base for specific instructions on how to sign up for the e-commerce store. Please hold on for a moment.\n',
      "\nI'm sorry, but I couldn't find specific information on the signup process for our e-commerce store. Would you like me to create a support ticket to get more detailed assistance on this? \n",
    ]);
  });

  // Test case for the potential "leftover closing tag" issue
  it('should not leave closing tag if stream ends right after it', () => {
    processor.processChunk('<answer>Content</answer>', emitFn);
    processor.flush(emitFn);
    expect(emitted).toEqual(['Content']);
    // Check internal state if possible/necessary, though output is primary
    // processor.buffer should be empty after flush
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((processor as any).buffer).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((processor as any).inAnswer).toBe(false);
  });

  it('should handle leading text before any tags', () => {
    processor.processChunk(
      'Some leading text <thinking>blah</thinking><answer>Hello</answer> Trailing text',
      emitFn,
    );
    processor.flush(emitFn);
    expect(emitted).toEqual(['Hello']);
  });
});
