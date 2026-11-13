import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { unprocessable } from '../common/errors';
import { RULES } from '../config/rules';
import { Room } from '../entities';

@Injectable()
export class RoomsService {
  constructor(@InjectRepository(Room) private rooms: Repository<Room>) {}

  all() {
    return this.rooms.find({ order: { id: 'ASC' } });
  }

  async nameMap() {
    return new Map((await this.all()).map((r) => [r.id, r.name]));
  }

  private async assertFree(name: string, exceptId?: number) {
    const clash = (await this.all()).find((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
    if (clash) throw unprocessable('Bunday nomli xona bor.', 'name');
  }

  private assertCapacity(n: number) {
    if (!Number.isInteger(n) || n < RULES.ROOM_MIN_CAPACITY || n > RULES.ROOM_MAX_CAPACITY) throw unprocessable("Sig'im 1 dan 60 gacha butun son bo'lsin.", 'capacity');
  }

  async create(name: string, capacity: number) {
    this.assertCapacity(capacity);
    await this.assertFree(name.trim());
    return this.rooms.save(this.rooms.create({ name: name.trim(), capacity }));
  }

  /** Renaming is safe: group schedules point at the room id, not at its name. */
  async update(id: number, name: string, capacity: number) {
    const room = await this.rooms.findOneBy({ id });
    if (!room) throw new NotFoundException('Xona topilmadi.');
    this.assertCapacity(capacity);
    await this.assertFree(name.trim(), id);
    room.name = name.trim();
    room.capacity = capacity;
    return this.rooms.save(room);
  }
}
