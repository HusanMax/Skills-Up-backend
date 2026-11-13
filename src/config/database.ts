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
    return { type: 'postgres', url, entities: ALL_ENTITIES, synchronize: config.get('DB_SYNC', 'true') === 'true' };
  }
  const file = path.resolve(config.get<string>('DB_FILE') || 'data/dev.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return { type: 'sqljs', location: file, autoSave: true, entities: ALL_ENTITIES, synchronize: true };
}
