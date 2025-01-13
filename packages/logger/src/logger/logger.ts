import { createLogger, format, transports } from 'winston';
import { flattenArray, getEmoji } from './utils';

export class Logger {
  private static instance: Logger | undefined;
  private logger;

  private constructor() {
    this.logger = createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp(),
        format.printf(({ timestamp, level, message, ...rest }) => {
          const meta = (rest[Symbol.for('splat')] ?? []) as unknown[];
          const emoji = getEmoji(level);
          const metaString =
            meta.length > 0
              ? `MetaData: ${JSON.stringify(flattenArray(meta))}`
              : undefined;

          return `${timestamp} ${emoji} [${level.toUpperCase()}]: ${message} | ${metaString}`;
        }),
      ),
      transports: [
        new transports.Console(), // Log to console
      ],
    });
  }

  public formatError(error: Error): string {
    const errMsg = `${error.name}: ${error.message}`;
    return error.stack ? `${errMsg}\n${error.stack}` : errMsg;
  }
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public info(message: string, ...meta: unknown[]): void {
    this.logger.info(message, meta);
  }

  public warn(message: string, ...meta: unknown[]): void {
    this.logger.warn(message, meta);
  }

  public error(message: string, ...meta: unknown[]): void {
    this.logger.error(
      message,
      meta.map((m) => (m instanceof Error ? this.formatError(m) : m)),
    );
  }

  static info(message: string, ...meta: unknown[]): void {
    Logger.getInstance().info(message, meta);
  }
  static warn(message: string, ...meta: unknown[]): void {
    Logger.getInstance().warn(message, ...meta);
  }

  static error(message: string, ...meta: unknown[]): void {
    Logger.getInstance().error(message, ...meta);
  }
}

export default Logger.getInstance();
