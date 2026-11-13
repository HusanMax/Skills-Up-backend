import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { ExamsService } from '../exams/exams.service';
import { HomeworkService } from '../homework/homework.service';
import { LessonsService } from '../lessons/lessons.service';
import { TeacherService } from './teacher.service';

class StartLessonDto {
  @IsInt() groupId: number;
  @IsString() @MinLength(3, { message: "Dars nomi kamida 3 ta belgidan iborat bo'lsin." }) title: string;
  @IsOptional() @IsBoolean() isExam?: boolean;
}
class LessonInfoDto {
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Matches(/^https?:\/\/\S+$/, { message: 'Video havolasi http:// yoki https:// bilan boshlansin.' }) videoUrl?: string;
  @IsOptional() @IsInt() videoFileId?: number;
  @IsInt({ message: "Davomiylik butun son bo'lsin." }) durationMin: number;
}
class AssignDto {
  @IsString() @MinLength(10, { message: "Vazifa tavsifi kamida 10 ta belgidan iborat bo'lsin." }) task: string;
  @IsArray() @ArrayMinSize(1, { message: 'Kamida bitta qadam yozing.' }) @IsString({ each: true }) steps: string[];
  @IsInt({ message: 'Muddatni tanlang.' }) limitHours: number;
  @IsOptional() @IsArray() @ArrayMaxSize(5, { message: "Ko'pi bilan 5 ta fayl biriktirish mumkin." }) @IsInt({ each: true }) attachmentIds?: number[];
}
class PresentDto { @IsBoolean() present: boolean; }
class BallDto { @IsInt({ message: "Ball butun son bo'lsin." }) ball: number; }
class ReturnDto { @IsString() @MinLength(1, { message: 'Izoh yozing.' }) feedback: string; }

/** Teacher panel. Every call checks that the group or lesson belongs to the signed-in teacher (403 otherwise). */
@ApiTags('teacher')
@ApiBearerAuth()
@Roles(Role.TEACHER)
@Controller('teacher')
export class TeacherController {
  constructor(private teacher: TeacherService, private lessons: LessonsService, private homework: HomeworkService, private exams: ExamsService) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.teacher.dashboard(u.id); }
  @Get('groups') groups(@CurrentUser() u: AuthUser) { return this.teacher.groupList(u.id); }

  @Get('groups/:groupId/students')
  students(@CurrentUser() u: AuthUser, @Param('groupId', ParseIntPipe) id: number) { return this.teacher.groupStudents(u.id, id); }

  @Get('groups/:groupId/lessons')
  groupLessons(@CurrentUser() u: AuthUser, @Param('groupId', ParseIntPipe) id: number, @Query() q: { order?: string; q?: string }) { return this.teacher.groupLessons(u.id, id, q); }

  @Get('groups/:groupId/journal')
  journal(@CurrentUser() u: AuthUser, @Param('groupId', ParseIntPipe) id: number) { return this.teacher.journal(u.id, id); }

  /** "Darsni boshlash": the date and time are the server's current time. */
  @Post('lessons')
  start(@CurrentUser() u: AuthUser, @Body() dto: StartLessonDto) { return this.lessons.start(u.id, dto); }

  @Get('lessons/:lessonId')
  lesson(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number) { return this.teacher.lessonDetail(u.id, id); }

  @Put('lessons/:lessonId/info')
  info(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Body() dto: LessonInfoDto) { return this.lessons.updateInfo(u.id, id, dto); }

  @Put('lessons/:lessonId/homework')
  assign(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Body() dto: AssignDto) { return this.homework.assign(u.id, id, dto); }

  // attendance: mark, mark all, save (locks), reopen
  @Put('lessons/:lessonId/attendance/:studentId') @HttpCode(204)
  async mark(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Param('studentId', ParseIntPipe) sid: number, @Body() dto: PresentDto) { await this.lessons.mark(u.id, id, sid, dto.present); }

  @Post('lessons/:lessonId/attendance/mark-all') @HttpCode(204)
  async markAll(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number) { await this.lessons.markAll(u.id, id); }

  @Post('lessons/:lessonId/attendance/save') @HttpCode(204)
  async save(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number) { await this.lessons.save(u.id, id); }

  @Post('lessons/:lessonId/attendance/reopen') @HttpCode(204)
  async reopen(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number) { await this.lessons.reopen(u.id, id); }

  // reviewing homework
  @Get('lessons/:lessonId/students/:studentId/submission')
  submission(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Param('studentId', ParseIntPipe) sid: number) { return this.homework.reviewView(u.id, id, sid); }

  @Post('lessons/:lessonId/students/:studentId/grade') @HttpCode(204)
  async grade(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Param('studentId', ParseIntPipe) sid: number, @Body() dto: BallDto) { await this.homework.grade(u.id, id, sid, dto.ball); }

  @Post('lessons/:lessonId/students/:studentId/return') @HttpCode(204)
  async sendBack(@CurrentUser() u: AuthUser, @Param('lessonId', ParseIntPipe) id: number, @Param('studentId', ParseIntPipe) sid: number, @Body() dto: ReturnDto) { await this.homework.returnWork(u.id, id, sid, dto.feedback); }

  @Get('review')
  review(@CurrentUser() u: AuthUser, @Query('groupId') groupId?: string) { return this.teacher.review(u.id, groupId ? Number(groupId) : undefined); }

  // exams
  @Get('exams/:examId')
  exam(@CurrentUser() u: AuthUser, @Param('examId', ParseIntPipe) id: number) { return this.teacher.examDetail(u.id, id); }

  /** 409 when the student has no admission to the exam. */
  @Put('exams/:examId/students/:studentId') @HttpCode(204)
  async examBall(@CurrentUser() u: AuthUser, @Param('examId', ParseIntPipe) id: number, @Param('studentId', ParseIntPipe) sid: number, @Body() dto: BallDto) {
    const { lesson, d } = await this.teacher.dataFor(id, u.id);
    await this.exams.setBall(u.id, lesson, d, sid, dto.ball);
  }
}
