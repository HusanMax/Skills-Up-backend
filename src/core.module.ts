import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsService } from './auth/sessions.service';
import { ContentController } from './content/content.controller';
import { ALL_ENTITIES } from './entities';
import { ExamsService } from './exams/exams.service';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { StorageService } from './files/storage.service';
import { GroupsService } from './groups/groups.service';
import { HomeworkService } from './homework/homework.service';
import { LessonsService } from './lessons/lessons.service';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsService } from './payments/payments.service';
import { RewardsService } from './rewards/rewards.service';
import { RoomsService } from './rooms/rooms.service';
import { MeController } from './users/me.controller';
import { UsersService } from './users/users.service';

const SERVICES = [SessionsService, StorageService, UsersService, NotificationsService, FilesService, RoomsService, GroupsService, RewardsService, ExamsService, LessonsService, HomeworkService, PaymentsService];

/**
 * Domain services shared by the role panels (student / teacher / admin). The business rules live in these services,
 * the panels only expose them. Also holds the endpoints every signed-in user has (/me, /notifications, /files, content).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  controllers: [MeController, FilesController, ContentController],
  providers: SERVICES,
  exports: [...SERVICES, TypeOrmModule],
})
export class CoreModule {}
