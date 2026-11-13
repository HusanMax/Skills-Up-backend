import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { Roles, AuthUser, CurrentUser } from '../common/decorators';
import { Day, Role } from '../common/enums';
import { RULES } from '../config/rules';
import { GroupsService } from '../groups/groups.service';
import { PaymentsService } from '../payments/payments.service';
import { RoomsService } from '../rooms/rooms.service';
import { AdminService } from './admin.service';

const LOGIN_MSG = 'Login 4–30 ta belgi: kichik lotin harflari, raqam, nuqta, chiziq.';
const PW_MSG = 'Parol kamida 8 ta belgidan iborat bo\'lsin.';

class CreateStudentDto {
  @IsString() fullName: string;
  @IsString() phone: string;
  @Matches(/^[a-zA-Z0-9._-]{4,30}$/, { message: LOGIN_MSG }) login: string;
  @MinLength(8, { message: PW_MSG }) password: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) groupIds?: number[];
}
class CreateTeacherDto {
  @IsString() fullName: string;
  @IsString() phone: string;
  @Matches(/^[a-zA-Z0-9._-]{4,30}$/, { message: LOGIN_MSG }) login: string;
  @MinLength(8, { message: PW_MSG }) password: string;
}
class AccountDto {
  @IsOptional() @Matches(/^[a-zA-Z0-9._-]{4,30}$/, { message: LOGIN_MSG }) login?: string;
  @IsOptional() @MinLength(8, { message: PW_MSG }) password?: string;
}
class EnrolDto { @IsInt() groupId: number; }
class RoomDto {
  @IsString() @MinLength(2, { message: 'Xona nomi kamida 2 ta belgi bo\'lsin.' }) name: string;
  @IsInt({ message: "Sig'im butun son bo'lsin." }) capacity: number;
}
class CreateGroupDto {
  @IsString() @MinLength(3, { message: 'Guruh nomi kamida 3 ta belgi bo\'lsin.' }) name: string;
  @IsString() @MinLength(3, { message: "Yo'nalishni yozing." }) course: string;
  @IsInt() teacherId: number;
  @IsArray() @ArrayMinSize(1, { message: 'Kamida bitta dars kunini tanlang.' }) @IsEnum(Day, { each: true }) days: Day[];
  @IsIn(RULES.LESSON_SLOTS as unknown as string[], { message: "Dars vaqti 2 soatlik kataklardan biri bo'lsin." }) start: string;
  @IsInt() roomId: number;
  @IsInt() @Min(RULES.MIN_PAYMENT, { message: "To'lov so'mda, kamida 10 000." }) amount: number;
  @IsString() dueDate: string;
}
class PlanDto {
  @IsInt() @Min(RULES.MIN_PAYMENT, { message: "To'lov so'mda, kamida 10 000." }) amount: number;
  @IsString() dueDate: string;
}
class RecordPaymentDto {
  @IsInt() studentId: number;
  @IsInt() groupId: number;
  @IsInt() @Min(1) amount: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) paidAt: string;
  @IsString() method: string;
  @IsString() description: string;
}

/** Administrator panel: students, teachers, accounts, rooms, groups and payments. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService, private groups: GroupsService, private rooms: RoomsService, private payments: PaymentsService) {}

  @Get('dashboard') dashboard() { return this.admin.dashboard(); }

  // students
  @Get('students') students(@Query('q') q?: string, @Query('groupId') groupId?: string) { return this.admin.listStudents(q, groupId ? Number(groupId) : undefined); }
  @Post('students') createStudent(@Body() dto: CreateStudentDto) { return this.admin.createStudent(dto); }
  @Post('students/:id/enrol') @HttpCode(204)
  async enrol(@Param('id', ParseIntPipe) id: number, @Body() dto: EnrolDto) { await this.admin.enrol(id, dto.groupId); }
  @Put('students/:id/account') @HttpCode(204)
  async studentAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: AccountDto) { await this.admin.changeAccount(Role.STUDENT, id, dto); }

  // teachers
  @Get('teachers') teachers() { return this.admin.listTeachers(); }
  @Post('teachers') createTeacher(@Body() dto: CreateTeacherDto) { return this.admin.createTeacher(dto); }
  @Put('teachers/:id/account') @HttpCode(204)
  async teacherAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: AccountDto) { await this.admin.changeAccount(Role.TEACHER, id, dto); }

  // rooms (the static paths come before :id)
  @Get('rooms') roomList() { return this.rooms.all(); }
  @Get('rooms/timetable') timetable(@Query('day') day: Day = Day.MON) { return this.groups.timetable(day); }
  @Get('rooms/free') free(@Query('days') days = '', @Query('start') start = '') { return this.groups.freeRooms(days.split(',').filter(Boolean) as Day[], start); }
  @Post('rooms') createRoom(@Body() dto: RoomDto) { return this.rooms.create(dto.name, dto.capacity); }
  @Put('rooms/:id') updateRoom(@Param('id', ParseIntPipe) id: number, @Body() dto: RoomDto) { return this.rooms.update(id, dto.name, dto.capacity); }

  // groups
  @Get('groups') async groupList() { return this.groups.describe(await this.groups.allGroups()); }
  @Post('groups') createGroup(@Body() dto: CreateGroupDto) { return this.groups.createGroup(dto); }

  // payments
  @Get('payments') paymentsOverview() { return this.payments.overview(); }
  /** Sets the group's payment and notifies EVERY student of the group. */
  @Put('groups/:id/payment-plan')
  plan(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PlanDto) { return this.payments.publish(u.id, id, dto.amount, dto.dueDate); }
  @Post('payments') record(@Body() dto: RecordPaymentDto) { return this.payments.record(dto); }
}
