import util from 'node:util';
import {
  createLogger,
  format,
  transports,
  type Logger as WinstonLogger,
} from 'winston';
import { getEmoji } from './utils.js';

export interface ILoggerOptions {
  context?: string;
}

export class Logger {
  private static instance: Logger | undefined;
  private logger: WinstonLogger;
  private context?: string;

  private constructor(options?: ILoggerOptions) {
    this.context = options?.context;
    const logLevel = process.env.LOG_LEVEL || 'info';

    this.logger = createLogger({
      level: logLevel,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }), // handles error.stack
        format.printf((info) => {
          const { timestamp, level, message, stack, context, ...rest } = info;
          const emoji = getEmoji(level);
          const contextStr =
            context || this.context
              ? `[${String(context || this.context)}]`
              : '';

          // Extract errors and other metadata
          const meta =
            (rest[Symbol.for('splat')] as unknown[] | undefined) ?? [];
          const error = meta.find((m) => m instanceof Error);
          const otherMeta = meta.filter((m) => !(m instanceof Error));

          const errorString: string = error
            ? Logger.formatError(error)
            : stack // fallback for raw stack
              ? String(stack)
              : '';

          const metaString =
            otherMeta.length > 0
              ? `\nMetaData:\n${util.inspect(otherMeta, { depth: null, colors: false })}`
              : '';

          return `${timestamp} ${emoji} [${level.toUpperCase()}]${contextStr}: ${message}${
            errorString ? `\n${errorString}` : ''
          }${metaString}`;
        }),
      ),
      transports: [
        new transports.Console({
          format: format.combine(format.colorize({ all: true })),
        }),
      ],
    });

    if (process.env.NODE_ENV === 'production') {
      this.logger.add(
        new transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 5242880,
          maxFiles: 5,
        }),
      );
      this.logger.add(
        new transports.File({
          filename: 'logs/combined.log',
          maxsize: 5242880,
          maxFiles: 5,
        }),
      );
    }
  }

  public static formatError(error: Error): string {
    const base = `${error.name}: ${error.message}`;
    const stack = error.stack
      ? error.stack.split('\n').slice(1).join('\n')
      : '';
    const extraProps = Object.entries(error)
      .filter(([key]) => !['name', 'message', 'stack'].includes(key))
      .map(([key, value]) => `${key}: ${util.inspect(value, { depth: null })}`)
      .join('\n');

    return [base, stack, extraProps].filter(Boolean).join('\n');
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
    this.logger.info(message, { ...meta });
  }

  public warn(message: string, ...meta: unknown[]): void {
    this.logger.warn(message, { ...meta });
  }

  public error(message: string, ...meta: unknown[]): void {
    this.logger.error(message, { ...meta });
  }

  public debug(message: string, ...meta: unknown[]): void {
    this.logger.debug(message, { ...meta });
  }

  public verbose(message: string, ...meta: unknown[]): void {
    this.logger.verbose(message, { ...meta });
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
