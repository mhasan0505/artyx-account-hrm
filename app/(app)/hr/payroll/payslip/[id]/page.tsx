"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { getPayslipById } from "@/lib/actions/payroll";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { generatePayslipPdf, buildPayslipStatementRows } from "@/lib/pdf/payslip-pdf-generator";

export default function PrintablePayslipPage() {
  const params = useParams();
  const entryId = params.id as string;

  const [payslip, setPayslip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!entryId) return;

    startTransition(async () => {
      try {
        setLoading(true);
        const data = await getPayslipById(entryId);
        if (data) {
          setPayslip(data);
        } else {
          toast.error("Payslip entry not found");
        }
      } catch (_err) {
        toast.error("Failed to load payslip data");
      } finally {
        setLoading(false);
      }
    });
  }, [entryId]);

  const companyLogo = payslip?.employee?.outlet?.logo || "/artyx-logo.webp";
  const companyName = payslip?.employee?.outlet?.name || "Artyx Digital";
  const isPaid = payslip?.status === "PAID";
  const payPeriodDisplay = payslip?.payrollPeriod
    ? `${payslip.payrollPeriod.month}/${payslip.payrollPeriod.year}`
    : "—";

  const statementRows = payslip ? buildPayslipStatementRows(payslip) : [];

  async function handleDownloadPdf() {
    if (!payslip) return;
    try {
      setIsDownloading(true);
      await generatePayslipPdf({
        payslip,
        statementRows,
        companyName,
        companyLogo,
        entryId,
        payPeriodDisplay,
      });
      toast.success("Payslip PDF downloaded successfully!");
    } catch (err: any) {
      console.error("PDF download error:", err);
      toast.error("Failed to generate PDF download");
    } finally {
      setIsDownloading(false);
    }
  }

  if (loading || isPending) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading printable payslip...</p>
      </div>
    );
  }

  if (!payslip) {
    return (
      <div className="max-w-xl mx-auto my-12 text-center space-y-4">
        <p className="text-lg font-semibold text-rose-600">Payslip record not found</p>
        <Button asChild variant="outline">
          <Link href="/hr/payroll">Return to Payroll Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header controls (Hidden during print) */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="outline" size="sm" asChild>
          <Link href="/hr/payroll">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Payroll
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2 text-success" />
            )}
            Download PDF
          </Button>
          <Button
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* Printable Payslip Document */}
      <div
        id="payslip-container"
        className="payslip-document bg-white text-[#2d3748] border border-slate-200 rounded-lg p-8 sm:p-10 shadow-sm print:shadow-none print:border-none print:p-0"
      >
        {/* Company Header with Logo */}
        <div className="text-center pb-2">
          <img
            src={companyLogo}
            alt={companyName}
            className="h-20 sm:h-24 w-auto max-w-[220px] mx-auto mb-3 object-contain"
          />
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#1a365d] uppercase">
            {companyName}
          </h1>
          <p className="text-xs sm:text-sm text-[#4a5568] mt-1 font-normal">
            Official Salary Slip & Payment Confirmation
          </p>
        </div>

        {/* Confidential & Reference */}
        <div className="flex items-center justify-between text-xs mt-6 mb-4">
          <span className="font-bold text-[#c53030] tracking-wider uppercase">
            CONFIDENTIAL
          </span>
          <span className="text-[#718096]">
            Entry Ref: #{entryId ? entryId.slice(-8).toUpperCase() : "--------"}
          </span>
        </div>

        {/* Employee Details Section (Fixed table structure to prevent collisions) */}
        <div className="mt-4">
          <h2 className="text-sm sm:text-base font-bold text-[#2b6cb0] mb-2">
            Employee Details
          </h2>
          <table className="w-full text-xs sm:text-sm border-t border-[#e2e8f0]">
            <tbody>
              <tr className="border-b border-[#e2e8f0]">
                <td className="py-2.5 font-bold text-[#2d3748] w-32 sm:w-40">Employee Name:</td>
                <td className="py-2.5 text-[#2d3748] pr-4">{payslip?.employee?.name || "—"}</td>
                <td className="py-2.5 font-bold text-[#2d3748] w-28 sm:w-36">Pay Period:</td>
                <td className="py-2.5 text-[#2d3748]">{payPeriodDisplay}</td>
              </tr>
              <tr className="border-b border-[#e2e8f0]">
                <td className="py-2.5 font-bold text-[#2d3748] w-32 sm:w-40">Employee Code:</td>
                <td className="py-2.5 text-[#2d3748] pr-4">{payslip?.employee?.employeeCode || "—"}</td>
                <td className="py-2.5 font-bold text-[#2d3748] w-28 sm:w-36">Payment Status:</td>
                <td className={`py-2.5 font-bold ${isPaid ? "text-emerald-700" : "text-[#c53030]"}`}>
                  {payslip?.status || "UNPAID"}
                </td>
              </tr>
              <tr className="border-b border-[#e2e8f0]">
                <td className="py-2.5 font-bold text-[#2d3748] w-32 sm:w-40">Designation:</td>
                <td className="py-2.5 text-[#2d3748] pr-4">{payslip?.employee?.designation?.name || "Staff"}</td>
                <td className="py-2.5 font-bold text-[#2d3748] w-28 sm:w-36">
                  {payslip?.employee?.department?.name ? "Department:" : ""}
                </td>
                <td className="py-2.5 text-[#2d3748]">
                  {payslip?.employee?.department?.name || ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Earnings & Deductions Statement Section */}
        <div className="mt-8">
          <h2 className="text-sm sm:text-base font-bold text-[#2b6cb0] mb-2">
            Earnings & Deductions Statement
          </h2>

          <div className="w-full overflow-hidden">
            {/* Table Header Bar */}
            <div className="bg-[#2b6cb0] text-white px-4 py-2.5 flex justify-between items-center text-xs sm:text-sm font-bold">
              <span>Description</span>
              <span className="text-right">Amount (BDT)</span>
            </div>

            {/* Statement Rows */}
            <div className="divide-y divide-[#e2e8f0]">
              {statementRows.map((row, index) => (
                <div
                  key={index}
                  className="px-4 py-3 flex justify-between items-center text-xs sm:text-sm text-[#2d3748]"
                >
                  <span>{row.description}</span>
                  <span
                    className={`font-normal tabular-nums text-right ${
                      row.isDeduction && row.amount !== 0 ? "text-rose-600" : ""
                    }`}
                  >
                    {row.amount === 0
                      ? "0"
                      : row.amount < 0
                      ? `-${Math.abs(row.amount).toLocaleString()}`
                      : row.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Net Payable Amount Row */}
            <div className="bg-[#edf2f7] border-t-[1.5px] border-[#1a365d] px-4 py-3.5 flex justify-between items-center">
              <div>
                <div className="text-xs sm:text-sm font-bold text-[#2d3748]">
                  Net Payable Amount
                </div>
                <div className="text-[10px] sm:text-[11px] text-[#718096] mt-0.5">
                  Base + Additions - Deductions - Advance
                </div>
              </div>
              <div className="text-sm sm:text-base font-bold text-[#1a365d] tabular-nums text-right">
                {Number(payslip?.netPayable || 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-16 pt-6 grid grid-cols-2 gap-12 sm:gap-20 text-center text-xs text-[#718096]">
          <div className="border-t border-[#cbd5e1] pt-2">
            <p className="font-semibold text-[#2d3748]">Employer / HR Authorization</p>
            <p className="text-[10px] text-[#a0aec0] mt-0.5">Approved & Issued digitally</p>
          </div>
          <div className="border-t border-[#cbd5e1] pt-2">
            <p className="font-semibold text-[#2d3748]">Employee Signature & Receipt</p>
            <p className="text-[10px] text-[#a0aec0] mt-0.5">Received full payment</p>
          </div>
        </div>
      </div>

      {/* Print-specific style */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          body {
            background-color: white !important;
            color: #2d3748 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .payslip-document {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
