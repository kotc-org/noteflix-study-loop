import { describe, expect, it } from "vitest";

import { containsRestrictedData } from "../src/security/restricted-data.js";

describe("restricted-data guard", () => {
  it.each([
    ["payment card", "Card number: 4242 4242 4242 4242"],
    ["full-width payment card", "Card: ４２４２ ４２４２ ４２４２ ４２４２"],
    ["card security code", "CVV: 123"],
    ["formatted government identifier", "SSN: 123-45-6789"],
    ["compact labeled government identifier", "Social Security number is 123456789"],
    ["international government identifier", "Passport number: X12345678"],
    ["government identifier stated in prose", "Passport number is X12345678"],
    ["private key", "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----"],
    ["API key", "API key: live_value_8Qx2mP7nR4tV9wZ6"],
    ["password stated in prose", "The password is hunter2"],
    ["known token", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"],
    ["bearer credential", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456"],
    ["verification code", "MFA code: 483920"],
    ["medical record number", "MRN: A1234567"],
    ["date of birth", "DOB: 1990-02-03"],
    ["structured patient identity", "Patient name: Alice Smith\nDiagnosis: diabetes"],
    ["named patient with clinical facts", "Patient Alice Smith was diagnosed with diabetes."],
    ["patient email with clinical facts", "Diagnosis: diabetes\nEmail: alice.smith@example.test"],
    ["patient phone with clinical facts", "Patient treatment plan\nPhone: +1 (312) 555-0199"],
  ])("blocks %s without needing an external classifier", (_label, value) => {
    expect(containsRestrictedData([value])).toBe(true);
  });

  it("combines note fields so identity and health context cannot be split across them", () => {
    expect(containsRestrictedData([
      "Patient Alice Smith",
      "A clinical review of her diabetes diagnosis and treatment.",
    ])).toBe(true);
  });

  it.each([
    ["ordinary medical lesson", "A 45-year-old patient has hypertension. Compare ACE inhibitors with ARBs."],
    ["medical terminology", "Review diabetes symptoms, diagnosis, medication classes, and prevention."],
    ["legal privacy lesson", "HIPAA defines PHI, while PCI DSS covers payment-card information."],
    ["case-law lesson", "In Smith v. United States, compare the majority and dissenting opinions."],
    ["masked card", "The card ending in 4242 is a masked example."],
    ["masked SSN", "Use XXX-XX-XXXX when explaining the SSN format."],
    ["auth placeholder", "Send Authorization: Bearer <token>."],
    ["API placeholder", "Set API key: example-key in the sample configuration."],
    ["de-identified patient", "Patient John Doe has a hypothetical diabetes diagnosis for this case study."],
    ["generic patient grammar", "The patient has diabetes and receives treatment."],
    ["policy statement", "A patient ID is protected and should never appear in study notes."],
    ["identifier explanation", "A member ID is used to associate a person with a health plan."],
    ["credential explanation", "A verification code is sent by SMS and a password is required."],
    ["passport explanation", "A passport number is issued by a national government."],
  ])("allows %s", (_label, value) => {
    expect(containsRestrictedData([value])).toBe(false);
  });

  it("does not retain regular-expression state between calls", () => {
    const restricted = "SSN: 123-45-6789";
    expect(containsRestrictedData([restricted])).toBe(true);
    expect(containsRestrictedData([restricted])).toBe(true);
    expect(containsRestrictedData(["Cell membranes and transport proteins."])).toBe(false);
  });
});
