import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

async function main() {
  console.log("Seeding Sunrise Coaching Khargone...");

  await prisma.notification.deleteMany();
  await prisma.studentPayment.deleteMany();
  await prisma.studentCourse.deleteMany();
  await prisma.studentBatch.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.employeeSalary.deleteMany();
  await prisma.employeeAttendance.deleteMany();
  await prisma.student.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.courseSubject.deleteMany();
  await prisma.course.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.schoolClass.deleteMany();
  await prisma.board.deleteMany();
  await prisma.higherEdTrack.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.branchPhoto.deleteMany();
  await prisma.companyImage.deleteMany();
  await prisma.otp.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.file.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.company.deleteMany();
  await prisma.appContent.deleteMany();

  const adminHash = await bcrypt.hash("Admin@123", 10);
  const teacherHash = await bcrypt.hash("Sunriseteacher@123", 10);
  const studentHash = await bcrypt.hash("student@123", 10);

  const now = new Date();
  const company = await prisma.company.create({
    data: {
      name: "Sunrise Coaching Khargone",
      ownerName: "Institute Admin",
      email: "admin@sunrise.com",
      phone: "7898356505",
      bio: "Coaching institute for PAT exams.",
      maxBranches: 2,
      subscriptionStartAt: now,
      subscriptionEndAt: addMonths(now, 2),
      active: true,
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@sunrise.com",
      passwordHash: adminHash,
      firstName: "Sunrise",
      lastName: "Admin",
      phone: "7898356505",
      role: "ADMIN",
      companyId: company.id,
    },
  });

  const khargone = await prisma.branch.create({
    data: {
      companyId: company.id,
      name: "Khargone",
      ownerName: "Institute Admin",
      address: "Khargone, Madhya Pradesh",
      phone: "7898356505",
      details: "Main campus for PAT and entrance exam coaching.",
    },
  });

  const subjects = await Promise.all(
    ["Biology", "Chemistry", "Arts", "Maths", "Physics", "Science"].map((name) =>
      prisma.subject.create({ data: { companyId: company.id, name } }),
    ),
  );
  const subjectByName = Object.fromEntries(subjects.map((s) => [s.name, s]));

  await Promise.all(
    ["Class X", "Class XI", "Class XII"].map((name) =>
      prisma.schoolClass.create({ data: { companyId: company.id, name } }),
    ),
  );
  const classXi = await prisma.schoolClass.findFirst({
    where: { companyId: company.id, name: "Class XI" },
  });

  await Promise.all(
    ["CBSE", "State Board"].map((name) => prisma.board.create({ data: { companyId: company.id, name } })),
  );
  const cbse = await prisma.board.findFirst({ where: { companyId: company.id, name: "CBSE" } });

  await Promise.all(
    ["ICAR", "UG"].map((name) => prisma.higherEdTrack.create({ data: { companyId: company.id, name } })),
  );

  const courseDefs = [
    { name: "AIEEA", months: 12, price: 18000, subjects: ["Biology", "Chemistry"] },
    { name: "AIEEE", months: 12, price: 20000, subjects: ["Maths", "Physics", "Chemistry"] },
    { name: "B.Sc Entrance", months: 6, price: 12000, subjects: ["Biology", "Chemistry", "Physics"] },
    { name: "BHU Entrance", months: 8, price: 15000, subjects: ["Science", "Arts"] },
    { name: "CPAT", months: 6, price: 14000, subjects: ["Biology", "Chemistry"] },
    { name: "CUET", months: 8, price: 16000, subjects: ["Arts", "Science"] },
    { name: "IIT JEE", months: 12, price: 24000, subjects: ["Maths", "Physics", "Chemistry"] },
    { name: "PAT", months: 10, price: 17000, subjects: ["Biology", "Chemistry", "Physics"] },
  ];

  const courses = [];
  for (const def of courseDefs) {
    const course = await prisma.course.create({
      data: {
        branchId: khargone.id,
        name: def.name,
        details: `${def.name} coaching at Sunrise Khargone`,
        durationMonths: def.months,
        price: def.price,
        subjects: {
          create: def.subjects.map((name) => ({ subjectId: subjectByName[name].id })),
        },
      },
    });
    courses.push(course);
  }
  const pat = courses.find((c) => c.name === "PAT")!;
  const jee = courses.find((c) => c.name === "IIT JEE")!;

  const patBatch = await prisma.batch.create({
    data: {
      branchId: khargone.id,
      courseId: pat.id,
      name: "PAT Morning 2026",
      time: "07:00 - 10:00",
      durationMonths: pat.durationMonths,
      price: pat.price,
      startDate: now,
      endDate: addMonths(now, pat.durationMonths),
    },
  });
  const jeeBatch = await prisma.batch.create({
    data: {
      branchId: khargone.id,
      courseId: jee.id,
      name: "JEE Evening 2026",
      time: "16:00 - 19:00",
      durationMonths: jee.durationMonths,
      price: jee.price,
      startDate: now,
      endDate: addMonths(now, jee.durationMonths),
    },
  });

  const teacherUser = await prisma.user.create({
    data: {
      email: "teacher@sunrise.com",
      passwordHash: teacherHash,
      firstName: "Anita",
      lastName: "Sharma",
      phone: "9876543211",
      role: "TEACHER",
      companyId: company.id,
      branchId: khargone.id,
    },
  });

  const today = new Date();
  const monthEnd = addMonths(today, 10);
  const dueSoon = new Date(today);
  dueSoon.setDate(dueSoon.getDate() + 4);
  const salarySoon = new Date(today);
  salarySoon.setDate(salarySoon.getDate() + 2);
  const expenseSoon = new Date(today);
  expenseSoon.setDate(expenseSoon.getDate() + 3);

  await prisma.employee.createMany({
    data: [
      {
        branchId: khargone.id,
        userId: teacherUser.id,
        fullName: "Anita Sharma",
        gender: "FEMALE",
        role: "TEACHER",
        subjectId: subjectByName.Biology.id,
        salary: 28000,
        salaryDate: salarySoon,
        joiningDate: new Date("2025-01-15"),
        email: "teacher@sunrise.com",
        phone: "9876543211",
        address: "Khargone",
      },
      {
        branchId: khargone.id,
        fullName: "Ramesh Patel",
        gender: "MALE",
        role: "STAFF",
        salary: 15000,
        salaryDate: salarySoon,
        joiningDate: new Date("2025-03-01"),
        phone: "9876543221",
        address: "Khargone",
      },
    ],
  });

  const amitUser = await prisma.user.create({
    data: {
      email: "amit@example.com",
      passwordHash: studentHash,
      firstName: "Amit",
      lastName: "Kumar",
      phone: "9876543212",
      role: "STUDENT",
      companyId: company.id,
      branchId: khargone.id,
    },
  });
  const snehaUser = await prisma.user.create({
    data: {
      email: "sneha@example.com",
      passwordHash: studentHash,
      firstName: "Sneha",
      lastName: "Patel",
      phone: "9876543213",
      role: "STUDENT",
      companyId: company.id,
      branchId: khargone.id,
    },
  });

  const amit = await prisma.student.create({
    data: {
      branchId: khargone.id,
      userId: amitUser.id,
      fullName: "Amit Kumar",
      gender: "MALE",
      schoolClassId: classXi?.id,
      boardId: cbse?.id,
      courseCharge: Number(pat.price),
      registrationCharge: 1000,
      paymentAmount: Number(pat.price) + 1000,
      dueAmount: Number(pat.price) + 1000 - 5000,
      paymentDate: today,
      monthEndDate: dueSoon,
      subscriptionStartAt: today,
      subscriptionEndAt: dueSoon,
      paymentStatus: "UNPAID",
      joiningDate: new Date("2025-06-01"),
      email: "amit@example.com",
      phone: "9876543212",
      status: "ACTIVE",
      subscriptionMonths: pat.durationMonths,
      courses: { create: [{ courseId: pat.id }] },
      batches: { create: [{ batchId: patBatch.id }] },
    },
  });

  const sneha = await prisma.student.create({
    data: {
      branchId: khargone.id,
      userId: snehaUser.id,
      fullName: "Sneha Patel",
      gender: "FEMALE",
      schoolClassId: classXi?.id,
      boardId: cbse?.id,
      courseCharge: Number(jee.price),
      registrationCharge: 1000,
      paymentAmount: Number(jee.price) + 1000,
      dueAmount: 0,
      paymentDate: today,
      monthEndDate: monthEnd,
      subscriptionStartAt: today,
      subscriptionEndAt: monthEnd,
      paymentStatus: "PAID",
      joiningDate: new Date("2025-04-12"),
      email: "sneha@example.com",
      phone: "9876543213",
      status: "ACTIVE",
      subscriptionMonths: jee.durationMonths,
      courses: { create: [{ courseId: jee.id }] },
      batches: { create: [{ batchId: jeeBatch.id }] },
    },
  });

  await prisma.studentPayment.createMany({
    data: [
      {
        studentId: sneha.id,
        amount: Number(jee.price) + 1000,
        paymentDate: today,
        dueAmountAfter: 0,
      },
      {
        studentId: amit.id,
        amount: 5000,
        paymentDate: new Date("2025-07-01"),
        dueAmountAfter: Number(pat.price) + 1000 - 5000,
      },
    ],
  });

  const defaultNames = ["Rent", "Cleaning", "Electricity", "Maintenance", "Water"];
  await prisma.expense.createMany({
    data: defaultNames.map((name, i) => ({
      branchId: khargone.id,
      name,
      dueDate: i === 0 ? expenseSoon : new Date(today.getFullYear(), today.getMonth(), 5),
      amount: name === "Rent" ? 25000 : name === "Electricity" ? 4000 : 2000,
      comment: "Monthly",
    })),
  });

  await prisma.appContent.createMany({
    data: [
      {
        key: "TERMS",
        title: "Terms & Conditions",
        body: `Sunrise Coaching Khargone is free to use for two months from the date of registration. After the trial period, continued use is subject to the plan agreed with the administrator.

The application records students, teachers, cash payments, courses, batches and expenses. No online payment is processed through this portal — only cash payments are accepted.

You are responsible for the accuracy of data entered for your branches. Photos uploaded are stored on the server under your company account.`,
      },
      {
        key: "HELP",
        title: "Help & Support",
        body: "For account, billing or technical help, contact Sunrise Coaching Khargone using the details below.",
        email: "admin@online-business-erp.com",
        phone: "7898356505",
      },
    ],
  });

  console.log("Seed complete.");
  console.log("Admin login:    admin@sunrise.com / Admin@123");
  console.log("Teacher login:  teacher@sunrise.com / Sunriseteacher@123");
  console.log("Student login:  amit@example.com / student@123");
  console.log(`Company ${company.id} admin ${admin.id} branch ${khargone.id}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
