export class JobExecutor {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;

  async run<T>(job: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await job();
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      void this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        try {
          await job();
        } catch (error) {
          // eslint-disable-next-line no-console -- this is a serial queue
          console.error('Job execution failed:', error);
        }
      }
    }

    this.isProcessing = false;
  }
}
