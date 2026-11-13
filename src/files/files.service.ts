import { ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { AuthUser } from '../common/decorators';
import { Role } from '../common/enums';
import { FILE_RULES, FileRule } from '../config/rules';
import { StorageService } from './storage.service';
import { GroupMember, Homework, HomeworkAttachment, Lesson, StoredFile } from '../entities';

export type FilePurpose = keyof typeof FILE_RULES;

@Injectable()
export class FilesService {
  readonly dir: string;

  constructor(
    config: ConfigService,
    private storage: StorageService,
    @InjectRepository(StoredFile) private files: Repository<StoredFile>,
    @InjectRepository(Lesson) private lessons: Repository<Lesson>,
    @InjectRepository(Homework) private homeworks: Repository<Homework>,
    @InjectRepository(HomeworkAttachment) private attachments: Repository<HomeworkAttachment>,
    @InjectRepository(GroupMember) private members: Repository<GroupMember>,
  ) {
    this.dir = path.resolve(config.get<string>('UPLOAD_DIR') || 'uploads');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  rule(purpose: FilePurpose): FileRule {
    return FILE_RULES[purpose];
  }

  private extOf(name: string) {
    return path.extname(name).toLowerCase();
  }

  /** Files only (no folders), allowed type, size limit. Removes the uploaded file when it is rejected. */
  async register(owner: AuthUser, file: Express.Multer.File, purpose: FilePurpose) {
    const rule = this.rule(purpose);
    const reject = (err: Error) => {
      fs.rmSync(file.path, { force: true });
      throw err;
    };
    const ext = this.extOf(file.originalname);
    if (!ext) reject(new UnsupportedMediaTypeException(`“${file.originalname}” papka yoki turi noma'lum fayl. Papkani ZIP qilib yuboring.`));
    if (!rule.extensions.includes(ext)) reject(new UnsupportedMediaTypeException(`“${file.originalname}” fayl turi qo'llab-quvvatlanmaydi.`));
    if (file.size > rule.maxBytes) reject(new PayloadTooLargeException(`“${file.originalname}” hajmi ${Math.round(rule.maxBytes / 1024 / 1024)} MB dan oshmasligi kerak.`));
    // the upload first lands in the local folder; with R2 configured it is moved to the bucket right away
    let storageKey = path.basename(file.path);
    if (this.storage.remote) {
      storageKey = `uploads/${storageKey}`;
      await this.storage.put(storageKey, file.path, file.mimetype);
    }
    const row = await this.files.save(
      this.files.create({ ownerId: owner.id, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey, storage: this.storage.kind }),
    );
    return { id: row.id, name: row.originalName, size: row.sizeBytes, mime: row.mimeType };
  }

  async byId(id: number) {
    const f = await this.files.findOneBy({ id });
    if (!f) throw new NotFoundException('Fayl topilmadi.');
    return f;
  }

  pathOf(f: StoredFile) {
    return path.join(this.dir, f.storageKey);
  }

  /** Short info for a list of file ids. */
  async infoOf(ids: number[]) {
    if (!ids.length) return [];
    const rows = await this.files.findBy({ id: In(ids) });
    return rows.map((f) => ({ id: f.id, name: f.originalName, size: f.sizeBytes, mime: f.mimeType }));
  }

  /** Files the user may use as attachments: they must be their own uploads. */
  async assertOwned(userId: number, ids: number[], purpose: FilePurpose) {
    const rule = this.rule(purpose);
    if (ids.length > rule.maxFiles) throw new UnsupportedMediaTypeException(`Ko'pi bilan ${rule.maxFiles} ta fayl biriktirish mumkin.`);
    const rows = ids.length ? await this.files.findBy({ id: In(ids) }) : [];
    if (rows.length !== new Set(ids).size || rows.some((r) => r.ownerId !== userId)) throw new ForbiddenException('Fayl topilmadi yoki sizniki emas.');
  }

  /** Owner, teacher and admin may always open a file; a student only the files of their own groups. */
  async assertCanOpen(user: AuthUser, f: StoredFile) {
    if (f.ownerId === user.id || user.role !== Role.STUDENT) return;
    const groupIds = (await this.members.findBy({ studentId: user.id })).map((m) => m.groupId);
    if (!groupIds.length) throw new ForbiddenException('Bu faylni ochishga ruxsatingiz yo\'q.');
    const video = await this.lessons.findOne({ where: { videoFileId: f.id, groupId: In(groupIds) } });
    if (video) return;
    const att = await this.attachments.findBy({ fileId: f.id });
    if (att.length) {
      const hws = await this.homeworks.findBy({ id: In(att.map((a) => a.homeworkId)) });
      const ls = hws.length ? await this.lessons.findBy({ id: In(hws.map((h) => h.lessonId)), groupId: In(groupIds) }) : [];
      if (ls.length) return;
    }
    throw new ForbiddenException("Bu faylni ochishga ruxsatingiz yo'q.");
  }
}
