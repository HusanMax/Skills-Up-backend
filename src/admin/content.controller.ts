import { Body, Controller, Delete, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { CareerVideo, Faq, Guide } from '../entities';

class VideoDto {
  @IsString() @MinLength(3, { message: "Sarlavha kamida 3 ta belgi bo'lsin." }) title: string;
  @IsString() @MinLength(2, { message: 'Mavzuni yozing.' }) topic: string;
  @IsInt({ message: "Davomiylik butun son (daqiqa) bo'lsin." }) @Min(1, { message: "Davomiylik kamida 1 daqiqa." }) durationMin: number;
  @IsString() description: string;
  @IsOptional() @Matches(/^https?:\/\/\S+$/, { message: 'Video havolasi http:// yoki https:// bilan boshlansin.' }) url?: string;
}
class GuideDto {
  @IsString() @MinLength(3, { message: "Sarlavha kamida 3 ta belgi bo'lsin." }) title: string;
  @IsString() @MinLength(2, { message: 'Turkumni yozing.' }) category: string;
  @IsInt({ message: "O'qish vaqti butun son (daqiqa) bo'lsin." }) @Min(1) readMin: number;
  @IsString() @MinLength(5, { message: 'Qisqa mazmunni yozing.' }) summary: string;
  @IsString() @MinLength(10, { message: "Matn kamida 10 ta belgi bo'lsin." }) body: string;
}
class FaqDto {
  @IsString() @MinLength(5, { message: 'Savolni yozing.' }) question: string;
  @IsString() @MinLength(2, { message: 'Javobni yozing.' }) answer: string;
}

const gone = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} topilmadi.` });

/** The administrator manages the content every student sees: career videos, guides and FAQ (reading is in /career-videos, /guides, /faqs). */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/content')
export class AdminContentController {
  constructor(
    @InjectRepository(CareerVideo) private videos: Repository<CareerVideo>,
    @InjectRepository(Guide) private guides: Repository<Guide>,
    @InjectRepository(Faq) private faqs: Repository<Faq>,
  ) {}

  private videoRow = (v: CareerVideo) => ({ id: v.id, title: v.title, topic: v.topic, durationMin: v.durationMin, description: v.description, url: v.videoUrl });

  @Post('career-videos') async addVideo(@Body() d: VideoDto) { return this.videoRow(await this.videos.save(this.videos.create({ title: d.title.trim(), topic: d.topic.trim(), durationMin: d.durationMin, description: d.description.trim(), videoUrl: d.url?.trim() || null }))); }
  @Put('career-videos/:id')
  async editVideo(@Param('id', ParseIntPipe) id: number, @Body() d: VideoDto) {
    const v = await this.videos.findOneBy({ id });
    if (!v) throw gone('Video');
    Object.assign(v, { title: d.title.trim(), topic: d.topic.trim(), durationMin: d.durationMin, description: d.description.trim(), videoUrl: d.url?.trim() || null });
    return this.videoRow(await this.videos.save(v));
  }
  @Delete('career-videos/:id') @HttpCode(204)
  async removeVideo(@Param('id', ParseIntPipe) id: number) { if (!(await this.videos.delete({ id })).affected) throw gone('Video'); }

  @Post('guides') addGuide(@Body() d: GuideDto) { return this.guides.save(this.guides.create({ title: d.title.trim(), category: d.category.trim(), readMin: d.readMin, summary: d.summary.trim(), body: d.body.trim() })); }
  @Put('guides/:id')
  async editGuide(@Param('id', ParseIntPipe) id: number, @Body() d: GuideDto) {
    const g = await this.guides.findOneBy({ id });
    if (!g) throw gone("Qo'llanma");
    Object.assign(g, { title: d.title.trim(), category: d.category.trim(), readMin: d.readMin, summary: d.summary.trim(), body: d.body.trim() });
    return this.guides.save(g);
  }
  @Delete('guides/:id') @HttpCode(204)
  async removeGuide(@Param('id', ParseIntPipe) id: number) { if (!(await this.guides.delete({ id })).affected) throw gone("Qo'llanma"); }

  @Post('faqs') addFaq(@Body() d: FaqDto) { return this.faqs.save(this.faqs.create({ question: d.question.trim(), answer: d.answer.trim() })); }
  @Put('faqs/:id')
  async editFaq(@Param('id', ParseIntPipe) id: number, @Body() d: FaqDto) {
    const f = await this.faqs.findOneBy({ id });
    if (!f) throw gone('Savol');
    Object.assign(f, { question: d.question.trim(), answer: d.answer.trim() });
    return this.faqs.save(f);
  }
  @Delete('faqs/:id') @HttpCode(204)
  async removeFaq(@Param('id', ParseIntPipe) id: number) { if (!(await this.faqs.delete({ id })).affected) throw gone('Savol'); }
}
