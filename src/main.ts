import 'dotenv/config'; // load .env before the decorators below read process.env
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { appValidationPipe } from './common/pipes/validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  // the bare address of the server (https://host/) opens the API docs instead of a 404
  app.getHttpAdapter().get('/', (_req: unknown, res: { redirect: (url: string) => void }) => res.redirect('/api/docs'));
  // CORS_ORIGIN: the frontend addresses, comma separated. Spaces and a trailing "/" are forgiven.
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalPipes(appValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Skills Up API').setVersion('1.0').addBearerAuth().build());
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Skills Up API: http://localhost:${port}/api/v1  (docs: http://localhost:${port}/api/docs)`);
}
bootstrap();
