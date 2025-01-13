import EventEmitter2 from 'eventemitter2';

export class RootEventEmitter {
  private static instance: RootEventEmitter | null = null;
  private readonly emitter: EventEmitter2;

  private constructor() {
    this.emitter = new EventEmitter2();
  }

  public static getInstance(): RootEventEmitter {
    if (typeof window !== 'undefined') {
      throw new Error('RootEventEmitter should not be used in the browser.');
    }

    if (!RootEventEmitter.instance) {
      RootEventEmitter.instance = new RootEventEmitter();
    }
    return RootEventEmitter.instance;
  }

  public emit(event: string, data: unknown): void {
    this.emitter.emit(event, data);
  }

  public on(event: string, listener: (...args: unknown[]) => void): void {
    this.emitter.on(event, listener);
  }

  public removeListener(
    event: string,
    listener: (...args: unknown[]) => void,
  ): void {
    this.emitter.removeListener(event, listener);
  }
}

export const rootEventEmitter = RootEventEmitter.getInstance();
