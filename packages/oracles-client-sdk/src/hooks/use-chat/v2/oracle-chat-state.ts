import { type ChatStatus, type IChatState, type IMessage } from './types.js';

export class OracleChatState implements IChatState {
  #messages: IMessage[];
  #status: ChatStatus = 'ready';
  #error: Error | undefined = undefined;
  #callbacks = new Set<() => void>();
  #rafId: number | null = null;

  constructor(initialMessages: IMessage[] = []) {
    this.#messages = initialMessages;
  }

  get status(): ChatStatus {
    return this.#status;
  }

  set status(newStatus: ChatStatus) {
    this.#status = newStatus;
    this.#callCallbacks();
  }

  get error(): Error | undefined {
    return this.#error;
  }

  set error(newError: Error | undefined) {
    this.#error = newError;
    this.#callCallbacks();
  }

  get messages(): IMessage[] {
    return this.#messages;
  }

  set messages(newMessages: IMessage[]) {
    this.#messages = [...newMessages];

    // Keep only last 100 messages to prevent memory leaks
    if (this.#messages.length > 100) {
      this.#messages = this.#messages.slice(-100);
    }

    this.#callCallbacks();
  }

  pushMessage = (message: IMessage): void => {
    this.#messages = [...this.#messages, message];

    // Keep only last 100 messages to prevent memory leaks
    if (this.#messages.length > 100) {
      this.#messages = this.#messages.slice(-100);
    }

    this.#callCallbacks();
  };

  replaceMessage = (index: number, message: IMessage): void => {
    this.#messages = [
      ...this.#messages.slice(0, index),
      this.snapshot(message),
      ...this.#messages.slice(index + 1),
    ];
    this.#callCallbacks();
  };

  // Optimized for streaming - updates last message (90% of cases)
  updateLastMessage = (updater: (msg: IMessage) => IMessage): void => {
    if (this.#messages.length === 0) {
      return;
    }

    const lastIndex = this.#messages.length - 1;
    const message = this.#messages[lastIndex];
    if (!message) return;
    const updatedMessage = updater(message);

    this.#messages = [
      ...this.#messages.slice(0, lastIndex),
      this.snapshot(updatedMessage),
    ];
    this.#callCallbacks();
  };

  // For WebSocket tool calls - finds by ID when needed (10% of cases)
  updateMessageById = (
    id: string,
    updater: (msg: IMessage) => IMessage,
  ): void => {
    const index = this.#messages.findIndex((m) => m.id === id);
    if (index === -1) return;

    const message = this.#messages[index];
    if (!message) return;

    const updatedMessage = updater(message);
    this.replaceMessage(index, updatedMessage);
  };

  snapshot = <T extends IMessage>(value: T): T => {
    // Simple shallow copy - creates new references for React re-renders
    // No deep cloning needed since content is plain serializable data
    return { ...value };
  };

  subscribe = (callback: () => void): (() => void) => {
    this.#callbacks.add(callback);
    return () => {
      this.#callbacks.delete(callback);
    };
  };

  #callCallbacks = (): void => {
    // Batch multiple rapid updates into single render frame
    // This is crucial for streaming performance
    if (this.#rafId !== null) {
      return; // Already scheduled
    }

    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;
      this.#callbacks.forEach((callback) => {
        callback();
      });
    });
  };

  // Cleanup method to prevent memory leaks
  cleanup = (): void => {
    // Cancel any pending RAF
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    this.#callbacks.clear(); // Critical: Clear all callbacks to prevent leaks
    this.#messages = [];
    this.#error = undefined;
    this.#status = 'ready';
  };
}
