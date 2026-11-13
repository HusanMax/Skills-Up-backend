import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from './users.service';

class ChangePasswordDto {
  @IsString({ message: 'Joriy parolni kiriting.' }) current: string;
  @MinLength(8, { message: 'Yangi parol kamida 8 ta belgidan iborat bo\'lsin.' })
  @Matches(/[A-Za-z]/, { message: 'Kamida bitta harf ishlating.' })
  @Matches(/\d/, { message: 'Kamida bitta raqam ishlating.' })
  next: string;
}

class SettingsDto {
  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifyPush?: boolean;
  @IsOptional() @IsBoolean() notifyReminders?: boolean;
  @IsOptional() @IsIn(['light', 'dark', 'system']) theme?: string;
}

@ApiTags('me')
@Controller()
export class MeController {
  constructor(private users: UsersService, private notifications: NotificationsService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.users.byId(user.id);
    return { id: u.id, role: u.role, fullName: u.fullName, login: u.login, phone: u.phone, email: u.email, bio: u.bio };
  }

  @Post('me/password')
  @HttpCode(204)
  async password(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.users.changeOwnPassword(user.id, dto.current, dto.next, user.sessionId);
  }

  @Get('me/settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.users.getSettings(user.id);
  }

  @Put('me/settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: SettingsDto) {
    return this.users.updateSettings(user.id, dto);
  }

  @Get('notifications')
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  /** Reading one notification deletes it. */
  @Delete('notifications/:id')
  @HttpCode(204)
  async readOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.notifications.remove(user.id, id);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.notifications.readAll(user.id);
  }
}
