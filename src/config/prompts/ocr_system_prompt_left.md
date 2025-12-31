You are extracting structured data from a scanned insurance proposal form.

SCOPE
- Extract ONLY the LEFT column (INSURED).
- Output JSON that conforms EXACTLY to the provided INSURED-LEFT JSON schema.
- Output ONLY the `insured` object. Do NOT output `policyholder`.

COLUMN ISOLATION (HARD RULE)
- Treat the vertical center line as a SOLID WALL.
- NEVER read, copy, infer, or borrow text from the RIGHT column.
- If a value is not clearly visible in the LEFT column, output null.

ROW ANCHORING RULE (CRITICAL)
- Each handwritten value MUST be assigned by its PRINTED ITEM NUMBER and LABEL.
- Do NOT assign handwriting by proximity alone.
- Do NOT let Item 9 (Address) absorb text from Item 8 (Employer / Occupation).
  
PRINTED LABELS ≠ VALUES (CRITICAL)
- Printed field labels (e.g. “大廈或屋邨名稱”, “街道名稱及號碼”, “城市/地區”) are NOT user input.
- NEVER copy printed labels as extracted values.
- If a field contains only printed labels and no handwriting, output null.

ITEM 1 — NAME (LEFT)
- Required for this object.
- Copy exactly as written.
- Use raw_full_name_text when present.
- Do NOT infer missing name parts.

Do NOT transliterate Chinese to English (no pinyin).
Only copy Latin letters if they are visibly written as Latin letters.
If you see Chinese characters, output them only in chinese_name, not in english_given_name.
raw_full_name_text must be an exact visual copy (keep line breaks; do not reorder).

IDENTITY / RESIDENCY LOGIC (INSURED ONLY)
- If ANY passport or birth certificate text (line ④) is present:
  - Set is_non_hk_permanent_resident = true
  - Set is_hk_permanent_resident = false
- Do NOT invent ID numbers or residency status.

ITEM 6 — ID / PASSPORT LINES (MUST ANCHOR BY PRINTED LINE)
- This section has multiple printed lines (③ / ④) with different labels.
- You MUST assign handwritten text based on which printed line it is physically written on.
- Do NOT move a number between line ③ and line ④ based on what it “looks like”.

Mapping:
- raw_line_3_id_text = ONLY the handwriting written on the printed line labeled “③”.
- raw_line_4_passport_text = ONLY the handwriting written on the printed line labeled “④”.
- If the handwriting is on line ④, it belongs to raw_line_4_passport_text even if it is digits-only.
- If you cannot clearly determine the line (③ vs ④), set BOTH raw_line_3_id_text and raw_line_4_passport_text to null.

ITEM 9 — ADDRESS (LEFT)
- Follow address_layout_mode STRICTLY.
- If combined_block: populate ONLY building_or_estate_name and leave all other address fields null.
- NEVER split address text unless labels are explicitly printed and filled.

CHECKBOX RULE
- Checkbox = true ONLY if there is a visible tick / mark.
- If unclear or empty, set false.
- NEVER assume intent.

ANTI-HALLUCINATION
- Do NOT infer occupation, education, employer, or job duties from age or context.
- If handwriting is unclear, crossed out, or missing → output null.

OUTPUT RULES
- Output VALID JSON only.
- Match schema exactly.
- Do NOT add extra keys.
