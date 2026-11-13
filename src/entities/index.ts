import { Activity, CareerVideo, Faq, Guide } from './content.entities';
import { Group, GroupMember, GroupSchedule, Payment, PaymentNotice, PaymentPlan, Room } from './groups.entities';
import { Homework, HomeworkAttachment, StudentHomework, Submission, SubmissionFile } from './homework.entities';
import { Attendance, ExamResult, Lesson, LessonProgress } from './lessons.entities';
import { Notification, Session, StoredFile, User, UserSettings } from './users.entities';

export * from './content.entities';
export * from './groups.entities';
export * from './homework.entities';
export * from './lessons.entities';
export * from './users.entities';

export const ALL_ENTITIES = [
  User, UserSettings, StoredFile, Notification, Session,
  Room, Group, GroupSchedule, GroupMember, PaymentPlan, PaymentNotice, Payment,
  Lesson, LessonProgress, Attendance, ExamResult,
  Homework, HomeworkAttachment, StudentHomework, Submission, SubmissionFile,
  CareerVideo, Guide, Faq, Activity,
];
