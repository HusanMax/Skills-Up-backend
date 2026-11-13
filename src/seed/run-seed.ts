import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

/** `npm run seed`: starts the app context (the seed runs on start when the database is empty), then exits. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.close();
}
main();
