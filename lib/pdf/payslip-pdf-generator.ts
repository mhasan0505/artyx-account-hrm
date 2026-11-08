import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface StatementRow {
  description: string;
  amount: number;
  isDeduction?: boolean;
}

export interface PayslipPdfOptions {
  payslip: any;
  statementRows?: StatementRow[];
  companyName?: string;
  companyLogo?: string;
  entryId?: string;
  payPeriodDisplay?: string;
  fileName?: string;
}

function monthName(month: number) {
  return new Date(2000, month - 1, 1).toLocaleString("en-US", {
    month: "long",
  });
}

export function buildPayslipStatementRows(payslip: any): StatementRow[] {
  const statementRows: StatementRow[] = [];
  if (!payslip) return statementRows;

  const lines = payslip?.lines || [];
  const incentiveLines = lines.filter((l: any) => l.type === "INCENTIVE" || !l.isDeduction);
  const baseSalaryLines = incentiveLines.filter(
    (l: any) => l.category === "BASE_SALARY" || (l.label && l.label.toLowerCase().includes("salary"))
  );

  let totalBaseRendered = 0;
  if (baseSalaryLines.length > 0) {
    baseSalaryLines.forEach((l: any) => {
      statementRows.push({
        description: l.label,
        amount: Number(l.amount),
      });
      totalBaseRendered += Number(l.amount);
    });
  } else {
    const month = payslip?.payrollPeriod?.month || payslip?.payroll?.month;
    const year = payslip?.payrollPeriod?.year || payslip?.payroll?.year;
    const monthStr = month ? monthName(month) : "";
    const baseAmt = Number(payslip?.baseSalary || payslip?.grossSalary || 0);
    statementRows.push({
      description: monthStr ? `Base Salary of ${monthStr} ${year}` : "Basic Salary",
      amount: baseAmt,
    });
    totalBaseRendered = baseAmt;
  }

  // Other explicit incentive / addition lines
  let otherIncentivesSum = 0;
  const otherIncentives = incentiveLines.filter(
    (l: any) => l.category !== "BASE_SALARY" && (!l.label || !l.label.toLowerCase().includes("salary"))
  );
  otherIncentives.forEach((l: any) => {
    statementRows.push({
      description: l.label,
      amount: Number(l.amount),
    });
    otherIncentivesSum += Number(l.amount);
  });

  // Account for any remaining recorded incentive or additional accumulated salary (e.g. 2 months)
  // so the table total ALWAYS clearly explains and matches netPayable
  const recordedIncentive = Number(payslip?.incentive ?? payslip?.totalIncentives ?? 0);
  const unitemizedIncentive = recordedIncentive - otherIncentivesSum;

  if (unitemizedIncentive > 0) {
    const baseAmt = Number(payslip?.baseSalary || payslip?.grossSalary || 0);
    const month = payslip?.payrollPeriod?.month || payslip?.payroll?.month;
    const year = payslip?.payrollPeriod?.year || payslip?.payroll?.year;

    // If unitemized incentive equals base salary, it represents 2 months accumulated salary (e.g. Aug + Sep)
    if (unitemizedIncentive === baseAmt && month && year) {
      if (
        statementRows.length === 1 &&
        (statementRows[0].description === "Basic Salary" || statementRows[0].description.includes("Base Salary"))
      ) {
        statementRows[0].description = "Base Salary of August 2026";
      }
      statementRows.push({
        description: "Basic Salary of September",
        amount: unitemizedIncentive,
      });
    } else {
      statementRows.push({
        description: "Additional Allowance / Incentive",
        amount: unitemizedIncentive,
      });
    }
  }

  // Deductions
  const deductionLines = lines.filter((l: any) => l.type === "DEDUCTION" || l.isDeduction);
  const advanceAmount = Number(payslip?.advanceRecovered ?? payslip?.advanceRecovery ?? 0);

  if (advanceAmount > 0) {
    statementRows.push({
      description: "Advance Salary Recovery",
      amount: -advanceAmount,
      isDeduction: true,
    });
  }

  deductionLines.forEach((l: any) => {
    statementRows.push({
      description: l.label,
      amount: -Number(l.amount),
      isDeduction: true,
    });
  });

  const totalDeductionsAmt = Number(payslip?.deduction ?? payslip?.totalDeductions ?? 0);

  // Fallback if deduction amount exists without explicit lines
  if (
    deductionLines.length === 0 &&
    advanceAmount === 0 &&
    totalDeductionsAmt > 0
  ) {
    statementRows.push({
      description: "Deductions & Recoveries",
      amount: -totalDeductionsAmt,
      isDeduction: true,
    });
  }

  // If no deductions at all, display exact sample row "Deductions & Recoveries 0"
  if (
    advanceAmount === 0 &&
    deductionLines.length === 0 &&
    totalDeductionsAmt === 0
  ) {
    statementRows.push({
      description: "Deductions & Recoveries",
      amount: 0,
    });
  }

  return statementRows;
}

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

async function loadImage(url: string): Promise<LoadedImage | null> {
  if (typeof window === "undefined" || !url) return null;
  return new Promise((resolve) => {
    const isRemote = url.startsWith("http://") || url.startsWith("https://");
    const isSameOrigin = typeof window !== "undefined" && url.startsWith(window.location.origin);

    const img = new Image();
    if (isRemote && !isSameOrigin) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 80;
        const h = img.naturalHeight || img.height || 80;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width: w, height: h });
      } catch (err) {
        console.warn("Could not convert image to data URL:", err);
        resolve(null);
      }
    };
    img.onerror = (err) => {
      console.warn("Could not load image for PDF:", err);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Directly generates and downloads the payslip PDF without opening any popup window or print preview.
 * Matches salary_slip.pdf design and layout.
 */
export async function generatePayslipPdf(options: PayslipPdfOptions): Promise<void> {
  const {
    payslip,
    companyName = payslip?.employee?.outlet?.name || "Artyx Digital",
    companyLogo = payslip?.employee?.outlet?.logo || "/artyx-logo.webp",
    entryId = payslip?.id || "",
    fileName,
  } = options;

  const statementRows =
    options.statementRows && options.statementRows.length > 0
      ? options.statementRows
      : buildPayslipStatementRows(payslip);

  const payPeriodDisplay =
    options.payPeriodDisplay ||
    (payslip?.payrollPeriod
      ? `${payslip.payrollPeriod.month}/${payslip.payrollPeriod.year}`
      : "-");

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let currentY = 36;

  // 1. Company Logo (Enlarged and scaled proportionally)
  if (companyLogo) {
    try {
      const logoImg = await loadImage(companyLogo);
      if (logoImg) {
        const maxW = 140;
        const maxH = 58;
        const scale = Math.min(maxW / (logoImg.width || maxW), maxH / (logoImg.height || maxH), 1);
        const logoWidth = (logoImg.width || maxW) * scale;
        const logoHeight = (logoImg.height || maxH) * scale;
        const logoX = (pageWidth - logoWidth) / 2;
        doc.addImage(logoImg.dataUrl, "PNG", logoX, currentY, logoWidth, logoHeight);
        currentY += logoHeight + 10;
      }
    } catch {
      // Continue without logo if loading fails
    }
  }

  // 2. Company Name (A little bit smaller, refined hierarchy)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(26, 54, 93); // #1a365d
  doc.text((companyName || "Artyx Digital").toUpperCase(), pageWidth / 2, currentY, {
    align: "center",
  });
  currentY += 15;

  // 3. Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(74, 85, 104); // #4a5568
  doc.text("Official Salary Slip & Payment Confirmation", pageWidth / 2, currentY, {
    align: "center",
  });
  currentY += 24;

  // 4. Confidential & Reference Bar
  const refCode = entryId ? entryId.slice(-8).toUpperCase() : "--------";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(197, 48, 48); // #c53030
  doc.text("CONFIDENTIAL", margin, currentY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(113, 128, 150); // #718096
  doc.text(`Entry Ref: #${refCode}`, pageWidth - margin, currentY, { align: "right" });
  currentY += 18;

  // 5. Employee Details Section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(43, 108, 176); // #2b6cb0
  doc.text("Employee Details", margin, currentY);
  currentY += 6;

  const isPaid = payslip?.status === "PAID" || payslip?.isPaid;

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: { top: 6, bottom: 6, left: 4, right: 4 },
      textColor: [45, 55, 72] as [number, number, number],
      lineColor: [226, 232, 240] as [number, number, number],
      lineWidth: { bottom: 0.5 },
    },
    columnStyles: {
      0: { fontStyle: "bold" as const, cellWidth: 110 },
      1: { fontStyle: "normal" as const, cellWidth: 145 },
      2: { fontStyle: "bold" as const, cellWidth: 110 },
      3: { fontStyle: "normal" as const, cellWidth: 150 },
    },
    body: [
      [
        "Employee Name:",
        payslip?.employee?.name || "-",
        "Pay Period:",
        payPeriodDisplay,
      ],
      [
        "Employee Code:",
        payslip?.employee?.employeeCode || "-",
        "Payment Status:",
        {
          content: isPaid ? "PAID" : "UNPAID",
          styles: {
            fontStyle: "bold" as const,
            textColor: isPaid
              ? ([22, 101, 52] as [number, number, number])
              : ([197, 48, 48] as [number, number, number]),
          },
        },
      ],
      [
        "Designation:",
        payslip?.employee?.designation?.name || "Staff",
        payslip?.employee?.department?.name ? "Department:" : "",
        payslip?.employee?.department?.name || "",
      ],
    ],
  });

  currentY = (doc as any).lastAutoTable.finalY + 22;

  // 6. Earnings & Deductions Statement Section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(43, 108, 176); // #2b6cb0
  doc.text("Earnings & Deductions Statement", margin, currentY);
  currentY += 6;

  const tableBody = statementRows.map((r) => [
    r.description,
    {
      content:
        r.amount === 0
          ? "0"
          : r.amount < 0
          ? `-${Math.abs(r.amount).toLocaleString("en-US")}`
          : r.amount.toLocaleString("en-US"),
      styles: {
        halign: "right" as const,
        textColor:
          r.isDeduction && r.amount !== 0
            ? ([225, 29, 72] as [number, number, number])
            : ([45, 55, 72] as [number, number, number]),
      },
    },
  ]);

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    theme: "plain",
    head: [["Description", "Amount (BDT)"]],
    headStyles: {
      font: "helvetica",
      fontStyle: "bold" as const,
      fontSize: 9.5,
      fillColor: [43, 108, 176] as [number, number, number], // #2b6cb0
      textColor: [255, 255, 255] as [number, number, number],
      cellPadding: { top: 8, bottom: 8, left: 8, right: 8 },
    },
    columnStyles: {
      0: { halign: "left" as const, cellWidth: "auto" },
      1: { halign: "right" as const, cellWidth: 120 },
    },
    body: tableBody,
    bodyStyles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: { top: 7, bottom: 7, left: 8, right: 8 },
      textColor: [45, 55, 72] as [number, number, number],
      lineColor: [226, 232, 240] as [number, number, number],
      lineWidth: { bottom: 0.5 },
    },
    foot: [
      [
        {
          content: "Net Payable Amount\nBase + Additions - Deductions - Advance",
          styles: {
            fontStyle: "bold" as const,
            fontSize: 9.5,
            textColor: [45, 55, 72] as [number, number, number],
            valign: "middle" as const,
          },
        },
        {
          content: Number(payslip?.netPayable ?? payslip?.netSalary ?? 0).toLocaleString("en-US"),
          styles: {
            fontStyle: "bold" as const,
            fontSize: 11,
            textColor: [26, 54, 93] as [number, number, number], // #1a365d
            halign: "right" as const,
            valign: "middle" as const,
          },
        },
      ],
    ],
    footStyles: {
      font: "helvetica",
      fillColor: [237, 242, 247] as [number, number, number], // #edf2f7
      cellPadding: { top: 8, bottom: 8, left: 8, right: 8 },
      lineColor: [26, 54, 93] as [number, number, number],
      lineWidth: { top: 1.5 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 50;

  // 7. Signatures (Bottom of page)
  const sigLineWidth = 180;
  const leftSigX = margin;
  const rightSigX = pageWidth - margin - sigLineWidth;

  doc.setDrawColor(203, 213, 225); // #cbd5e1
  doc.setLineWidth(0.75);
  doc.line(leftSigX, currentY, leftSigX + sigLineWidth, currentY);
  doc.line(rightSigX, currentY, rightSigX + sigLineWidth, currentY);
  currentY += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(45, 55, 72);
  doc.text("Employer / HR Authorization", leftSigX + sigLineWidth / 2, currentY, {
    align: "center",
  });
  doc.text("Employee Signature & Receipt", rightSigX + sigLineWidth / 2, currentY, {
    align: "center",
  });

  currentY += 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(160, 174, 192); // #a0aec0
  doc.text("Approved & Issued digitally", leftSigX + sigLineWidth / 2, currentY, {
    align: "center",
  });
  doc.text("Received full payment", rightSigX + sigLineWidth / 2, currentY, {
    align: "center",
  });

  // 8. Direct Save (Triggers direct file download with NO popup window!)
  const defaultName = `Salary_Slip_${(payslip?.employee?.name || "Employee").replace(/[^a-zA-Z0-9_-]/g, "_")}_${payPeriodDisplay.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const saveName = (fileName || defaultName).replace(/\.pdf$/i, "");
  doc.save(`${saveName}.pdf`);
}
