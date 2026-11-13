import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString({ message: 'Login kiriting.' }) @MinLength(1, { message: 'Login kiriting.' }) login: string;
  @IsString({ message: 'Parol kiriting.' }) @MinLength(1, { message: 'Parol kiriting.' }) password: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService) {}

  /** Login + password -> token. The role comes from the account, the user never chooses it. */
  @Public()
  // brute-force protection: LOGIN_RATE_LIMIT attempts per minute (default 10)
  @Throttle({ default: { limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.login, dto.password);
  }

  /** Tokens are stateless: the client just forgets the token. */
  @Post('logout')
  @HttpCode(204)
  logout() {
    return;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@CurrentUser() user: AuthUser) {
    return this.auth.tokenFor(await this.users.byId(user.id));
  }
}
