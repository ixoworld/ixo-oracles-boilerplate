// Define separate types for the emitter callbacks for clarity
type EmitAnswerFn = (text: string) => void;
type EmitThinkingFn = (text: string) => void;

export class StreamTagProcessor {
  private buffer = '';
  private inAnswer = false;
  private inThinking = false; // New state flag

  // Constants for tag lengths - 1 (for lookbehind/partial checks)
  private static readonly ANSWER_TAG_LOOKBEHIND = '<answer>'.length - 1; // 7
  private static readonly THINKING_TAG_LOOKBEHIND = '<thinking>'.length - 1; // 9
  private static readonly CLOSE_ANSWER_TAG_LOOKBEHIND = '</answer>'.length - 1; // 8
  private static readonly CLOSE_THINKING_TAG_LOOKBEHIND =
    '</thinking>'.length - 1; // 10

  /**
   * Feed every incoming token chunk into this.
   * @param chunk - A piece of text from the LLM stream.
   * @param emitAnswer - Called with each piece of text inside <answer>…</answer>.
   * @param emitThinking - Called with each piece of text inside <thinking>…</thinking>.
   */
  processChunk(
    chunk: string,
    emitAnswer: EmitAnswerFn,
    emitThinking: EmitThinkingFn = () => void 0,
  ) {
    this.buffer += chunk;

     
    while (true) {
      if (!this.inAnswer && !this.inThinking) {
        // --- State: Outside any known tag ---
        const answerIdx = this.buffer.indexOf('<answer>');
        const thinkingIdx = this.buffer.indexOf('<thinking>');

        let firstTagIdx = -1;
        let isAnswerTag = false;

        if (answerIdx !== -1 && thinkingIdx !== -1) {
          firstTagIdx = Math.min(answerIdx, thinkingIdx);
          isAnswerTag = answerIdx < thinkingIdx;
        } else if (answerIdx !== -1) {
          firstTagIdx = answerIdx;
          isAnswerTag = true;
        } else if (thinkingIdx !== -1) {
          firstTagIdx = thinkingIdx;
          isAnswerTag = false;
        }

        if (firstTagIdx !== -1) {
          // Found an opening tag
          if (isAnswerTag) {
            this.inAnswer = true;
            this.buffer = this.buffer.slice(firstTagIdx + '<answer>'.length);
          } else {
            this.inThinking = true;
            this.buffer = this.buffer.slice(firstTagIdx + '<thinking>'.length);
          }
          continue; // Re-evaluate state in the next loop iteration
        } else {
          // No opening tag found yet; keep potential start chars
          const lookbehind = Math.max(
            StreamTagProcessor.ANSWER_TAG_LOOKBEHIND,
            StreamTagProcessor.THINKING_TAG_LOOKBEHIND,
          );
          if (this.buffer.length > lookbehind) {
            this.buffer = this.buffer.slice(-lookbehind);
          }
          break; // Wait for the next chunk
        }
      } else if (this.inAnswer) {
        // --- State: Inside <answer> ---
        const closeIdx = this.buffer.indexOf('</answer>');
        if (closeIdx !== -1) {
          // Found closing tag
          const toEmit = this.buffer.slice(0, closeIdx);
          if (toEmit) emitAnswer(toEmit);
          this.inAnswer = false;
          this.buffer = this.buffer.slice(closeIdx + '</answer>'.length);
          continue; // Re-evaluate state
        } else {
          // Closing tag not found, check for partial tag
          let partialTagLen = 0;
          for (
            let k = StreamTagProcessor.CLOSE_ANSWER_TAG_LOOKBEHIND;
            k >= 1;
            k--
          ) {
            if (this.buffer.endsWith('</answer>'.slice(0, k))) {
              partialTagLen = k;
              break;
            }
          }

          if (partialTagLen > 0) {
            const contentBeforePartial = this.buffer.slice(
              0,
              this.buffer.length - partialTagLen,
            );
            if (contentBeforePartial) emitAnswer(contentBeforePartial);
            this.buffer = this.buffer.slice(-partialTagLen);
          } else {
            if (this.buffer) emitAnswer(this.buffer);
            this.buffer = '';
          }
          break; // Wait for the next chunk
        }
      } else {
        // Must be inThinking
        // --- State: Inside <thinking> ---
        const closeIdx = this.buffer.indexOf('</thinking>');
        if (closeIdx !== -1) {
          // Found closing tag
          const toEmit = this.buffer.slice(0, closeIdx);
          if (toEmit) emitThinking(toEmit); // Use the thinking emitter
          this.inThinking = false;
          this.buffer = this.buffer.slice(closeIdx + '</thinking>'.length);
          continue; // Re-evaluate state
        } else {
          // Closing tag not found, check for partial tag
          let partialTagLen = 0;
          for (
            let k = StreamTagProcessor.CLOSE_THINKING_TAG_LOOKBEHIND;
            k >= 1;
            k--
          ) {
            if (this.buffer.endsWith('</thinking>'.slice(0, k))) {
              partialTagLen = k;
              break;
            }
          }

          if (partialTagLen > 0) {
            const contentBeforePartial = this.buffer.slice(
              0,
              this.buffer.length - partialTagLen,
            );
            if (contentBeforePartial) emitThinking(contentBeforePartial); // Use the thinking emitter
            this.buffer = this.buffer.slice(-partialTagLen);
          } else {
            if (this.buffer) emitThinking(this.buffer); // Use the thinking emitter
            this.buffer = '';
          }
          break; // Wait for the next chunk
        }
      }
    }
  }

  /** Call at the very end of the stream to flush any trailing content. */
  flush(emitAnswer: EmitAnswerFn, emitThinking: EmitThinkingFn = () => void 0) {
    if (this.inAnswer && this.buffer) {
      emitAnswer(this.buffer);
    } else if (this.inThinking && this.buffer) {
      emitThinking(this.buffer); // Use the thinking emitter
    }
    // Reset state fully on flush
    this.buffer = '';
    this.inAnswer = false;
    this.inThinking = false;
  }
}
