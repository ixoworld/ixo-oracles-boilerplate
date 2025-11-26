import { MatrixManager } from '@ixo/matrix';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { Cron, CronExpression } from '@nestjs/schedule';
import { hours } from '@nestjs/throttler';
import { File } from 'node:buffer';
import * as fs from 'node:fs/promises';

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { ENV } from 'src/config';
import { mainAgent } from 'src/graph';
import {
  getMediaFromRoom,
  getMediaFromRoomByStorageKey,
  GetMediaFromRoomByStorageKeyResult,
  MatrixMediaEvent,
  uploadMediaToRoom,
} from './matrix-upload-utils';

const configService = new ConfigService<ENV>();

@Injectable()
export class UserMatrixSqliteSyncService implements OnModuleInit {
  private static instance: UserMatrixSqliteSyncService;

  private constructor(
    readonly fileEventsDatabase: DatabaseType = new Database(
      path.join(
        configService.getOrThrow('MATRIX_STORE_PATH'),
        'file_events.db',
      ),
    ),
  ) {}

  private readonly filePathCache = new Map<
    string,
    {
      filePath: string;
      lastAccessedAt: number;
    }
  >();

  private readonly dbConnectionCache = new Map<
    string,
    {
      db: DatabaseType;
      lastAccessedAt: number;
    }
  >();

  static createUserStorageKey(userDid: string): string {
    const key = `checkpoint_${userDid}_${configService.getOrThrow('ORACLE_DID')}`;
    return createHash('sha256').update(key).digest('hex').substring(0, 10);
  }

  static getUserCheckpointDbPath(userDid: string): string {
    const dbPath = path.join(
      UserMatrixSqliteSyncService.checkpointsFolder,
      userDid,
      `${UserMatrixSqliteSyncService.createUserStorageKey(userDid)}.db`,
    );
    return dbPath;
  }

  static checkpointsFolder = './checkpoints';

  public async onModuleInit(): Promise<void> {
    // create checkpoints folder if it doesn't exist
    const exists = await fs
      .access(UserMatrixSqliteSyncService.checkpointsFolder)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      Logger.debug(
        `Creating checkpoints folder at ${UserMatrixSqliteSyncService.checkpointsFolder}`,
      );
      await fs.mkdir(UserMatrixSqliteSyncService.checkpointsFolder, {
        recursive: true,
      });
    }

    this.fileEventsDatabase
      .prepare(
        'CREATE TABLE IF NOT EXISTS file_events (event_id TEXT PRIMARY KEY, storage_key TEXT, event TEXT)',
      )
      .run();

    this.fileEventsDatabase
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_storage_key ON file_events (storage_key)',
      )
      .run();
  }

  /**
   * Get or create database connection for a user
   * Ensures database exists and is synced from Matrix
   */
  public async getUserDatabase(userDid: string): Promise<DatabaseType> {
    // Ensure database is synced locally first
    await this.syncLocalStorageFromMatrixStorage({ userDid });

    const dbPath = UserMatrixSqliteSyncService.getUserCheckpointDbPath(userDid);

    // Check cache
    const cached = this.dbConnectionCache.get(userDid);
    if (cached) {
      cached.lastAccessedAt = Date.now();
      return cached.db;
    }

    // Create new connection
    const db = new Database(dbPath);

    // Enable WAL mode (compatible with SqliteSaver)
    db.pragma('journal_mode=WAL');

    // Initialize sessions and calls tables if needed
    this.initializeSessionsAndCallsTables(db);

    // Cache it
    this.dbConnectionCache.set(userDid, {
      db,
      lastAccessedAt: Date.now(),
    });

    return db;
  }

  private initializeSessionsAndCallsTables(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        last_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        oracle_name TEXT NOT NULL,
        oracle_did TEXT NOT NULL,
        oracle_entity_did TEXT NOT NULL,
        last_processed_count INTEGER,
        user_context TEXT,
        room_id TEXT,
        slack_thread_ts TEXT
      );

      CREATE TABLE IF NOT EXISTS calls (
        call_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(last_updated_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_oracle_entity ON sessions(oracle_entity_did);
      CREATE INDEX IF NOT EXISTS idx_calls_session ON calls(session_id);
    `);
  }

  @Cron(CronExpression.EVERY_HOUR)
  public async localStorageCacheCleanUpTask(): Promise<void> {
    const now = Date.now();

    // Close idle database connections
    for (const [
      userDid,
      { db, lastAccessedAt },
    ] of this.dbConnectionCache.entries()) {
      if (now - lastAccessedAt > hours(1)) {
        try {
          // Sync to Matrix before closing
          await this.uploadCheckpointToMatrixStorage({ userDid });
          // Close connection (db is already from the loop iteration)
          db.close();
          this.dbConnectionCache.delete(userDid);
          Logger.log(`Closed idle database connection for user ${userDid}`);
        } catch (error) {
          Logger.error(
            `Failed to cleanup DB connection for user ${userDid}`,
            error,
          );
        }
      }
    }

    // Clean up file cache
    for (const [
      userDid,
      { filePath, lastAccessedAt },
    ] of this.filePathCache.entries()) {
      if (now - lastAccessedAt > hours(1)) {
        try {
          await this.uploadCheckpointToMatrixStorage({ userDid });
        } catch (error) {
          Logger.error(
            `Failed to sync checkpoint file to matrix storage for user ${userDid}`,
            error,
          );
          // failed to sync, continue to next user so we can retry next hour
          continue;
        }

        // sync successful, delete local cache
        // this.filePathCache.delete(userDid);
        const userFolder = path.join(
          UserMatrixSqliteSyncService.checkpointsFolder,
          userDid,
        );
        await fs.rm(userFolder, { recursive: true });
        Logger.log(
          `Deleted Local Storage checkpoint folder for user ${userDid} and path ${userFolder}`,
        );
      }
    }
  }

  /**
   * Get the singleton instance of UserMatrixSqliteSyncService
   * @param maxCacheSize - Maximum number of cached files (default: 100)
   * @returns The singleton instance
   */
  public static getInstance(): UserMatrixSqliteSyncService {
    if (!UserMatrixSqliteSyncService.instance) {
      UserMatrixSqliteSyncService.instance = new UserMatrixSqliteSyncService();
    }
    return UserMatrixSqliteSyncService.instance;
  }

  /**
   * Load the checkpoint SQLite file for a user.
   * First checks the local cache, then matrix storage if not cached.
   * @param userDid - The user's DID identifier
   * @returns Promise resolving to the SQLite file buffer
   */
  public async syncLocalStorageFromMatrixStorage(
    params: BaseSyncArgs,
  ): Promise<void> {
    const { userDid } = params;
    const storageKey =
      UserMatrixSqliteSyncService.createUserStorageKey(userDid);
    const checkpointPath =
      UserMatrixSqliteSyncService.getUserCheckpointDbPath(userDid);

    Logger.debug(
      `Syncing checkpoint for user ${userDid}, storageKey: ${storageKey}, path: ${checkpointPath}`,
    );

    // Ensure the user's checkpoint directory exists
    const userCheckpointDir = path.dirname(checkpointPath);
    const dirExists = await fs
      .access(userCheckpointDir)
      .then(() => true)
      .catch(() => false);

    if (!dirExists) {
      Logger.debug(
        `Creating checkpoint directory for user ${userDid}: ${userCheckpointDir}`,
      );
      await fs.mkdir(userCheckpointDir, { recursive: true });
    }

    // check if file exists
    const exists = await fs
      .access(checkpointPath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      Logger.debug(
        `Checkpoint file already exists locally for user ${userDid} at ${checkpointPath}`,
      );
      this.filePathCache.set(userDid, {
        filePath: checkpointPath,
        lastAccessedAt: Date.now(),
      });
      return;
    }

    Logger.debug(
      `Checkpoint file not found locally for user ${userDid}, attempting to download from Matrix`,
    );

    let userDB: GetMediaFromRoomByStorageKeyResult | null = null;

    const cachedEventText = this.fileEventsDatabase
      .prepare('SELECT event FROM file_events WHERE storage_key = ?')
      .get(storageKey);

    const cachedEvent = cachedEventText
      ? (JSON.parse(cachedEventText as string) as MatrixMediaEvent)
      : undefined;
    if (cachedEvent) {
      const result = await getMediaFromRoom(undefined, undefined, cachedEvent);
      userDB = {
        ...result,
        contentInfo: {
          ...result.contentInfo,
          storageKey,
        },
      };
    } else {
      const mxManager = MatrixManager.getInstance();
      const { roomId } = await mxManager.getOracleRoomId({
        userDid: userDid,
        oracleEntityDid: configService.getOrThrow('ORACLE_ENTITY_DID'),
      });

      if (!roomId) {
        throw new NotFoundException('Room not found or Invalid Session Id');
      }

      Logger.debug(
        `Downloading checkpoint from Matrix room ${roomId} for user ${userDid}`,
      );
      // load from matrix
      userDB = await getMediaFromRoomByStorageKey(roomId, storageKey);
    }

    if (!userDB) {
      Logger.debug(
        `No checkpoint found in Matrix for user ${userDid} with storageKey ${storageKey}, this is expected for new users`,
      );
      return;
    }

    Logger.log(
      `Checkpoint downloaded from Matrix for user ${userDid}, size: ${userDB.mediaBuffer.length} bytes`,
    );

    // save to local cache
    this.filePathCache.set(userDid, {
      filePath: checkpointPath,
      lastAccessedAt: Date.now(),
    });

    Logger.debug(
      `Saving checkpoint to local cache for user ${userDid} at ${checkpointPath}`,
    );

    await fs.writeFile(checkpointPath, userDB.mediaBuffer, {
      flag: 'w', // overwrite
    });

    Logger.debug(
      `Successfully saved checkpoint for user ${userDid} at ${checkpointPath}`,
    );
    return;
  }

  /**
   * Sync checkpoint file from local cache to S3.
   * @param userDid - The user's DID identifier
   * @returns Promise that resolves when sync is complete
   */
  async uploadCheckpointToMatrixStorage(params: BaseSyncArgs): Promise<void> {
    const { userDid } = params;

    // Close database connection if open (flush any pending writes)

    const checkpointKey =
      UserMatrixSqliteSyncService.createUserStorageKey(userDid);

    const checkpointPath =
      UserMatrixSqliteSyncService.getUserCheckpointDbPath(userDid);

    Logger.debug(
      `Uploading checkpoint for user ${userDid}, storageKey: ${checkpointKey}, path: ${checkpointPath}`,
    );

    const exists = await fs
      .access(checkpointPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      Logger.warn(
        `Checkpoint file not found for user ${userDid} at ${checkpointPath}`,
      );
      return;
    }

    Logger.debug(
      `Reading checkpoint file for user ${userDid} from ${checkpointPath}`,
    );
    const checkpoint = await fs.readFile(checkpointPath);

    Logger.debug(
      `Checkpoint file read for user ${userDid}, size: ${checkpoint.length} bytes`,
    );

    const mxManager = MatrixManager.getInstance();
    const { roomId } = await mxManager.getOracleRoomId({
      userDid: userDid,
      oracleEntityDid: configService.getOrThrow('ORACLE_ENTITY_DID'),
    });

    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }

    Logger.debug(
      `Uploading checkpoint to Matrix room ${roomId} for user ${userDid}`,
    );
    const event = await uploadMediaToRoom(
      roomId,
      new File([checkpoint], `${checkpointKey}.db`, {
        type: 'application/x-sqlite3',
        lastModified: Date.now(),
      }),
      checkpointKey,
    );
    await this.saveFileEventToDB({
      eventId: event.eventId,
      storageKey: event.storageKey,
      event: event.event,
    });

    Logger.log(
      `Successfully uploaded checkpoint to Matrix for user ${userDid}`,
    );
  }

  private async saveFileEventToDB({
    eventId,
    storageKey,
    event,
  }: {
    eventId: string;
    storageKey: string;
    event: MatrixMediaEvent;
  }): Promise<void> {
    this.fileEventsDatabase
      .prepare(
        'INSERT OR REPLACE INTO file_events (event_id, storage_key, event) VALUES (?, ?, ?)',
      )
      .run(eventId, storageKey, JSON.stringify(event));
  }

  // Call CRUD methods

  async addCall(
    userDid: string,
    callId: string,
    sessionId: string,
  ): Promise<void> {
    const db = await this.getUserDatabase(userDid);

    db.prepare(
      `
      INSERT OR REPLACE INTO calls (call_id, session_id, created_at)
      VALUES (?, ?, ?)
    `,
    ).run(callId, sessionId, new Date().toISOString());
  }

  async listCalls(
    userDid: string,
    sessionId?: string,
  ): Promise<Array<{ call_id: string; session_id: string }>> {
    const db = await this.getUserDatabase(userDid);

    if (sessionId) {
      const rows = db
        .prepare('SELECT call_id, session_id FROM calls WHERE session_id = ?')
        .all(sessionId) as Array<{ call_id: string; session_id: string }>;
      return rows;
    }

    const rows = db
      .prepare('SELECT call_id, session_id FROM calls')
      .all() as Array<{ call_id: string; session_id: string }>;
    return rows;
  }

  // Migration method

  async migrateUserDataFromMatrix(
    userDid: string,
    roomId: string,
    oracleEntityDid: string,
  ): Promise<void> {
    const db = await this.getUserDatabase(userDid);

    // Check if sessions table is empty
    const sessionCount = db
      .prepare('SELECT COUNT(*) as count FROM sessions')
      .get() as { count: number };

    if (sessionCount.count > 0) {
      Logger.debug(
        `Sessions already exist in SQLite for user ${userDid}, skipping migration`,
      );
      return;
    }

    // Check if calls table is empty
    const callCount = db
      .prepare('SELECT COUNT(*) as count FROM calls')
      .get() as { count: number };

    if (callCount.count > 0) {
      Logger.debug(
        `Calls already exist in SQLite for user ${userDid}, skipping migration`,
      );
      return;
    }

    const matrixManager = MatrixManager.getInstance();
    await matrixManager.init();

    if (!matrixManager.stateManager) {
      Logger.warn(
        `MatrixStateManager not initialized, cannot migrate data for user ${userDid}`,
      );
      return;
    }

    // Migrate sessions
    try {
      const sessionsStateKey = `${oracleEntityDid}_sessions`;
      const sessionsState = await matrixManager.stateManager.getState<
        Array<{
          sessionId: string;
          oracleEntityDid: string;
          oracleDid: string;
          createdAt: string;
          lastUpdatedAt: string;
          [key: string]: unknown;
        }>
      >(roomId, sessionsStateKey);

      if (
        sessionsState &&
        Array.isArray(sessionsState) &&
        sessionsState.length > 0
      ) {
        Logger.debug(
          `Migrating ${sessionsState.length} sessions from Matrix to SQLite for user ${userDid}`,
        );
        const insertStmt = db.prepare(`
          INSERT INTO sessions (
            session_id, title, last_updated_at, created_at, oracle_name,
            oracle_did, oracle_entity_did, last_processed_count,
            user_context, room_id, slack_thread_ts
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((sessions) => {
          for (const session of sessions) {
            insertStmt.run(
              session.sessionId,
              (session as any).title ?? null,
              session.lastUpdatedAt,
              session.createdAt,
              (session as any).oracleName ?? '',
              session.oracleDid,
              session.oracleEntityDid,
              (session as any).lastProcessedCount ?? null,
              (session as any).userContext
                ? JSON.stringify((session as any).userContext)
                : null,
              (session as any).roomId ?? null,
              (session as any).slackThreadTs ?? null,
            );
          }
        });

        insertMany(sessionsState);
        Logger.log(
          `Migrated ${sessionsState.length} sessions from Matrix to SQLite for user ${userDid}`,
        );

        Logger.log(
          `Starting chat history migration from Matrix to SQLite for user ${userDid}`,
        );

        for (const session of sessionsState) {
          await mainAgent.migrateChatHistoryToSqlite({
            sessionId: session.sessionId,
            configurable: {
              thread_id: session.sessionId,
              configs: {
                user: {
                  did: userDid,
                },
                matrix: {
                  roomId: roomId,
                  oracleDid: oracleEntityDid,
                },
              },
            },
          });
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'errcode' in error &&
        error.errcode === 'M_NOT_FOUND'
      ) {
        Logger.debug(
          `No sessions found in Matrix for user ${userDid}, skipping migration`,
        );
      } else {
        Logger.error(
          `Failed to migrate sessions from Matrix for user ${userDid}`,
          error,
        );
      }
    }

    // Migrate calls
    try {
      const callsState = await matrixManager.stateManager.getState<{
        calls: Array<{ callId: string; sessionId: string }>;
      }>(roomId, '_oracles_calls_list');

      if (callsState?.calls && callsState.calls.length > 0) {
        Logger.debug(
          `Migrating ${callsState.calls.length} calls from Matrix to SQLite for user ${userDid}`,
        );
        const insertStmt = db.prepare(`
          INSERT INTO calls (call_id, session_id, created_at)
          VALUES (?, ?, ?)
        `);

        const insertMany = db.transaction((calls) => {
          for (const call of calls) {
            insertStmt.run(
              call.callId,
              call.sessionId,
              new Date().toISOString(),
            );
          }
        });

        insertMany(callsState.calls);
        Logger.log(
          `Migrated ${callsState.calls.length} calls from Matrix to SQLite for user ${userDid}`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'errcode' in error &&
        error.errcode === 'M_NOT_FOUND'
      ) {
        Logger.debug(
          `No calls found in Matrix for user ${userDid}, skipping migration`,
        );
      } else {
        Logger.error(
          `Failed to migrate calls from Matrix for user ${userDid}`,
          error,
        );
      }
    }
  }
}
