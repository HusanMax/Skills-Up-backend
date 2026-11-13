import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { HomeworkService } from '../homework/homework.service';
import { LessonsService } from '../lessons/lessons.service';
import { PaymentsService } from '../payments/payments.service';
import { StudentService } from './student.service';

class ProgressDto {
  @IsInt({ message: 'Progress butun son bo\'lsin.' }) @Min(0) @Max(100) percent: number;
}

class SubmitDto {
  @IsOptional() @IsString() @MaxLength(2000, { message: 'Javob matni 2000 belgidan oshmasin.' }) text?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3, { message: "Ko'pi bilan 3 ta fayl biriktirish mumkin." }) @IsInt({ each: true }) fileIds?: number[];
}

/** Student panel. Everything is about the signed-in student: the id comes from the token, never from the URL. */
@ApiTags('student')
@ApiBearerAuth()
@Roles(Role.STUDENT)
@Controller('student')
export class StudentController {
  constructor(private student: StudentService, private lessons: LessonsService, private homework: HomeworkService, private payments: PaymentsService) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.student.dashboard(u.id); }
  @Get('groups') groups(@CurrentUser() u: AuthUser) { return this.student.groupList(u.id); }

  @Get('groups/:groupId/lessons')
  groupLessons(@CurrentUser() u: AuthUser, @Param('groupId', ParseIntPipe) groupId: number, @Query() q: { order?: string; status?: string; homework?: string; q?: string }) {
    return this.student.groupLessons(u.id, groupId, q);
  }

  @Get('lessons/:lessonId')
  lesson(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number) { return this.student.lessonDetail(u.id, id); }

  /** Watch progress only goes up. */
  @Put('lessons/:lessonId/progress')
  progress(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Body() dto: ProgressDto) { return this.lessons.setProgress(u.id, id, dto.percent); }

  @Post('lessons/:lessonId/homework')
  submit(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Body() dto: SubmitDto) { return this.homework.submit(u.id, id, dto); }

  @Get('groups/:groupId/leaderboard')
  leaderboard(@CurrentUser() u: AuthUser, @Param('groupId', ParseIntPipe) groupId: number) { return this.student.leaderboard(u.id, groupId); }

  @Get('payments') paymentsList(@CurrentUser() u: AuthUser) { return this.payments.forStudent(u.id); }
  @Get('analytics') analytics(@CurrentUser() u: AuthUser) { return this.student.analytics(u.id); }
  @Get('calendar') calendar(@CurrentUser() u: AuthUser, @Query('month') month = '') { return this.student.calendar(u.id, month); }
}
