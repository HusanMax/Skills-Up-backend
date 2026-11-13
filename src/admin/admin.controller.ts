import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { Roles, AuthUser, CurrentUser } from '../common/decorators';
import { Day, Role } from '../common/enums';
import { RULES } from '../config/rules';
import { GroupsService } from '../groups/groups.service';
import { PaymentsService } from '../payments/payments.service';
import { InvoiceStatus, ReportFilter, ReportsService } from '../payments/reports.service';
import { DetailsService } from './details.service';
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
class PersonDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
}
class CreateAdminDto {
  @IsString() fullName: string;
  @IsOptional() @IsString() phone?: string;
  @Matches(/^[a-zA-Z0-9._-]{4,30}$/, { message: LOGIN_MSG }) login: string;
  @MinLength(8, { message: PW_MSG }) password: string;
}
class UpdateGroupDto {
  @IsOptional() @IsString() @MinLength(3, { message: 'Guruh nomi kamida 3 ta belgi bo\'lsin.' }) name?: string;
  @IsOptional() @IsString() @MinLength(3, { message: "Yo'nalishni yozing." }) course?: string;
  @IsOptional() @IsInt() teacherId?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1, { message: 'Kamida bitta dars kunini tanlang.' }) @IsEnum(Day, { each: true }) days?: Day[];
  @IsOptional() @IsIn(RULES.LESSON_SLOTS as unknown as string[], { message: "Dars vaqti 2 soatlik kataklardan biri bo'lsin." }) start?: string;
  @IsOptional() @IsInt() roomId?: number;
}
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
class InvoiceDto {
  @IsInt() groupId: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/, { message: "Davr YYYY-MM ko'rinishida bo'lsin." }) period?: string;
  @IsOptional() @IsInt() amount?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedAt?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate: string;
}
class RejectDto {
  @IsOptional() @IsString() reason?: string;
}
class InvoicePaymentDto {
  @IsInt() @Min(1) amount: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) paidAt?: string;
  @IsString() method: string;
  @IsOptional() @IsString() description?: string;
}

/** Administrator panel: students, teachers, accounts, rooms, groups and payments. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService, private groups: GroupsService, private rooms: RoomsService, private payments: PaymentsService, private reports: ReportsService, private details: DetailsService) {}

  @Get('dashboard') dashboard() { return this.admin.dashboard(); }

  // students
  @Get('students') students(@Query('q') q?: string, @Query('groupId') groupId?: string) { return this.admin.listStudents(q, groupId ? Number(groupId) : undefined); }
  @Post('students') createStudent(@Body() dto: CreateStudentDto) { return this.admin.createStudent(dto); }
  @Post('students/:id/enrol') @HttpCode(204)
  async enrol(@Param('id', ParseIntPipe) id: number, @Body() dto: EnrolDto) { await this.admin.enrol(id, dto.groupId); }
  @Put('students/:id') @HttpCode(204)
  async updateStudent(@Param('id', ParseIntPipe) id: number, @Body() dto: PersonDto) { await this.admin.updatePerson(Role.STUDENT, id, dto); }
  /** Switches the student off and frees their seats (history stays). */
  @Delete('students/:id') @HttpCode(204)
  async removeStudent(@Param('id', ParseIntPipe) id: number) { await this.admin.removeStudent(id); }
  @Delete('students/:id/groups/:groupId') @HttpCode(204)
  async leaveGroup(@Param('id', ParseIntPipe) id: number, @Param('groupId', ParseIntPipe) groupId: number) { await this.groups.unenrol(id, groupId); }
  @Put('students/:id/account') @HttpCode(204)
  async studentAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: AccountDto) { await this.admin.changeAccount(Role.STUDENT, id, dto); }

  // teachers
  @Get('teachers') teachers() { return this.admin.listTeachers(); }
  @Post('teachers') createTeacher(@Body() dto: CreateTeacherDto) { return this.admin.createTeacher(dto); }
  @Put('teachers/:id') @HttpCode(204)
  async updateTeacher(@Param('id', ParseIntPipe) id: number, @Body() dto: PersonDto) { await this.admin.updatePerson(Role.TEACHER, id, dto); }
  /** 409 while the teacher still has active groups. */
  @Delete('teachers/:id') @HttpCode(204)
  async removeTeacher(@Param('id', ParseIntPipe) id: number) { await this.admin.removeTeacher(id); }
  @Put('teachers/:id/account') @HttpCode(204)
  async teacherAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: AccountDto) { await this.admin.changeAccount(Role.TEACHER, id, dto); }

  // administrators
  @Get('admins') admins() { return this.admin.listAdmins(); }
  @Post('admins') createAdmin(@Body() dto: CreateAdminDto) { return this.admin.createAdmin(dto); }
  @Put('admins/:id') @HttpCode(204)
  async updateAdmin(@Param('id', ParseIntPipe) id: number, @Body() dto: PersonDto) { await this.admin.updatePerson(Role.ADMIN, id, dto); }
  @Put('admins/:id/account') @HttpCode(204)
  async adminAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: AccountDto) { await this.admin.changeAccount(Role.ADMIN, id, dto); }
  /** Not yourself, and never the last administrator. */
  @Delete('admins/:id') @HttpCode(204)
  async removeAdmin(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { await this.admin.removeAdmin(u.id, id); }

  // rooms (the static paths come before :id)
  @Get('rooms') roomList() { return this.rooms.all(); }
  @Get('rooms/timetable') timetable(@Query('day') day: Day = Day.MON) { return this.groups.timetable(day); }
  @Get('rooms/free') free(@Query('days') days = '', @Query('start') start = '') { return this.groups.freeRooms(days.split(',').filter(Boolean) as Day[], start); }
  @Post('rooms') createRoom(@Body() dto: RoomDto) { return this.rooms.create(dto.name, dto.capacity); }
  @Put('rooms/:id') updateRoom(@Param('id', ParseIntPipe) id: number, @Body() dto: RoomDto) { return this.rooms.update(id, dto.name, dto.capacity); }
  /** 409 while an active group uses the room. */
  @Delete('rooms/:id') @HttpCode(204)
  async removeRoom(@Param('id', ParseIntPipe) id: number) { await this.rooms.remove(id); }

  // groups
  @Get('groups') async groupList() { return this.groups.describe(await this.groups.allGroups()); }
  @Post('groups') createGroup(@Body() dto: CreateGroupDto) { return this.groups.createGroup(dto); }
  @Put('groups/:id') updateGroup(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto) { return this.groups.updateGroup(id, dto); }
  /** Without lessons: deleted. With lessons: archived (the data stays). Answer says which. */
  @Delete('groups/:id')
  removeGroup(@Param('id', ParseIntPipe) id: number) { return this.groups.removeGroup(id); }

  // payments
  @Get('payments') paymentsOverview() { return this.payments.overview(); }
  /** Sets the group's payment and notifies EVERY student of the group. */
  @Put('groups/:id/payment-plan')
  plan(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PlanDto) { return this.payments.publish(u.id, id, dto.amount, dto.dueDate); }

  // payments & sales reports
  private filter(q: Record<string, string | undefined>): ReportFilter {
    return { from: q.from || undefined, to: q.to || undefined, q: q.q || undefined, status: (q.status || undefined) as InvoiceStatus | undefined, groupId: q.groupId ? Number(q.groupId) : undefined };
  }
  /** Dashboard numbers, growth against the previous period, chart series and one page of the table. */
  @Get('reports/payments')
  report(@Query() q: Record<string, string | undefined>) { return this.reports.report(this.filter(q), Number(q.page) || 1, Number(q.limit) || 20); }
  /** A real .xlsx with the same filters and ALL matching rows (not one page). */
  @Get('reports/payments/export')
  async exportReport(@Query() q: Record<string, string | undefined>, @Res() res: Response) {
    const file = await this.reports.exportXlsx(this.filter(q));
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="tolovlar-hisoboti-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'Content-Length': String(file.length) });
    res.end(file);
  }
  /** Bills every student of a group for a period (students already billed are skipped). */
  @Post('invoices') createInvoices(@Body() dto: InvoiceDto) { return this.payments.createInvoices(dto); }
  @Post('invoices/:id/payments') addPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: InvoicePaymentDto) { return this.payments.addPayment(id, dto); }

  // students' "I paid" messages
  @Get('claims') claims(@Query('status') status?: string) { return this.payments.listClaims(status); }
  @Post('claims/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.payments.approveClaim(u.id, id); }
  @Post('claims/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto) { return this.payments.rejectClaim(u.id, id, dto.reason); }

  // "open one" pages
  @Get('teachers/:id') teacher(@Param('id', ParseIntPipe) id: number) { return this.details.teacher(id); }
  @Get('students/:id') student(@Param('id', ParseIntPipe) id: number) { return this.details.student(id); }
  @Get('groups/:id') group(@Param('id', ParseIntPipe) id: number) { return this.details.group(id); }
  @Get('rooms/:id') room(@Param('id', ParseIntPipe) id: number) { return this.details.room(id); }
}
