/* End-to-end smoke test of the API. Start the backend on an EMPTY database first (demo seed), then:
 *   API=http://localhost:4001/api/v1 npm run test:smoke
 */
import ExcelJS from 'exceljs';

const API = process.env.API ?? 'http://localhost:4000/api/v1';
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) passed++;
  else {
    failed++;
    console.log(`  FAIL: ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '');
  }
}

type Res<T = any> = { status: number; body: T };
async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<Res<T>> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
const login = async (l: string, p: string) => (await call('POST', '/auth/login', undefined, { login: l, password: p })).body?.token as string;

async function main() {
  console.log(`API: ${API}`);

  console.log('1. login and guards');
  check('no token -> 401', (await call('GET', '/student/dashboard')).status === 401);
  const bad = await call('POST', '/auth/login', undefined, { login: 'admin', password: 'xato' });
  check('wrong password -> 401 generic', bad.status === 401 && bad.body.error.message === "Login yoki parol noto'g'ri.", bad.body);
  const unknown = await call('POST', '/auth/login', undefined, { login: 'nobody', password: 'xato' });
  check('unknown login -> same message', unknown.body?.error?.message === bad.body?.error?.message);
  const admin = await login('ADMIN', 'admin123');
  const teacher = await login('dilnoza.rahimova', 'ustoz123');
  const student = await login('bekzod.rahimov', 'oquvchi123');
  check('three roles can sign in', !!admin && !!teacher && !!student);
  check('role comes from the account', (await call('GET', '/me', student)).body.role === 'STUDENT' && (await call('GET', '/me', teacher)).body.role === 'TEACHER' && (await call('GET', '/me', admin)).body.role === 'ADMIN');
  check('student on /admin -> 403', (await call('GET', '/admin/students', student)).status === 403);
  check('student on /teacher -> 403', (await call('GET', '/teacher/groups', student)).status === 403);
  check('teacher on /student -> 403', (await call('GET', '/student/dashboard', teacher)).status === 403);
  check('teacher on /admin -> 403', (await call('GET', '/admin/groups', teacher)).status === 403);
  check('admin on /teacher -> 403', (await call('GET', '/teacher/groups', admin)).status === 403);
  const err = await call('GET', '/admin/students', student);
  check('error shape { error: { code, message } }', typeof err.body?.error?.code === 'string' && typeof err.body?.error?.message === 'string', err.body);

  console.log('2. student panel');
  const dash = (await call('GET', '/student/dashboard', student)).body;
  check('dashboard has xp, level, 2 group ranks', typeof dash.xp === 'number' && dash.xp > 0 && dash.level >= 1 && dash.groupRanks.length === 2, dash);
  const groups = (await call('GET', '/student/groups', student)).body;
  check('student has 2 groups with schedule', groups.length === 2 && groups.every((g: any) => g.schedule.length > 0), groups.length);
  const gr1 = groups.find((g: any) => g.name === 'Fullstack dasturlash');
  const lessons = (await call('GET', `/student/groups/${gr1.id}/lessons`, student)).body;
  check('lessons list with stats and exams', lessons.lessons.length >= 11 && lessons.exams.length >= 1 && typeof lessons.stats.progress === 'number', lessons.stats);
  const gr3 = (await call('GET', '/teacher/groups', teacher)).body.find((g: any) => g.name === 'Backend asoslari');
  check('student cannot read a group they are not in', (await call('GET', `/student/groups/${gr3.id}/lessons`, student)).status === 403);
  const open = lessons.lessons.find((l: any) => l.homework.status === 'not-done' || l.homework.status === 'returned');
  const lesson = (await call('GET', `/student/lessons/${lessons.lessons[0].id}`, student)).body;
  check('lesson detail has video, reward, homework, other lessons', lesson.lesson && lesson.homework && lesson.otherLessons.length > 5, Object.keys(lesson));
  const prog1 = (await call('PUT', `/student/lessons/${lessons.lessons[0].id}/progress`, student, { percent: 100 })).body;
  const prog2 = (await call('PUT', `/student/lessons/${lessons.lessons[0].id}/progress`, student, { percent: 10 })).body;
  check('progress only goes up', prog1.progress === 100 && prog2.progress === 100, [prog1, prog2]);
  const board = (await call('GET', `/student/groups/${gr1.id}/leaderboard`, student)).body;
  check('leaderboard sorted, has me', board.length === 10 && board.some((e: any) => e.isMe) && board.every((e: any, i: number) => i === 0 || board[i - 1].xp >= e.xp));
  const pays = (await call('GET', '/student/payments', student)).body;
  check('payments: history + 2 upcoming', pays.items.length > 0 && pays.upcoming.length === 2 && pays.total > 0, pays.upcoming);
  check('analytics and calendar respond', (await call('GET', '/student/analytics', student)).status === 200 && (await call('GET', '/student/calendar', student)).status === 200);
  check('content endpoints', (await call('GET', '/career-videos', student)).body.length > 0 && (await call('GET', '/faqs', student)).body.length > 0 && (await call('GET', '/guides', student)).body.length > 0);

  console.log('3. files and homework submission');
  const form = new FormData();
  form.append('file', new Blob(['salom'], { type: 'text/plain' }), 'javob.txt');
  const up = await fetch(`${API}/files?purpose=answer`, { method: 'POST', headers: { Authorization: `Bearer ${student}` }, body: form });
  const upBody: any = await up.json();
  check('upload .txt as answer', up.status === 201 && upBody.name === 'javob.txt', upBody);
  const bad1 = new FormData();
  bad1.append('file', new Blob(['x']), 'virus.exe');
  const upBad = await fetch(`${API}/files?purpose=answer`, { method: 'POST', headers: { Authorization: `Bearer ${student}` }, body: bad1 });
  check('upload .exe rejected (415)', upBad.status === 415, upBad.status);
  const bad2 = new FormData();
  bad2.append('file', new Blob(['x']), 'papka');
  check('folder-like file rejected', (await fetch(`${API}/files?purpose=answer`, { method: 'POST', headers: { Authorization: `Bearer ${student}` }, body: bad2 })).status === 415);
  let target = open;
  check('there is homework to hand in', !!target);
  if (target) {
    check('empty answer -> 422', (await call('POST', `/student/lessons/${target.id}/homework`, student, { text: '' })).status === 422);
    check('too many files -> 422', (await call('POST', `/student/lessons/${target.id}/homework`, student, { text: 'a', fileIds: [1, 2, 3, 4] })).status === 422);
    const sub = await call('POST', `/student/lessons/${target.id}/homework`, student, { text: 'Bajardim', fileIds: [upBody.id] });
    check('submit homework', sub.status === 201 && sub.body.files.length === 1, sub.body);
    check('second submit -> 409', (await call('POST', `/student/lessons/${target.id}/homework`, student, { text: 'yana' })).status === 409);
    const after = (await call('GET', `/student/lessons/${target.id}`, student)).body;
    check('status is now pending', after.homework.status === 'pending' && after.homework.submission.text === 'Bajardim', after.homework);
    check('student can open own file', (await fetch(`${API}/files/${upBody.id}`, { headers: { Authorization: `Bearer ${student}` } })).status === 200);
    check('a file opens with ?token= (for <video>/<img>), but other routes do not accept it', (await fetch(`${API}/files/${upBody.id}?token=${student}`)).status === 200 && (await fetch(`${API}/student/dashboard?token=${student}`)).status === 401 && (await fetch(`${API}/files/${upBody.id}?token=nonsense`)).status === 401);
    check('teacher can open it too', (await fetch(`${API}/files/${upBody.id}`, { headers: { Authorization: `Bearer ${teacher}` } })).status === 200);
  }

  console.log('4. teacher panel');
  const tg = (await call('GET', '/teacher/groups', teacher)).body;
  check('teacher has 2 groups', tg.length === 2, tg.length);
  const tgr1 = tg.find((g: any) => g.name === 'Fullstack dasturlash');
  const gr2 = groups.find((g: any) => g.name === 'UI/UX dizayn');
  check("teacher cannot touch another teacher's group", (await call('GET', `/teacher/groups/${gr2.id}/students`, teacher)).status === 403);
  check('group students stats', (await call('GET', `/teacher/groups/${tgr1.id}/students`, teacher)).body.length === 10);
  const tl = (await call('GET', `/teacher/groups/${tgr1.id}/lessons`, teacher)).body;
  check('teacher lessons + exams + sinceLastExam', tl.lessons.length >= 11 && tl.exams.length >= 1 && typeof tl.sinceLastExam === 'number');
  const started = await call('POST', '/teacher/lessons', teacher, { groupId: tgr1.id, title: 'Sinov darsi' });
  check('start a lesson', started.status === 201 && started.body.isExam === false, started.body);
  const L = started.body.id;
  check('short lesson name -> 422', (await call('POST', '/teacher/lessons', teacher, { groupId: tgr1.id, title: 'ab' })).status === 422);
  check('lesson info: link and file at once -> 422', (await call('PUT', `/teacher/lessons/${L}/info`, teacher, { videoUrl: 'https://example.com/v', videoFileId: 1, durationMin: 45 })).status === 422);
  check('lesson info saved', (await call('PUT', `/teacher/lessons/${L}/info`, teacher, { description: 'Bu dars sinov uchun yaratildi.', videoUrl: 'https://example.com/v', durationMin: 50 })).status === 200);
  check('homework: bad limit -> 422', (await call('PUT', `/teacher/lessons/${L}/homework`, teacher, { task: 'Uzoq vazifa matni bu', steps: ['bir'], limitHours: 5 })).status === 422);
  const as = await call('PUT', `/teacher/lessons/${L}/homework`, teacher, { task: 'Sinov uchun uyga vazifa matni.', steps: ['Birinchi qadam', 'Ikkinchi qadam'], limitHours: 24 });
  check('assign homework', as.status === 200 && as.body.steps.length === 2, as.body);
  const seen = (await call('GET', `/student/lessons/${L}`, student)).body;
  check('student sees the new lesson and homework (not-done)', seen.homework.status === 'not-done' && seen.lesson.title === 'Sinov darsi', seen.homework);
  const notif = (await call('GET', '/notifications', student)).body;
  check('student got new lesson notification', notif.some((n: any) => n.type === 'new_lesson'));
  const detail = (await call('GET', `/teacher/lessons/${L}`, teacher)).body;
  check('teacher lesson page: 10 students', detail.students.length === 10 && detail.homework.task, detail.students.length);
  const meId = (await call('GET', '/me', student)).body.id;
  // attendance
  check('mark attendance', (await call('PUT', `/teacher/lessons/${L}/attendance/${meId}`, teacher, { present: true })).status === 204);
  check('mark all', (await call('POST', `/teacher/lessons/${L}/attendance/mark-all`, teacher)).status === 204);
  check('save attendance', (await call('POST', `/teacher/lessons/${L}/attendance/save`, teacher)).status === 204);
  check('marking after saving -> 409', (await call('PUT', `/teacher/lessons/${L}/attendance/${meId}`, teacher, { present: false })).status === 409);
  check('journal shows the lock', (await call('GET', `/teacher/groups/${tgr1.id}/journal`, teacher)).body.columns.some((c: any) => c.lessonId === L && c.attendanceSaved));
  check('reopen attendance', (await call('POST', `/teacher/lessons/${L}/attendance/reopen`, teacher)).status === 204);
  check('mark works again', (await call('PUT', `/teacher/lessons/${L}/attendance/${meId}`, teacher, { present: false })).status === 204);
  // grading
  check('student hands in the new homework', (await call('POST', `/student/lessons/${L}/homework`, student, { text: 'Tayyor' })).status === 201);
  const rv = (await call('GET', `/teacher/lessons/${L}/students/${meId}/submission`, teacher)).body;
  check('teacher sees the submission', rv.status === 'pending' && rv.submission.text === 'Tayyor', rv);
  check('ball 0 -> 422', (await call('POST', `/teacher/lessons/${L}/students/${meId}/grade`, teacher, { ball: 0 })).status === 422);
  check('ball 101 -> 422', (await call('POST', `/teacher/lessons/${L}/students/${meId}/grade`, teacher, { ball: 101 })).status === 422);
  const xp0 = (await call('GET', '/student/dashboard', student)).body.xp;
  check('return needs a comment', (await call('POST', `/teacher/lessons/${L}/students/${meId}/return`, teacher, { feedback: '' })).status === 422);
  check('return with comment', (await call('POST', `/teacher/lessons/${L}/students/${meId}/return`, teacher, { feedback: 'Xatolarni tuzating' })).status === 204);
  const ret = (await call('GET', `/student/lessons/${L}`, student)).body.homework;
  check('student sees returned + comment', ret.status === 'returned' && ret.feedback === 'Xatolarni tuzating', ret);
  check('student resubmits', (await call('POST', `/student/lessons/${L}/homework`, student, { text: 'Tuzatdim' })).status === 201);
  check('grade 90', (await call('POST', `/teacher/lessons/${L}/students/${meId}/grade`, teacher, { ball: 90 })).status === 204);
  const done = (await call('GET', `/student/lessons/${L}`, student)).body;
  check('status done, ball 90, xp +90', done.homework.status === 'done' && done.reward.ball === 90 && done.reward.ballXp === 90, done.reward);
  const xp1 = (await call('GET', '/student/dashboard', student)).body.xp;
  check('dashboard xp grew by ball xp (attendance not marked)', xp1 > xp0, [xp0, xp1]);
  // exam
  const exam = await call('POST', '/teacher/lessons', teacher, { groupId: tgr1.id, title: 'Sinov imtihoni', isExam: true });
  check('start an exam lesson', exam.status === 201 && exam.body.isExam === true, exam.body);
  const ed = (await call('GET', `/teacher/exams/${exam.body.id}`, teacher)).body;
  check('exam detail has states', ed.students.length === 10 && ed.exam.coveredLessons.length > 5, ed.exam);
  const ready = ed.students.find((s: any) => s.state === 'ready');
  const blocked = ed.students.find((s: any) => s.state === 'blocked');
  if (blocked) check('blocked student cannot get a ball (409)', (await call('PUT', `/teacher/exams/${exam.body.id}/students/${blocked.studentId}`, teacher, { ball: 70 })).status === 409);
  else console.log('  (no blocked student in the seed: skipped)');
  if (ready) {
    check('ball 0 -> 422', (await call('PUT', `/teacher/exams/${exam.body.id}/students/${ready.studentId}`, teacher, { ball: 0 })).status === 422);
    check('admitted student gets a ball', (await call('PUT', `/teacher/exams/${exam.body.id}/students/${ready.studentId}`, teacher, { ball: 88 })).status === 204);
    const ed2 = (await call('GET', `/teacher/exams/${exam.body.id}`, teacher)).body;
    check('state is done with 88', ed2.students.find((s: any) => s.studentId === ready.studentId).ball === 88);
  }
  check('review queue is a list', Array.isArray((await call('GET', '/teacher/review', teacher)).body));
  check('teacher dashboard', (await call('GET', '/teacher/dashboard', teacher)).body.groups.length === 2);

  console.log('5. admin panel');
  const dd = (await call('GET', '/admin/dashboard', admin)).body;
  check('admin dashboard counts', dd.studentsCount >= 25 && dd.teachersCount === 3 && dd.groupsCount === 3, dd);
  check('bad phone -> 422', (await call('POST', '/admin/students', admin, { fullName: 'Aziza Karimova', phone: '123', login: 'aziza.k', password: 'yangi1234' })).status === 422);
  check('one-word name -> 422', (await call('POST', '/admin/students', admin, { fullName: 'Aziza', phone: '+998 90 123 45 67', login: 'aziza.k', password: 'yangi1234' })).status === 422);
  check('short password -> 422', (await call('POST', '/admin/students', admin, { fullName: 'Aziza Karimova', phone: '+998 90 123 45 67', login: 'aziza.k', password: '123' })).status === 422);
  const ns = await call('POST', '/admin/students', admin, { fullName: 'Aziza Karimova', phone: '+998901234567', login: 'aziza.k', password: 'yangi1234', groupIds: [gr1.id] });
  check('create student into group', ns.status === 201 && ns.body.groups.length === 1 && ns.body.phone === '+998 90 123 45 67', ns.body);
  check('duplicate login -> 422', (await call('POST', '/admin/students', admin, { fullName: 'Boshqa Odam', phone: '+998 90 123 45 68', login: 'AZIZA.K', password: 'yangi1234' })).status === 422);
  const newStudent = await login('aziza.k', 'yangi1234');
  check('new student can sign in', !!newStudent && (await call('GET', '/student/groups', newStudent)).body.length === 1);
  const sees = (await call('GET', `/student/groups/${gr1.id}/lessons`, newStudent)).body;
  check('new student gets the homework already given in the group', sees.lessons.some((l: any) => l.homework.status === 'not-done'), sees.lessons.map((l: any) => l.homework.status));
  check('teacher sees the new student', (await call('GET', `/teacher/groups/${tgr1.id}/students`, teacher)).body.length === 11);
  check('enrol twice -> 409', (await call('POST', `/admin/students/${ns.body.id}/enrol`, admin, { groupId: gr1.id })).status === 409);
  check('enrol into another group', (await call('POST', `/admin/students/${ns.body.id}/enrol`, admin, { groupId: gr2.id })).status === 204);
  // accounts
  check('admin sets a new password', (await call('PUT', `/admin/students/${ns.body.id}/account`, admin, { password: 'boshqa5678' })).status === 204);
  check('the student\'s old session token died with the password change (401)', (await call('GET', '/me', newStudent)).status === 401);
  check('old password stops working', (await call('POST', '/auth/login', undefined, { login: 'aziza.k', password: 'yangi1234' })).status === 401);
  check('new password works', !!(await login('aziza.k', 'boshqa5678')));
  check('admin changes login', (await call('PUT', `/admin/students/${ns.body.id}/account`, admin, { login: 'aziza.karimova' })).status === 204);
  const newStudent2 = await login('aziza.karimova', 'boshqa5678');
  check('new login works', !!newStudent2);
  check('login taken -> 422', (await call('PUT', `/admin/students/${ns.body.id}/account`, admin, { login: 'bekzod.rahimov' })).status === 422);
  const nt = await call('POST', '/admin/teachers', admin, { fullName: 'Bobur Aliyev', phone: '+998 91 000 11 22', login: 'bobur.aliyev', password: 'ustoz5678' });
  check('create teacher', nt.status === 201, nt.body);
  const ntTok = await login('bobur.aliyev', 'ustoz5678');
  check('new teacher sees the teacher panel (no groups yet)', (await call('GET', '/teacher/groups', ntTok)).body.length === 0);
  check('teacher account change', (await call('PUT', `/admin/teachers/${nt.body.id}/account`, admin, { password: 'yangiustoz9' })).status === 204);
  check('student account route refuses a teacher id', (await call('PUT', `/admin/students/${nt.body.id}/account`, admin, { password: 'yangiustoz9' })).status === 422);
  // own password
  check('own password: wrong current -> 422', (await call('POST', '/me/password', student, { current: 'xato', next: 'Yangi2345a' })).status === 422);
  check('own password changed', (await call('POST', '/me/password', student, { current: 'oquvchi123', next: 'Yangi2345a' })).status === 204);
  check('student signs in with the new password', !!(await login('bekzod.rahimov', 'Yangi2345a')));
  // rooms
  const rooms = (await call('GET', '/admin/rooms', admin)).body;
  check('4 seeded rooms', rooms.length === 4);
  const newRoom = await call('POST', '/admin/rooms', admin, { name: 'D xona', capacity: 8 });
  check('add room', newRoom.status === 201 && newRoom.body.capacity === 8, newRoom.body);
  check('duplicate room name (case-insensitive) -> 422', (await call('POST', '/admin/rooms', admin, { name: 'd XONA', capacity: 8 })).status === 422);
  check('capacity 0 -> 422', (await call('POST', '/admin/rooms', admin, { name: 'E xona', capacity: 0 })).status === 422);
  const aRoom = rooms.find((r: any) => r.name === 'A xona');
  check('rename room', (await call('PUT', `/admin/rooms/${aRoom.id}`, admin, { name: 'Katta zal', capacity: 12 })).body.name === 'Katta zal');
  const tt = (await call('GET', '/admin/rooms/timetable?day=MON', admin)).body;
  const aRow = tt.rooms.find((r: any) => r.id === aRoom.id);
  check('timetable: renamed room shows Fullstack on Monday 18:00', aRow.name === 'Katta zal' && aRow.cells['18:00']?.groupName === 'Fullstack dasturlash' && aRow.cells['08:00'] === null, aRow);
  const free = (await call('GET', '/admin/rooms/free?days=MON,WED&start=18:00', admin)).body;
  check('free rooms exclude the busy one', !free.includes(aRoom.id) && free.length === 4, free);
  const g = { name: 'Python asoslari', course: 'Python va Django', teacherId: nt.body.id, days: ['MON'], start: '18:00', roomId: aRoom.id, amount: 500000, dueDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) };
  check('busy room -> 409', (await call('POST', '/admin/groups', admin, g)).status === 409);
  const t1Id = (await call('GET', '/me', teacher)).body.id;
  check('teacher clash -> 409', (await call('POST', '/admin/groups', admin, { ...g, teacherId: t1Id, roomId: newRoom.body.id })).status === 409);
  check('past due date -> 422', (await call('POST', '/admin/groups', admin, { ...g, roomId: newRoom.body.id, dueDate: '2020-01-01' })).status === 422);
  check('bad slot -> 422', (await call('POST', '/admin/groups', admin, { ...g, roomId: newRoom.body.id, start: '17:30' })).status === 422);
  const ng = await call('POST', '/admin/groups', admin, { ...g, roomId: newRoom.body.id });
  check('open a group in a free room', ng.status === 201 && ng.body.capacity === 8 && ng.body.schedule[0].end === '20:00', ng.body);
  check('room is now busy in the timetable', (await call('GET', '/admin/rooms/timetable?day=MON', admin)).body.rooms.find((r: any) => r.id === newRoom.body.id).cells['18:00'].groupName === 'Python asoslari');
  check('new teacher now teaches the group', (await call('GET', '/teacher/groups', await login('bobur.aliyev', 'yangiustoz9'))).body.length === 1);
  // payments
  const po = (await call('GET', '/admin/payments', admin)).body;
  check('payments overview', po.groups.length === 4, po.groups.length);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  check('empty group cannot be notified -> 422', (await call('PUT', `/admin/groups/${ng.body.id}/payment-plan`, admin, { amount: 300000, dueDate: future })).status === 422);
  check('amount below minimum -> 422', (await call('PUT', `/admin/groups/${gr1.id}/payment-plan`, admin, { amount: 500, dueDate: future })).status === 422);
  check('past date -> 422', (await call('PUT', `/admin/groups/${gr1.id}/payment-plan`, admin, { amount: 500000, dueDate: '2020-01-01' })).status === 422);
  const before = (await call('GET', '/notifications', newStudent2)).body.length;
  const pub = await call('PUT', `/admin/groups/${gr1.id}/payment-plan`, admin, { amount: 520000, dueDate: future });
  check('plan saved, notice sent to every student of the group (11)', pub.status === 200 && pub.body.notice.recipients === 11, pub.body);
  const n2 = (await call('GET', '/notifications', newStudent2)).body;
  check('student got the payment notice', n2.length === before + 1 && n2[0].type === 'payment_notice' && n2[0].title.includes('520 000'), n2[0]);
  check('student sees the new plan in upcoming payments', (await call('GET', '/student/payments', student)).body.upcoming.some((u: any) => u.amount === 520000));
  check('a student of ANOTHER group did not get it', !(await call('GET', '/notifications', await login('zilola.hasanova', 'oquvchi123'))).body.some((n: any) => n.type === 'payment_notice'));
  check('notice shows in history', (await call('GET', '/admin/payments', admin)).body.notices[0].recipients === 11);
  check('the old record-payment route is gone (use invoices)', (await call('POST', '/admin/payments', admin, { studentId: meId, groupId: gr1.id, amount: 500000 })).status === 404);
  check('notifications can be marked read', (await call('POST', '/notifications/read-all', student)).status === 204 && (await call('GET', '/notifications', student)).body.every((n: any) => n.readAt));
  check('settings read/write', (await call('PUT', '/me/settings', student, { theme: 'light' })).body.theme === 'light');
  check('invalid theme -> 422', (await call('PUT', '/me/settings', student, { theme: 'pink' })).status === 422);
  check('unknown field -> 422 (whitelist)', (await call('PUT', '/me/settings', student, { admin: true })).status === 422);


  console.log('6. sessions (no JWT: random tokens stored as hashes)');
  const tokenA = await login('zilola.hasanova', 'oquvchi123');
  const tokenB = await login('zilola.hasanova', 'oquvchi123');
  check('two logins give two different tokens', !!tokenA && !!tokenB && tokenA !== tokenB && tokenA.length === 64);
  check('both work', (await call('GET', '/me', tokenA)).status === 200 && (await call('GET', '/me', tokenB)).status === 200);
  check('a made-up token -> 401', (await call('GET', '/me', 'a'.repeat(64))).status === 401);
  check('a JWT-looking token -> 401', (await call('GET', '/me', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.x')).status === 401);
  const refreshed = await call('POST', '/auth/refresh', tokenA);
  check('refresh gives a new token', refreshed.status === 200 && refreshed.body.token && refreshed.body.token !== tokenA, refreshed.body);
  check('the old token stops working after refresh', (await call('GET', '/me', tokenA)).status === 401);
  check('the new token works', (await call('GET', '/me', refreshed.body.token)).status === 200);
  check('logout -> 204', (await call('POST', '/auth/logout', refreshed.body.token)).status === 204);
  check('after logout the token is dead at once (401)', (await call('GET', '/me', refreshed.body.token)).status === 401);
  check('the other session is not affected by that logout', (await call('GET', '/me', tokenB)).status === 200);
  const tokenC = await login('zilola.hasanova', 'oquvchi123');
  check('own password change keeps this session...', (await call('POST', '/me/password', tokenB, { current: 'oquvchi123', next: 'Boshqa2345a' })).status === 204 && (await call('GET', '/me', tokenB)).status === 200);
  check('...and signs the other devices out', (await call('GET', '/me', tokenC)).status === 401);
  const tokenD = await login('zilola.hasanova', 'Boshqa2345a');
  const zid = (await call('GET', '/me', tokenD)).body.id;
  check('admin resets the password', (await call('PUT', `/admin/students/${zid}/account`, admin, { password: 'Yangi99887a' })).status === 204);
  check('every session of that student is gone (401)', (await call('GET', '/me', tokenB)).status === 401 && (await call('GET', '/me', tokenD)).status === 401);


  console.log('7. admin: full management (edit and delete rooms, groups, teachers, students; more admins)');
  check('student cannot delete a room (403)', (await call('DELETE', `/admin/rooms/${newRoom.body.id}`, student)).status === 403);
  const eRoom = await call('POST', '/admin/rooms', admin, { name: 'E xona', capacity: 6 });
  check('delete an unused room', (await call('DELETE', `/admin/rooms/${eRoom.body.id}`, admin)).status === 204);
  check('deleting it again -> 404', (await call('DELETE', `/admin/rooms/${eRoom.body.id}`, admin)).status === 404);
  const busyRoom = await call('DELETE', `/admin/rooms/${newRoom.body.id}`, admin);
  check('a room used by an active group cannot be deleted (409)', busyRoom.status === 409 && String(busyRoom.body.error.message).includes('Python'), busyRoom.body);
  // groups: edit
  const edited = await call('PUT', `/admin/groups/${ng.body.id}`, admin, { name: 'Python (yangilandi)', course: 'Python 3' });
  check('edit group name and course', edited.status === 200 && edited.body.name === 'Python (yangilandi)' && edited.body.course === 'Python 3', edited.body);
  check('partial schedule (days only) -> 422', (await call('PUT', `/admin/groups/${ng.body.id}`, admin, { days: ['TUE'] })).status === 422);
  check('move to a busy room slot -> 409', (await call('PUT', `/admin/groups/${ng.body.id}`, admin, { days: ['MON'], start: '18:00', roomId: aRoom.id })).status === 409);
  const moved = await call('PUT', `/admin/groups/${ng.body.id}`, admin, { days: ['TUE', 'THU'], start: '10:00', roomId: newRoom.body.id });
  check('move the group to a free slot', moved.status === 200 && moved.body.schedule.length === 2 && moved.body.schedule[0].start === '10:00', moved.body);
  check('its old slot is free again', (await call('GET', '/admin/rooms/timetable?day=MON', admin)).body.rooms.find((r: any) => r.id === newRoom.body.id).cells['18:00'] === null);
  // teachers: edit and remove
  check('edit teacher name', (await call('PUT', `/admin/teachers/${nt.body.id}`, admin, { fullName: 'Bobur Aliyevich' })).status === 204);
  check('bad phone on edit -> 422', (await call('PUT', `/admin/teachers/${nt.body.id}`, admin, { phone: '123' })).status === 422);
  check('the name changed in the list', (await call('GET', '/admin/teachers', admin)).body.some((t: any) => t.id === nt.body.id && t.fullName === 'Bobur Aliyevich'));
  const tBusy = await call('DELETE', `/admin/teachers/${nt.body.id}`, admin);
  check('a teacher with a group cannot be removed (409)', tBusy.status === 409 && String(tBusy.body.error.message).includes('Python'), tBusy.body);
  check('teacher clash when changing the group teacher -> 409', (await call('PUT', `/admin/groups/${ng.body.id}`, admin, { teacherId: t1Id, days: ['TUE'], start: '18:00', roomId: newRoom.body.id })).status === 409);
  check('hand the group to another teacher', (await call('PUT', `/admin/groups/${ng.body.id}`, admin, { teacherId: t1Id })).body.teacher.id === t1Id);
  check('now the teacher can be removed', (await call('DELETE', `/admin/teachers/${nt.body.id}`, admin)).status === 204);
  check('the removed teacher cannot sign in', (await call('POST', '/auth/login', undefined, { login: 'bobur.aliyev', password: 'yangiustoz9' })).status === 401);
  check('and is gone from the list', !(await call('GET', '/admin/teachers', admin)).body.some((t: any) => t.id === nt.body.id));
  // groups: delete (empty) and archive (with lessons)
  const empty = await call('POST', '/admin/groups', admin, { name: 'Bo\'sh guruh', course: 'Sinov kursi', teacherId: t1Id, days: ['FRI'], start: '08:00', roomId: newRoom.body.id, amount: 100000, dueDate: g.dueDate });
  check('delete a group that never had lessons -> deleted', (await call('DELETE', `/admin/groups/${empty.body.id}`, admin)).body.result === 'deleted');
  const withLessons = await call('POST', '/admin/groups', admin, { name: 'Arxivlanadigan', course: 'Sinov kursi', teacherId: t1Id, days: ['FRI'], start: '12:00', roomId: newRoom.body.id, amount: 100000, dueDate: g.dueDate });
  check('teacher starts a lesson in it', (await call('POST', '/teacher/lessons', teacher, { groupId: withLessons.body.id, title: 'Arxiv uchun dars' })).status === 201);
  const delWith = await call('DELETE', `/admin/groups/${withLessons.body.id}`, admin);
  check('delete a group that has lessons -> deleted for good with its lessons', delWith.body.result === 'deleted' && delWith.body.removed.lessons === 1, delWith.body);
  check('deleted group is gone from the admin list', !(await call('GET', '/admin/groups', admin)).body.some((x: any) => x.id === withLessons.body.id));
  check('deleted group is gone for its teacher (404)', (await call('GET', `/teacher/groups/${withLessons.body.id}/lessons`, teacher)).status === 404);
  const again = await call('POST', '/admin/groups', admin, { name: 'Yangi', course: 'Sinov kursi', teacherId: t1Id, days: ['FRI'], start: '12:00', roomId: newRoom.body.id, amount: 100000, dueDate: g.dueDate });
  check('its room slot was freed (a new group fits)', again.status === 201, again.body);
  await call('DELETE', `/admin/groups/${again.body.id}`, admin);
  // students: edit, leave a group, remove
  check('edit student name', (await call('PUT', `/admin/students/${ns.body.id}`, admin, { fullName: 'Aziza Karimova Rustamovna' })).status === 204);
  check('take the student out of a group', (await call('DELETE', `/admin/students/${ns.body.id}/groups/${gr2.id}`, admin)).status === 204);
  check('...twice -> 404', (await call('DELETE', `/admin/students/${ns.body.id}/groups/${gr2.id}`, admin)).status === 404);
  const before11 = (await call('GET', `/teacher/groups/${tgr1.id}/students`, teacher)).body.length;
  check('remove the student', (await call('DELETE', `/admin/students/${ns.body.id}`, admin)).status === 204);
  check('the removed student cannot sign in', (await call('POST', '/auth/login', undefined, { login: 'aziza.karimova', password: 'boshqa5678' })).status === 401);
  check('their seat in the group is free', (await call('GET', `/teacher/groups/${tgr1.id}/students`, teacher)).body.length === before11 - 1, before11);
  check('and they are gone from the students list', !(await call('GET', '/admin/students', admin)).body.some((x: any) => x.id === ns.body.id));
  // administrators
  const admin2 = await call('POST', '/admin/admins', admin, { fullName: 'Ikkinchi Admin', phone: '+998 90 555 66 77', login: 'admin.ikki', password: 'Admin2Pass99' });
  check('add a new administrator', admin2.status === 201 && admin2.body.login === 'admin.ikki', admin2.body);
  check('duplicate admin login -> 422', (await call('POST', '/admin/admins', admin, { fullName: 'Uchinchi Admin', login: 'ADMIN.IKKI', password: 'Admin2Pass99' })).status === 422);
  const a2 = await login('admin.ikki', 'Admin2Pass99');
  check('the new administrator signs in and manages', !!a2 && (await call('GET', '/admin/dashboard', a2)).status === 200 && (await call('GET', '/me', a2)).body.role === 'ADMIN');
  check('both administrators are listed', (await call('GET', '/admin/admins', admin)).body.length >= 2);
  const adminId = (await call('GET', '/me', admin)).body.id;
  check('an administrator cannot delete themselves (409)', (await call('DELETE', `/admin/admins/${adminId}`, admin)).status === 409);
  check('edit the new administrator', (await call('PUT', `/admin/admins/${admin2.body.id}`, admin, { fullName: 'Ikkinchi Admin Aliyev' })).status === 204);
  check('change their password: their session ends', (await call('PUT', `/admin/admins/${admin2.body.id}/account`, admin, { password: 'Admin3Pass00' })).status === 204 && (await call('GET', '/me', a2)).status === 401);
  const a2b = await login('admin.ikki', 'Admin3Pass00');
  check('a teacher cannot manage administrators (403)', (await call('POST', '/admin/admins', teacher, { fullName: 'Yomon Odam', login: 'yomon.odam', password: 'Admin2Pass99' })).status === 403);
  check('remove the new administrator', (await call('DELETE', `/admin/admins/${admin2.body.id}`, admin)).status === 204);
  check('their token is dead and they cannot sign in', (await call('GET', '/me', a2b)).status === 401 && (await call('POST', '/auth/login', undefined, { login: 'admin.ikki', password: 'Admin3Pass00' })).status === 401);


  console.log('8. payments & sales reports + detail pages');
  const rep = (q = '') => call('GET', `/admin/reports/payments${q}`, admin);
  const allRows = async (q = '') => {
    const out: any[] = [];
    for (let page = 1; ; page++) {
      const r = (await rep(`?${q}&limit=100&page=${page}`)).body;
      out.push(...r.rows);
      if (page >= r.totalPages) return { rows: out, report: r };
    }
  };
  check('report: no token -> 401', (await call('GET', '/admin/reports/payments')).status === 401);
  check('report: student -> 403', (await call('GET', '/admin/reports/payments', student)).status === 403);
  check('report: teacher -> 403', (await call('GET', '/admin/reports/payments', teacher)).status === 403);
  check('export: teacher -> 403', (await call('GET', '/admin/reports/payments/export', teacher)).status === 403);
  const { rows: all, report: r0 } = await allRows();
  const sum = (k: string, rows = all) => rows.reduce((t, r) => t + r[k], 0);
  check('real data: many sales in the DB', all.length > 50 && r0.totalRows === all.length, all.length);
  check('rows have client, date, total, paid, debt, status', all.every((r: any) => r.studentName && /^\d{4}-\d{2}-\d{2}$/.test(r.issuedAt) && r.total > 0 && r.paid >= 0 && r.debt >= 0 && ['PAID', 'UNPAID', 'PARTIALLY_PAID'].includes(r.status)));
  check('per row: total = paid + debt (debt never negative, never counted twice)', all.every((r: any) => r.total === r.paid + r.debt));
  check('status matches the money', all.every((r: any) => (r.status === 'PAID') === (r.debt === 0) && (r.status === 'UNPAID') === (r.paid === 0) && (r.status === 'PARTIALLY_PAID') === (r.paid > 0 && r.debt > 0)));
  check('all three statuses exist', ['PAID', 'UNPAID', 'PARTIALLY_PAID'].every((x) => all.some((r: any) => r.status === x)));
  const S = r0.summary;
  check('summary: totalSales = sum of totals', S.totalSales === sum('total'), S);
  check('summary: paid = sum of paid; debt = sum of debt', S.paid === sum('paid') && S.debt === sum('debt'));
  check('summary: totalSales = paid + debt', S.totalSales === S.paid + S.debt);
  const part = all.filter((r: any) => r.status === 'PARTIALLY_PAID'), unp = all.filter((r: any) => r.status === 'UNPAID'), full = all.filter((r: any) => r.status === 'PAID');
  check('summary: partial paid part + remaining debt', S.partialPaid === sum('paid', part) && S.partialRemaining === sum('debt', part));
  check('summary: unpaid amount', S.unpaidAmount === sum('total', unp));
  check('summary: paid = fully paid + paid part of partial', S.paid === sum('paid', full) + S.partialPaid);
  check('summary: debt = unpaid + rest of partial', S.debt === S.unpaidAmount + S.partialRemaining);
  check('summary: percent', Math.abs(S.paymentPercent - Math.round((S.paid / S.totalSales) * 1000) / 10) < 0.001, S.paymentPercent);
  check('summary: counts', S.counts.PAID === full.length && S.counts.UNPAID === unp.length && S.counts.PARTIALLY_PAID === part.length);
  check('no date filter -> no comparison', r0.comparison === null && r0.series === null);
  // paging
  const p1 = (await rep('?limit=10&page=1')).body, p2 = (await rep('?limit=10&page=2')).body;
  check('paging: 10 rows per page, pages differ, totals stay', p1.rows.length === 10 && p2.rows.length === 10 && p1.rows[0].id !== p2.rows[0].id && p1.summary.totalSales === S.totalSales && p1.totalPages === Math.ceil(all.length / 10));
  check('newest sale first', all.every((r: any, i: number) => i === 0 || all[i - 1].issuedAt >= r.issuedAt));
  // filters
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const range = await allRows(`from=${daysAgo(40)}&to=${today}`);
  check('date range: only sales inside it', range.rows.length > 0 && range.rows.length < all.length && range.rows.every((r: any) => r.issuedAt >= daysAgo(40) && r.issuedAt <= today));
  check('date range: equals the same filter done by hand', range.rows.length === all.filter((r: any) => r.issuedAt >= daysAgo(40) && r.issuedAt <= today).length);
  check('date range: summary follows the filter', range.report.summary.totalSales === sum('total', range.rows));
  const day1 = (await rep(`?from=${all[0].issuedAt}&to=${all[0].issuedAt}`)).body;
  check('single day filter', day1.totalRows > 0 && day1.rows.every((r: any) => r.issuedAt === all[0].issuedAt));
  check('from without to -> 422', (await rep(`?from=${today}`)).status === 422);
  check('from after to -> 422', (await rep(`?from=${today}&to=${daysAgo(5)}`)).status === 422);
  check('bad date -> 422', (await rep('?from=2026-13-45&to=2026-14-01')).status === 422);
  check('bad status -> 422', (await rep('?status=NOPE')).status === 422);
  const st = (await allRows('status=PARTIALLY_PAID')).rows;
  check('status filter', st.length === part.length && st.every((r: any) => r.status === 'PARTIALLY_PAID'));
  const who = all[3].studentName.split(' ')[0].toUpperCase();
  const q1 = (await allRows(`q=${encodeURIComponent(who)}`)).rows;
  check('client name search (case-insensitive)', q1.length > 0 && q1.every((r: any) => r.studentName.toUpperCase().includes(who)) && q1.length === all.filter((r: any) => r.studentName.toUpperCase().includes(who)).length);
  const both = (await allRows(`q=${encodeURIComponent(who)}&status=UNPAID`)).rows;
  check('search + status together', both.every((r: any) => r.status === 'UNPAID' && r.studentName.toUpperCase().includes(who)));
  check('search with no match -> emptyRep, zero totals', (await rep('?q=zzzzzz')).body.summary.totalSales === 0 && (await rep('?q=zzzzzz')).body.rows.length === 0);
  const groupsList = (await call('GET', '/admin/groups', admin)).body;
  const byGroup = (await allRows(`groupId=${groupsList[0].id}`)).rows;
  check('group filter', byGroup.length > 0 && byGroup.every((r: any) => r.groupId === groupsList[0].id));
  // growth vs previous period
  const cmp = (await rep(`?from=${daysAgo(30)}&to=${today}`)).body;
  const prevRows = (await allRows(`from=${daysAgo(61)}&to=${daysAgo(31)}`)).rows;
  check('comparison: previous period has the same length, just before', cmp.comparison.previousTo === daysAgo(31) && cmp.comparison.previousFrom === daysAgo(61), cmp.comparison);
  check('comparison: previous sales are right', cmp.comparison.previousTotalSales === sum('total', prevRows));
  check('comparison: growth % is right', prevRows.length > 0 && cmp.comparison.growthPercent === Math.round(((cmp.summary.totalSales - cmp.comparison.previousTotalSales) / cmp.comparison.previousTotalSales) * 1000) / 10, cmp.comparison);
  check('chart series: one point per day, sums match', cmp.series.points.length === 31 && cmp.series.points.reduce((t: number, p: any) => t + p.current, 0) === cmp.summary.totalSales && cmp.series.points.reduce((t: number, p: any) => t + p.previous, 0) === cmp.comparison.previousTotalSales);
  const emptyRep = (await rep(`?from=${daysAgo(3000)}&to=${daysAgo(2990)}`)).body;
  check('previous period without sales -> growth null (no divide by zero)', emptyRep.comparison.growthPercent === null && emptyRep.summary.totalSales === 0);
  // creating sales and payments
  const gid = groupsList[1].id;
  const inv = await call('POST', '/admin/invoices', admin, { groupId: gid, period: '2025-01', dueDate: '2025-01-20', issuedAt: '2025-01-10', amount: 300000 });
  check('bill a group: one invoice per student', inv.status === 201 && inv.body.created === groupsList[1].members && inv.body.skipped === 0, inv.body);
  const inv2 = await call('POST', '/admin/invoices', admin, { groupId: gid, period: '2025-01', dueDate: '2025-01-20', issuedAt: '2025-01-10', amount: 300000 });
  check('billing twice never bills twice', inv2.body.created === 0 && inv2.body.skipped === groupsList[1].members, inv2.body);
  check('invoice validation: low amount / bad period / unknown group', (await call('POST', '/admin/invoices', admin, { groupId: gid, period: '2026-10', dueDate: '2026-10-20', amount: 50 })).status === 422 && (await call('POST', '/admin/invoices', admin, { groupId: gid, period: '2026-13', dueDate: '2026-10-20', amount: 300000 })).status === 422 && (await call('POST', '/admin/invoices', admin, { groupId: 99999, dueDate: '2026-10-20', amount: 300000 })).status === 404);
  check('teacher cannot bill (403)', (await call('POST', '/admin/invoices', teacher, { groupId: gid, dueDate: '2026-10-20' })).status === 403);
  const fresh = (await allRows('from=2025-01-10&to=2025-01-10')).rows.filter((r: any) => r.total === 300000 && r.groupId === gid);
  check('new sales are UNPAID with full debt', fresh.length === inv.body.created && fresh.every((r: any) => r.status === 'UNPAID' && r.debt === 300000 && r.paid === 0));
  const saleRow = fresh[0];
  const pay1 = await call('POST', `/admin/invoices/${saleRow.id}/payments`, admin, { amount: 100000, paidAt: '2025-01-12', method: 'Naqd pul' });
  check('partial payment -> PARTIALLY_PAID, debt 200 000', pay1.status === 201 && pay1.body.status === 'PARTIALLY_PAID' && pay1.body.paid === 100000 && pay1.body.debt === 200000, pay1.body);
  const sBefore = (await rep()).body.summary;
  check('over-payment -> 422', (await call('POST', `/admin/invoices/${saleRow.id}/payments`, admin, { amount: 200001, method: 'Naqd pul' })).status === 422);
  check('zero payment -> 422', (await call('POST', `/admin/invoices/${saleRow.id}/payments`, admin, { amount: 0, method: 'Naqd pul' })).status === 422);
  check('future date -> 422', (await call('POST', `/admin/invoices/${saleRow.id}/payments`, admin, { amount: 1000, paidAt: '2099-01-01', method: 'Naqd pul' })).status === 422);
  check('unknown invoice -> 404', (await call('POST', '/admin/invoices/999999/payments', admin, { amount: 1000, method: 'Naqd pul' })).status === 404);
  const pay2 = await call('POST', `/admin/invoices/${saleRow.id}/payments`, admin, { amount: 200000, paidAt: '2025-01-15', method: 'Payme' });
  check('second instalment -> PAID, debt 0', pay2.body.status === 'PAID' && pay2.body.paid === 300000 && pay2.body.debt === 0, pay2.body);
  check('paid invoice accepts nothing more -> 422', (await call('POST', `/admin/invoices/${saleRow.id}/payments`, admin, { amount: 1000, method: 'Naqd pul' })).status === 422);
  const sAfter = (await rep()).body.summary;
  check('instalments: total sales unchanged, paid +300 000, debt -300 000 (nothing counted twice)', sAfter.totalSales === sBefore.totalSales && sAfter.paid === sBefore.paid + 200000 && sAfter.debt === sBefore.debt - 200000, { sBefore, sAfter });
  // Excel
  const xr = await fetch(`${API}/admin/reports/payments/export?status=PARTIALLY_PAID&from=${daysAgo(90)}&to=${today}`, { headers: { Authorization: `Bearer ${admin}` } });
  check('export: 200 + xlsx content type + attachment', xr.status === 200 && (xr.headers.get('content-type') ?? '').includes('spreadsheetml') && (xr.headers.get('content-disposition') ?? '').includes('.xlsx'), xr.headers.get('content-type'));
  const buf = Buffer.from(await xr.arrayBuffer());
  check('export: a real xlsx (zip signature PK)', buf[0] === 0x50 && buf[1] === 0x4b);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const exp = (await allRows(`status=PARTIALLY_PAID&from=${daysAgo(90)}&to=${today}`));
  check('export: sheets Summary, Payments, Transactions', ['Summary', 'Payments', 'Transactions'].every((n) => !!wb.getWorksheet(n)), wb.worksheets.map((w) => w.name));
  const ws = wb.getWorksheet('Payments')!;
  const dataRows: any[][] = [];
  ws.eachRow((row, i) => { if (i > 1 && row.getCell(2).value !== 'JAMI') dataRows.push(row.values as any[]); });
  check('export: ALL matching rows (more than one page of 10), not the current page', exp.rows.length > 10 && dataRows.length === exp.rows.length, { exported: dataRows.length, expected: exp.rows.length });
  check('export: every row has the chosen status only', dataRows.every((v) => v[10] === "Qisman to'langan"));
  const totRow = ws.lastRow!.values as any[];
  check('export: totals row equals the report summary', totRow[2] === 'JAMI' && totRow[7] === exp.report.summary.totalSales && totRow[8] === exp.report.summary.paid && totRow[9] === exp.report.summary.debt, totRow);
  const sumText: string[] = [];
  wb.getWorksheet('Summary')!.eachRow((row) => sumText.push(row.values!.toString()));
  check('export: Summary keeps the filters and the totals', sumText.some((t) => t.includes(`${daysAgo(90)} — ${today}`)) && sumText.some((t) => t.includes('PARTIALLY_PAID')) && sumText.some((t) => t.includes(String(exp.report.summary.totalSales))));
  const xAll = new ExcelJS.Workbook();
  await xAll.xlsx.load(Buffer.from(await (await fetch(`${API}/admin/reports/payments/export`, { headers: { Authorization: `Bearer ${admin}` } })).arrayBuffer()) as any);
  check('export without filters: every sale', xAll.getWorksheet('Payments')!.rowCount === (await rep()).body.totalRows + 2, xAll.getWorksheet('Payments')!.rowCount);
  check('export: bad filter -> 422 (no file)', (await fetch(`${API}/admin/reports/payments/export?status=NOPE`, { headers: { Authorization: `Bearer ${admin}` } })).status === 422);
  // detail pages
  const t1 = (await call('GET', '/admin/teachers', admin)).body.find((t: any) => t.login === 'dilnoza.rahimova');
  const td = await call('GET', `/admin/teachers/${t1.id}`, admin);
  check('teacher detail: every group with schedule, students, lessons', td.status === 200 && td.body.groups.length >= 2 && td.body.groups.every((g: any) => g.schedule.length > 0 && typeof g.members === 'number') && td.body.totals.groups >= 2 && td.body.totals.students > 0 && td.body.totals.weeklySessions >= 4, td.body.totals);
  const gd = await call('GET', `/admin/groups/${td.body.groups[0].id}`, admin);
  check('group detail: teacher link, students with money, totals', gd.status === 200 && gd.body.teacher.id === t1.id && gd.body.students.length === gd.body.members && gd.body.students.every((s: any) => s.totalSales === s.paid + s.debt) && gd.body.totals.totalSales === gd.body.students.reduce((t: number, s: any) => t + s.totalSales, 0), gd.body.totals);
  const firstStudent = gd.body.students[0];
  check('group detail: every student has full info (login, joined, level/XP, attendance, homework, exams, money, other groups)', gd.body.students.every((x: any) => x.login && x.joinedAt && x.level >= 1 && x.xp >= 0 && x.rank >= 1 && x.attendance.lessons === gd.body.lessonsHeld && x.attendance.percent >= 0 && x.attendance.percent <= 100 && x.homework.given >= x.homework.done && Array.isArray(x.otherGroups) && Array.isArray(x.bills) && x.totalSales === x.paid + x.debt), firstStudent);
  check('group detail: a student of two groups lists the other one', gd.body.students.some((x: any) => x.otherGroups.length > 0));
  check('group detail: ranks are 1..n without repeats', new Set(gd.body.students.map((x: any) => x.rank)).size === gd.body.students.length);
  const sd = await call('GET', `/admin/students/${gd.body.students[0].id}`, admin);
  check('student detail: groups, invoices, payments, totals', sd.status === 200 && sd.body.groups.length >= 1 && sd.body.invoices.length > 0 && sd.body.totals.totalSales === sd.body.totals.paid + sd.body.totals.debt && sd.body.payments.reduce((t: number, p: any) => t + p.amount, 0) === sd.body.totals.paid, sd.body.totals);
  const manyToMany = (await call('GET', '/admin/students', admin)).body.find((s: any) => s.groups.length >= 2);
  const sd2 = await call('GET', `/admin/students/${manyToMany.id}`, admin);
  check('many-to-many: one student in several groups, each linking to its teacher', sd2.body.groups.length >= 2 && sd2.body.groups.every((g: any) => g.teacher.id && g.teacher.fullName), sd2.body.groups.length);
  const rd = await call('GET', `/admin/rooms/${groupsList.flatMap((g: any) => g.schedule).find((x: any) => x.roomId).roomId}`, admin);
  check('room detail: groups using it with slots', rd.status === 200 && rd.body.groups.length >= 1 && rd.body.weeklySlots >= 2 && rd.body.groups[0].slots.every((s: any) => s.roomId === rd.body.id), rd.body);
  check('detail: unknown ids -> 404', (await call('GET', '/admin/teachers/99999', admin)).status === 404 && (await call('GET', '/admin/students/99999', admin)).status === 404 && (await call('GET', '/admin/groups/99999', admin)).status === 404 && (await call('GET', '/admin/rooms/99999', admin)).status === 404);
  check('detail: a student id on the teacher route -> 404', (await call('GET', `/admin/teachers/${gd.body.students[0].id}`, admin)).status === 404);
  check('detail: teacher/student cannot open admin details (403)', (await call('GET', `/admin/students/${gd.body.students[0].id}`, teacher)).status === 403 && (await call('GET', `/admin/groups/${gd.body.id}`, student)).status === 403);


  console.log('9. student "I paid" messages -> admin approves');
  const me2 = await login('bekzod.rahimov', 'Yangi2345a');
  const mine = (await call('GET', '/student/payments', me2)).body;
  check('student sees only billed, unpaid invoices', mine.invoices.length > 0 && mine.invoices.every((i: any) => i.debt > 0 && i.studentName === 'Bekzod Rahimov'), mine.invoices.length);
  const inv0 = mine.invoices[0];
  const other = (await call('GET', '/student/payments', await login('zilola.hasanova', 'Yangi99887a'))).body.invoices[0];
  check("a student cannot claim someone else's invoice (404)", other && (await call('POST', `/student/invoices/${other.id}/claims`, me2, { amount: 1000 })).status === 404);
  check('claim above the debt -> 422', (await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: inv0.debt + 1 })).status === 422);
  check('claim of 0 -> 422', (await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: 0 })).status === 422);
  check('admin cannot use the student route (403)', (await call('POST', `/student/invoices/${inv0.id}/claims`, admin, { amount: 1000 })).status === 403);
  const paidBefore = (await call('GET', '/admin/reports/payments', admin)).body.summary.paid;
  const cl = await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: 100000, method: 'Uzcard' });
  check('"I paid 100 000" is accepted as PENDING', cl.status === 201 && cl.body.status === 'PENDING', cl.body);
  check('a second open message for the same invoice -> 409', (await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: 1000 })).status === 409);
  check('money is NOT counted before approval', (await call('GET', '/admin/reports/payments', admin)).body.summary.paid === paidBefore);
  const pend = (await call('GET', '/admin/claims', admin)).body;
  check('admin sees it waiting', pend.some((c: any) => c.id === cl.body.id && c.studentName === 'Bekzod Rahimov' && c.amount === 100000));
  check('teacher/student cannot see or approve (403)', (await call('GET', '/admin/claims', me2)).status === 403 && (await call('POST', `/admin/claims/${cl.body.id}/approve`, me2)).status === 403);
  const ap = await call('POST', `/admin/claims/${cl.body.id}/approve`, admin);
  check('approve -> APPROVED', ap.status === 201 && ap.body.status === 'APPROVED', ap.body);
  check('now the money is counted (+100 000)', (await call('GET', '/admin/reports/payments', admin)).body.summary.paid === paidBefore + 100000);
  check('approving twice -> 409', (await call('POST', `/admin/claims/${cl.body.id}/approve`, admin)).status === 409);
  check('student got a notification', (await call('GET', '/notifications', me2)).body.some((n: any) => n.type === 'payment_approved'));
  const after = (await call('GET', '/student/payments', me2)).body;
  check('student: debt fell by 100 000, claim shown APPROVED', after.invoices.find((i: any) => i.id === inv0.id).debt === inv0.debt - 100000 && after.claims[0].status === 'APPROVED');
  const cl2 = await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: 50000 });
  const rj = await call('POST', `/admin/claims/${cl2.body.id}/reject`, admin, { reason: "Pul tushmadi" });
  check('reject -> REJECTED, nothing counted', rj.body.status === 'REJECTED' && (await call('GET', '/admin/reports/payments', admin)).body.summary.paid === paidBefore + 100000);
  check('student sees the reason', (await call('GET', '/student/payments', me2)).body.claims[0].rejectReason === 'Pul tushmadi' && (await call('GET', '/notifications', me2)).body.some((n: any) => n.type === 'payment_rejected'));
  check('after a rejection the student can write again', (await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: 1000 })).status === 201);
  const stale = (await call('GET', '/admin/claims', admin)).body.find((c: any) => c.amount === 1000);
  await call('POST', `/admin/invoices/${inv0.id}/payments`, admin, { amount: (await call('GET', '/student/payments', me2)).body.invoices.find((i: any) => i.id === inv0.id).debt, method: 'Naqd pul' });
  check('debt paid in another way before approval -> approve refuses (409)', (await call('POST', `/admin/claims/${stale.id}/approve`, admin)).status === 409);
  check('a fully paid invoice accepts no more messages (404 listed / 409)', [404, 409].includes((await call('POST', `/student/invoices/${inv0.id}/claims`, me2, { amount: 1000 })).status));
  check('bills notify the students', (await call('POST', '/admin/invoices', admin, { groupId: groupsList[0].id, period: '2024-05', dueDate: '2024-05-20', issuedAt: '2024-05-10', amount: 200000 })).body.created > 0);
  check('claims list filter by status', (await call('GET', '/admin/claims?status=APPROVED', admin)).body.length >= 1 && (await call('GET', '/admin/claims?status=NOPE', admin)).status === 422);


  console.log('10. deleting a finished group removes everything of it');
  const allGroups10 = (await call('GET', '/admin/groups', admin)).body;
  const doomed = allGroups10.find((x: any) => x.name === 'Backend asoslari');
  const doomedDetail = (await call('GET', `/admin/groups/${doomed.id}`, admin)).body;
  const shared = doomedDetail.students.find((x: any) => x.otherGroups.length > 0);
  const otherGroupId = shared.otherGroups[0].id;
  const xpElsewhereBefore = (await call('GET', `/admin/groups/${otherGroupId}`, admin)).body.students.find((x: any) => x.id === shared.id).xp;
  const repBefore = (await rep()).body.summary;
  const doomedSales = doomedDetail.totals.totalSales;
  check('before: the group has lessons, students, bills', doomedDetail.lessonsHeld > 0 && doomedDetail.students.length > 3 && doomedSales > 0 && shared.xp > 0, { lessons: doomedDetail.lessonsHeld, n: doomedDetail.students.length });
  check('teacher cannot delete a group (403)', (await call('DELETE', `/admin/groups/${doomed.id}`, teacher)).status === 403);
  const purged = await call('DELETE', `/admin/groups/${doomed.id}`, admin);
  check('delete -> everything of the group removed', purged.body.result === 'deleted' && purged.body.removed.lessons >= doomedDetail.lessonsHeld && purged.body.removed.students === doomedDetail.students.length && purged.body.removed.invoices > 0 && purged.body.removed.payments > 0, purged.body);
  check('the group page is purged (404)', (await call('GET', `/admin/groups/${doomed.id}`, admin)).status === 404);
  check('not in the groups list', !(await call('GET', '/admin/groups', admin)).body.some((x: any) => x.id === doomed.id));
  const repAfter = (await rep()).body.summary;
  check('its sales and payments left the report, the rest is intact', repAfter.totalSales === repBefore.totalSales - doomedSales && repAfter.totalSales === repAfter.paid + repAfter.debt, { repBefore, repAfter });
  check('no sale of that group is left', (await rep(`?groupId=${doomed.id}`)).body.totalRows === 0);
  check('students stay as accounts, only the group is purged from their pages', (await call('GET', `/admin/students/${shared.id}`, admin)).body.groups.every((x: any) => x.id !== doomed.id) && (await call('GET', `/admin/students/${shared.id}`, admin)).status === 200);
  check('XP from their OTHER group is untouched', (await call('GET', `/admin/groups/${otherGroupId}`, admin)).body.students.find((x: any) => x.id === shared.id).xp === xpElsewhereBefore);
  check('the teacher no longer sees it (404)', (await call('GET', `/teacher/groups/${doomed.id}/lessons`, teacher)).status === 404);
  check('deleting twice -> 404', (await call('DELETE', `/admin/groups/${doomed.id}`, admin)).status === 404);

  // the student's uploaded answer file lives in one of the remaining groups: deleting those removes the file too
  const filesBefore = process.env.UPLOAD_DIR ? (await import('fs')).readdirSync(process.env.UPLOAD_DIR).length : -1;
  for (const gg of (await call('GET', '/admin/groups', admin)).body) await call('DELETE', `/admin/groups/${gg.id}`, admin);
  check('every group deleted -> the groups list is empty', (await call('GET', '/admin/groups', admin)).body.length === 0 && (await rep()).body.summary.totalSales === 0);
  check('the uploaded answer file is gone from the database', [403, 404].includes((await fetch(`${API}/files/${upBody.id}`, { headers: { Authorization: `Bearer ${student}` } })).status));
  if (filesBefore >= 0) check('...and from the disk', (await import('fs')).readdirSync(process.env.UPLOAD_DIR!).length < filesBefore, filesBefore);


  console.log('11. admin manages career videos, guides and FAQ');
  const cv = await call('POST', '/admin/content/career-videos', admin, { title: 'Yangi video', topic: 'Rezyume', durationMin: 12, description: 'Tavsif', url: 'https://youtu.be/jNQXAC9IVRw' });
  check('add a career video', cv.status === 201 && cv.body.url === 'https://youtu.be/jNQXAC9IVRw', cv.body);
  check('students see it', (await call('GET', '/career-videos', student)).body.some((v: any) => v.id === cv.body.id));
  check('bad video link / duration -> 422', (await call('POST', '/admin/content/career-videos', admin, { title: 'Yomon', topic: 'X1', durationMin: 5, description: '', url: 'ftp://x' })).status === 422 && (await call('POST', '/admin/content/career-videos', admin, { title: 'Yomon', topic: 'X1', durationMin: 0, description: '' })).status === 422);
  check('edit a career video (link can be cleared)', (await call('PUT', `/admin/content/career-videos/${cv.body.id}`, admin, { title: 'Yangi video 2', topic: 'Rezyume', durationMin: 15, description: 'Tavsif' })).body.url === null);
  const gd2 = await call('POST', '/admin/content/guides', admin, { title: "Yangi qo'llanma", category: 'Boshlash', readMin: 3, summary: 'Qisqa mazmun', body: "Bu qo'llanmaning to'liq matni." });
  check('add a guide', gd2.status === 201 && (await call('GET', '/guides', student)).body.some((g: any) => g.id === gd2.body.id));
  check('edit + delete a guide', (await call('PUT', `/admin/content/guides/${gd2.body.id}`, admin, { title: "O'zgargan", category: 'Boshlash', readMin: 4, summary: 'Qisqa mazmun', body: "Bu qo'llanmaning to'liq matni." })).body.title === "O'zgargan" && (await call('DELETE', `/admin/content/guides/${gd2.body.id}`, admin)).status === 204 && !(await call('GET', '/guides', student)).body.some((g: any) => g.id === gd2.body.id));
  const fq = await call('POST', '/admin/content/faqs', admin, { question: "Savol qanday bo'ladi?", answer: 'Javob shunday.' });
  check('add + edit + delete a FAQ', fq.status === 201 && (await call('PUT', `/admin/content/faqs/${fq.body.id}`, admin, { question: "Savol o'zgardi?", answer: 'Javob.' })).body.question === "Savol o'zgardi?" && (await call('DELETE', `/admin/content/faqs/${fq.body.id}`, admin)).status === 204);
  check('delete unknown -> 404; twice -> 404', (await call('DELETE', '/admin/content/faqs/99999', admin)).status === 404 && (await call('DELETE', `/admin/content/career-videos/${cv.body.id}`, admin)).status === 204 && (await call('DELETE', `/admin/content/career-videos/${cv.body.id}`, admin)).status === 404);
  check('students and teachers cannot edit content (403)', (await call('POST', '/admin/content/faqs', student, { question: "Savol qanday?", answer: 'Javob' })).status === 403 && (await call('DELETE', '/admin/content/guides/1', teacher)).status === 403 && (await call('POST', '/admin/content/faqs', undefined, { question: 'Savol qanday?', answer: 'Javob' })).status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
