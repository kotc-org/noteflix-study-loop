export type RestrictedDataText = string | null | undefined;

const ZERO_WIDTH_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/gu;
const PAYMENT_CARD_CANDIDATE = /(?:^|[^\d])((?:\d[ -]?){12,18}\d)(?=$|[^\d])/gu;
const FORMATTED_SSN = /\b\d{3}-\d{2}-\d{4}\b/gu;
const LABELED_SSN = /\b(?:ssn|social security(?: number)?|social insurance(?: number)?|sin)\s*(?:[:=#]|\bis\b)\s*(\d{9})\b/giu;
const LABELED_GOVERNMENT_ID = /\b(?:passport(?:\s+(?:number|no\.?))?|national (?:id|identification)(?: number)?|tax(?:payer)? (?:id|identification)(?: number)?|tin|driver['’]?s licen[cs]e(?: number)?|state id(?: number)?|resident permit(?: number)?|alien registration(?: number)?|a-number|aadhaar(?: number)?|nino)\s*[:=#]\s*([a-z0-9][a-z0-9-]{4,23})\b/giu;
const GOVERNMENT_ID_IS = /\b(?:passport(?:\s+(?:number|no\.?))?|national (?:id|identification)(?: number)?|tax(?:payer)? (?:id|identification)(?: number)?|tin|driver['’]?s licen[cs]e(?: number)?|state id(?: number)?|resident permit(?: number)?|alien registration(?: number)?|a-number|aadhaar(?: number)?|nino)\s+is\s+([a-z0-9][a-z0-9-]{4,23})\b/giu;
const CARD_SECURITY_CODE = /\b(?:cvv2?|cvc2?|cid|card security code)\s*(?:[:=#]|\bis\b)\s*\d{3,4}\b/giu;

const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/giu;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/gu;
const KNOWN_SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  /\bsk_live_[A-Za-z0-9]{16,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAIza[0-9A-Za-z_-]{30,}\b/gu,
] as const;
const BEARER_SECRET = /\bbearer\s+([A-Za-z0-9._~+/=-]{16,})/giu;
const LABELED_SECRET = /\b(?:password|passcode|api[ _-]?key|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth(?:entication)?[ _-]?token|session[ _-]?token|secret[ _-]?key|private[ _-]?token|mfa[ _-]?(?:code|token)|otp|one[ _-]?time(?:[ _-]?(?:password|code))?|verification[ _-]?code)\s*[:=#]\s*([^\s,;"'`]{4,})/giu;
const SECRET_IS = /\b(?:password|passcode|api[ _-]?key|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth(?:entication)?[ _-]?token|session[ _-]?token|secret[ _-]?key|private[ _-]?token|mfa[ _-]?(?:code|token)|otp|one[ _-]?time(?:[ _-]?(?:password|code))?|verification[ _-]?code)\s+is\s+([^\s,;"'`]{4,})/giu;
const CREDENTIAL_URL = /https?:\/\/[^/\s:@]+:([^@\s/]{4,})@/giu;

const HEALTH_IDENTIFIER = /\b(?:mrn|medical record(?: number)?|patient (?:id|identifier)|health plan (?:id|number)|beneficiary (?:id|number)|member id)\s*[:=#]\s*([a-z0-9][a-z0-9-]{3,31})\b/giu;
const HEALTH_IDENTIFIER_IS = /\b(?:mrn|medical record(?: number)?|patient (?:id|identifier)|health plan (?:id|number)|beneficiary (?:id|number)|member id)\s+is\s+([a-z0-9][a-z0-9-]{3,31})\b/giu;
const DATE_OF_BIRTH = /\b(?:dob|date of birth)\s*(?:[:=#]|\bis\b)\s*((?:(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:(?:19|20)?\d{2})))\b/giu;
const STRUCTURED_PATIENT_NAME = /\b(?:patient|member) name\s*[:=#]\s*([\p{L}][\p{L}'’.-]{1,40}\s+[\p{L}][\p{L}'’.-]{1,40})/giu;
const PATIENT_NAMED = /\bpatient\s+named\s+([\p{L}][\p{L}'’.-]{1,40}\s+[\p{L}][\p{L}'’.-]{1,40})/giu;
const DIRECT_NAMED_PATIENT = /\b[Pp]atient\s+([\p{Lu}][\p{L}'’.-]{1,40}\s+[\p{Lu}][\p{L}'’.-]{1,40})/gu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const LABELED_PHONE = /\b(?:phone|telephone|mobile)\s*[:=#]\s*(\+?\d[\d ().-]{6,}\d)/giu;
const LABELED_ADDRESS = /\b(?:patient )?address\s*[:=#]\s*(\d{1,6}\s+[\p{L}\d.'’-]+(?:\s+[\p{L}\d.'’-]+){0,5}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct)\.?)/giu;
const CLINICAL_CONTEXT = /\b(?:diagnos(?:is|ed)|disease|disorder|syndrome|symptom|medical|clinical|treat(?:ment|ed)|therapy|medication|prescription|dosage?|lab result|test result|blood pressure|heart rate|allerg(?:y|ies)|hospital|clinic|physician|patient|prognosis|surgery|imaging|x-ray|mri|cancer|diabetes|hiv|pregnan(?:cy|t)|mental health)\b/iu;

function normalizeRestrictedDataText(segments: readonly RestrictedDataText[]): string {
  return segments
    .filter((segment): segment is string => typeof segment === "string" && segment.length > 0)
    .join("\n")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARACTERS, "");
}

function isPlaceholderValue(rawValue: string): boolean {
  const value = rawValue.trim().replace(/^["'`]|["'`.]$/gu, "").toLowerCase();
  return /^<[^>]+>$/u.test(value)
    || /^\$\{[^}]+\}$/u.test(value)
    || /^(?:redacted|placeholder|example|sample|fake|dummy|test(?:-?only)?|changeme|unknown|unavailable|omitted|required|regulated|prohibited|protected|confidential|sensitive|private|x{3,}|\*{3,})$/u.test(value)
    || /^(?:test|example|sample|fake|dummy|your)[-_][a-z0-9._-]+$/u.test(value);
}

function isPlaceholderPerson(rawValue: string): boolean {
  const value = rawValue.trim().replace(/\s+/gu, " ").toLowerCase();
  return isPlaceholderValue(value)
    || new Set([
      "john doe",
      "jane doe",
      "example patient",
      "sample patient",
      "test patient",
    ]).has(value);
}

function containsConcreteCapture(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (typeof value === "string" && !isPlaceholderValue(value)) return true;
  }
  return false;
}

function containsCaptureMatching(
  text: string,
  pattern: RegExp,
  predicate: (value: string) => boolean,
): boolean {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (typeof value === "string" && !isPlaceholderValue(value) && predicate(value)) return true;
  }
  return false;
}

function matches(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function isLuhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function containsPaymentCardNumber(text: string): boolean {
  PAYMENT_CARD_CANDIDATE.lastIndex = 0;
  for (const match of text.matchAll(PAYMENT_CARD_CANDIDATE)) {
    const digits = (match[1] ?? "").replace(/\D/gu, "");
    if (isLuhnValid(digits)) return true;
  }
  return false;
}

function containsKnownSecret(text: string): boolean {
  if (matches(text, PRIVATE_KEY) || matches(text, JWT)) return true;
  for (const pattern of KNOWN_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return containsConcreteCapture(text, BEARER_SECRET)
    || containsConcreteCapture(text, LABELED_SECRET)
    || containsCaptureMatching(
      text,
      SECRET_IS,
      (value) => /\d/u.test(value)
        || value.length >= 16
        || (value.length >= 8 && /[A-Z]/u.test(value) && /[a-z]/u.test(value)),
    )
    || containsConcreteCapture(text, CREDENTIAL_URL);
}

function hasClinicalContextNear(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, (match.index ?? 0) - 300);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 300);
    if (CLINICAL_CONTEXT.test(text.slice(start, end))) return true;
  }
  return false;
}

function containsProtectedHealthInformation(text: string): boolean {
  if (containsConcreteCapture(text, HEALTH_IDENTIFIER)) return true;
  if (containsCaptureMatching(text, HEALTH_IDENTIFIER_IS, (value) => /\d/u.test(value))) return true;
  if (containsConcreteCapture(text, DATE_OF_BIRTH)) return true;

  STRUCTURED_PATIENT_NAME.lastIndex = 0;
  for (const match of text.matchAll(STRUCTURED_PATIENT_NAME)) {
    if (match[1] && !isPlaceholderPerson(match[1])) return true;
  }

  for (const pattern of [PATIENT_NAMED, DIRECT_NAMED_PATIENT]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!match[1] || isPlaceholderPerson(match[1])) continue;
      const start = Math.max(0, (match.index ?? 0) - 300);
      const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 300);
      if (CLINICAL_CONTEXT.test(text.slice(start, end))) return true;
    }
  }

  return hasClinicalContextNear(text, EMAIL)
    || hasClinicalContextNear(text, LABELED_PHONE)
    || hasClinicalContextNear(text, LABELED_ADDRESS);
}

export function containsRestrictedData(segments: readonly RestrictedDataText[]): boolean {
  const text = normalizeRestrictedDataText(segments);
  if (!text) return false;

  if (containsPaymentCardNumber(text) || matches(text, CARD_SECURITY_CODE)) return true;
  if (matches(text, FORMATTED_SSN) || containsConcreteCapture(text, LABELED_SSN)) return true;
  if (containsConcreteCapture(text, LABELED_GOVERNMENT_ID)) return true;
  if (containsCaptureMatching(text, GOVERNMENT_ID_IS, (value) => /\d/u.test(value))) return true;
  if (containsKnownSecret(text)) return true;
  return containsProtectedHealthInformation(text);
}
