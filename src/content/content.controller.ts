import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CareerVideo, Faq, Guide } from '../entities';

/** Read-only content for every signed-in user: career videos (view only, no progress/rewards), guides and FAQ. */
@ApiTags('content')
@Controller()
export class ContentController {
  constructor(
    @InjectRepository(CareerVideo) private videos: Repository<CareerVideo>,
    @InjectRepository(Guide) private guides: Repository<Guide>,
    @InjectRepository(Faq) private faqs: Repository<Faq>,
  ) {}

  @Get('career-videos')
  careerVideos() {
    return this.videos.find({ order: { id: 'ASC' } }).then((rows) => rows.map((v) => ({ id: v.id, title: v.title, topic: v.topic, durationMin: v.durationMin, description: v.description, url: v.videoUrl })));
  }

  @Get('guides')
  guideList() {
    return this.guides.find({ order: { id: 'ASC' } });
  }

  @Get('faqs')
  faqList() {
    return this.faqs.find({ order: { id: 'ASC' } }).then((rows) => rows.map((f) => ({ id: f.id, question: f.question, answer: f.answer })));
  }
}
