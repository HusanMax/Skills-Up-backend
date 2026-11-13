import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { ALL_ENTITIES } from '../entities';

/**
 * PostgreSQL when DATABASE_URL is set, otherwise a local file database (sql.js, pure JS, no native build).
 * `synchronize` creates the tables automatically: fine for development, use migrations in production.
 */
export function databaseOptions(config: ConfigService): TypeOrmModuleOptions {
  const url = config.get<string>('DATABASE_URL');
  if (url) {
    // Safety: a remote database is the REAL data. On a developer's computer it is only used on purpose
    // (ALLOW_REMOTE_DB=true), so that tests and experiments can never write into it by accident.
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    if (!local && !process.env.RENDER && config.get('ALLOW_REMOTE_DB') !== 'true') {
      throw new Error(
        'DATABASE_URL points to a remote database, but this is not the hosting server. Leave DATABASE_URL empty for local work ' +
          '(a local file database is used), or set ALLOW_REMOTE_DB=true if you really want to use the remote one.',
      );
    }
    return { type: 'postgres', url, entities: ALL_ENTITIES, synchronize: config.get('DB_SYNC', 'true') === 'true' };
  }
  const file = path.resolve(config.get<string>('DB_FILE') || 'data/dev.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return { type: 'sqljs', location: file, autoSave: true, entities: ALL_ENTITIES, synchronize: true };
}
