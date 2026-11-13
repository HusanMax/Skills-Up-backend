import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DetailsService } from './details.service';

@Module({ controllers: [AdminController], providers: [AdminService, DetailsService] })
export class AdminModule {}
