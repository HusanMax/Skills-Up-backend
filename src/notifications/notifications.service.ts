import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification } from '../entities';
import { iso } from '../common/dates';

@Injectable()
export class NotificationsService {
  constructor(@InjectRepository(Notification) private repo: Repository<Notification>) {}

  /** One notification row for every user in the list. */
  async notifyMany(userIds: number[], n: { type: string; title: string; link?: string }) {
    if (!userIds.length) return;
    await this.repo.insert(userIds.map((userId) => ({ userId, type: n.type, title: n.title, link: n.link ?? null, readAt: null })));
  }

  async list(userId: number, unreadOnly = false) {
    const rows = await this.repo.find({ where: { userId, ...(unreadOnly ? { readAt: IsNull() } : {}) }, order: { createdAt: 'DESC', id: 'DESC' }, take: 100 });
    return rows.map((n) => ({ id: n.id, type: n.type, title: n.title, link: n.link, createdAt: iso(n.createdAt), readAt: iso(n.readAt) }));
  }

  async readAll(userId: number) {
    await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
  }
}
