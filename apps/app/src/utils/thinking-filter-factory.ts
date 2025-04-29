type EmitFn = (text: string) => void;

export class StreamTagProcessor {
  private buffer = '';
  private inAnswer = false;

  /**
   * Feed every incoming token chunk into this.
   * @param chunk   A piece of text from the LLM stream.
   * @param emit    Called with each piece of text inside <answer>…</answer>.
   */
  processChunk(chunk: string, emit: EmitFn) {
    this.buffer += chunk;

    // we loop because a single chunk could open & close multiple tags
    while (true) {
      if (!this.inAnswer) {
        // look for the next opening <answer>
        const openIdx = this.buffer.indexOf('<answer>');
        if (openIdx === -1) {
          // no opening tag yet; drop everything before the last 8 chars
          // (in case "<answer>" is split across chunks)
          if (this.buffer.length > 16) {
            this.buffer = this.buffer.slice(-16);
          }
          break;
        }
        // enter answer state and discard everything up through the tag
        this.inAnswer = true;
        this.buffer = this.buffer.slice(openIdx + '<answer>'.length);
      }

      // now we're inside an answer; look for the closing tag
      const closeIdx = this.buffer.indexOf('</answer>');
      if (closeIdx === -1) {
        // no end yet: emit all we have and clear buffer
        emit(this.buffer);
        this.buffer = '';
        break;
      }

      // closing tag found: emit up to it, then switch back out
      const toEmit = this.buffer.slice(0, closeIdx);
      if (toEmit) {
        emit(toEmit);
      }
      this.inAnswer = false;
      this.buffer = this.buffer.slice(closeIdx + '</answer>'.length);
      // loop to catch any further <answer>…</answer> in the same chunk
    }
  }

  /** Call at the very end of the stream to flush any trailing content. */
  flush(emit: EmitFn) {
    if (this.inAnswer && this.buffer) {
      emit(this.buffer);
    }
    this.buffer = '';
    this.inAnswer = false;
  }
}
