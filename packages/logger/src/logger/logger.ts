import { createLogger, format, transports } from 'winston';
import { flattenArray, getEmoji } from './utils';

export interface ILoggerOptions {
  context?: string;
}

export class Logger {
  private static instance: Logger | undefined;
  private logger;
  private context?: string;

  private constructor(options?: ILoggerOptions) {
    this.context = options?.context;

    // Determine log level from environment or default to 'info'
    const logLevel = process.env.LOG_LEVEL || 'info';

    // Create Winston logger
    this.logger = createLogger({
      level: logLevel,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ timestamp, level, message, context, ...rest }) => {
          const meta = (rest[Symbol.for('splat')] ?? []) as unknown[];
          const emoji = getEmoji(level);
          const metaString =
            meta.length > 0
              ? `MetaData: ${JSON.stringify(flattenArray(meta))}`
              : '';

          // Include context if available
          const contextStr =
            context || this.context
              ? `[${String(context || this.context)}]`
              : '';

          return `${String(timestamp)} ${emoji} [${String(level).toUpperCase()}]${contextStr}: ${String(message)}${metaString ? ` | ${metaString}` : ''}`;
        }),
      ),
      transports: [
        // Console transport with colors
        new transports.Console({
          format: format.combine(format.colorize({ all: true })),
        }),
      ],
    });

    // Add file transport in production environment
    if (process.env.NODE_ENV === 'production') {
      this.logger.add(
        new transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
      );
      this.logger.add(
        new transports.File({
          filename: 'logs/combined.log',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
      );
    }
  }

  public formatError(error: Error): string {
    const errMsg = `${error.name}: ${error.message}`;
    return error.stack ? `${errMsg}\n${error.stack}` : errMsg;
  }

  public static getInstance(options?: ILoggerOptions): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(options);
    }
    return Logger.instance;
  }

  public setContext(context: string): this {
    this.context = context;
    return this;
  }

  public info(message: string, ...meta: unknown[]): void {
    this.logger.info(message, { context: this.context, ...meta });
  }

  public warn(message: string, ...meta: unknown[]): void {
    this.logger.warn(message, { context: this.context, ...meta });
  }

  public error(message: string, ...meta: unknown[]): void {
    this.logger.error(message, {
      context: this.context,
      ...meta.map((m) => (m instanceof Error ? this.formatError(m) : m)),
    });
  }

  public debug(message: string, ...meta: unknown[]): void {
    this.logger.debug(message, { context: this.context, ...meta });
  }

  public verbose(message: string, ...meta: unknown[]): void {
    this.logger.verbose(message, { context: this.context, ...meta });
  }

  static info(message: string, ...meta: unknown[]): void {
    Logger.getInstance().info(message, ...meta);
  }

  static warn(message: string, ...meta: unknown[]): void {
    Logger.getInstance().warn(message, ...meta);
  }

  static error(message: string, ...meta: unknown[]): void {
    Logger.getInstance().error(message, ...meta);
  }

  static debug(message: string, ...meta: unknown[]): void {
    Logger.getInstance().debug(message, ...meta);
  }

  static verbose(message: string, ...meta: unknown[]): void {
    Logger.getInstance().verbose(message, ...meta);
  }

  static setContext(context: string): Logger {
    return Logger.getInstance().setContext(context);
  }
}

export default Logger.getInstance();
