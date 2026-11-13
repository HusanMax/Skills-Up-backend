import { Module } from '@nestjs/common';
import { AdminContentController } from './content.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DetailsService } from './details.service';

@Module({ controllers: [AdminController, AdminContentController], providers: [AdminService, DetailsService] })
export class AdminModule {}
