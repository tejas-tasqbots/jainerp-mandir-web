import { useEffect, useRef, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Save, RefreshCw, Upload, X, Eye, ShieldCheck, AlertTriangle, Printer, CheckCircle2, Check } from 'lucide-react'
import { api, apiErrorMessage } from '../../../lib/api'
import { buildReceiptHtml, MAX_PLATE_TOKENS, printReceiptHtml, type ReceiptData } from '../../../lib/printReceipt'
import { formatCalendarDate, isWellFormedGstin } from '../../../lib/statutoryIds'
import { useToast } from '../../../components/kit/Toast'

type TemplateDef = { id: string; label: string; badge?: string; thumb: (color: string) => string }

const TEMPLATES: TemplateDef[] = [
  {
    // The receipt donors are sent on WhatsApp (devotee-api renders the same
    // builder, lib/receiptDocument.ts) — first, so a trust sees it before the
    // older designs.
    id: 'anumodana',
    label: 'Anumodana',
    badge: 'New',
    thumb: (color: string) => `
      <div style="font-family:Georgia,serif;font-size:6px;background:#FFFDF8;border:3px double ${color};padding:2px">
        <div style="border:1px solid #B8862B;padding:5px 6px;text-align:center">
          <div style="color:#B8862B;font-size:5px">॥ जय जिनेन्द्र ॥</div>
          <div style="font-weight:700;font-size:7.5px;color:${color};margin-top:2px">Mandir Name</div>
          <div style="display:inline-block;background:${color};color:#fff;font-size:4.5px;font-family:sans-serif;letter-spacing:.5px;padding:1px 5px;border-radius:4px;margin-top:3px">DONATION RECEIPT</div>
          <div style="text-align:left;margin-top:4px;font-weight:700;font-size:7px">Donor Name</div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:${color}12;border-left:2px solid #B8862B;padding:2px 3px;margin-top:3px">
            <span style="font-size:4.5px;color:#8A7560;font-family:sans-serif">AMOUNT</span>
            <span style="font-size:9px;font-weight:800;color:${color};font-family:sans-serif">₹1,500</span>
          </div>
          <div style="color:${color};font-style:italic;font-size:4.5px;margin-top:4px">Heartfelt anumodana for your daan</div>
        </div>
      </div>`,
  },
  {
    id: 'classic',
    label: 'Classic',

    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border-radius:3px;overflow:hidden;border:1px solid #e2e8f0">
        <div style="background:${color};color:#fff;padding:5px 7px">
          <div style="font-weight:700;font-size:7px">Mandir Name</div>
          <div style="opacity:.8;font-size:5px">Address, City</div>
        </div>
        <div style="padding:5px 7px">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:2px;padding:3px 4px;margin-bottom:3px">
            <div style="font-weight:700;font-size:6.5px">Donor Name</div>
            <div style="color:#9ca3af;font-size:5px">+91 98765 43210</div>
          </div>
          <div style="background:${color}15;border:1px solid ${color}40;border-radius:2px;padding:3px 4px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:5px;color:${color}">Donation Amount</div>
            <div style="font-size:9px;font-weight:800;color:${color}">₹1,500</div>
          </div>
          <div style="margin-top:3px;font-size:5px;color:#6b7280;border-top:1px solid #f1f5f9;padding-top:3px">
            <div>Category: General</div><div>Mode: Cash &nbsp; 80G: Yes</div>
          </div>
        </div>
      </div>`,
  },
  {
    id: 'minimal',
    label: 'Minimal',

    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border:1px solid #d1d5db;border-radius:2px;padding:7px 8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:5px;border-bottom:2px solid ${color};margin-bottom:5px">
          <div>
            <div style="font-weight:700;font-size:7px">Mandir Name</div>
            <div style="color:#9ca3af;font-size:5px">Address, City</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:5px;color:${color};font-weight:700">RECEIPT</div>
            <div style="font-size:6px;font-family:monospace">DON/001</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f3f4f6"><span style="color:#9ca3af">Donor</span><span style="font-weight:600">Name Here</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f3f4f6"><span style="color:#9ca3af">Amount</span><span style="font-weight:800;font-size:8px;color:${color}">₹1,500</span></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:#9ca3af">Mode</span><span>Cash</span></div>
      </div>`,
  },
  {
    id: 'modern',
    label: 'Modern',

    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border-radius:4px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,.1)">
        <div style="height:3px;background:linear-gradient(90deg,${color},${color}99)"></div>
        <div style="background:#fff;padding:4px 6px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #f1f5f9">
          <div><div style="font-weight:800;font-size:7px">Mandir</div><div style="color:#9ca3af;font-size:5px">Address</div></div>
          <div style="text-align:right"><div style="background:${color}15;color:${color};font-size:4.5px;padding:1px 4px;border-radius:9px;font-weight:700">RECEIPT</div><div style="font-size:6px;margin-top:2px;font-family:monospace">DON/001</div></div>
        </div>
        <div style="padding:4px 6px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:4px">
            <div style="background:#f8fafc;border-radius:2px;padding:2px 3px"><div style="font-size:4px;color:#9ca3af">From</div><div style="font-size:6px;font-weight:700">Donor Name</div></div>
            <div style="background:#f8fafc;border-radius:2px;padding:2px 3px"><div style="font-size:4px;color:#9ca3af">Category</div><div style="font-size:6px;font-weight:700">General</div></div>
          </div>
          <div style="background:linear-gradient(135deg,${color},${color}cc);border-radius:3px;padding:4px 6px;color:#fff;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:5px;opacity:.9">Donation Amount</div>
            <div style="font-size:11px;font-weight:900;font-family:monospace">₹1,500</div>
          </div>
        </div>
      </div>`,
  },
  {
    id: 'traditional',
    label: 'Traditional',

    thumb: (_color: string) => `
      <div style="font-family:'Times New Roman',serif;font-size:6px;border:2px solid #c97b22;border-radius:2px;overflow:hidden">
        <div style="height:4px;background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22)"></div>
        <div style="background:linear-gradient(180deg,#fef3c7,#fffef9);padding:5px 7px;text-align:center;border-bottom:2px solid #f59e0b">
          <div style="font-size:10px">🕉</div>
          <div style="font-weight:700;font-size:7px;color:#92400e">Mandir Name</div>
          <div style="font-size:5px;color:#78350f">Address, City</div>
          <div style="font-size:5px;font-weight:700;color:#c97b22;letter-spacing:1px;margin-top:3px;border-top:1px dashed #f59e0b;padding-top:2px">DONATION RECEIPT</div>
        </div>
        <div style="padding:4px 7px">
          <div style="font-size:5px;color:#78350f;font-style:italic">Received with gratitude from:</div>
          <div style="font-weight:700;font-size:7px;color:#92400e;margin:2px 0">Donor Name</div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #fef3c7"><span style="color:#78350f">Amount</span><span style="font-weight:800;color:#c97b22;font-size:8px">₹1,500</span></div>
        </div>
        <div style="height:4px;background:linear-gradient(90deg,#c97b22,#f59e0b,#c97b22);margin-top:2px"></div>
      </div>`,
  },
  {
    id: 'elegant',
    label: 'Elegant',

    thumb: (color: string) => `
      <div style="font-family:Georgia,serif;font-size:6px;border-radius:1px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 1px 6px rgba(0,0,0,.08)">
        <div style="height:3px;background:${color}"></div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:6px 8px;border-bottom:1px solid #e5e7eb;align-items:start">
          <div>
            <div style="font-weight:700;font-size:7.5px">Mandir Name</div>
            <div style="font-size:5px;color:#9ca3af;margin-top:1px">Address, City</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:4.5px;color:${color};font-weight:700;letter-spacing:1px">RECEIPT</div>
            <div style="font-size:6px;font-family:monospace;margin-top:2px">DON/001</div>
          </div>
        </div>
        <div style="padding:6px 8px">
          <div style="font-size:4.5px;letter-spacing:1.5px;color:${color};font-weight:700;border-bottom:1px solid #f3f4f6;padding-bottom:3px;margin-bottom:4px">RECEIVED FROM</div>
          <div style="font-weight:700;font-size:8px">Donor Name</div>
          <div style="margin-top:6px">
            <div style="font-size:4.5px;letter-spacing:1.5px;color:${color};font-weight:700;border-bottom:1px solid #f3f4f6;padding-bottom:2px;margin-bottom:3px">AMOUNT</div>
            <div style="font-size:13px;font-weight:700;color:${color};font-family:monospace;letter-spacing:-1px">₹1,500.00</div>
          </div>
        </div>
        <div style="height:3px;background:${color}20"></div>
      </div>`,
  },
  {
    id: 'temple',
    label: 'Temple',

    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border:1.5px solid #ccc;overflow:hidden">
        <div style="background:${color};color:#fff;padding:5px 8px;display:flex;align-items:center;gap:5px">
          <div style="width:14px;height:14px;background:#fff;border-radius:50%;opacity:.9;flex-shrink:0"></div>
          <div style="flex:1;text-align:center">
            <div style="font-weight:900;font-size:7px;text-transform:uppercase">Mandir Name</div>
            <div style="font-size:4.5px;opacity:.8;margin-top:1px">Address, City · contact@mandir.org</div>
          </div>
        </div>
        <div style="height:3px;background:linear-gradient(90deg,#f97316,${color},#f97316)"></div>
        <div style="background:#fff8f0;padding:3px 8px;display:flex;justify-content:space-between;border-bottom:1px solid #fde8cc;font-size:4.5px;color:#92400e">
          <span>80G: 80G/2024/001</span><span>PAN: AAAAB1234C</span>
        </div>
        <div style="display:flex;border-bottom:1px solid #e5e7eb">
          <div style="flex:1;padding:4px 6px;border-right:1px solid #e5e7eb">
            <div style="background:${color};color:#fff;font-size:4px;padding:1px 3px;margin:-4px -6px 4px;font-weight:700">DONOR DETAIL</div>
            <div style="font-weight:700;font-size:6px">Donor Name</div>
            <div style="font-size:4.5px;color:#6b7280;margin-top:2px">+91 98765 43210</div>
            <div style="font-size:8px;font-weight:800;color:${color};margin-top:4px;font-family:monospace">₹1,500</div>
          </div>
          <div style="flex:1;padding:4px 6px">
            <div style="background:${color};color:#fff;font-size:4px;padding:1px 3px;margin:-4px -6px 4px;font-weight:700">TRANSACTION</div>
            <div style="font-size:4.5px;border-bottom:1px solid #f0f0f0;padding:2px 0">Mode: Cash</div>
            <div style="font-size:4.5px;border-bottom:1px solid #f0f0f0;padding:2px 0">Purpose: General</div>
            <div style="font-size:4.5px;padding:2px 0">80G: <b>Yes</b></div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;padding:3px 6px;font-size:4.5px;color:#555">Authorised Signatory</div>
      </div>`,
  },
  {
    id: 'tabular',
    label: 'Tabular',

    thumb: (color: string) => `
      <div style="font-family:sans-serif;font-size:6px;border:2px solid #333;overflow:hidden">
        <div style="text-align:center;padding:5px 6px;border-bottom:2px solid #333">
          <div style="font-weight:900;font-size:7.5px;text-transform:uppercase">Mandir Name</div>
          <div style="font-size:4.5px;color:#555;margin-top:1px">Address · Phone · GSTIN</div>
        </div>
        <div style="background:#f0f0f0;text-align:center;letter-spacing:3px;font-weight:900;font-size:5.5px;padding:2px;border-bottom:1px solid #999">DONATION RECEIPT</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #999">
          <div style="padding:2px 4px;border-right:1px solid #999"><div style="font-size:4px;color:#555">Receipt No</div><div style="font-weight:700;font-size:5px">DON/001</div></div>
          <div style="padding:2px 4px;border-right:1px solid #999"><div style="font-size:4px;color:#555">Donor</div><div style="font-weight:700;font-size:5px">Name</div></div>
          <div style="padding:2px 4px"><div style="font-size:4px;color:#555">Date</div><div style="font-weight:700;font-size:5px">11 Jan 2025</div></div>
        </div>
        <div style="border-top:2px solid #333;border-bottom:2px solid #333">
          <div style="display:flex;background:#333;color:#fff;padding:2px 4px;font-size:4.5px;font-weight:700;justify-content:space-between"><span>Description</span><span>Amount</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px;border-bottom:1px solid #ddd"><span>General Donation</span><span style="font-weight:700;font-family:monospace">₹1,500</span></div>
          <div style="display:flex;justify-content:space-between;padding:3px 4px;font-weight:900;border-top:2px solid #333"><span>Total</span><span style="color:${color};font-family:monospace">₹1,500</span></div>
        </div>
        <div style="display:flex;justify-content:flex-end;padding:3px 5px;font-size:4.5px;color:#555">Authorised Signatory</div>
      </div>`,
  },
  {
    id: 'acknowledgement',
    label: 'Acknowledgement',

    thumb: (color: string) => `
      <div style="font-family:'Times New Roman',serif;font-size:6px;border:2px double #333;overflow:hidden">
        <div style="text-align:center;padding:6px 8px;border-bottom:3px double #333">
          <div style="font-weight:900;font-size:7.5px;text-transform:uppercase;letter-spacing:.5px">Mandir Name</div>
          <div style="font-size:4.5px;color:#555;margin-top:2px">Reg. No. / 80G / PAN</div>
          <div style="font-size:4px;color:#777">Address · Phone · Email</div>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 6px;background:#f8f8f8;border-bottom:1px solid #ccc;font-size:4.5px">
          <span>Txn ID: DON/001</span><span style="color:#15803d">Status: Received</span>
        </div>
        <div style="background:${color}10;text-align:center;font-weight:900;letter-spacing:2px;font-size:5.5px;padding:3px;border-bottom:1px solid #ccc">ACKNOWLEDGEMENT RECEIPT</div>
        <div style="padding:5px 8px">
          <div style="margin-bottom:4px;font-size:5px">Received with thanks from <b>Donor Name</b>, an amount of <b style="color:${color}">INR 1,500.00</b> towards corpus donation on 11 Jan 2025.</div>
          <div style="border:1px solid #ccc;font-size:4px">
            <div style="display:flex;background:#333;color:#fff;font-weight:700;padding:1.5px 4px;justify-content:space-between"><span>Mode</span><span>Instrument</span><span>Date</span><span>Amount</span></div>
            <div style="display:flex;justify-content:space-between;padding:2px 4px"><span>Cash</span><span>DON/001</span><span>11 Jan</span><span style="font-weight:700">₹1,500</span></div>
          </div>
          <div style="margin-top:4px;font-size:4px;color:#555;font-style:italic">Your contribution towards Mandir is one of the best charities.</div>
          <div style="margin-top:4px;display:flex;justify-content:space-between;border-top:1px solid #ccc;padding-top:3px">
            <div style="font-size:4px;color:#777">Auto-generated document</div>
            <div style="text-align:right;font-size:4px"><div style="font-weight:700">Mandir Name</div><div style="color:#555">Chief Accounts Officer</div></div>
          </div>
        </div>
      </div>`,
  },
  {
    id: '80g',
    label: '80G Tax Receipt',
    badge: 'Statutory',

    thumb: (color: string) => `
      <div style="font-family:Georgia,serif;font-size:6px;border:1px solid #cbd5e1;border-radius:2px;overflow:hidden">
        <div style="height:3px;background:linear-gradient(90deg,${color},${color}aa)"></div>
        <div style="display:flex;gap:5px;align-items:center;padding:5px 7px;border-bottom:2px solid ${color}">
          <div style="width:14px;height:14px;background:${color}20;border:1px solid ${color};border-radius:2px;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:7px;color:${color}">Mandir Name</div>
            <div style="font-size:4px;color:#5b6472">Address · Ph · GSTIN</div>
          </div>
          <div style="text-align:right"><div style="background:${color};color:#fff;font-size:3.5px;padding:1px 4px;border-radius:2px;font-weight:700">80G RECEIPT</div><div style="font-size:5px;font-family:monospace;margin-top:2px">DON/001</div></div>
        </div>
        <div style="display:flex;background:${color}0c;border-bottom:1px solid #e2e8f0;font-size:3.5px">
          <div style="flex:1;padding:2px 5px;border-right:1px solid #e2e8f0"><div style="color:#7c8598;font-weight:700">80G REG</div><div style="font-weight:700;font-family:monospace">AAATQ...F20214</div></div>
          <div style="flex:1;padding:2px 5px;border-right:1px solid #e2e8f0"><div style="color:#7c8598;font-weight:700">VALID UPTO</div><div style="font-weight:700;font-family:monospace">31 Mar 27</div></div>
          <div style="flex:1;padding:2px 5px"><div style="color:#7c8598;font-weight:700">PAN</div><div style="font-weight:700;font-family:monospace">AAATQ0001F</div></div>
        </div>
        <div style="text-align:center;padding:3px"><div style="font-size:5px;font-weight:700;letter-spacing:1px;color:${color}">RECEIPT FOR DONATION U/S 80G</div></div>
        <div style="padding:2px 7px 5px">
          <div style="display:flex;gap:4px;margin-bottom:3px">
            <div style="flex:1;border:1px solid #e2e8f0;border-radius:2px;padding:2px 4px"><div style="color:#7c8598;font-size:3.5px;font-weight:700">DONOR</div><div style="font-weight:700;font-size:5px">Donor Name</div><div style="font-size:3.5px;color:#475569">PAN: ABXXXXX4F</div></div>
            <div style="flex:1;border:1px solid #e2e8f0;border-radius:2px;padding:2px 4px"><div style="color:#7c8598;font-size:3.5px;font-weight:700">DETAILS</div><div style="font-size:3.5px">General · Cash</div><div style="font-size:3.5px;color:#15803d;font-weight:700">80G Eligible: Yes</div></div>
          </div>
          <div style="background:${color};color:#fff;border-radius:3px;padding:3px 6px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:4px;opacity:.9">Donation Amount</div><div style="font-size:9px;font-weight:800;font-family:monospace">₹1,500</div>
          </div>
          <div style="margin-top:3px;background:#f8fafc;border-left:2px solid ${color};border-radius:2px;padding:2px 4px;font-size:3.5px;color:#374151;line-height:1.5">Certified registered u/s 80G(5). No goods or services provided in return.</div>
        </div>
      </div>`,
  },
  {
    id: 'jain_tirth',
    label: 'Jain Tirth',

    thumb: (color: string) => `
      <div style="font-family:Arial,sans-serif;font-size:6px;border:2.5px solid #333;overflow:hidden">
        <div style="display:flex;gap:6px;align-items:flex-start;padding:5px 8px;border-bottom:2px solid #333">
          <div style="width:16px;height:16px;background:${color}20;border:1px solid ${color};border-radius:2px;flex-shrink:0"></div>
          <div style="flex:1;text-align:center">
            <div style="font-size:5px;color:${color};font-weight:700">॥ श्री आदिनाथाय नमः ॥</div>
            <div style="font-weight:900;font-size:7.5px;text-transform:uppercase">Jain Tirth Kshetra</div>
            <div style="font-size:4.5px;color:#555;margin-top:1px">Address, City · Phone</div>
          </div>
          <div style="text-align:right;font-size:4px;color:#555">Reg: 75/2001<br>PAN: AAAAB1234C<br>Date: 11 Jan 2025</div>
        </div>
        <div style="background:${color};color:#fff;text-align:center;font-weight:900;letter-spacing:2px;font-size:5px;padding:2.5px">TRUST RECEIPT</div>
        <div style="display:flex;justify-content:space-between;padding:2px 6px;background:#fafafa;border-bottom:1px solid #ccc;font-size:4.5px">
          <span>Receipt No: <b>DON/001</b></span><span>Date: <b>11 Jan 2025</b></span>
        </div>
        <div style="padding:5px 8px">
          <div style="display:flex;border-bottom:1px dotted #ccc;padding-bottom:3px;margin-bottom:3px"><span style="min-width:80px;font-weight:700;font-size:5px">Donor Name Shri</span><span style="font-size:5px;font-weight:600">Ayush Kasliwal</span></div>
          <div style="display:flex;border-bottom:1px dotted #ccc;padding-bottom:3px;margin-bottom:3px"><span style="min-width:80px;font-weight:700;font-size:5px">Amount in Words</span><span style="font-size:4.5px">INR One Thousand Five Hundred Only</span></div>
          <div style="display:flex;border:1.5px solid #333;margin-top:3px">
            <div style="flex:2;padding:3px 5px;font-size:4px;line-height:1.8;border-right:1.5px solid #333">Bank: State Bank<br>A/C Name: Mandir<br>A/C No.: 12345678<br>IFS: SBIN0001234</div>
            <div style="flex:1;padding:3px 5px;text-align:right"><div style="font-size:9px;font-weight:900;font-family:monospace;color:${color}">₹1,500</div><div style="font-size:4px;color:#6b7280">Cash</div></div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:6px;padding-top:4px;border-top:1px solid #ccc">
            <div style="text-align:center"><div style="width:40px;border-top:1px solid #333;margin:0 auto 2px"></div><div style="font-size:4.5px;font-weight:700">Signature</div></div>
          </div>
        </div>
      </div>`,
  },
  {
    // What a trust BILLS for — a room, a hall, a bhojanshala account: party
    // block, itemised lines, and the total where an accountant looks.
    id: 'statement',
    label: 'Statement',
    badge: 'New',
    thumb: (color: string) => `
      <div style="font-family:Arial,sans-serif;font-size:6px;background:#fff;border:1px solid #e5e7eb;padding:6px 7px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${color};padding-bottom:4px">
          <div><div style="font-weight:800;font-size:7px">Mandir Name</div><div style="font-size:4px;color:#6b7280">Address, City · GSTIN</div></div>
          <div style="text-align:right"><div style="background:${color};color:#fff;font-size:4px;letter-spacing:1px;padding:1px 5px;border-radius:2px">ROOM RECEIPT</div><div style="font-family:monospace;font-size:5.5px;margin-top:2px">ROOM/000001</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <div style="flex:1"><div style="font-size:3.5px;color:#9ca3af;letter-spacing:1px">RECEIVED FROM</div><div style="font-weight:700;font-size:5.5px">Ayush Kasliwal</div></div>
          <div style="flex:1"><div style="font-size:3.5px;color:#9ca3af;letter-spacing:1px">CATEGORY</div><div style="font-size:5px">Room 101 · 2 nights</div></div>
        </div>
        <div style="margin-top:4px;border:1px solid #e5e7eb">
          <div style="display:flex;background:${color};color:#fff;font-size:3.5px;padding:1.5px 3px"><span style="flex:1">DESCRIPTION</span><span>AMOUNT</span></div>
          <div style="display:flex;padding:2px 3px;border-bottom:1px solid #f1f5f9;font-size:4.5px"><span style="flex:1">Room 101 · 2 nights</span><span>₹1,500.00</span></div>
          <div style="display:flex;padding:2px 3px;font-size:4.5px;font-weight:700"><span style="flex:1">Total</span><span>₹1,500.00</span></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:5px"><div style="text-align:center"><div style="width:34px;border-top:1px solid #9ca3af;margin:0 auto 1px"></div><div style="font-size:3.5px;color:#6b7280">Authorised Signatory</div></div></div>
      </div>`,
  },
  {
    // For a trust that wants the receipt to look like the mandir: double rule,
    // gold hairline, the amount as the centrepiece.
    id: 'heritage',
    label: 'Heritage',
    badge: 'New',
    thumb: (color: string) => `
      <div style="font-family:Georgia,serif;font-size:6px;background:#FFFDF8;border:3px double #B8862B;padding:3px">
        <div style="border:1px solid #B8862B55;padding:5px 6px">
          <div style="text-align:center;color:#B8862B;font-size:4.5px;letter-spacing:2px">॥ जय जिनेन्द्र ॥</div>
          <div style="text-align:center;font-weight:700;font-size:8px;color:${color};margin-top:2px">Mandir Name</div>
          <div style="text-align:center;font-size:4px;color:#6B5A44">Address, City · Phone</div>
          <div style="text-align:center;margin:4px 0"><span style="border-top:1px solid #B8862B;border-bottom:1px solid #B8862B;padding:1px 8px;font-size:4px;letter-spacing:2px;color:${color}">DONATION RECEIPT</span></div>
          <div style="font-size:3.5px;letter-spacing:1px;color:#8A7560">RECEIVED WITH THANKS FROM</div>
          <div style="font-weight:700;font-size:6.5px">Ayush Kasliwal</div>
          <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #B8862B66;background:#B8862B0f;padding:3px 5px;margin-top:3px">
            <div><div style="font-size:3.5px;letter-spacing:1px;color:#8A7560">DONATION AMOUNT</div><div style="font-size:3.5px;font-style:italic;color:#6B5A44">Twenty Five Thousand Only</div></div>
            <div style="font-size:9px;font-weight:700;color:${color}">₹25,000</div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:5px"><div style="text-align:center"><div style="width:34px;border-top:1px solid #9ca3af;margin:0 auto 1px"></div><div style="font-size:3.5px;color:#6B5A44">Authorised Signatory</div></div></div>
        </div>
      </div>`,
  },
]

const BLANK = {
  logo_cdn_url: '', logo_base64: '', show_logo_on_receipts: true,
  receipt_template: 'classic', primary_color: '#0D1B2E',
  show_gstin_on_header: true, show_80g_on_receipt: true,
  upi_id: '', bank_account_name: '', bank_account_no: '',
  bank_ifsc: '', bank_name: '', custom_receipt_footer: '',
  // Print settings (tenant-migration 011)
  receipt_copies: 'single', receipt_paper: 'a4', receipt_language: 'en', receipt_show_upi_qr: false,
  // Counter slips (tenant-migration 032) — prasad, seva and bhojanshala print
  // through these instead of the receipt settings above. Separate because the
  // choices genuinely differ: a trust that prints donation receipts on A4
  // letterhead still wants meal tokens on an 80 mm roll.
  slip_template: 'token', slip_paper: 'thermal80', slip_copies: 'single', slip_auto_print: false,
  // Bhojanshala: N plates print N tokens (tenant-migration 039).
  slip_token_per_plate: false,
  // profile fields for preview (read-only here; edited in Temple Profile)
  name: '', address: '', mobile: '', email: '',
  gstin: '', pan: '', tan: '',
  reg_80g_number: '', reg_80g_urn: '', reg_80g_valid_upto: '', reg_12a_number: '', reg_12ab_number: '',
  // Trust identity (tenant migration 041). Prints on EVERY document, so the
  // preview is wrong without it — which is exactly how it was reported.
  registration_number: '', darpan_number: '',
}

/**
 * What the preview is showing.
 *
 * The panel only ever rendered the donation receipt, so the two documents an
 * admin most wants to check before printing a hundred of them — the 80G
 * certificate and the counter slip — could not be seen at all. Each mode feeds
 * the SAME builder the same shape the API sends for that document, so what is
 * previewed is what prints.
 */
export type PreviewMode = 'receipt' | '80g' | 'slip'

function buildPreviewData(form: typeof BLANK, mode: PreviewMode = 'receipt'): ReceiptData {
  // Mirrors the server's `statutoryVisibility`: the NUMBER is the fact — and it
  // has to be shaped like a GSTIN, not merely non-empty ("0" used to switch GST
  // on). mandir-api is a separate deployable with no shared package, so if that
  // rule changes, change it in both
  // (mandiradmin-api/src/common/domain/statutory-visibility.ts).
  const gstEnabled = isWellFormedGstin(form.gstin)
  const gstin = gstEnabled ? form.gstin.trim().toUpperCase() : ''
  const has80g = form.reg_80g_number.trim().length > 0

  return {
    receipt_number: 'DON/2025-26/000001',
    date: new Date().toISOString(),
    is_voided: false,
    donor: {
      name: 'Ayush Kasliwal',
      mobile: '+919876543210',
      pan_masked: 'ABXXXXX34C',
      address: '12 Sample Street', city: 'Surat', state: 'Gujarat', pincode: '395001',
    },
    category: mode === 'slip' ? 'Bhojanshala — lunch (10 plates)' : 'General Donation',
    amount_paise: mode === 'slip' ? 20000 : 150000,
    payment_mode: 'cash',
    // A slip is a purchase, a receipt is a gift: the wording, the 80G row and
    // the registration numbers follow this.
    kind: mode === 'slip' ? 'service' : 'donation',
    ...(mode === 'slip'
      ? {
        slip_kind: 'bhojanshala' as const,
        doc_title: 'Bhojanshala Token',
        meta: { tokens: 10, meal_type: 'lunch', rate_paise: 2000, tokens_redeemed: 0 },
      }
      : {}),
    // The sample donation is 80G-eligible only if this trust could actually
    // issue one. Previewing a "80G Eligible: Yes" row on a trust with no
    // registration shows an admin a receipt they can never produce.
    is_80g_eligible: mode === 'slip' ? false : has80g,
    mandir: {
      name: form.name || 'Shree Jain Mandir',
      address: form.address || '123, Temple Road, Ahmedabad, Gujarat 380001',
      mobile: form.mobile || '+91 98765 43210',
      email: form.email || 'info@jainmandir.org',
      // ── NO PLACEHOLDER STATUTORY NUMBERS ──────────────────────────────
      // These read `form.gstin || '24XXXXX1234A1Z5'` and
      // `form.reg_80g_number || 'AAAAB1234CF20214'`, so a trust with neither
      // saw a preview receipt printing both — a GSTIN beside a panel that said
      // "GSTIN: Not set" two inches to its left.
      //
      // The placeholders were there so the layout would not collapse while
      // previewing, and for a name or an address that is a fair trade. For a
      // tax registration it is not: this screen exists precisely so an admin
      // can confirm WHAT PRINTS, and it was the one screen answering wrongly.
      // A trust with no GSTIN now previews a receipt with no GSTIN, which is
      // what its donors will receive.
      gstin: gstin || null,
      pan: form.pan || 'AAAAB1234C',
      tan: form.tan || null,
      is_gst_registered: gstEnabled,
      gst_enabled: gstEnabled,
      eighty_g_enabled: has80g,
      reg_80g_number: form.reg_80g_number.trim() || null,
      reg_80g_urn: form.reg_80g_urn || null,
      reg_80g_valid_upto: form.reg_80g_valid_upto || null,
      reg_12a_number: form.reg_12a_number || null,
      reg_12ab_number: form.reg_12ab_number || null,
      registration_number: form.registration_number || null,
      darpan_number: form.darpan_number || null,
      upi_id: form.upi_id || 'temple@upi',
      bank_account_name: form.bank_account_name || null,
      bank_account_no: form.bank_account_no || null,
      bank_ifsc: form.bank_ifsc || null,
      bank_name: form.bank_name || null,
      logo_cdn_url: form.logo_cdn_url || null,
      logo_base64: form.logo_base64 || null,
      show_logo: form.show_logo_on_receipts,
      // Both toggles can only ever HIDE. A trust cannot tick a checkbox into
      // holding a registration — the same rule the server applies in
      // common/domain/statutory-visibility.ts, and the reason the preview and
      // the printed receipt now agree.
      show_80g: has80g && form.show_80g_on_receipt,
      show_gstin: gstEnabled && form.show_gstin_on_header,
      footer: form.custom_receipt_footer || 'Jai Jinendra! Thank you for your generous donation.',
      template: mode === 'slip'
        ? (form.slip_template === 'receipt' ? form.receipt_template : form.slip_template)
        : mode === '80g' ? '80g' : form.receipt_template,
      primary_color: form.primary_color,
      receipt_copies: (mode === 'slip' ? form.slip_copies : form.receipt_copies) as 'single' | 'both',
      receipt_paper: (mode === 'slip'
        ? (form.slip_template === 'receipt' ? form.receipt_paper : form.slip_paper)
        : form.receipt_paper) as 'a4' | 'a5' | 'thermal58' | 'thermal80',
      receipt_language: form.receipt_language,
      receipt_show_upi_qr: form.receipt_show_upi_qr,
      ...(mode === 'slip'
        ? { surface: 'slip' as const, slip_token_per_plate: form.slip_token_per_plate }
        : {}),
    },
  }
}

export function ReceiptSettingsTab({ onGoToTab }: { onGoToTab?: (tab: 'accounts') => void } = {}) {
  const toast = useToast()
  const { t } = useTranslation()
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('receipt')

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm(f => ({
        ...f,
        logo_cdn_url: (p.logo_cdn_url as string) || '',
        logo_base64: (p.logo_base64 as string) || '',
        show_logo_on_receipts: p.show_logo_on_receipts !== false,
        receipt_template: (p.receipt_template as string) || 'classic',
        primary_color: (p.primary_color as string) || '#0D1B2E',
        show_gstin_on_header: p.show_gstin_on_header !== false,
        show_80g_on_receipt: Boolean(p.show_80g_on_receipt),
        upi_id: (p.upi_id as string) || '',
        bank_account_name: (p.bank_account_name as string) || '',
        bank_account_no: (p.bank_account_no as string) || '',
        bank_ifsc: (p.bank_ifsc as string) || '',
        bank_name: (p.bank_name as string) || '',
        custom_receipt_footer: (p.custom_receipt_footer as string) || '',
        receipt_copies: (p.receipt_copies as string) || 'single',
        receipt_paper: (p.receipt_paper as string) || 'a4',
        receipt_language: (p.receipt_language as string) || 'en',
        receipt_show_upi_qr: Boolean(p.receipt_show_upi_qr),
        slip_template: (p.slip_template as string) || 'token',
        slip_paper: (p.slip_paper as string) || 'thermal80',
        slip_copies: (p.slip_copies as string) || 'single',
        slip_auto_print: Boolean(p.slip_auto_print),
        slip_token_per_plate: Boolean(p.slip_token_per_plate),
        name: (p.name as string) || '',
        address: [p.address_line1, p.city, p.state, p.pincode].filter(Boolean).join(', '),
        mobile: (p.mobile as string) || '',
        email: (p.email as string) || '',
        gstin: (p.gstin as string) || '',
        pan: (p.pan as string) || '',
        tan: (p.tan as string) || '',
        reg_80g_number: (p.reg_80g_number as string) || '',
        reg_80g_urn: (p.reg_80g_urn as string) || '',
        reg_80g_valid_upto: (p.reg_80g_valid_upto as string) || '',
        reg_12a_number: (p.reg_12a_number as string) || '',
        reg_12ab_number: (p.reg_12ab_number as string) || '',
        registration_number: (p.registration_number as string) || '',
        darpan_number: (p.darpan_number as string) || '',
      }))
    }).catch(() => {})
  }, [])

  // Update preview iframe whenever form changes
  useEffect(() => {
    const html = buildReceiptHtml(buildPreviewData(form, previewMode))
    // Remove the auto-print script for preview
    const previewHtml = html.replace('<script>window.onload=()=>{window.print()}</script>', '')
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(previewHtml)
        doc.close()
      }
    }
  }, [form, previewMode])

  function set<K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleLogoFile(file: File) {
    if (!file.type.startsWith('image/')) return
    if (file.size > 2 * 1024 * 1024) { toast.success(t('settings.receipts.logoRequiredWarn')); return }
    setLogoUploading(true)
    const reader = new FileReader()
    reader.onload = e => {
      set('logo_base64', e.target?.result as string)
      set('logo_cdn_url', '')
      setLogoUploading(false)
    }
    reader.readAsDataURL(file)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // Only what this tab actually edits. The UPI and bank values are loaded
      // for the preview and shown read-only above ("Manage in Donor Payments"),
      // and sending them back made this form unsaveable once the mandir was
      // verified: `upi_id` is a SENSITIVE field, the API rejects a payload that
      // merely CONTAINS one, and so the whole save — logo, colour, footer,
      // template — failed with SENSITIVE_LOCKED on a value nobody had touched.
      await api.patch('/tenants/me', {
        logo_cdn_url: form.logo_cdn_url,
        logo_base64: form.logo_base64,
        show_logo_on_receipts: form.show_logo_on_receipts,
        receipt_template: form.receipt_template,
        primary_color: form.primary_color,
        show_gstin_on_header: form.show_gstin_on_header,
        show_80g_on_receipt: form.show_80g_on_receipt,
        custom_receipt_footer: form.custom_receipt_footer,
        receipt_copies: form.receipt_copies,
        receipt_paper: form.receipt_paper,
        receipt_language: form.receipt_language,
        receipt_show_upi_qr: form.receipt_show_upi_qr,
        slip_template: form.slip_template,
        slip_paper: form.slip_paper,
        slip_copies: form.slip_copies,
        slip_auto_print: form.slip_auto_print,
        slip_token_per_plate: form.slip_token_per_plate,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const logoSrc = form.logo_base64 || form.logo_cdn_url

  function printSample() {
    printReceiptHtml(buildReceiptHtml(buildPreviewData(form, previewMode)))
  }

  // Statutory identity that will print on receipts (managed in Temple Profile).
  // What PRINTS, not what is stored: a GSTIN that is not shaped like one never
  // reaches a receipt, so showing it here as "set" would contradict the preview.
  const statutory: { label: string; value: string; required?: boolean }[] = [
    { label: 'GSTIN', value: isWellFormedGstin(form.gstin) ? form.gstin.trim().toUpperCase() : '' },
    { label: 'PAN', value: form.pan },
    { label: t('settings.receipts.statutory80gRegNo'), value: form.reg_80g_number, required: true },
    // Only when it differs from the registration number above — since 2021
    // they are the same 16-character URN, and nothing edits this column.
    ...(form.reg_80g_urn && form.reg_80g_urn !== form.reg_80g_number
      ? [{ label: '80G URN', value: form.reg_80g_urn }]
      : []),
    { label: t('settings.receipts.statutory80gValidUpto'), value: form.reg_80g_valid_upto ? formatCalendarDate(form.reg_80g_valid_upto) : '' },
    { label: '12A / 12AB', value: form.reg_12ab_number || form.reg_12a_number },
    // Identity, not a tax claim — printed on every document including a room
    // bill, so it belongs in this list of what a receipt will carry.
    { label: t('settings.profile.registrationNumber'), value: form.registration_number },
    { label: t('settings.profile.darpanNumber'), value: form.darpan_number },
  ]
  const missingRequired = statutory.filter(s => s.required && !s.value)
  const selected = TEMPLATES.find(t => t.id === form.receipt_template)

  return (
    // Side by side from xl only: the preview is 420 px, and below that it sat
    // on top of the form (a 390 px phone saw the preview and no settings).
    <div className="flex flex-col xl:flex-row gap-6 xl:items-start">
      {/* ── Left: Settings panel ── */}
      <form onSubmit={save} className="flex-1 min-w-0 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{t('settings.receipts.heading')}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{t('settings.receipts.subheading')}</p>
          </div>
          <button type="button" onClick={printSample} className="btn-secondary btn-sm whitespace-nowrap">
            <Printer size={14} /> {t('settings.receipts.printSample')}
          </button>
        </div>

        {success && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">
            <CheckCircle2 size={16} /> {t('settings.receipts.saved')}
          </div>
        )}

        <section className="space-y-4">
          <div className="flex items-baseline gap-2 pt-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('settings.receipts.groupDesign')}</h3>
            <p className="text-[11px] text-slate-400">{t('settings.receipts.groupDesignHint')}</p>
          </div>

        {/* Template */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <h3 className="font-semibold text-sm">{t('settings.receipts.templateHeading')}</h3>
            <span className="ml-auto text-[11px] text-slate-400">{t('settings.receipts.designsCount', { count: TEMPLATES.length })}</span>
          </div>
          <div className="card-body grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TEMPLATES.map(t => {
              const active = form.receipt_template === t.id
              return (
                <button type="button" key={t.id} onClick={() => set('receipt_template', t.id)}
                  className={`relative text-left border rounded-lg p-2.5 transition-all ${active ? 'border-navy-900 ring-2 ring-navy-900 bg-navy-50' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
                  {active && (
                    <span className="absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-white">
                      <Check size={12} />
                    </span>
                  )}
                  <div className="rounded-md overflow-hidden bg-white" dangerouslySetInnerHTML={{ __html: t.thumb(form.primary_color) }} />
                  <div className="flex items-center gap-1.5 mt-2">
                    <p className="font-semibold text-sm text-slate-800">{t.label}</p>
                    {t.badge && (
                      <span className="text-[9px] uppercase font-bold tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{t.badge}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Colour & Visibility */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.receipts.colourHeading')}</h3></div>
          <div className="card-body space-y-3">
            <div className="flex items-center gap-3">
              <label className="form-label mb-0 w-28">{t('settings.receipts.primaryColour')}</label>
              <input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)}
                className="h-9 w-16 rounded border border-slate-200 cursor-pointer" />
              <span className="text-xs font-mono text-slate-500">{form.primary_color}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_gstin_on_header}
                onChange={e => set('show_gstin_on_header', e.target.checked)} />
              {t('settings.receipts.showGstin')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_80g_on_receipt}
                onChange={e => set('show_80g_on_receipt', e.target.checked)} />
              {t('settings.receipts.show80g')}
            </label>
          </div>
        </div>

        {/* Logo */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.receipts.logoHeading')}</h3></div>
          <div className="card-body space-y-3">
            {logoSrc ? (
              <div className="flex items-center gap-3">
                <img src={logoSrc} alt="Logo" className="h-14 object-contain border border-slate-200 rounded p-1 bg-white" />
                <div className="flex-1">
                  <p className="text-xs text-slate-500">{form.logo_base64 ? t('settings.receipts.logoStoredBase64') : t('settings.receipts.logoExternalUrl')}</p>
                </div>
                <button type="button" onClick={() => { set('logo_base64', ''); set('logo_cdn_url', '') }}
                  className="p-1 text-slate-400 hover:text-red-500">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleLogoFile(f) }}
                className="border-2 border-dashed border-slate-200 rounded-md p-6 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors"
              >
                <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-600">{t('settings.receipts.uploadLogo')}</p>
                <p className="text-xs text-slate-400 mt-1">{t('settings.receipts.uploadLogoHelp')}</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = '' }} />
            {logoUploading && <p className="text-xs text-blue-600 animate-pulse">{t('settings.receipts.processingLogo')}</p>}

            <div>
              <label className="form-label">{t('settings.receipts.orEnterUrl')}</label>
              <input className="form-input" placeholder="https://yourdomain.com/logo.png"
                value={form.logo_cdn_url}
                onChange={e => { set('logo_cdn_url', e.target.value); if (e.target.value) set('logo_base64', '') }} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_logo_on_receipts}
                onChange={e => set('show_logo_on_receipts', e.target.checked)} />
              {t('settings.receipts.showLogo')}
            </label>
          </div>
        </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline gap-2 pt-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('settings.receipts.groupPrinting')}</h3>
            <p className="text-[11px] text-slate-400">{t('settings.receipts.groupPrintingHint')}</p>
          </div>
        {/* Printing — copies, paper, receipt language, UPI QR */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm">{t('settings.receipts.printHeading')}</h3>
          </div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="form-label">{t('settings.receipts.copies')}</label>
                <select className="form-select" value={form.receipt_copies}
                  onChange={e => set('receipt_copies', e.target.value)}>
                  <option value="single">{t('settings.receipts.copiesSingle')}</option>
                  <option value="both">{t('settings.receipts.copiesBoth')}</option>
                </select>
              </div>
              <div>
                <label className="form-label">{t('settings.receipts.paper')}</label>
                <select className="form-select" value={form.receipt_paper}
                  onChange={e => set('receipt_paper', e.target.value)}>
                  <option value="a4">{t('settings.receipts.paperA4')}</option>
                  <option value="thermal80">{t('settings.receipts.paperThermal')}</option>
                </select>
              </div>
              <div>
                <label className="form-label">{t('settings.receipts.language')}</label>
                <select className="form-select" value={form.receipt_language}
                  onChange={e => set('receipt_language', e.target.value)}>
                  <option value="en">English</option>
                  <option value="hi">हिंदी</option>
                  <option value="mr">मराठी</option>
                  <option value="gu">ગુજરાતી</option>
                  <option value="kn">ಕನ್ನಡ</option>
                  <option value="ta">தமிழ்</option>
                  <option value="te">తెలుగు</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.receipt_show_upi_qr}
                onChange={e => set('receipt_show_upi_qr', e.target.checked)} />
              {t('settings.receipts.showUpiQr')}
            </label>
            {form.receipt_show_upi_qr && !form.upi_id && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {t('settings.receipts.upiQrNeedsId')}
              </p>
            )}
            {form.receipt_paper === 'thermal80' && (
              <p className="text-xs text-slate-500">{t('settings.receipts.thermalNote')}</p>
            )}
          </div>
        </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline gap-2 pt-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('settings.receipts.groupSlips')}</h3>
            <p className="text-[11px] text-slate-400">{t('settings.receipts.groupSlipsHint')}</p>
          </div>

        {/* ── COUNTER SLIPS ───────────────────────────────────────────────
            Prasad, Seva and Bhojanshala used to print through the settings
            above: the same nine A4 templates, the same paper. So a ₹20 prasad
            packet produced a full A4 donation receipt with an 80G block and a
            signature line, and the counter threw it away. What those three
            counters hand over is a TOKEN — the thing a devotee shows at the
            window — and it wants a slip, not a certificate. */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm">{t('settings.slips.heading')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{t('settings.slips.subheading')}</p>
          </div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="form-label">{t('settings.slips.layout')}</label>
                <select className="form-select" value={form.slip_template}
                  onChange={e => set('slip_template', e.target.value)}>
                  <option value="token">{t('settings.slips.layoutToken')}</option>
                  <option value="compact">{t('settings.slips.layoutCompact')}</option>
                  <option value="receipt">{t('settings.slips.layoutReceipt')}</option>
                </select>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  {form.slip_template === 'token' && t('settings.slips.layoutTokenHelp')}
                  {form.slip_template === 'compact' && t('settings.slips.layoutCompactHelp')}
                  {form.slip_template === 'receipt' && t('settings.slips.layoutReceiptHelp')}
                </p>
              </div>
              <div>
                <label className="form-label">{t('settings.receipts.paper')}</label>
                {/* Disabled on 'receipt', where the receipt settings above own
                    the paper too — a paper picker that silently does nothing is
                    worse than one that says why. */}
                <select className="form-select" value={form.slip_paper}
                  disabled={form.slip_template === 'receipt'}
                  onChange={e => set('slip_paper', e.target.value)}>
                  <option value="thermal58">{t('settings.slips.paper58')}</option>
                  <option value="thermal80">{t('settings.slips.paper80')}</option>
                  <option value="a5">{t('settings.slips.paperA5')}</option>
                  <option value="a4">{t('settings.receipts.paperA4')}</option>
                </select>
              </div>
              <div>
                <label className="form-label">{t('settings.receipts.copies')}</label>
                <select className="form-select" value={form.slip_copies}
                  onChange={e => set('slip_copies', e.target.value)}>
                  <option value="single">{t('settings.slips.copiesSingle')}</option>
                  <option value="both">{t('settings.slips.copiesBoth')}</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.slip_auto_print}
                onChange={e => set('slip_auto_print', e.target.checked)} />
              {t('settings.slips.autoPrint')}
            </label>
            {/* A family of ten should not have to walk to the dining hall
                together on one token. Bhojanshala only; the hall collects one
                token per thali. Disabled where no token is printed at all. */}
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" data-testid="slip-token-per-plate"
                  checked={form.slip_token_per_plate}
                  disabled={form.slip_template === 'receipt'}
                  onChange={e => set('slip_token_per_plate', e.target.checked)} />
                {t('settings.slips.tokenPerPlate')}
              </label>
              <p className="mt-1 pl-6 text-[11px] leading-relaxed text-slate-500">
                {t('settings.slips.tokenPerPlateHelp', { max: MAX_PLATE_TOKENS })}
              </p>
            </div>
            <p className="text-xs text-slate-500">{t('settings.slips.note')}</p>
          </div>
        </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline gap-2 pt-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('settings.receipts.groupContent')}</h3>
            <p className="text-[11px] text-slate-400">{t('settings.receipts.groupContentHint')}</p>
          </div>
        {/* Statutory identity (read-only — edited in Temple Profile) */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <ShieldCheck size={15} className="text-navy-900" />
            <h3 className="font-semibold text-sm">{t('settings.receipts.statutoryHeading')}</h3>
            <span className="ml-auto text-[11px] text-slate-400">{t('settings.receipts.statutorySource')}</span>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {statutory.map(s => (
                <div key={s.label} className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{s.label}</div>
                  {s.value ? (
                    <div className="text-sm font-semibold text-slate-800 font-mono truncate" title={s.value}>{s.value}</div>
                  ) : (
                    <div className={`text-xs font-medium ${s.required ? 'text-amber-600' : 'text-slate-400'}`}>{s.required ? t('settings.receipts.notSetRequired') : t('settings.receipts.notSet')}</div>
                  )}
                </div>
              ))}
            </div>
            {missingRequired.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <Trans i18nKey="settings.receipts.missingWarning" components={{ bold: <b />, bold2: <b /> }} />
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400"><Trans i18nKey="settings.receipts.statutoryHelp" components={{ bold: <b /> }} /></p>
          </div>
        </div>

        {/* Payment details — READ-ONLY MIRROR.
            These fields are owned by Settings → Donor Payments and stored once
            in kshetra_profile. They used to be editable here AND there AND on
            Temple Profile: three forms, three Save buttons, one row underneath.
            Editing in one tab left the others showing stale values until a
            reload, which reads as "it didn't save".
            It matters more than tidiness: this is the account a devotee
            actually transfers money into, and the same value is printed on the
            receipt as proof. Two editable copies is one opportunity for the
            receipt to name an account the donor never paid. One owner, read
            everywhere. */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-sm">{t('settings.receipts.paymentHeading')}</h3>
            <button
              type="button"
              onClick={() => onGoToTab?.('accounts')}
              className="text-xs font-semibold text-brand-red hover:underline"
            >
              {t('settings.receipts.managePaymentDetails')}
            </button>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-500 mb-3">{t('settings.receipts.paymentDetailsOwnedElsewhere')}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="col-span-2 flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{t('settings.receipts.upiId')}</dt>
                <dd className="font-medium">{form.upi_id || <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="col-span-2 flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{t('settings.receipts.bankAccountName')}</dt>
                <dd className="font-medium">{form.bank_account_name || <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="col-span-2 flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{t('settings.receipts.accountNumber')}</dt>
                <dd className="font-medium font-mono">{form.bank_account_no || <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="col-span-2 flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{t('settings.receipts.ifsc')}</dt>
                <dd className="font-medium font-mono">{form.bank_ifsc || <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="col-span-2 flex justify-between">
                <dt className="text-slate-500">{t('settings.receipts.bankName')}</dt>
                <dd className="font-medium">{form.bank_name || <span className="text-slate-400">—</span>}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Footer */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.receipts.footerHeading')}</h3></div>
          <div className="card-body">
            <textarea className="form-input" rows={2} value={form.custom_receipt_footer}
              onChange={e => set('custom_receipt_footer', e.target.value)}
              placeholder={t('settings.receipts.footerPlaceholder') as string} />
          </div>
        </div>
        </section>


        {/* Sticky, because this form is four sections long: the Save button
            used to sit past the end of a very tall scroll, so a trust that
            changed the template at the top had to find its way back down. */}
        <div className="sticky bottom-0 z-10 -mx-1 px-1 pt-3 pb-3 bg-gradient-to-t from-white via-white to-white/0">
          <button type="submit" disabled={saving} className="btn-primary w-full sm:w-auto justify-center">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? t('settings.saving') : t('settings.receipts.saveButton')}
          </button>
        </div>
      </form>

      {/* ── Right: Live preview panel ── */}
      <div className="w-full max-w-[420px] xl:w-[420px] flex-shrink-0 xl:sticky xl:top-4">
        <div className="card overflow-hidden">
          <div className="card-header flex flex-wrap items-center gap-2">
            <Eye size={14} className="text-slate-500" />
            <h3 className="font-semibold text-sm">{t('settings.receipts.livePreview')}</h3>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
              {previewMode === 'receipt' ? (selected?.label || 'Classic') : previewMode === '80g' ? '80G' : t('settings.slips.heading')}
              {previewMode === 'receipt' && selected?.badge && <span className="text-[9px] uppercase font-bold tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{selected.badge}</span>}
            </span>
            {/* Three documents print from this screen; all three are previewable. */}
            <div className="w-full flex gap-1">
              {([
                ['receipt', t('settings.receipts.previewReceipt')],
                ['80g', t('settings.receipts.preview80g')],
                ['slip', t('settings.receipts.previewSlip')],
              ] as [PreviewMode, string][]).map(([m, label]) => (
                <button
                  key={m} type="button" data-testid={`preview-mode-${m}`}
                  onClick={() => setPreviewMode(m)}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${previewMode === m ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="bg-slate-100 p-3">
            <div className="bg-white rounded shadow-sm overflow-hidden ring-1 ring-slate-200" style={{ height: '560px' }}>
              <iframe
                ref={iframeRef}
                title="Receipt Preview"
                sandbox="allow-same-origin"
                className="w-full h-full border-0"
                style={{ zoom: 0.6, height: '933px', transformOrigin: 'top left' }}
              />
            </div>
          </div>
          {previewMode === '80g' && !form.reg_80g_number.trim() && (
            <p className="px-3 pb-2 text-[11px] leading-relaxed text-amber-700" data-testid="preview-80g-note">
              {t('settings.receipts.preview80gUnavailable')}
            </p>
          )}
          <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
            <p className="text-xs text-slate-400 flex-1">{t('settings.receipts.previewUpdates')}</p>
            <button type="button" onClick={printSample} className="btn-secondary btn-sm">
              <Printer size={13} /> {t('settings.receipts.print')}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 text-center mt-2 px-4">
          {t('settings.receipts.sampleDataNote')}
        </p>
      </div>
    </div>
  )
}
