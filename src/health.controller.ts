import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';

/** "Is the server alive?" for people (open /api/v1 in a browser) and for the hosting health check. */
@ApiTags('health')
@Controller()
export class HealthController {
  @Public()
  @Get(['', 'health'])
  health() {
    return { name: 'Skills Up API', status: 'ok', version: 'v1', docs: '/api/docs', login: 'POST /api/v1/auth/login' };
  }
}
