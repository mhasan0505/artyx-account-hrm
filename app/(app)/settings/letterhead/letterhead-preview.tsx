"use client";

import * as React from 'react';
import {
  Printer,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Table as TableIcon,
  Minus,
  PenTool,
  RotateCcw,
  Undo,
  Redo,
  Sparkles,
  FileText,
  Trash2,
  Type,
  Palette,
  Indent,
  Outdent,
  Cloud,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { saveCompanyLetterhead } from '@/lib/actions/settings';
import { toast } from 'sonner';

const TEMPLATES: Record<string, { title: string; html: string; ref: string }> = {
  proposal: {
    title: 'Business Proposal / Quotation Cover Letter',
    ref: 'PROP-2026-001',
    html: `<p><strong>To,</strong><br><strong>The Managing Director</strong><br>[Client Organization / Company Name]<br>[Client Address, City, Bangladesh]</p>
<p><br></p>
<p><strong>Subject: Official Commercial Proposal for Hardware & POS Solutions</strong></p>
<p><br></p>
<p>Dear Sir/Madam,</p>
<p><br></p>
<p>We are pleased to present our official commercial proposal for the supply, setup, and maintenance of high-grade point-of-sale hardware and management systems tailored specifically for your operational workflow.</p>
<p><br></p>
<p><strong>Scope of Supply & Services:</strong></p>
<ul>
  <li>Supply of certified POS terminals, barcode scanners, and thermal receipt printers.</li>
  <li>Complete on-site system deployment, initial configuration, and staff training.</li>
  <li>Comprehensive 1-year official warranty coverage and priority technical support.</li>
</ul>
<p><br></p>
<p>We assure you of our highest standard of service and look forward to receiving your favorable response.</p>
<p><br></p>
<p>Warm regards,</p>
<p><br></p>
<p><strong>Authorized Signatory</strong><br>[Signer Name]<br>[Designation / Title]<br>[Company Name]</p>`,
  },
  notice: {
    title: 'Official Notice / Internal Memorandum',
    ref: 'MEMO-2026-004',
    html: `<p style="text-align: center;"><strong style="font-size: 18px;"><u>OFFICIAL MEMORANDUM</u></strong></p>
<p><br></p>
<p><strong>To:</strong> All Department Heads, Store Managers & Staff<br><strong>From:</strong> Operations Management<br><strong>Date:</strong> [Current Date]<br><strong>Subject:</strong> Updated Operating Procedures & Cash Drawer Reconciliations</p>
<p><br></p>
<p>This memorandum serves to officially communicate the updated store operating procedures effective from the upcoming business week.</p>
<p><br></p>
<p><strong>Mandatory Operational Directives:</strong></p>
<ol>
  <li><strong>Cash Drawer Reconciliation:</strong> All shift registers must be physically counted and verified upon close. Any variance exceeding the allowed threshold must be immediately documented.</li>
  <li><strong>Customer Invoicing:</strong> Invoices and warranty slips must be printed and delivered for every completed transaction.</li>
  <li><strong>Inventory Movements:</strong> All stock adjustments and outgoing transfers must be pre-approved by the store manager.</li>
</ol>
<p><br></p>
<p>Your strict adherence to these policies ensures seamless operations across all branches.</p>
<p><br></p>
<p><strong>Management Committee</strong><br>[Company Name]</p>`,
  },
  certificate: {
    title: 'Experience & Employment Certificate',
    ref: 'EXP-2026-089',
    html: `<p style="text-align: center;"><strong style="font-size: 20px; letter-spacing: 1px;"><u>TO WHOM IT MAY CONCERN</u></strong></p>
<p><br></p>
<p>This is to certify that <strong>Mr./Ms. [Employee Full Name]</strong> has been employed with <strong>[Company Name]</strong> as a <strong>[Job Title / Designation]</strong> from <strong>[Joining Date]</strong> to <strong>[Release Date]</strong>.</p>
<p><br></p>
<p>During their tenure in our organization, they demonstrated exceptional professionalism, dedication, and high competency in executing their duties. They proved to be a reliable and sincere team member with commendable work ethics.</p>
<p><br></p>
<p>We thank them for their valuable contributions and wish them every success in all their future professional endeavors.</p>
<p><br></p>
<p><br></p>
<p><strong>[Authorized Officer Name]</strong><br>Head of Human Resources & Operations<br>[Company Name]</p>`,
  },
  warranty: {
    title: 'Warranty & Service Authorization Slip',
    ref: 'WAR-2026-112',
    html: `<p style="text-align: center;"><strong style="font-size: 18px;"><u>WARRANTY & SERVICE AUTHORIZATION CERTIFICATE</u></strong></p>
<p><br></p>
<p><strong>Customer Name:</strong> [Customer Full Name]<br><strong>Contact Number:</strong> [Customer Phone Number]<br><strong>Original Invoice No:</strong> [INV-XXXXX]<br><strong>Purchase Date:</strong> [Purchase Date]</p>
<p><br></p>
<p>This document officially certifies that the hardware units listed below are covered under our authorized service and replacement warranty program:</p>
<p><br></p>
<table style="width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px;">
  <thead>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left;">Product Item Description</th>
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: center;">Serial / IMEI Number</th>
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: center;">Warranty Duration</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px;">POS Terminal Unit</td>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: center; font-family: monospace;">SN-2026-XXXX</td>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: center;">12 Months Replacement</td>
    </tr>
  </tbody>
</table>
<p><br></p>
<p><small style="color: #64748b;">* Note: Warranty does not cover accidental physical, liquid, electrical burn, or tamper damages.</small></p>
<p><br></p>
<p><strong>Authorized Service Center</strong><br>[Company Name]</p>`,
  },
  blank: {
    title: 'Blank Letterhead',
    ref: `REF-${new Date().getFullYear()}-001`,
    html: `<p>To,<br>[Recipient Name / Organization]<br>[Address / City]</p>
<p><br></p>
<p><strong>Subject: [Subject of Letter]</strong></p>
<p><br></p>
<p>Dear [Recipient Name],</p>
<p><br></p>
<p>Start typing your official letter here...</p>
<p><br></p>
<p>Sincerely,</p>
<p><br></p>
<p><strong>[Your Name]</strong><br>[Your Title]<br>[Company Name]</p>`,
  },
};

interface LetterheadPreviewProps {
  outlet: any;
  initialLetterhead?: {
    content: string;
    refNumber: string;
    updatedAt?: string | null;
    updatedBy?: string | null;
  } | null;
}

export function LetterheadPreview({ outlet, initialLetterhead }: LetterheadPreviewProps) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const [refNumber, setRefNumber] = React.useState(initialLetterhead?.refNumber || 'REF-2026-001');
  const [letterDate, setLetterDate] = React.useState('');
  const [selectedFont, setSelectedFont] = React.useState('Inter');
  const [textColor, setTextColor] = React.useState('#1e293b');
  const [isSaving, setIsSaving] = React.useState(false);
  const [lastSaved, setLastSaved] = React.useState<string | null>(
    initialLetterhead?.updatedAt
      ? `Saved ${new Date(initialLetterhead.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${initialLetterhead.updatedBy || 'Staff'}`
      : null
  );

  // Initialize date and populate server content or proposal template
  React.useEffect(() => {
    const todayStr = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    setLetterDate(todayStr);

    if (editorRef.current) {
      if (initialLetterhead?.content) {
        editorRef.current.innerHTML = initialLetterhead.content;
      } else {
        const companyName = outlet?.name || 'Company Name';
        editorRef.current.innerHTML = TEMPLATES.proposal.html.replace(
          /\[Company Name\]/g,
          companyName
        );
      }
    }
  }, [outlet, initialLetterhead]);

  // Execute formatting command on document editor
  const format = (command: string, value: string | undefined = undefined) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
  };

  // Save official template directly to server database
  const handleSaveToServer = async () => {
    if (!editorRef.current || !outlet?.id) {
      toast.error('Cannot save: Outlet ID is missing');
      return;
    }

    try {
      setIsSaving(true);
      const content = editorRef.current.innerHTML;
      const res = await saveCompanyLetterhead(outlet.id, {
        content,
        refNumber,
      });

      if (res.success) {
        const timeStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        setLastSaved(`Saved to database at ${timeStr}`);
        toast.success('Company letterhead saved to cloud database (available to all devices)');
      } else {
        toast.error('Failed to save company letterhead to server');
      }
    } catch (err) {
      console.error('Error saving letterhead:', err);
      toast.error('Failed to connect to database server');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyTemplate = (key: keyof typeof TEMPLATES) => {
    const template = TEMPLATES[key];
    if (!template || !editorRef.current) return;

    const companyName = outlet?.name || 'Company Name';
    const populatedHtml = template.html.replace(/\[Company Name\]/g, companyName);

    editorRef.current.innerHTML = populatedHtml;
    setRefNumber(template.ref);
    toast.info(`Loaded template: ${template.title}. Click "Save to Server" to make it the company default.`);
  };

  const [confirmClearOpen, setConfirmClearOpen] = React.useState(false);
  const handleClear = () => {
    if (!editorRef.current) return;
    setConfirmClearOpen(true);
  };
  const confirmClear = async () => {
    setConfirmClearOpen(false);
    if (editorRef.current) {
      editorRef.current.innerHTML = '<p><br></p>';
      toast.info('Document cleared');
    }
  };

  const handleInsertTable = () => {
    const rows = prompt('Number of rows:', '3') || '3';
    const cols = prompt('Number of columns:', '3') || '3';
    const r = parseInt(rows, 10);
    const c = parseInt(cols, 10);
    if (isNaN(r) || isNaN(c) || r < 1 || c < 1) return;

    let tableHtml =
      '<table style="width: 100%; border-collapse: collapse; margin: 12px 0;"><thead><tr style="background-color: #f8fafc;">';
    for (let j = 0; j < c; j++) {
      tableHtml += `<th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left;">Header ${j + 1}</th>`;
    }
    tableHtml += '</tr></thead><tbody>';
    for (let i = 0; i < r - 1; i++) {
      tableHtml += '<tr>';
      for (let j = 0; j < c; j++) {
        tableHtml += `<td style="border: 1px solid #cbd5e1; padding: 8px 12px;">Cell data</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p><br></p>';

    format('insertHTML', tableHtml);
  };

  const handleInsertSignatureBlock = () => {
    const sigHtml = `
      <div style="margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid;">
        <div style="width: 200px; text-align: center;">
          <div style="border-bottom: 1px solid #94a3b8; height: 45px; margin-bottom: 6px;"></div>
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #1e293b;">Prepared By</p>
          <p style="margin: 0; font-size: 11px; color: #64748b;">Staff / Representative</p>
        </div>
        <div style="width: 200px; text-align: center;">
          <div style="border-bottom: 1px solid #94a3b8; height: 45px; margin-bottom: 6px;"></div>
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #1e293b;">Authorized Signature</p>
          <p style="margin: 0; font-size: 11px; color: #64748b;">Manager / Director</p>
        </div>
      </div>
      <p><br></p>
    `;
    format('insertHTML', sigHtml);
  };

  const handleInsertDivider = () => {
    format(
      'insertHTML',
      '<hr style="border: none; border-top: 1px solid #cbd5e1; margin: 16px 0;" /><p><br></p>'
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border/80 shadow-sm print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          {/* Template Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 font-medium">
                <Sparkles className="size-4 text-amber-500" />
                Templates
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Choose a Template
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleApplyTemplate('proposal')}>
                <FileText className="size-4 mr-2 text-emerald-500" />
                Business Proposal Cover
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleApplyTemplate('notice')}>
                <FileText className="size-4 mr-2 text-blue-500" />
                Official Memo / Notice
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleApplyTemplate('certificate')}>
                <FileText className="size-4 mr-2 text-purple-500" />
                Experience Certificate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleApplyTemplate('warranty')}>
                <FileText className="size-4 mr-2 text-amber-500" />
                Warranty Authorization
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleApplyTemplate('blank')}>
                <RotateCcw className="size-4 mr-2 text-muted-foreground" />
                Blank Letter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Save to Database Button */}
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            className="h-9 gap-1.5 font-medium border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
            onClick={handleSaveToServer}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Cloud className="size-4" />
            )}
            Save to Cloud DB
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={handleClear}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>

          {lastSaved && (
            <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1 font-mono pl-1">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              {lastSaved}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.print()}
            className="h-9 gap-2 shadow-sm font-semibold"
          >
            <Printer className="size-4" /> Print Letterhead
          </Button>
        </div>
      </div>

      {/* Formatting Toolbar */}
      <div className="bg-card p-2 rounded-xl border border-border/80 shadow-sm flex flex-wrap items-center gap-1 print:hidden text-muted-foreground sticky top-3 z-20 backdrop-blur-md bg-card/95">
        {/* Undo / Redo */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground"
          onClick={() => format('undo')}
          title="Undo (Ctrl+Z)"
        >
          <Undo className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground"
          onClick={() => format('redo')}
          title="Redo (Ctrl+Y)"
        >
          <Redo className="size-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Headings */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs font-semibold gap-1 text-foreground"
            >
              <Type className="size-3.5" />
              Style
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-44">
            <DropdownMenuItem onClick={() => format('formatBlock', '<p>')}>
              Normal Paragraph
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => format('formatBlock', '<h1>')}>
              <Heading1 className="size-4 mr-2" /> Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => format('formatBlock', '<h2>')}>
              <Heading2 className="size-4 mr-2" /> Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => format('formatBlock', '<h3>')}>
              <Heading3 className="size-4 mr-2" /> Heading 3
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => format('formatBlock', '<blockquote>')}>
              <Quote className="size-4 mr-2" /> Blockquote
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Font Family */}
        <select
          value={selectedFont}
          onChange={(e) => {
            setSelectedFont(e.target.value);
            format('fontName', e.target.value);
          }}
          className="h-8 px-2 text-xs bg-muted/50 rounded border border-border/80 text-foreground outline-none cursor-pointer"
          title="Font Family"
        >
          <option value="Inter">Inter</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Georgia">Georgia (Serif)</option>
          <option value="Courier New">Courier (Monospace)</option>
          <option value="Calibri">Calibri</option>
        </select>

        {/* Font Size */}
        <select
          onChange={(e) => format('fontSize', e.target.value)}
          defaultValue="3"
          className="h-8 px-2 text-xs bg-muted/50 rounded border border-border/80 text-foreground outline-none cursor-pointer"
          title="Font Size"
        >
          <option value="1">Small (10pt)</option>
          <option value="2">Normal (12pt)</option>
          <option value="3">Medium (14pt)</option>
          <option value="4">Large (16pt)</option>
          <option value="5">X-Large (18pt)</option>
          <option value="6">XX-Large (24pt)</option>
        </select>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Inline Formatting */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground font-bold hover:bg-muted"
          onClick={() => format('bold')}
          title="Bold (Ctrl+B)"
        >
          <Bold className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground italic hover:bg-muted"
          onClick={() => format('italic')}
          title="Italic (Ctrl+I)"
        >
          <Italic className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground underline hover:bg-muted"
          onClick={() => format('underline')}
          title="Underline (Ctrl+U)"
        >
          <Underline className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground line-through hover:bg-muted"
          onClick={() => format('strikeThrough')}
          title="Strikethrough"
        >
          <Strikethrough className="size-4" />
        </Button>

        {/* Text Color Picker */}
        <div className="relative flex items-center" title="Text Color">
          <input
            type="color"
            value={textColor}
            onChange={(e) => {
              setTextColor(e.target.value);
              format('foreColor', e.target.value);
            }}
            className="opacity-0 absolute inset-0 size-8 cursor-pointer"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-foreground pointer-events-none"
          >
            <Palette className="size-4" style={{ color: textColor }} />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Alignments */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('justifyLeft')}
          title="Align Left"
        >
          <AlignLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('justifyCenter')}
          title="Align Center"
        >
          <AlignCenter className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('justifyRight')}
          title="Align Right"
        >
          <AlignRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('justifyFull')}
          title="Justify"
        >
          <AlignJustify className="size-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Lists & Indents */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('insertUnorderedList')}
          title="Bullet List"
        >
          <List className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('insertOrderedList')}
          title="Numbered List"
        >
          <ListOrdered className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('indent')}
          title="Increase Indent"
        >
          <Indent className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-foreground hover:bg-muted"
          onClick={() => format('outdent')}
          title="Decrease Indent"
        >
          <Outdent className="size-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Rich Inserts */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs font-medium gap-1 text-foreground hover:bg-muted"
          onClick={handleInsertTable}
          title="Insert Table"
        >
          <TableIcon className="size-3.5" />
          Table
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs font-medium gap-1 text-foreground hover:bg-muted"
          onClick={handleInsertSignatureBlock}
          title="Insert Signature & Seal Block"
        >
          <PenTool className="size-3.5" />
          Signatures
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs font-medium gap-1 text-foreground hover:bg-muted"
          onClick={handleInsertDivider}
          title="Insert Divider"
        >
          <Minus className="size-3.5" />
          Divider
        </Button>
      </div>

      {/* Main Printable Letterhead Card */}
      <Card className="max-w-4xl mx-auto p-12 bg-white text-slate-900 min-h-[1050px] print:min-h-0 print:h-full shadow-2xl print:shadow-none print:p-0 flex flex-col border border-slate-200">
        <div id="print-area" className="flex flex-col flex-1 h-full font-sans">
          {/* Header Banner */}
          <div className="flex gap-8 place-items-start justify-between">
            <div className="flex items-center gap-6">
              {outlet?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={outlet.logo}
                  alt={outlet.name}
                  className="h-24 w-24 object-contain rounded"
                />
              ) : (
                <div className="w-24 h-24 bg-slate-100 border border-slate-200 flex items-center justify-center rounded text-slate-400 font-bold text-lg">
                  LOGO
                </div>
              )}
              <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {outlet?.name || 'Company Name'}
                </h1>
                {outlet?.slogan && (
                  <p className="text-sm font-medium text-slate-600 italic mt-0.5">
                    {outlet.slogan}
                  </p>
                )}
              </div>
            </div>

            <div className="text-right text-xs text-slate-600 space-y-1">
              {outlet?.address && (
                <p className="font-semibold text-slate-800">{outlet.address}</p>
              )}
              {outlet?.phone && <p>Tel: {outlet.phone}</p>}
              {outlet?.email && <p>Email: {outlet.email}</p>}
              {outlet?.openTime && outlet?.closeTime && (
                <p className="text-[11px] text-slate-500 font-mono">
                  Hours: {outlet.openTime} - {outlet.closeTime}
                </p>
              )}
            </div>
          </div>

          <Separator className="my-6 bg-slate-300 h-0.5" />

          {/* Reference and Date Row */}
          <div className="min-h-[600px] print:min-h-0 py-2 flex flex-col flex-1">
            <div className="flex justify-between items-center mb-6 text-sm text-slate-700 font-medium">
              <div className="flex items-center gap-2 group">
                <span className="font-semibold text-slate-800">Ref:</span>
                <input
                  type="text"
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  placeholder="e.g. REF-2026-001"
                  className="outline-none border-b border-dashed border-slate-300 hover:border-slate-400 focus:border-slate-600 transition-colors bg-transparent w-48 font-mono print:border-none print:placeholder-transparent text-slate-900"
                />
              </div>
              <div className="flex items-center gap-2 group">
                <span className="font-semibold text-slate-800">Date:</span>
                <input
                  type="text"
                  value={letterDate}
                  onChange={(e) => setLetterDate(e.target.value)}
                  className="outline-none border-b border-dashed border-slate-300 hover:border-slate-400 focus:border-slate-600 transition-colors bg-transparent w-36 text-right font-mono print:border-none text-slate-900"
                />
              </div>
            </div>

            {/* Rich ContentEditable Document Surface */}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="w-full flex-1 outline-none text-slate-800 leading-relaxed cursor-text prose prose-slate max-w-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300 empty:before:pointer-events-none print:empty:before:hidden"
              data-placeholder="Start typing your official letter here..."
            />
          </div>

          {/* Footer Banner */}
          <div className="mt-auto pt-6">
            <Separator className="my-4 bg-slate-300 h-0.5" />

            <div className="text-center text-xs text-slate-500 space-y-1 pb-2">
              <p className="font-bold text-base text-slate-800">{outlet?.name}</p>
              <p className="text-[11px]">
                {outlet?.address} | Tel: {outlet?.phone} | Email: {outlet?.email}
              </p>
              {outlet?.slogan && (
                <p className="italic text-[10px] text-slate-600 dark:text-slate-400">{outlet.slogan}</p>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Print Styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          body * {
            visibility: hidden !important;
          }
          #print-area, #print-area * {
            visibility: visible !important;
          }
          #print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            min-height: 100vh !important;
            display: flex !important;
            flex-direction: column !important;
            padding: 15mm 20mm 15mm 20mm !important;
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          @page {
            size: A4;
            margin: 0mm;
          }
        }
      `,
        }}
      />
    </div>
  );
}
