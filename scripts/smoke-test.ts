/* End-to-end smoke test of the API. Start the backend on an EMPTY database first (demo seed), then:
 *   API=http://localhost:4001/api/v1 npm run test:smoke
 */
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
  check('old password stops working', (await call('POST', '/auth/login', undefined, { login: 'aziza.k', password: 'yangi1234' })).status === 401);
  check('new password works', !!(await login('aziza.k', 'boshqa5678')));
  check('admin changes login', (await call('PUT', `/admin/students/${ns.body.id}/account`, admin, { login: 'aziza.karimova' })).status === 204);
  check('new login works', !!(await login('aziza.karimova', 'boshqa5678')));
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
  const before = (await call('GET', '/notifications', newStudent)).body.length;
  const pub = await call('PUT', `/admin/groups/${gr1.id}/payment-plan`, admin, { amount: 520000, dueDate: future });
  check('plan saved, notice sent to every student of the group (11)', pub.status === 200 && pub.body.notice.recipients === 11, pub.body);
  const n2 = (await call('GET', '/notifications', newStudent)).body;
  check('student got the payment notice', n2.length === before + 1 && n2[0].type === 'payment_notice' && n2[0].title.includes('520 000'), n2[0]);
  check('student sees the new plan in upcoming payments', (await call('GET', '/student/payments', student)).body.upcoming.some((u: any) => u.amount === 520000));
  check('a student of ANOTHER group did not get it', !(await call('GET', '/notifications', await login('zilola.hasanova', 'oquvchi123'))).body.some((n: any) => n.type === 'payment_notice'));
  check('notice shows in history', (await call('GET', '/admin/payments', admin)).body.notices[0].recipients === 11);
  const rec = await call('POST', '/admin/payments', admin, { studentId: meId, groupId: gr1.id, amount: 500000, paidAt: '2026-11-05', method: 'Uzcard', description: "Standart to'lov" });
  check('record a payment', rec.status === 201, rec.body);
  check('notifications can be marked read', (await call('POST', '/notifications/read-all', student)).status === 204 && (await call('GET', '/notifications', student)).body.every((n: any) => n.readAt));
  check('settings read/write', (await call('PUT', '/me/settings', student, { theme: 'light' })).body.theme === 'light');
  check('invalid theme -> 422', (await call('PUT', '/me/settings', student, { theme: 'pink' })).status === 422);
  check('unknown field -> 422 (whitelist)', (await call('PUT', '/me/settings', student, { admin: true })).status === 422);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
