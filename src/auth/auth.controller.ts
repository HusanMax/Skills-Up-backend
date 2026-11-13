import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';

class LoginDto {
  @IsString({ message: 'Login kiriting.' }) @MinLength(1, { message: 'Login kiriting.' }) login: string;
  @IsString({ message: 'Parol kiriting.' }) @MinLength(1, { message: 'Parol kiriting.' }) password: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService, private sessions: SessionsService) {}

  /** Login + password -> session token. The role comes from the account, the user never chooses it. */
  @Public()
  // brute-force protection: LOGIN_RATE_LIMIT attempts per minute (default 10)
  @Throttle({ default: { limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.login, dto.password);
  }

  /** Ends this session on the server: the token stops working at once. */
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.sessions.end(user.sessionId);
  }

  /** Swaps the current token for a fresh one (a new expiry time); the old token stops working. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@CurrentUser() user: AuthUser) {
    const res = await this.auth.open(await this.users.byId(user.id));
    await this.sessions.end(user.sessionId);
    return res;
  }
}
