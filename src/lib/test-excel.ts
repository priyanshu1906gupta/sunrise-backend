import ExcelJS from "exceljs";

export const TEST_SHEET_HEADERS = [
  "Subject",
  "Question EN",
  "Question HI",
  "Answer number",
  "Answer description",
  "Option 1 EN",
  "Option 1 HI",
  "Option 2 EN",
  "Option 2 HI",
  "Option 3 EN",
  "Option 3 HI",
  "Option 4 EN",
  "Option 4 HI",
  "Option 5 EN",
  "Option 5 HI",
  "Option 6 EN",
  "Option 6 HI",
] as const;

export async function testSampleExcelBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questions");
  sheet.columns = TEST_SHEET_HEADERS.map((header) => ({
    header,
    key: header,
    width: header.startsWith("Question") || header === "Answer description" ? 42 : 18,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([
    "Biology",
    "Mitochondria are known as the:",
    "माइटोकॉन्ड्रिया को जाना जाता है:",
    1,
    "Mitochondria produce ATP, so they are called the powerhouse of the cell.",
    "Powerhouse of the cell",
    "कोशिका का पावरहाउस",
    "Brain of the cell",
    "कोशिका का मस्तिष्क",
    "Kitchen of the cell",
    "कोशिका का रसोईघर",
    "Packaging centre",
    "पैकेजिंग केंद्र",
    "",
    "",
    "",
    "",
  ]);
  sheet.addRow([
    "Physics",
    "The SI unit of force is:",
    "बल की एसआई इकाई है:",
    2,
    "Force is measured in newton (N) in the SI system.",
    "Joule",
    "जूल",
    "Newton",
    "न्यूटन",
    "Watt",
    "वाट",
    "Pascal",
    "पास्कल",
    "",
    "",
    "",
    "",
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
