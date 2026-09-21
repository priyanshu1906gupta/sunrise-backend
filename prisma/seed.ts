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
  await prisma.testAttempt.deleteMany();
  await prisma.testQuestion.deleteMany();
  await prisma.test.deleteMany();
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

  await prisma.test.create({
    data: {
      name: "PAT Sample Test 2026",
      courseId: pat.id,
      branchId: khargone.id,
      durationMinutes: 20,
      questionCount: 6,
      totalMarks: 6,
      negativeEnabled: true,
      negativeFraction: "HALF",
      createdById: teacherUser.id,
      questions: {
        create: [
          {
            sortOrder: 1,
            subjectName: "Biology",
            questionEn: "Mitochondria are known as the:",
            questionHi: "माइटोकॉन्ड्रिया को जाना जाता है:",
            correctIndex: 1,
            answerDescription: "Mitochondria produce ATP, so they are called the powerhouse of the cell.",
            options: [
              { en: "Powerhouse of the cell", hi: "कोशिका का पावरहाउस" },
              { en: "Brain of the cell", hi: "कोशिका का मस्तिष्क" },
              { en: "Kitchen of the cell", hi: "कोशिका का रसोईघर" },
              { en: "Packaging centre", hi: "पैकेजिंग केंद्र" },
            ],
          },
          {
            sortOrder: 2,
            subjectName: "Biology",
            questionEn: "Which pigment is responsible for green colour in plants?",
            questionHi: "पौधों में हरे रंग के लिए कौन सा वर्णक जिम्मेदार है?",
            correctIndex: 2,
            answerDescription: "Chlorophyll absorbs light for photosynthesis and gives plants their green colour.",
            options: [
              { en: "Carotene", hi: "कैरोटीन" },
              { en: "Chlorophyll", hi: "क्लोरोफिल" },
              { en: "Xanthophyll", hi: "जैन्थोफिल" },
              { en: "Anthocyanin", hi: "एंथोसायनिन" },
            ],
          },
          {
            sortOrder: 3,
            subjectName: "Chemistry",
            questionEn: "The atomic number of carbon is:",
            questionHi: "कार्बन की परमाणु संख्या है:",
            correctIndex: 3,
            answerDescription: "Carbon has 6 protons, so its atomic number is 6.",
            options: [
              { en: "4", hi: "4" },
              { en: "8", hi: "8" },
              { en: "6", hi: "6" },
              { en: "12", hi: "12" },
            ],
          },
          {
            sortOrder: 4,
            subjectName: "Chemistry",
            questionEn: "pH of a neutral solution at 25°C is:",
            questionHi: "25°C पर उदासीन विलयन का pH है:",
            correctIndex: 1,
            answerDescription: "A neutral aqueous solution has pH 7 at 25°C.",
            options: [
              { en: "7", hi: "7" },
              { en: "0", hi: "0" },
              { en: "14", hi: "14" },
              { en: "1", hi: "1" },
            ],
          },
          {
            sortOrder: 5,
            subjectName: "Physics",
            questionEn: "The SI unit of force is:",
            questionHi: "बल की एसआई इकाई है:",
            correctIndex: 2,
            answerDescription: "Force is measured in newton (N) in the SI system.",
            options: [
              { en: "Joule", hi: "जूल" },
              { en: "Newton", hi: "न्यूटन" },
              { en: "Watt", hi: "वाट" },
              { en: "Pascal", hi: "पास्कल" },
            ],
          },
          {
            sortOrder: 6,
            subjectName: "Physics",
            questionEn: "Acceleration due to gravity on Earth is approximately:",
            questionHi: "पृथ्वी पर गुरुत्वीय त्वरण लगभग है:",
            correctIndex: 4,
            answerDescription: "Standard value of g is 9.8 m/s².",
            options: [
              { en: "8.9 m/s²", hi: "8.9 मी/से²" },
              { en: "10.8 m/s²", hi: "10.8 मी/से²" },
              { en: "6.67 m/s²", hi: "6.67 मी/से²" },
              { en: "9.8 m/s²", hi: "9.8 मी/से²" },
            ],
          },
        ],
      },
    },
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
