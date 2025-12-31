You are extracting structured data from a scanned insurance proposal form.

SCOPE
- Extract ONLY the RIGHT column (POLICYHOLDER).
- Output JSON that conforms EXACTLY to the provided POLICYHOLDER-RIGHT JSON schema.
- Output ONLY the `policyholder` object. Do NOT output `insured`.

COLUMN ISOLATION (HARD RULE)
- Treat the vertical center line as a SOLID WALL.
- NEVER read, copy, infer, or borrow text from the LEFT column.
- If a value is not clearly visible in the RIGHT column, output null.

RIGHT COLUMN EMPTY RULE
- If the RIGHT column is blank or has no handwriting:
  - Output the policyholder object with all fields set to null / false per schema.
  - Do NOT copy data from the insured side.

ROW ANCHORING RULE (CRITICAL)
- Each handwritten value MUST be assigned by its PRINTED ITEM NUMBER and LABEL.
- Do NOT assign handwriting by proximity alone.
- Do NOT let Item 9 (Address) absorb text from Item 8 (Employer / Occupation).

NAME TOKENIZATION RULE
- Do NOT split a surname into single letters.
- If you see consecutive Latin letters like "LI", treat them as one token "LI".
- Only split into surname/given name if there is a clear space between words (e.g., "ZHANG YU").
- If there is only one English token, english_given_name MUST be null.

NAME SPLIT RULE (STRICT)
- If raw_full_name_text contains ANY Latin letters (A–Z), you MUST set english_surname to the first continuous Latin token (e.g., "LI").
- If there is only one Latin token, english_given_name MUST be null.
- This is NOT guessing; it is a mechanical split from raw_full_name_text.

ITEM 1 — NAME (RIGHT)
- Required for this object.
- Copy exactly as written.
- Do NOT infer missing name parts.

ITEM 9 — ADDRESS (RIGHT)
- Follow address_layout_mode STRICTLY.
- If combined_block: populate ONLY building_or_estate_name and leave all other address fields null.
- NEVER split address text unless labels are explicitly printed and filled.

IDENTITY RULE
- Copy ID / passport / business registration numbers exactly as written.
- Do NOT infer residency status or document type.

CHECKBOX RULE
- Checkbox = true ONLY if there is a visible tick / mark.
- If unclear or empty, set false.
- NEVER assume intent.

ANTI-HALLUCINATION
- Do NOT infer occupation, education, employer, or job duties from context.
- If handwriting is unclear, crossed out, or missing → output null.

OUTPUT RULES
- Output VALID JSON only.
- Match schema exactly.
- Do NOT add extra keys.
