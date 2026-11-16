import re
from typing import Any, Dict, List, Optional, Tuple
from bs4 import BeautifulSoup

GSTIN_RE = re.compile(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b", re.I)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?:\+91[\s-]?)?[6-9]\d{9}\b|\b0\d{2,4}[\s-]?\d{6,8}\b")
DATE_RE = re.compile(
    r"\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b"
)

STATE_CODE_MAP = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
}

MONTH_MAP = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


def field(value: Any, confidence: Optional[float]) -> Dict[str, Any]:
    return {
        "value": value,
        "confidence": round(float(confidence), 4) if confidence is not None else None,
    }


def _parse_num(raw: str) -> Optional[float]:
    cleaned = re.sub(r"[^\d.\-]", "", (raw or "").replace(",", ""))
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _normalize_date(raw: str) -> str:
    txt = (raw or "").strip()
    if not txt:
        return ""
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", txt)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$", txt)
    if m:
        d, mo, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if yr < 100:
            yr += 2000
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{yr:04d}-{mo:02d}-{d:02d}"
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$", txt)
    if m:
        d, mo_str, yr = int(m.group(1)), m.group(2).lower(), int(m.group(3))
        if yr < 100:
            yr += 2000
        mo = MONTH_MAP.get(mo_str)
        if mo and 1 <= d <= 31:
            return f"{yr:04d}-{mo:02d}-{d:02d}"
    return ""


def _collect_lines_and_tables(pages_output: List[Any]) -> Tuple[List[Tuple[str, float]], List[Tuple[str, Optional[float]]]]:
    """
    Extract (text, confidence) lines and (html_table, avg_confidence) tuples
    from PaddleOCR PP-StructureV3 prediction output.
    """
    lines: List[Tuple[str, float]] = []
    tables: List[Tuple[str, Optional[float]]] = []

    for res in pages_output:
        payload = res.json if hasattr(res, "json") else (res if isinstance(res, dict) else {})
        inner = payload.get("res", payload) if isinstance(payload, dict) else {}

        # 1. Overall OCR lines (text + score)
        overall_ocr = inner.get("overall_ocr_res") or {}
        rec_texts = overall_ocr.get("rec_texts") or []
        rec_scores = overall_ocr.get("rec_scores") or []
        for idx, txt in enumerate(rec_texts):
            s = str(txt).strip()
            if not s:
                continue
            conf = float(rec_scores[idx]) if idx < len(rec_scores) else 0.75
            lines.append((s, conf))

        # 2. Layout parsing blocks fallback if overall_ocr_res absent
        if not rec_texts:
            for blk in inner.get("parsing_res_list") or []:
                content = str(blk.get("block_content") or "").strip()
                if content:
                    for ln in content.splitlines():
                        if ln.strip():
                            lines.append((ln.strip(), 0.75))

        # 3. Tables (PP-StructureV3 table_res_list)
        for tbl in inner.get("table_res_list") or []:
            html = tbl.get("pred_html") or tbl.get("html") or ""
            tbl_ocr = tbl.get("table_ocr_pred") or {}
            scores = tbl_ocr.get("rec_scores") or []
            avg_conf = (sum(float(x) for x in scores) / len(scores)) if scores else None
            if html:
                tables.append((str(html), avg_conf))

        # 4. Also check parsing blocks tagged as table
        if not (inner.get("table_res_list")):
            for blk in inner.get("parsing_res_list") or []:
                content = str(blk.get("block_content") or "")
                if "<table" in content.lower():
                    tables.append((content, None))

    return lines, tables


def _find_labeled_value(lines: List[Tuple[str, float]], patterns: List[str]) -> Tuple[str, Optional[float]]:
    for idx, (text, conf) in enumerate(lines):
        for pat in patterns:
            m = re.search(pat, text, re.I)
            if m:
                val = (m.group(1) if m.lastindex else "").strip(" :-\t")
                if val:
                    return val, conf
                if idx + 1 < len(lines):
                    nxt, nconf = lines[idx + 1]
                    return nxt.strip(), min(conf, nconf)
    return "", None


def _parse_html_table_items(
    tables: List[Tuple[str, Optional[float]]],
    lines: List[Tuple[str, float]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Tuple[Optional[float], Optional[float]]]]:
    items: List[Dict[str, Any]] = []
    summary_hints: Dict[str, Tuple[Optional[float], Optional[float]]] = {}

    line_conf_lookup = {txt.lower(): conf for txt, conf in lines}

    for html, tbl_conf in tables:
        soup = BeautifulSoup(html, "html.parser")
        rows = soup.find_all("tr")
        if len(rows) < 2:
            continue

        # Identify header row
        header_cells: List[str] = []
        body_start_idx = 0
        for r_idx, row in enumerate(rows[:3]):
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["th", "td"])]
            joined = " ".join(cells).lower()
            if any(k in joined for k in ["item", "description", "particular", "product", "hsn", "qty", "rate", "amount"]):
                header_cells = [c.lower() for c in cells]
                body_start_idx = r_idx + 1
                break

        if not header_cells:
            continue

        def col_index(keywords: List[str]) -> int:
            for idx, h in enumerate(header_cells):
                if any(k in h for k in keywords):
                    return idx
            return -1

        idx_name = col_index(["item", "description", "particular", "product", "goods", "service"])
        idx_hsn = col_index(["hsn", "sac"])
        idx_qty = col_index(["qty", "quantity", "qnty"])
        idx_unit = col_index(["unit", "uom", "per"])
        idx_rate = col_index(["rate", "price", "unit price"])
        idx_disc = col_index(["disc", "discount"])
        idx_taxable = col_index(["taxable"])
        idx_gst_rate = col_index(["gst %", "tax %", "gst rate", "igst %", "cgst %", "gst"])
        idx_cgst = col_index(["cgst"])
        idx_sgst = col_index(["sgst", "utgst"])
        idx_igst = col_index(["igst"])
        idx_total = col_index(["total", "amount", "net amt", "line total"])

        if idx_name < 0 and len(header_cells) >= 2:
            idx_name = 1 if header_cells[0] in {"#", "sr", "sr.", "s.no", "sno", "no"} else 0

        for row in rows[body_start_idx:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            if not cells or all(not c for c in cells):
                continue
            joined_row = " ".join(cells).lower()

            # Check if this row is a table footer / summary row
            if any(k in joined_row for k in ["grand total", "total amount", "net payable", "round off", "sub total", "subtotal"]):
                last_num = None
                for cell in reversed(cells):
                    n = _parse_num(cell)
                    if n is not None:
                        last_num = n
                        break
                if last_num is not None:
                    if "grand" in joined_row or "net payable" in joined_row:
                        summary_hints["grandTotal"] = (last_num, tbl_conf)
                    elif "round" in joined_row:
                        summary_hints["roundOff"] = (last_num, tbl_conf)
                    elif "sub" in joined_row:
                        summary_hints["subtotal"] = (last_num, tbl_conf)
                continue

            name_val = cells[idx_name] if 0 <= idx_name < len(cells) else ""
            if not name_val or re.match(r"^(total|sub\s*total|cgst|sgst|igst)$", name_val.strip(), re.I):
                continue

            def cell_text(col: int) -> str:
                return cells[col].strip() if 0 <= col < len(cells) else ""

            def cell_conf(text_val: str) -> Optional[float]:
                if not text_val:
                    return tbl_conf
                return line_conf_lookup.get(text_val.lower(), tbl_conf)

            hsn_val = re.sub(r"\D", "", cell_text(idx_hsn))[:8]
            qty_raw = cell_text(idx_qty)
            qty_num = _parse_num(qty_raw)
            unit_val = cell_text(idx_unit)
            if not unit_val and qty_raw:
                unit_match = re.search(r"([A-Za-z]{2,8})$", qty_raw.strip())
                if unit_match:
                    unit_val = unit_match.group(1)

            rate_num = _parse_num(cell_text(idx_rate))
            disc_num = _parse_num(cell_text(idx_disc)) or 0.0
            taxable_num = _parse_num(cell_text(idx_taxable))
            gst_text = cell_text(idx_gst_rate)
            gst_rate_num = _parse_num(gst_text)
            if gst_rate_num is not None and gst_rate_num > 28:
                # Avoid misreading GST rupee amount as GST % when column lacked %
                gst_rate_num = None

            cgst_num = _parse_num(cell_text(idx_cgst)) or 0.0
            sgst_num = _parse_num(cell_text(idx_sgst)) or 0.0
            igst_num = _parse_num(cell_text(idx_igst)) or 0.0
            total_num = _parse_num(cell_text(idx_total))

            items.append(
                {
                    "name": field(name_val, cell_conf(name_val)),
                    "hsnSac": field(hsn_val, cell_conf(cell_text(idx_hsn))),
                    "quantity": field(qty_num if qty_num is not None else 1.0, cell_conf(qty_raw)),
                    "unit": field(unit_val or "Nos", cell_conf(unit_val) if unit_val else tbl_conf),
                    "rate": field(rate_num if rate_num is not None else 0.0, cell_conf(cell_text(idx_rate))),
                    "discount": field(disc_num, cell_conf(cell_text(idx_disc))),
                    "taxableValue": field(taxable_num if taxable_num is not None else 0.0, cell_conf(cell_text(idx_taxable))),
                    "gstRate": field(gst_rate_num if gst_rate_num is not None else 0.0, cell_conf(gst_text)),
                    "cgst": field(cgst_num, cell_conf(cell_text(idx_cgst))),
                    "sgst": field(sgst_num, cell_conf(cell_text(idx_sgst))),
                    "igst": field(igst_num, cell_conf(cell_text(idx_igst))),
                    "lineTotal": field(total_num if total_num is not None else 0.0, cell_conf(cell_text(idx_total))),
                }
            )

    return items, summary_hints


def parse_purchase_bill_structure(
    pages_output: List[Any], processing_ms: int
) -> Dict[str, Any]:
    lines, tables = _collect_lines_and_tables(pages_output)
    raw_text = "\n".join(text for text, _ in lines)

    # Supplier GSTIN (prefer first valid GSTIN found)
    supplier_gstin = ""
    supplier_gstin_conf: Optional[float] = None
    for txt, conf in lines:
        m = GSTIN_RE.search(txt.replace(" ", ""))
        if m:
            supplier_gstin = m.group(1).upper()
            supplier_gstin_conf = conf
            break

    # Supplier business name: top prominent non-header line before GSTIN/Invoice label
    supplier_name = ""
    supplier_name_conf: Optional[float] = None
    skip_words = {"tax invoice", "invoice", "bill of supply", "original for recipient", "cash memo", "estimate", "gstin"}
    for txt, conf in lines[:12]:
        low = txt.lower().strip()
        if len(txt) < 3 or any(w in low for w in skip_words):
            continue
        if GSTIN_RE.search(txt.replace(" ", "")) or DATE_RE.search(txt):
            continue
        supplier_name = txt.strip()
        supplier_name_conf = conf
        break

    # State from GSTIN prefix or text match
    supplier_state = ""
    supplier_state_conf: Optional[float] = None
    if supplier_gstin and supplier_gstin[:2] in STATE_CODE_MAP:
        supplier_state = STATE_CODE_MAP[supplier_gstin[:2]]
        supplier_state_conf = supplier_gstin_conf
    else:
        for txt, conf in lines:
            low = txt.lower()
            for state_name in STATE_CODE_MAP.values():
                if state_name.lower() in low:
                    supplier_state = state_name
                    supplier_state_conf = conf
                    break
            if supplier_state:
                break

    # Phone & Email
    supplier_phone = ""
    supplier_phone_conf: Optional[float] = None
    supplier_email = ""
    supplier_email_conf: Optional[float] = None
    for txt, conf in lines:
        if not supplier_email:
            em = EMAIL_RE.search(txt)
            if em:
                supplier_email = em.group(0)
                supplier_email_conf = conf
        if not supplier_phone:
            ph = PHONE_RE.search(txt)
            if ph:
                supplier_phone = ph.group(0).strip()
                supplier_phone_conf = conf

    # Address near top lines
    address_lines: List[str] = []
    address_confs: List[float] = []
    for txt, conf in lines[1:14]:
        low = txt.lower()
        if any(k in low for k in ["invoice no", "bill no", "date", "buyer", "bill to", "ship to", "gstin"]):
            continue
        if txt == supplier_name or EMAIL_RE.search(txt):
            continue
        if any(k in low for k in ["road", "street", "floor", "park", "nagar", "ind", "plot", "city", "dist", "pin", "mumbai", "delhi", "bengaluru", "pune", "chennai"]) or re.search(r"\b\d{6}\b", txt):
            address_lines.append(txt)
            address_confs.append(conf)
    supplier_address = ", ".join(address_lines[:3])
    supplier_address_conf = (sum(address_confs) / len(address_confs)) if address_confs else None

    # Invoice numbers / dates / PO
    inv_num, inv_num_conf = _find_labeled_value(
        lines,
        [
            r"(?:invoice|bill)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})",
            r"\binv\s*(?:no\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})",
        ],
    )
    po_num, po_num_conf = _find_labeled_value(
        lines,
        [r"(?:p\.?o\.?|purchase\s*order|ref(?:erence)?)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})"],
    )
    inv_date_raw, inv_date_conf = _find_labeled_value(
        lines,
        [r"(?:invoice|bill)\s*date\s*[:\-]?\s*(.+)", r"\bdated?\s*[:\-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}.*)"],
    )
    due_date_raw, due_date_conf = _find_labeled_value(
        lines,
        [r"(?:due|payment\s*due)\s*date\s*[:\-]?\s*(.+)"],
    )

    inv_date = _normalize_date(DATE_RE.search(inv_date_raw).group(1)) if DATE_RE.search(inv_date_raw) else ""
    if not inv_date:
        for txt, conf in lines[:25]:
            dm = DATE_RE.search(txt)
            if dm:
                parsed_d = _normalize_date(dm.group(1))
                if parsed_d:
                    inv_date = parsed_d
                    inv_date_conf = conf
                    break
    due_date = _normalize_date(DATE_RE.search(due_date_raw).group(1)) if DATE_RE.search(due_date_raw) else ""

    items, table_summary_hints = _parse_html_table_items(tables, lines)

    def _extract_summary_amount(patterns: List[str], hint_key: Optional[str] = None) -> Tuple[float, Optional[float]]:
        val_str, conf = _find_labeled_value(lines, patterns)
        if val_str:
            n = _parse_num(val_str)
            if n is not None:
                return n, conf
        if hint_key and hint_key in table_summary_hints:
            val, hconf = table_summary_hints[hint_key]
            if val is not None:
                return val, hconf
        return 0.0, None

    subtotal_val, subtotal_conf = _extract_summary_amount(
        [r"(?:sub\s*-?\s*total)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)"],
        "subtotal",
    )
    discount_val, discount_conf = _extract_summary_amount(
        [r"(?:total\s*)?discount\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)"]
    )
    taxable_val, taxable_conf = _extract_summary_amount(
        [r"(?:total\s*)?taxable\s*(?:value|amount)?\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)"]
    )
    cgst_val, cgst_conf = _extract_summary_amount(
        [r"(?:total\s*)?cgst\b[^0-9]*([\d,]+\.\d{1,2})"]
    )
    sgst_val, sgst_conf = _extract_summary_amount(
        [r"(?:total\s*)?(?:sgst|utgst)\b[^0-9]*([\d,]+\.\d{1,2})"]
    )
    igst_val, igst_conf = _extract_summary_amount(
        [r"(?:total\s*)?igst\b[^0-9]*([\d,]+\.\d{1,2})"]
    )
    total_gst_val, total_gst_conf = _extract_summary_amount(
        [r"(?:total\s*(?:gst|tax))\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2})"]
    )
    if total_gst_val == 0 and (cgst_val or sgst_val or igst_val):
        total_gst_val = round(cgst_val + sgst_val + igst_val, 2)
        confs = [c for c in [cgst_conf, sgst_conf, igst_conf] if c is not None]
        total_gst_conf = (sum(confs) / len(confs)) if confs else None

    add_charges_val, add_charges_conf = _extract_summary_amount(
        [r"(?:freight|shipping|packing|other\s*charges|additional\s*charges)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2})"]
    )
    round_off_val, round_off_conf = _extract_summary_amount(
        [r"round\s*off\s*[:\-]?\s*([\-+]?[\d,]+\.\d{1,2})"],
        "roundOff",
    )
    grand_total_val, grand_total_conf = _extract_summary_amount(
        [r"(?:grand\s*total|invoice\s*total|net\s*payable|total\s*payable)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)"],
        "grandTotal",
    )

    return {
        "success": True,
        "engine": "PaddleOCR PP-StructureV3",
        "pageCount": len(pages_output),
        "processingMs": processing_ms,
        "supplier": {
            "businessName": field(supplier_name, supplier_name_conf),
            "gstin": field(supplier_gstin, supplier_gstin_conf),
            "address": field(supplier_address, supplier_address_conf),
            "state": field(supplier_state, supplier_state_conf),
            "phone": field(supplier_phone, supplier_phone_conf),
            "email": field(supplier_email, supplier_email_conf),
        },
        "invoice": {
            "invoiceNumber": field(inv_num, inv_num_conf),
            "invoiceDate": field(inv_date, inv_date_conf),
            "dueDate": field(due_date, due_date_conf),
            "poNumber": field(po_num, po_num_conf),
        },
        "items": items,
        "summary": {
            "subtotal": field(subtotal_val, subtotal_conf),
            "totalDiscount": field(discount_val, discount_conf),
            "totalTaxableValue": field(taxable_val, taxable_conf),
            "totalGst": field(total_gst_val, total_gst_conf),
            "cgstTotal": field(cgst_val, cgst_conf),
            "sgstTotal": field(sgst_val, sgst_conf),
            "igstTotal": field(igst_val, igst_conf),
            "additionalCharges": field(add_charges_val, add_charges_conf),
            "roundOff": field(round_off_val, round_off_conf),
            "grandTotal": field(grand_total_val, grand_total_conf),
        },
        "rawText": raw_text[:12000],
    }
