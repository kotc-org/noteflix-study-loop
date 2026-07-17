#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const project = process.env.GCP_PROJECT_ID ?? "studywnoteflix";
const reviewerSecret = process.env.REVIEWER_SECRET_NAME;
const transportOrigin = process.env.MCP_TRANSPORT_ORIGIN;
const publicOrigin = process.env.MCP_PUBLIC_ORIGIN;
const fixtureMode = process.argv.includes("--create-review-fixture");
const fixtureSecret = process.env.FIXTURE_SECRET_NAME;
const foreignReviewerSecret = process.env.FOREIGN_REVIEWER_SECRET_NAME;
const primaryReviewerSecret = "noteflix-anthropic-reviewer-credentials";
const syntheticReviewerSecret = "noteflix-openai-cross-account-fixture-credentials";
const productionProject = "studywnoteflix";
const productionPublicOrigin = "https://chatgpt.noteflix.com";
const productionTransportOrigins = new Set([
  productionPublicOrigin,
  "https://noteflix-openai-mcp-738470476706.us-central1.run.app",
]);
const oauthDatabaseId = "noteflix-openai-mcp";
const oauthCollectionPrefix = "noteflix_openai_mcp";

if (process.argv.slice(2).some((argument) => argument !== "--create-review-fixture")) {
  throw new Error("The only supported argument is --create-review-fixture.");
}

if (!reviewerSecret || !transportOrigin || !publicOrigin) {
  throw new Error(
    "REVIEWER_SECRET_NAME, MCP_TRANSPORT_ORIGIN, and MCP_PUBLIC_ORIGIN are required.",
  );
}
if (
  fixtureMode
  && (
    !fixtureSecret
    || !foreignReviewerSecret
    || process.env.REVIEW_FIXTURE_CONFIRMATION
      !== "CREATE_ONE_PUBLIC_VIDEO_USING_ONE_REVIEWER_CREDIT"
  )
) {
  throw new Error(
    "Fixture mode requires FIXTURE_SECRET_NAME, FOREIGN_REVIEWER_SECRET_NAME, and the exact REVIEW_FIXTURE_CONFIRMATION value.",
  );
}
if (
  fixtureMode
  && !(
    (reviewerSecret === primaryReviewerSecret && foreignReviewerSecret === syntheticReviewerSecret)
    || (reviewerSecret === syntheticReviewerSecret && foreignReviewerSecret === primaryReviewerSecret)
  )
) {
  throw new Error("Fixture mode accepts only the two dedicated reviewer accounts as counterparts.");
}

const transportBase = new URL(transportOrigin);
const publicBase = new URL(publicOrigin);
if (
  project !== productionProject
  || transportBase.protocol !== "https:"
  || publicBase.protocol !== "https:"
  || transportBase.username
  || transportBase.password
  || transportBase.search
  || transportBase.hash
  || publicBase.username
  || publicBase.password
  || publicBase.search
  || publicBase.hash
  || transportBase.pathname !== "/"
  || publicBase.pathname !== "/"
  || !productionTransportOrigins.has(transportBase.origin)
  || publicBase.origin !== productionPublicOrigin
) {
  throw new Error("The production verifier accepts only the exact allowlisted HTTPS project and origins.");
}

const resource = new URL("/mcp", publicBase).href;
const callback = "https://chatgpt.com/connector/oauth/noteflix_readonly_verifier";
const scopes = fixtureMode
  ? ["notes:create", "videos:create", "videos:read", "videos:publish"]
  : ["videos:read"];
const expectedTools = [
  "create_private_note",
  "create_public_note_video",
  "get_video_allowance",
  "get_video_status",
];
const allowanceKeys = [
  "can_generate",
  "completed",
  "eligible",
  "in_flight",
  "limit",
  "message",
  "period_start",
  "reason",
  "remaining",
  "resets_at",
  "used",
];
const noteRequestId = "d9be0ee2-8e8c-4f7a-9d6b-95c379874f33";
const videoRequestId = "f2647278-7c37-4ab8-a645-e92ee0bab1c1";
const fixtureTitle = "Cell Membrane Basics — OpenAI Review Fixture";
const fixtureContent = [
  "# Cell membrane basics",
  "",
  "The cell membrane is a flexible boundary built mainly from a phospholipid bilayer.",
  "",
  "- Hydrophilic heads face watery environments inside and outside the cell.",
  "- Hydrophobic tails face inward, away from water.",
  "- Membrane proteins help move substances, receive signals, and anchor structures.",
  "- Cholesterol helps animal-cell membranes remain stable across temperature changes.",
  "",
  "This structure is often described by the fluid mosaic model because many components can move within the membrane.",
].join("\n");
const fixturePollLimit = 45;

function fixtureNoteArguments() {
  return {
    request_id: noteRequestId,
    title: fixtureTitle,
    content_markdown: fixtureContent,
    summary: "A concise overview of the cell membrane and the fluid mosaic model.",
    key_points: [
      "Phospholipids form a bilayer.",
      "Proteins support transport, signaling, and structure.",
      "Cholesterol helps stabilize animal-cell membranes.",
    ],
  };
}

function fixtureVideoArguments(noteId) {
  return {
    request_id: videoRequestId,
    note_id: noteId,
    style: "whiteboard",
    mode: "brief",
    user_confirmed_generation: true,
    user_confirmed_publication: true,
    user_confirmed_source_rights: true,
  };
}

function fail(message) {
  throw new Error(message);
}

function parseUrl(value, message) {
  try {
    return new URL(value);
  } catch {
    fail(message);
  }
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safeHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableHash(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function withFirestore(databaseId, operation) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    fail("The production verifier refuses to use a Firestore emulator.");
  }
  const app = initializeApp(
    { credential: applicationDefault(), projectId: project },
    `noteflix-production-verifier-${Date.now()}-${randomBytes(6).toString("hex")}`,
  );
  const firestore = getFirestore(app, databaseId);
  try {
    return await operation(firestore);
  } finally {
    await firestore.terminate();
    await deleteApp(app);
  }
}

async function verifyOAuthTokenBinding(accessToken, identity, clientId) {
  const documentId = createHash("sha256").update(accessToken, "utf8").digest("base64url");
  return await withFirestore(oauthDatabaseId, async (firestore) => {
    const snapshot = await firestore
      .collection(`${oauthCollectionPrefix}_oauth_access_tokens`)
      .doc(documentId)
      .get();
    const record = snapshot.data();
    if (
      !snapshot.exists
      || record?.uid !== identity.uid
      || record?.clientId !== clientId
      || record?.resource !== resource
      || !Array.isArray(record?.scopes)
      || JSON.stringify([...record.scopes].sort()) !== JSON.stringify([...scopes].sort())
      || !Number.isFinite(record?.createdAtMs)
      || !Number.isFinite(record?.expiresAtMs)
      || record.expiresAtMs <= Date.now()
      || record.revokedAtMs !== undefined
    ) {
      fail("The OAuth access-token record was not bound to the exact signed-in reviewer UID.");
    }
    return true;
  });
}

function gcloud(args, env = process.env) {
  return execFileSync("gcloud", args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

let cachedAdcToken;
function adcToken() {
  cachedAdcToken ??= gcloud(["auth", "application-default", "print-access-token"]);
  return cachedAdcToken;
}

function authorizedGcloud(args, input) {
  return execFileSync("gcloud", args, {
    encoding: "utf8",
    env: { ...process.env, CLOUDSDK_AUTH_ACCESS_TOKEN: adcToken() },
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

function reviewerCredentials(secretName = reviewerSecret) {
  let parsed;
  try {
    const raw = authorizedGcloud([
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret",
      secretName,
      "--project",
      project,
    ]);
    parsed = JSON.parse(raw);
  } catch {
    fail("The reviewer credential was malformed.");
  }
  if (
    !exactKeys(parsed, ["email", "password"])
    || typeof parsed.email !== "string"
    || typeof parsed?.password !== "string"
    || parsed.password.length < 12
  ) {
    fail("The reviewer credential was malformed.");
  }
  return { email: parsed.email, password: parsed.password };
}

async function reviewerUidForSecret(secretName) {
  const credentials = reviewerCredentials(secretName);
  const app = initializeApp(
    { credential: applicationDefault(), projectId: project },
    `noteflix-reviewer-uid-${Date.now()}-${randomBytes(6).toString("hex")}`,
  );
  try {
    let user;
    try {
      user = await getAuth(app).getUserByEmail(credentials.email);
    } catch {
      fail("The foreign reviewer account could not be resolved.");
    }
    if (
      user.disabled
      || !user.emailVerified
      || typeof user.uid !== "string"
      || user.uid.length < 8
      || (
        secretName === syntheticReviewerSecret
        && (
          user.displayName !== "OpenAI cross-account review fixture"
          || !/^openai-cross-account-[a-z0-9-]+@noteflix\.com$/.test(user.email ?? "")
        )
      )
    ) {
      fail("The foreign reviewer account was not an enabled, verified Firebase user.");
    }
    return user.uid;
  } finally {
    await deleteApp(app);
  }
}

function storeFixtureSecret(value) {
  try {
    authorizedGcloud([
      "secrets",
      "describe",
      fixtureSecret,
      "--project",
      project,
      "--format=value(name)",
    ]);
  } catch (cause) {
    const stderr = String(cause?.stderr ?? "");
    if (!/\bNOT_FOUND\b|\bnot found\b/i.test(stderr)) {
      fail("The reviewer fixture secret could not be described; refusing to write it.");
    }
    authorizedGcloud([
      "secrets",
      "create",
      fixtureSecret,
      "--project",
      project,
      "--replication-policy=automatic",
    ]);
  }
  authorizedGcloud([
    "secrets",
    "versions",
    "add",
    fixtureSecret,
    "--project",
    project,
    "--data-file=-",
  ], `${JSON.stringify(value)}\n`);
}

function readFixtureSecret(secretName = fixtureSecret) {
  try {
    authorizedGcloud([
      "secrets",
      "describe",
      secretName,
      "--project",
      project,
      "--format=value(name)",
    ]);
  } catch (cause) {
    const stderr = String(cause?.stderr ?? "");
    if (/\bNOT_FOUND\b|\bnot found\b/i.test(stderr)) return null;
    fail("The reviewer fixture secret could not be described; refusing to enter mutation mode.");
  }
  let parsed;
  try {
    parsed = JSON.parse(authorizedGcloud([
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret",
      secretName,
      "--project",
      project,
    ]));
  } catch {
    fail("The existing reviewer fixture secret could not be read or parsed.");
  }
  return parsed;
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: init.redirect ?? "manual",
    signal: AbortSignal.timeout(30_000),
  });
}

async function json(response, message) {
  try {
    return await response.json();
  } catch {
    fail(message);
  }
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function extractConsentConfig(html) {
  const match = html.match(/const cfg = (\{[\s\S]*?\});\s*const auth/);
  if (!match?.[1]) fail("Consent configuration was unavailable.");
  const config = JSON.parse(match[1]);
  if (
    config?.firebase?.projectId !== project
    || typeof config?.firebase?.apiKey !== "string"
    || config.firebase.apiKey.length < 20
  ) {
    fail("Consent configuration did not match the expected Firebase project.");
  }
  return config;
}

async function signIn(apiKey) {
  const credentials = reviewerCredentials();
  const response = await fetchWithTimeout(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        Origin: publicBase.origin,
        Referer: `${publicBase.origin}/`,
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) fail(`Reviewer sign-in failed with HTTP ${response.status}.`);
  const body = await json(response, "Reviewer sign-in returned invalid JSON.");
  if (
    typeof body?.idToken !== "string"
    || body.idToken.length < 100
    || typeof body?.localId !== "string"
    || body.localId.length < 8
  ) {
    fail("Reviewer sign-in did not return an exact identity.");
  }
  return { idToken: body.idToken, uid: body.localId, email: credentials.email };
}

async function registerClient() {
  const response = await fetchWithTimeout(new URL("/register", transportBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "ChatGPT",
      scope: scopes.join(" "),
      software_id: "noteflix-production-readonly-verifier",
      software_version: "1.0.0",
    }),
  });
  if (response.status !== 201) fail(`Dynamic registration failed with HTTP ${response.status}.`);
  const client = await json(response, "Dynamic registration returned invalid JSON.");
  if (
    typeof client?.client_id !== "string"
    || client.client_id.length < 16
    || client.token_endpoint_auth_method !== "none"
    || Object.hasOwn(client, "client_secret")
  ) {
    fail("Dynamic registration returned an invalid public client.");
  }
  return client.client_id;
}

async function authorize(clientId, verifier, state) {
  const url = new URL("/authorize", transportBase);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("resource", resource);
  url.searchParams.set("state", state);
  const response = await fetchWithTimeout(url);
  if (response.status !== 302) fail(`Authorization failed with HTTP ${response.status}.`);
  const location = response.headers.get("location");
  if (!location) fail("Authorization did not return a consent location.");
  const consent = parseUrl(location, "The authorization redirect was malformed.");
  const requestId = consent.searchParams.get("request_id");
  if (
    consent.origin !== publicBase.origin
    || consent.pathname !== "/consent"
    || !requestId
  ) {
    fail("Authorization returned an invalid consent location.");
  }
  return requestId;
}

async function completeConsent(requestId) {
  const consentUrl = new URL("/consent", transportBase);
  consentUrl.searchParams.set("request_id", requestId);
  const view = await fetchWithTimeout(consentUrl, { redirect: "error" });
  if (!view.ok) fail(`Consent view failed with HTTP ${view.status}.`);
  const config = extractConsentConfig(await view.text());
  const identity = await signIn(config.firebase.apiKey);

  const response = await fetchWithTimeout(new URL("/consent/complete", transportBase), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: publicBase.origin,
    },
    body: JSON.stringify({
      request_id: requestId,
      decision: "allow",
      firebase_id_token: identity.idToken,
    }),
  });
  if (!response.ok) fail(`Consent completion failed with HTTP ${response.status}.`);
  const body = await json(response, "Consent completion returned invalid JSON.");
  const redirect = parseUrl(body?.redirect_url ?? "", "The consent redirect was malformed.");
  if (redirect.origin !== "https://chatgpt.com" || redirect.href.split("?")[0] !== callback) {
    fail("Consent completion returned an invalid ChatGPT callback.");
  }
  return { redirect, identity };
}

async function exchangeCode(clientId, verifier, redirect, expectedState) {
  if (redirect.searchParams.get("state") !== expectedState) fail("OAuth state was not preserved.");
  const code = redirect.searchParams.get("code");
  if (!code) fail("OAuth callback did not contain a code.");
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: callback,
    code_verifier: verifier,
    resource,
  });
  const response = await fetchWithTimeout(new URL("/token", transportBase), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) fail(`Token exchange failed with HTTP ${response.status}.`);
  const body = await json(response, "Token exchange returned invalid JSON.");
  if (
    typeof body?.access_token !== "string"
    || body.access_token.length < 32
    || body.token_type !== "Bearer"
  ) {
    fail("Token exchange returned an invalid access token response.");
  }
  return body.access_token;
}

function validateAllowance(value) {
  if (!exactKeys(value, allowanceKeys)) fail("Allowance returned an unexpected data shape.");
  if (
    value.eligible !== true
    || typeof value.can_generate !== "boolean"
    || !["available", "limit_reached"].includes(value.reason)
    || !Number.isInteger(value.used)
    || !Number.isInteger(value.in_flight)
    || !Number.isInteger(value.completed)
    || !Number.isInteger(value.limit)
    || !Number.isInteger(value.remaining)
    || typeof value.message !== "string"
    || value.used !== value.in_flight + value.completed
    || value.remaining !== Math.max(value.limit - value.used, 0)
    || value.can_generate !== (value.remaining > 0)
  ) {
    fail("Allowance failed its consistency checks.");
  }
  allowancePeriodKey(value);
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["email", "price", "purchase", "product", "provider", "subscription", "payment"]) {
    if (serialized.includes(forbidden)) fail("Allowance exposed a forbidden billing or identity field.");
  }
}

function allowancePeriodKey(value) {
  if (typeof value?.period_start !== "string" || typeof value?.resets_at !== "string") {
    fail("Allowance returned an invalid UTC period window.");
  }
  const start = new Date(value.period_start);
  const reset = new Date(value.resets_at);
  if (
    !Number.isFinite(start.getTime())
    || !Number.isFinite(reset.getTime())
    || start.toISOString() !== value.period_start
    || reset.toISOString() !== value.resets_at
    || start.getUTCDate() !== 1
    || start.getUTCHours() !== 0
    || start.getUTCMinutes() !== 0
    || start.getUTCSeconds() !== 0
    || start.getUTCMilliseconds() !== 0
    || reset.getTime()
      !== Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  ) {
    fail("Allowance returned an invalid UTC period window.");
  }
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sameAllowancePeriod(left, right) {
  return allowancePeriodKey(left) === allowancePeriodKey(right)
    && left.period_start === right.period_start
    && left.resets_at === right.resets_at;
}

function contiguousAllowancePeriods(left, right) {
  allowancePeriodKey(left);
  allowancePeriodKey(right);
  return left.resets_at === right.period_start;
}

function allowanceCountsEqual(left, right) {
  return left.used === right.used
    && left.in_flight === right.in_flight
    && left.completed === right.completed
    && left.limit === right.limit
    && left.remaining === right.remaining;
}

function allowanceSnapshot(value) {
  return {
    used: value.used,
    in_flight: value.in_flight,
    completed: value.completed,
    limit: value.limit,
    remaining: value.remaining,
    period_start: value.period_start,
    resets_at: value.resets_at,
  };
}

function nextAllowanceWindow(value) {
  allowancePeriodKey(value);
  const start = new Date(value.resets_at);
  const reset = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return {
    limit: value.limit,
    period_start: start.toISOString(),
    resets_at: reset.toISOString(),
  };
}

async function readAllowanceCounterSnapshot(uid, window) {
  return await withFirestore("(default)", async (firestore) => {
    const userIdHash = stableHash("claude-media-video-user-v1", uid);
    const document = await firestore
      .collection("claudeMediaVideoAllowances")
      .doc(`${userIdHash}-${allowancePeriodKey(window)}`)
      .get();
    const data = document.data();
    const value = document.exists
      ? {
          used: data?.reserved + data?.consumed,
          in_flight: data?.reserved,
          completed: data?.consumed,
          limit: data?.limit,
          remaining: data?.limit - data?.reserved - data?.consumed,
          period_start: data?.periodStart,
          resets_at: data?.periodEnd,
        }
      : {
          used: 0,
          in_flight: 0,
          completed: 0,
          limit: window.limit,
          remaining: window.limit,
          period_start: window.period_start,
          resets_at: window.resets_at,
        };
    if (
      !validStoredAllowance(value)
      || !counterMatchesAllowance(document, value, userIdHash)
      || value.period_start !== window.period_start
      || value.resets_at !== window.resets_at
    ) {
      fail("The next-period reviewer allowance counter was invalid before replay.");
    }
    return value;
  });
}

function assertToolResultPrivacy(result, label) {
  const serialized = JSON.stringify(result);
  const normalized = serialized.toLowerCase();
  for (const forbidden of [
    "billing",
    "email",
    "firebasestorage",
    "gs://",
    "password",
    "payment",
    "price",
    "provider",
    "purchase",
    "storage.googleapis",
    "subscription",
  ]) {
    if (normalized.includes(forbidden)) {
      fail(`${label} exposed a forbidden field or value outside structuredContent.`);
    }
  }
  const urls = serialized.match(/https:\/\/[^"\\\s]+/g) ?? [];
  for (const rawUrl of urls) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      fail(`${label} exposed a malformed URL.`);
    }
    if (url.origin !== "https://noteflix.com") {
      fail(`${label} exposed a non-Noteflix URL.`);
    }
  }
}

function validatePrivateNoteResult(result) {
  if (result?.isError) fail("The reviewer fixture note could not be created.");
  const value = result?.structuredContent;
  if (
    !exactKeys(value, ["cached", "note", "status"])
    || value.status !== "created"
    || typeof value.cached !== "boolean"
    || !exactKeys(value.note, ["id", "slug", "title", "url", "visibility"])
    || typeof value.note.id !== "string"
    || value.note.id.length < 8
    || value.note.title !== fixtureTitle
    || value.note.visibility !== "private"
    || !(value.note.slug === null || typeof value.note.slug === "string")
    || !isNoteflixUrl(value.note.url)
  ) {
    fail("The reviewer fixture note returned an unexpected receipt.");
  }
  return value;
}

function validateQueuedVideoResult(result, noteId) {
  if (result?.isError) fail("The reviewer fixture video could not be queued.");
  const value = result?.structuredContent;
  if (
    !exactKeys(value, ["status", "video"])
    || value.status !== "queued"
    || !exactKeys(
      value.video,
      ["ai_generated", "mode", "note_id", "privacy", "slug", "status", "style", "url", "video_id"],
    )
    || typeof value.video.video_id !== "string"
    || value.video.video_id.length < 8
    || value.video.note_id !== noteId
    || value.video.status !== "queued"
    || value.video.style !== "whiteboard"
    || value.video.mode !== "brief"
    || value.video.privacy !== "public"
    || value.video.ai_generated !== true
    || !/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*(?:-[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*)*$/u.test(value.video.slug)
    || !isNoteflixUrl(
      value.video.url,
      `/watch/${encodeURIComponent(value.video.slug)}`,
    )
  ) {
    fail("The reviewer fixture video returned an unexpected queue receipt.");
  }
  return value.video;
}

function validateVideoStatus(value, expectedVideo) {
  if (
    !exactKeys(
      value,
      [
        "ai_generated",
        "message",
        "next_action",
        "note_id",
        "privacy",
        "progress",
        "recommended_check_after_seconds",
        "slug",
        "status",
        "url",
        "video_id",
      ],
    )
    || value.video_id !== expectedVideo.video_id
    || value.note_id !== expectedVideo.note_id
    || value.slug !== expectedVideo.slug
    || value.url !== expectedVideo.url
    || value.privacy !== "public"
    || value.ai_generated !== true
    || !["queued", "processing", "ready", "failed"].includes(value.status)
    || !Number.isInteger(value.progress)
    || value.progress < 0
    || value.progress > 100
  ) {
    fail("The reviewer fixture video returned an unexpected status receipt.");
  }
}

function exactOwner(record, fields) {
  const owners = fields
    .map((field) => record?.[field])
    .filter((value) => typeof value === "string" && value.length > 0);
  return owners.length > 0 && owners.every((owner) => owner === owners[0])
    ? owners[0]
    : null;
}

function validPublicSlug(value) {
  return typeof value === "string"
    && value === value.trim()
    && value === value.normalize("NFKC")
    && value === value.toLowerCase()
    && Array.from(value).length <= 80
    && /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*(?:-[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*)*$/u.test(value);
}

function explicitlyPublicReadyVideo(data) {
  const privacy = typeof data?.privacy === "string" ? data.privacy.trim().toLowerCase() : "";
  const visibility = typeof data?.visibility === "string" ? data.visibility.trim().toLowerCase() : "";
  const status = typeof data?.status === "string" ? data.status.trim().toLowerCase() : "";
  const publication = typeof data?.publicationState === "string"
    ? data.publicationState.trim().toLowerCase()
    : "";
  const moderation = typeof data?.moderationState === "string"
    ? data.moderationState.trim().toLowerCase()
    : "";
  const explicitPublic = !["private", "workspace", "unlisted"].includes(privacy)
    && !["private", "workspace", "unlisted"].includes(visibility)
    && data?.isPublic !== false
    && data?.isVisible !== false
    && (privacy === "public" || visibility === "public" || data?.isPublic === true);
  return explicitPublic
    && ["complete", "completed", "done", "published", "ready"].includes(status)
    && publication === "published"
    && (moderation === "approved" || data?.moderationApproved === true)
    && validPublicSlug(data?.slug);
}

function strictlyPrivateOwnedNote(data, uid) {
  const accessType = typeof data?.accessType === "string"
    ? data.accessType.trim().toUpperCase()
    : "";
  const visibility = typeof data?.visibility === "string"
    ? data.visibility.trim().toLowerCase()
    : "";
  const explicitPrivate = ["PRIVATE_INVITE", "PRIVATE_CODE", "PRIVATE"].includes(accessType)
    || visibility === "private"
    || data?.isPublic === false;
  const publicNote = accessType === "PUBLIC"
    || visibility === "public"
    || data?.isPublic === true;
  return exactOwner(data, ["ownerId", "userId"]) === uid
    && explicitPrivate
    && !publicNote;
}

async function isKnownGoodForeignVideo(
  firestore,
  document,
  reviewerUid,
  expectedForeignUid,
) {
  if (!document?.exists || !/^[A-Za-z0-9_-]{1,128}$/.test(document.id)) return false;
  const video = document.data();
  const owner = exactOwner(video, ["ownerUid", "userId"]);
  if (
    !owner
    || owner === reviewerUid
    || owner !== expectedForeignUid
    || !explicitlyPublicReadyVideo(video)
    || typeof video?.noteId !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(video.noteId)
  ) {
    return false;
  }
  const [mapping, aiNote, legacyNote] = await Promise.all([
    firestore.collection("publicVideoSlugs").doc(video.slug).get(),
    firestore.collection("aiNotes").doc(video.noteId).get(),
    firestore.collection("notes").doc(video.noteId).get(),
  ]);
  const mappingData = mapping.data();
  const noteData = aiNote.exists ? aiNote.data() : legacyNote.data();
  if (
    !mapping.exists
    || mappingData?.videoId !== document.id
    || mappingData?.slug !== video.slug
    || mappingData?.state !== "published"
    || exactOwner(noteData, ["ownerId", "userId"]) !== owner
  ) {
    return false;
  }
  const response = await fetchWithTimeout(
    new URL(`/api/ai-notes/public-videos/${encodeURIComponent(video.slug)}`, "https://noteflix.com"),
    { headers: { Accept: "application/json" } },
  );
  if (response.status !== 200) return false;
  const publicVideo = await json(response, "A candidate foreign public video returned invalid JSON.");
  return publicVideo?.slug === video.slug
    && publicVideo?.status === "ready"
    && publicVideo?.privacy === "public";
}

async function findForeignVideoId(reviewerUid, expectedForeignUid, preferredVideoId) {
  if (
    typeof expectedForeignUid !== "string"
    || expectedForeignUid.length < 8
    || expectedForeignUid === reviewerUid
  ) {
    fail("The configured foreign reviewer was not a distinct exact Firebase user.");
  }
  if (!preferredVideoId || !/^[A-Za-z0-9_-]{1,128}$/.test(preferredVideoId)) {
    fail("The exact counterpart fixture video ID was unavailable.");
  }
  return await withFirestore("(default)", async (firestore) => {
    const preferred = await firestore.collection("videos").doc(preferredVideoId).get();
    if (await isKnownGoodForeignVideo(
      firestore,
      preferred,
      reviewerUid,
      expectedForeignUid,
    )) {
      return preferredVideoId;
    }
    fail("The exact separately owned counterpart video fixture was unavailable.");
  });
}

function counterMatchesAllowance(counter, allowance, userIdHash) {
  const periodKey = allowancePeriodKey(allowance);
  if (!counter.exists) {
    return allowance.used === 0
      && allowance.in_flight === 0
      && allowance.completed === 0
      && allowance.remaining === allowance.limit;
  }
  const data = counter.data();
  return data?.userIdHash === userIdHash
    && data?.periodKey === periodKey
    && data?.periodStart === allowance.period_start
    && data?.periodEnd === allowance.resets_at
    && data?.limit === allowance.limit
    && data?.reserved === allowance.in_flight
    && data?.consumed === allowance.completed
    && Number.isSafeInteger(data?.refunded)
    && data.refunded >= 0
    && data.reserved + data.consumed === allowance.used;
}

async function verifyReviewerProductState(
  identity,
  note,
  video,
  allowance,
  historicalAllowance = allowance,
) {
  return await withFirestore("(default)", async (firestore) => {
    const ledgerId = stableHash("claude-media-video-credit-v1", identity.uid, videoRequestId);
    const userIdHash = stableHash("claude-media-video-user-v1", identity.uid);
    const [aiNote, legacyNote, videoDocument, ledger, request, mapping] = await Promise.all([
      firestore.collection("aiNotes").doc(note.id).get(),
      firestore.collection("notes").doc(note.id).get(),
      firestore.collection("videos").doc(video.video_id).get(),
      firestore.collection("claudeMediaVideoCreditLedger").doc(ledgerId).get(),
      firestore.collection("claudeMediaVideoRequests").doc(video.video_id).get(),
      firestore.collection("publicVideoSlugs").doc(video.slug).get(),
    ]);
    const noteData = aiNote.exists ? aiNote.data() : legacyNote.data();
    const videoData = videoDocument.data();
    const ledgerData = ledger.data();
    const requestData = request.data();
    const mappingData = mapping.data();
    if (
      (!aiNote.exists && !legacyNote.exists)
      || !strictlyPrivateOwnedNote(noteData, identity.uid)
      || noteData?.title !== fixtureTitle
      || !videoDocument.exists
      || exactOwner(videoData, ["ownerUid", "userId"]) !== identity.uid
      || videoData?.noteId !== note.id
      || videoData?.slug !== video.slug
      || !explicitlyPublicReadyVideo(videoData)
      || !ledger.exists
      || ledgerData?.userIdHash !== userIdHash
      || ledgerData?.requestId !== videoRequestId
      || ledgerData?.videoId !== video.video_id
      || ledgerData?.slug !== video.slug
      || ledgerData?.state !== "consumed"
      || typeof ledgerData?.periodKey !== "string"
      || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(ledgerData.periodKey)
      || ledgerData?.counterId !== `${userIdHash}-${ledgerData.periodKey}`
      || !request.exists
      || requestData?.userId !== identity.uid
      || requestData?.requestId !== videoRequestId
      || requestData?.noteId !== note.id
      || requestData?.videoId !== video.video_id
      || requestData?.state !== "created"
      || !mapping.exists
      || mappingData?.videoId !== video.video_id
      || mappingData?.slug !== video.slug
      || mappingData?.state !== "published"
    ) {
      fail("The reviewer fixture was not an exact-owner, private-source, published, consumed-credit product record.");
    }
    const currentCounterId = `${userIdHash}-${allowancePeriodKey(allowance)}`;
    const [ledgerCounter, currentCounter] = await Promise.all([
      firestore.collection("claudeMediaVideoAllowances").doc(ledgerData.counterId).get(),
      ledgerData.counterId === currentCounterId
        ? Promise.resolve(null)
        : firestore.collection("claudeMediaVideoAllowances").doc(currentCounterId).get(),
    ]);
    const ledgerCounterData = ledgerCounter.data();
    if (
      !ledgerCounter.exists
      || ledgerCounterData?.userIdHash !== userIdHash
      || ledgerCounterData?.periodKey !== ledgerData.periodKey
      || ledgerCounterData?.periodStart !== `${ledgerData.periodKey}-01T00:00:00.000Z`
      || typeof ledgerCounterData?.periodEnd !== "string"
      || !Number.isSafeInteger(ledgerCounterData?.limit)
      || !Number.isSafeInteger(ledgerCounterData?.reserved)
      || !Number.isSafeInteger(ledgerCounterData?.consumed)
      || !Number.isSafeInteger(ledgerCounterData?.refunded)
      || ledgerCounterData.limit < 1
      || ledgerCounterData.reserved < 0
      || ledgerCounterData.consumed < 1
      || ledgerCounterData.refunded < 0
      || ledgerCounterData.reserved + ledgerCounterData.consumed > ledgerCounterData.limit
      || (
        ledgerData.counterId === currentCounterId
          ? !counterMatchesAllowance(ledgerCounter, allowance, userIdHash)
          : (
            allowancePeriodKey(historicalAllowance) !== ledgerData.periodKey
            || historicalAllowance.period_start !== ledgerCounterData.periodStart
            || historicalAllowance.resets_at !== ledgerCounterData.periodEnd
            || !counterMatchesAllowance(ledgerCounter, historicalAllowance, userIdHash)
            || !counterMatchesAllowance(currentCounter, allowance, userIdHash)
          )
      )
    ) {
      fail("The exact reviewer allowance and historical ledger counter did not match the product records.");
    }
    return {
      private_note_exact_owner: true,
      ready_video_exact_owner: true,
      deterministic_request_claim_created: true,
      exact_user_credit_ledger_consumed: true,
      exact_user_allowance_counter_matched: true,
    };
  });
}

async function verifySignedOutExposure(note, video) {
  const noteSegment = note.slug ?? note.id;
  const noteApi = new URL(
    `/api/ai-notes/slug/${encodeURIComponent(noteSegment)}`,
    "https://noteflix.com",
  );
  const noteResponse = await fetchWithTimeout(noteApi, {
    headers: { Accept: "application/json" },
  });
  const noteBody = await noteResponse.text();
  if (
    noteResponse.status !== 404
    || noteBody.includes(note.id)
    || noteBody.includes(fixtureTitle)
    || noteBody.includes("phospholipid")
  ) {
    fail("The private fixture note was not denied to a signed-out request.");
  }

  const watchResponse = await fetchWithTimeout(video.url);
  if (watchResponse.status !== 200) {
    fail("The signed-out public watch page was unavailable.");
  }
  await watchResponse.body?.cancel();

  const metadataUrl = new URL(
    `/api/ai-notes/public-videos/${encodeURIComponent(video.slug)}`,
    "https://noteflix.com",
  );
  const metadataResponse = await fetchWithTimeout(metadataUrl, {
    headers: { Accept: "application/json" },
  });
  if (metadataResponse.status !== 200) {
    fail("The signed-out public-video metadata was unavailable.");
  }
  const metadata = await json(metadataResponse, "Public-video metadata returned invalid JSON.");
  const allowedMetadataKeys = new Set([
    "aspectRatio",
    "canonicalUrl",
    "createdAt",
    "description",
    "durationSeconds",
    "id",
    "mode",
    "playbackUrl",
    "privacy",
    "publishedAt",
    "schemaVersion",
    "slideCount",
    "slug",
    "status",
    "style",
    "title",
    "videoUrl",
  ]);
  if (
    metadata?.schemaVersion !== 1
    || metadata?.slug !== video.slug
    || metadata?.status !== "ready"
    || metadata?.privacy !== "public"
    || metadata?.canonicalUrl !== video.url
    || typeof metadata?.playbackUrl !== "string"
    || Object.keys(metadata ?? {}).some((key) => !allowedMetadataKeys.has(key))
    || JSON.stringify(metadata).includes(note.id)
  ) {
    fail("The anonymous public-video response exceeded its reviewed allowlist.");
  }
  const playback = parseUrl(metadata.playbackUrl, "The public playback URL was malformed.");
  if (
    playback.origin !== "https://noteflix.com"
    || playback.pathname !== `/api/ai-notes/public-videos/${encodeURIComponent(video.slug)}/playback`
    || playback.search
  ) {
    fail("The public metadata exposed a non-canonical playback URL.");
  }
  const playbackResponse = await fetchWithTimeout(playback);
  const playbackLocation = playbackResponse.headers.get("location");
  if (
    playbackResponse.status !== 302
    || !playbackLocation
    || parseUrl(playbackLocation, "The public playback redirect was malformed.").protocol !== "https:"
  ) {
    fail("Signed-out public playback was unavailable.");
  }
  await playbackResponse.body?.cancel();
  return {
    signed_out_private_note_denied: true,
    signed_out_watch_page_public: true,
    signed_out_public_metadata_allowlisted: true,
    signed_out_playback_available: true,
  };
}

function validateStoredFixture(record) {
  const normalizedAllowanceBefore = normalizeStoredAllowanceBefore(record);
  if (
    record?.schema_version !== 1
    || typeof record?.note?.id !== "string"
    || record.note.id.length < 8
    || record.note.title !== fixtureTitle
    || typeof record.note.url !== "string"
    || !isNoteflixUrl(record.note.url)
    || typeof record?.ready_video?.id !== "string"
    || record.ready_video.id.length < 8
    || typeof record.ready_video.slug !== "string"
    || typeof record.ready_video.url !== "string"
    || !isNoteflixUrl(record.ready_video.url, `/watch/${encodeURIComponent(record.ready_video.slug)}`)
    || typeof record?.foreign_account_video_id !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(record.foreign_account_video_id)
    || !normalizedAllowanceBefore
    || !validStoredAllowance(record.allowance_after)
  ) {
    fail("The existing reviewer fixture secret had an unexpected shape.");
  }
  return {
    ...record,
    allowance_before: normalizedAllowanceBefore,
  };
}

function isNoteflixUrl(value, pathname) {
  try {
    const url = new URL(value);
    return url.origin === "https://noteflix.com"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && (pathname === undefined || url.pathname === pathname);
  } catch {
    return false;
  }
}

function noteflixLastPathSegment(value) {
  if (!isNoteflixUrl(value)) fail("The reviewer note URL was malformed.");
  return parseUrl(value, "The reviewer note URL was malformed.")
    .pathname
    .split("/")
    .filter(Boolean)
    .at(-1);
}

function normalizeStoredAllowanceBefore(record) {
  if (validStoredAllowance(record?.allowance_before)) return record.allowance_before;
  const before = record?.allowance_before;
  const after = record?.allowance_after;
  if (
    !validStoredAllowance(after)
    || !exactKeys(before, ["remaining", "resets_at", "used"])
    || !Number.isSafeInteger(before.used)
    || !Number.isSafeInteger(before.remaining)
    || typeof before.resets_at !== "string"
    || after.completed < 1
    || before.used !== after.used - 1
    || before.remaining !== after.remaining + 1
    || before.resets_at !== after.resets_at
  ) {
    return null;
  }
  return {
    ...after,
    used: before.used,
    completed: after.completed - 1,
    remaining: before.remaining,
  };
}

function validStoredAllowance(value) {
  try {
    return exactKeys(value, [
      "completed",
      "in_flight",
      "limit",
      "period_start",
      "remaining",
      "resets_at",
      "used",
    ])
      && Number.isSafeInteger(value.used)
      && Number.isSafeInteger(value.in_flight)
      && Number.isSafeInteger(value.completed)
      && Number.isSafeInteger(value.limit)
      && Number.isSafeInteger(value.remaining)
      && value.used >= 0
      && value.in_flight >= 0
      && value.completed >= 0
      && value.limit >= 1
      && value.used <= value.limit
      && value.remaining >= 0
      && value.used === value.in_flight + value.completed
      && value.remaining === Math.max(value.limit - value.used, 0)
      && Boolean(allowancePeriodKey(value));
  } catch {
    return false;
  }
}

function validatePendingFixture(record) {
  if (
    record?.schema_version !== 2
    || !["note_created", "video_queued"].includes(record?.fixture_state)
    || typeof record?.note?.id !== "string"
    || record.note.id.length < 8
    || record.note.title !== fixtureTitle
    || typeof record.note.url !== "string"
    || !isNoteflixUrl(record.note.url)
    || record?.generation_request?.request_id !== videoRequestId
    || record.generation_request.style !== "whiteboard"
    || record.generation_request.mode !== "brief"
    || !validStoredAllowance(record.allowance_before)
  ) {
    fail("The pending reviewer fixture secret had an unexpected shape.");
  }
  if (record.fixture_state === "video_queued") {
    validateQueuedVideoResult(
      { structuredContent: { status: "queued", video: record.queued_video } },
      record.note.id,
    );
  }
  return record;
}

async function verifyStoredFixture(
  client,
  allowanceBeforeReplay,
  record,
  identity,
  expectedForeignUid,
  expectedForeignVideoId,
) {
  validateAllowance(allowanceBeforeReplay);
  const stored = validateStoredFixture(record);
  if (
    stored.foreign_account_owner_hash !== undefined
    && (
      stored.foreign_account_owner_hash !== safeHash(expectedForeignUid)
      || stored.foreign_account_video_id !== expectedForeignVideoId
    )
  ) {
    fail("The stored foreign fixture was not bound to the configured counterpart account.");
  }
  const statusCall = await client.callTool({
    name: "get_video_status",
    arguments: { video_id: stored.ready_video.id },
  });
  if (statusCall.isError) fail("The stored reviewer video was no longer available.");
  assertToolResultPrivacy(statusCall, "The stored reviewer status call");
  const status = statusCall.structuredContent;
  validateVideoStatus(status, {
    video_id: stored.ready_video.id,
    note_id: stored.note.id,
    slug: stored.ready_video.slug,
    url: stored.ready_video.url,
  });
  if (status.status !== "ready" || status.next_action !== "open_video") {
    fail("The stored reviewer video was not ready.");
  }

  const [productAllowanceBeforeReplay, nextPeriodAllowanceBeforeReplay] = await Promise.all([
    readAllowanceCounterSnapshot(identity.uid, allowanceSnapshot(allowanceBeforeReplay)),
    readAllowanceCounterSnapshot(identity.uid, nextAllowanceWindow(allowanceBeforeReplay)),
  ]);
  if (!allowanceCountsEqual(productAllowanceBeforeReplay, allowanceBeforeReplay)) {
    fail("The exact product allowance did not match the pre-replay tool snapshot.");
  }
  const replayCall = await client.callTool({
    name: "create_public_note_video",
    arguments: fixtureVideoArguments(stored.note.id),
  });
  assertToolResultPrivacy(replayCall, "The idempotent video-creation replay");
  const replayVideo = validateQueuedVideoResult(replayCall, stored.note.id);
  if (
    replayVideo.video_id !== stored.ready_video.id
    || replayVideo.slug !== stored.ready_video.slug
    || replayVideo.url !== stored.ready_video.url
  ) {
    fail("The idempotent creation replay did not return the original public video receipt.");
  }
  const replayAllowanceCall = await client.callTool({ name: "get_video_allowance", arguments: {} });
  if (replayAllowanceCall.isError) fail("The post-replay allowance check failed.");
  assertToolResultPrivacy(replayAllowanceCall, "The post-replay allowance call");
  const allowanceAfterReplay = replayAllowanceCall.structuredContent;
  validateAllowance(allowanceAfterReplay);
  const crossedAllowanceBoundary = !sameAllowancePeriod(
    allowanceBeforeReplay,
    allowanceAfterReplay,
  );
  const previousPeriodAllowanceAfterReplay = crossedAllowanceBoundary
    ? await readAllowanceCounterSnapshot(
        identity.uid,
        allowanceSnapshot(allowanceBeforeReplay),
      )
    : null;
  if (
    (
      sameAllowancePeriod(allowanceBeforeReplay, allowanceAfterReplay)
      && !allowanceCountsEqual(allowanceBeforeReplay, allowanceAfterReplay)
    )
    || (
      crossedAllowanceBoundary
      && (
        !contiguousAllowancePeriods(allowanceBeforeReplay, allowanceAfterReplay)
        || !allowanceCountsEqual(nextPeriodAllowanceBeforeReplay, allowanceAfterReplay)
        || !allowanceCountsEqual(
          productAllowanceBeforeReplay,
          previousPeriodAllowanceAfterReplay,
        )
      )
    )
  ) {
    fail("The idempotent creation replay changed the exact reviewer's allowance.");
  }

  const productState = await verifyReviewerProductState(
    identity,
    stored.note,
    status,
    allowanceAfterReplay,
    stored.allowance_after,
  );
  const foreignVideoId = await findForeignVideoId(
    identity.uid,
    expectedForeignUid,
    expectedForeignVideoId,
  );
  const foreignCall = await client.callTool({
    name: "get_video_status",
    arguments: { video_id: foreignVideoId },
  });
  if (
    !foreignCall.isError
    || foreignCall.structuredContent !== undefined
    || !JSON.stringify(foreignCall).includes("video_not_found")
    || JSON.stringify(foreignCall).includes(foreignVideoId)
  ) {
    fail("The stored foreign-account fixture did not fail closed.");
  }
  assertToolResultPrivacy(foreignCall, "The foreign-account denial call");

  const exposure = await verifySignedOutExposure(
    { ...stored.note, slug: noteflixLastPathSegment(stored.note.url) },
    stored.ready_video,
  );
  storeFixtureSecret({
    ...stored,
    verified_at: new Date().toISOString(),
    generation_request: {
      request_id: videoRequestId,
      style: "whiteboard",
      mode: "brief",
    },
    foreign_account_video_id: foreignVideoId,
    foreign_account_owner_hash: safeHash(expectedForeignUid),
    current_allowance_at_verification: allowanceSnapshot(allowanceAfterReplay),
    privacy_verification: exposure,
  });
  return {
    fixture_reused_without_charge: true,
    idempotent_creation_replayed: true,
    fixture_note_private: true,
    fixture_video_ready_public: true,
    fixture_watch_slug_readable: true,
    foreign_account_denied: true,
    fixture_secret_version_added: true,
    fixture_credit_delta: 0,
    fixture_note_hash: safeHash(stored.note.id),
    fixture_video_hash: safeHash(stored.ready_video.id),
    ...productState,
    ...exposure,
  };
}

function counterpartFixtureSecretName() {
  if (foreignReviewerSecret === syntheticReviewerSecret) {
    return "noteflix-openai-cross-account-reviewer-fixtures";
  }
  if (foreignReviewerSecret === primaryReviewerSecret) {
    return "noteflix-openai-reviewer-fixtures";
  }
  fail("The counterpart fixture secret was not allowlisted.");
}

function counterpartVideoId() {
  const record = readFixtureSecret(counterpartFixtureSecretName());
  if (!record) fail("The counterpart reviewer fixture secret was unavailable.");
  if (record.schema_version === 1) return validateStoredFixture(record).ready_video.id;
  const pending = validatePendingFixture(record);
  if (pending.fixture_state !== "video_queued") {
    fail("The counterpart reviewer had not queued its deterministic video.");
  }
  return pending.queued_video.video_id;
}

function oneCreditHistoricalAllowance(before) {
  if (!validStoredAllowance(before) || before.remaining < 1) {
    fail("The persisted pre-video allowance could not fund exactly one fixture credit.");
  }
  return {
    ...before,
    used: before.used + 1,
    completed: before.completed + 1,
    remaining: before.remaining - 1,
  };
}

function assertSafeMutationWindow(allowance) {
  allowancePeriodKey(allowance);
  const millisecondsUntilReset = new Date(allowance.resets_at).getTime() - Date.now();
  if (millisecondsUntilReset <= 5 * 60 * 1_000) {
    fail("The reviewer fixture mutation was refused within five minutes of a UTC allowance reset.");
  }
}

async function recoverQueuedVideo(identity, note) {
  return await withFirestore("(default)", async (firestore) => {
    const ledgerId = stableHash("claude-media-video-credit-v1", identity.uid, videoRequestId);
    const userIdHash = stableHash("claude-media-video-user-v1", identity.uid);
    const ledger = await firestore
      .collection("claudeMediaVideoCreditLedger")
      .doc(ledgerId)
      .get();
    if (!ledger.exists) return null;
    const ledgerData = ledger.data();
    if (
      ledgerData?.userIdHash !== userIdHash
      || ledgerData?.requestId !== videoRequestId
      || !["reserved", "consumed"].includes(ledgerData?.state)
      || typeof ledgerData?.videoId !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(ledgerData.videoId)
      || !validPublicSlug(ledgerData?.slug)
      || typeof ledgerData?.periodKey !== "string"
      || ledgerData?.counterId !== `${userIdHash}-${ledgerData.periodKey}`
    ) {
      fail("The deterministic pending reviewer credit record was invalid.");
    }
    const [request, video, mapping] = await Promise.all([
      firestore.collection("claudeMediaVideoRequests").doc(ledgerData.videoId).get(),
      firestore.collection("videos").doc(ledgerData.videoId).get(),
      firestore.collection("publicVideoSlugs").doc(ledgerData.slug).get(),
    ]);
    const requestData = request.data();
    const videoData = video.data();
    const mappingData = mapping.data();
    if (
      !request.exists
      || requestData?.userId !== identity.uid
      || requestData?.requestId !== videoRequestId
      || requestData?.noteId !== note.id
      || requestData?.videoId !== ledgerData.videoId
      || requestData?.state !== "created"
      || !video.exists
      || exactOwner(videoData, ["ownerUid", "userId"]) !== identity.uid
      || videoData?.noteId !== note.id
      || videoData?.slug !== ledgerData.slug
      || videoData?.claudeMediaRequestId !== videoRequestId
      || videoData?.privacy !== "public"
      || videoData?.style !== "whiteboard"
      || videoData?.mode !== "brief"
      || videoData?.canonicalUrl !== `https://noteflix.com/watch/${encodeURIComponent(ledgerData.slug)}`
      || !mapping.exists
      || mappingData?.videoId !== ledgerData.videoId
      || mappingData?.slug !== ledgerData.slug
      || !["reserved", "published"].includes(mappingData?.state)
    ) {
      fail("The deterministic pending reviewer video record was invalid.");
    }
    return {
      ai_generated: true,
      mode: "brief",
      note_id: note.id,
      privacy: "public",
      slug: ledgerData.slug,
      status: "queued",
      style: "whiteboard",
      url: `https://noteflix.com/watch/${encodeURIComponent(ledgerData.slug)}`,
      video_id: ledgerData.videoId,
    };
  });
}

async function finishPendingReviewerFixture(
  client,
  allowanceBeforeRun,
  record,
  identity,
  expectedForeignUid,
  expectedForeignVideoId,
) {
  validateAllowance(allowanceBeforeRun);
  let pending = validatePendingFixture(record);
  let invocationAllowanceBefore = allowanceBeforeRun;
  let queuedVideo;
  if (pending.fixture_state === "note_created") {
    queuedVideo = await recoverQueuedVideo(identity, pending.note);
    if (!queuedVideo) {
      const freshAllowanceCall = await client.callTool({
        name: "get_video_allowance",
        arguments: {},
      });
      if (freshAllowanceCall.isError) fail("The pre-mutation allowance refresh failed.");
      assertToolResultPrivacy(freshAllowanceCall, "The pre-mutation allowance refresh");
      invocationAllowanceBefore = freshAllowanceCall.structuredContent;
      validateAllowance(invocationAllowanceBefore);
      assertSafeMutationWindow(invocationAllowanceBefore);
      if (!invocationAllowanceBefore.can_generate) {
        fail("The reviewer account has no public-video credit available.");
      }
      pending = {
        ...pending,
        checkpointed_at: new Date().toISOString(),
        allowance_before: allowanceSnapshot(invocationAllowanceBefore),
      };
      storeFixtureSecret(pending);
      const videoCall = await client.callTool({
        name: "create_public_note_video",
        arguments: fixtureVideoArguments(pending.note.id),
      });
      assertToolResultPrivacy(videoCall, "The reviewer fixture video call");
      queuedVideo = validateQueuedVideoResult(videoCall, pending.note.id);
    }
    pending = {
      ...pending,
      fixture_state: "video_queued",
      checkpointed_at: new Date().toISOString(),
      queued_video: queuedVideo,
    };
    storeFixtureSecret(pending);
  } else {
    queuedVideo = validateQueuedVideoResult(
      { structuredContent: { status: "queued", video: pending.queued_video } },
      pending.note.id,
    );
  }

  let status;
  for (let attempt = 0; attempt < fixturePollLimit; attempt += 1) {
    const statusCall = await client.callTool({
      name: "get_video_status",
      arguments: { video_id: queuedVideo.video_id },
    });
    if (statusCall.isError) fail("The reviewer fixture status check failed.");
    assertToolResultPrivacy(statusCall, "The reviewer fixture status call");
    status = statusCall.structuredContent;
    validateVideoStatus(status, queuedVideo);
    if (status.status === "ready" || status.status === "failed") break;
    const recommended = Number.isInteger(status.recommended_check_after_seconds)
      ? status.recommended_check_after_seconds
      : 20;
    await delay(Math.max(15, Math.min(recommended, 30)) * 1_000);
  }
  if (status?.status !== "ready" || status.progress !== 100 || status.next_action !== "open_video") {
    fail(`The reviewer fixture video did not become ready after ${fixturePollLimit} checks.`);
  }

  const historicalAllowanceAfter = oneCreditHistoricalAllowance(pending.allowance_before);
  let allowanceAfter;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const allowanceCall = await client.callTool({ name: "get_video_allowance", arguments: {} });
    if (allowanceCall.isError) fail("The post-fixture allowance check failed.");
    assertToolResultPrivacy(allowanceCall, "The post-fixture allowance call");
    allowanceAfter = allowanceCall.structuredContent;
    validateAllowance(allowanceAfter);
    if (
      (
        sameAllowancePeriod(historicalAllowanceAfter, allowanceAfter)
        && allowanceCountsEqual(historicalAllowanceAfter, allowanceAfter)
      )
      || new Date(allowanceAfter.period_start).getTime()
        >= new Date(historicalAllowanceAfter.resets_at).getTime()
    ) {
      break;
    }
    await delay(5_000);
  }
  if (
    !allowanceAfter
    || (
      sameAllowancePeriod(historicalAllowanceAfter, allowanceAfter)
        ? !allowanceCountsEqual(historicalAllowanceAfter, allowanceAfter)
        : new Date(allowanceAfter.period_start).getTime()
          < new Date(historicalAllowanceAfter.resets_at).getTime()
    )
  ) {
    fail("The ready fixture did not prove exactly one deterministic reviewer credit.");
  }

  const productState = await verifyReviewerProductState(
    identity,
    pending.note,
    status,
    allowanceAfter,
    historicalAllowanceAfter,
  );
  const foreignVideoId = await findForeignVideoId(
    identity.uid,
    expectedForeignUid,
    expectedForeignVideoId,
  );
  const foreignCall = await client.callTool({
    name: "get_video_status",
    arguments: { video_id: foreignVideoId },
  });
  if (
    !foreignCall.isError
    || foreignCall.structuredContent !== undefined
    || !JSON.stringify(foreignCall).includes("video_not_found")
    || JSON.stringify(foreignCall).includes(foreignVideoId)
  ) {
    fail("The foreign-account status fixture did not fail closed.");
  }
  assertToolResultPrivacy(foreignCall, "The foreign-account denial call");

  const noteForExposure = {
    ...pending.note,
    slug: noteflixLastPathSegment(pending.note.url),
  };
  const exposure = await verifySignedOutExposure(noteForExposure, status);
  let invocationCreditDelta = null;
  if (sameAllowancePeriod(invocationAllowanceBefore, allowanceAfter)) {
    invocationCreditDelta = allowanceAfter.used - invocationAllowanceBefore.used;
    if (![0, 1].includes(invocationCreditDelta)) {
      fail("The fixture invocation changed the reviewer allowance by an unexpected amount.");
    }
  } else if (!contiguousAllowancePeriods(invocationAllowanceBefore, allowanceAfter)) {
    fail("The fixture invocation crossed an invalid allowance period boundary.");
  }

  const fixtureRecord = {
    schema_version: 1,
    created_at: pending.created_at,
    verified_at: new Date().toISOString(),
    note: pending.note,
    ready_video: {
      id: status.video_id,
      url: status.url,
      slug: status.slug,
    },
    foreign_account_video_id: foreignVideoId,
    foreign_account_owner_hash: safeHash(expectedForeignUid),
    generation_request: pending.generation_request,
    allowance_before: pending.allowance_before,
    allowance_after: historicalAllowanceAfter,
    current_allowance_at_verification: allowanceSnapshot(allowanceAfter),
    privacy_verification: exposure,
  };
  storeFixtureSecret(fixtureRecord);

  return {
    fixture_note_private: true,
    fixture_video_ready_public: true,
    fixture_watch_slug_readable: true,
    foreign_account_denied: true,
    fixture_secret_version_added: true,
    fixture_lifecycle_credit_count: 1,
    fixture_credit_delta: invocationCreditDelta,
    fixture_note_hash: safeHash(pending.note.id),
    fixture_video_hash: safeHash(status.video_id),
    ...productState,
    ...exposure,
  };
}

async function createReviewerFixture(client, allowanceBefore, identity) {
  validateAllowance(allowanceBefore);
  const expectedForeignUid = await reviewerUidForSecret(foreignReviewerSecret);
  if (expectedForeignUid === identity.uid) {
    fail("The foreign reviewer secret resolved to the connected reviewer account.");
  }
  const expectedForeignVideoId = counterpartVideoId();
  const existing = readFixtureSecret();
  if (existing) {
    if (existing.schema_version === 2) {
      return await finishPendingReviewerFixture(
        client,
        allowanceBefore,
        existing,
        identity,
        expectedForeignUid,
        expectedForeignVideoId,
      );
    }
    return await verifyStoredFixture(
      client,
      allowanceBefore,
      existing,
      identity,
      expectedForeignUid,
      expectedForeignVideoId,
    );
  }
  if (!allowanceBefore.can_generate) {
    fail("The reviewer account has no public-video credit available.");
  }

  const noteCall = await client.callTool({
    name: "create_private_note",
    arguments: fixtureNoteArguments(),
  });
  assertToolResultPrivacy(noteCall, "The reviewer fixture note call");
  const noteResult = validatePrivateNoteResult(noteCall);
  const pending = {
    schema_version: 2,
    fixture_state: "note_created",
    created_at: new Date().toISOString(),
    checkpointed_at: new Date().toISOString(),
    note: {
      id: noteResult.note.id,
      url: noteResult.note.url,
      title: noteResult.note.title,
    },
    generation_request: {
      request_id: videoRequestId,
      style: "whiteboard",
      mode: "brief",
    },
    allowance_before: allowanceSnapshot(allowanceBefore),
  };
  storeFixtureSecret(pending);
  return await finishPendingReviewerFixture(
    client,
    allowanceBefore,
    pending,
    identity,
    expectedForeignUid,
    expectedForeignVideoId,
  );
}

async function verifyMcp(accessToken, identity, clientId) {
  let wireTools;
  const captureFetch = async (input, init) => {
    const response = await fetch(input, init);
    try {
      const request = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (request?.method === "tools/list") {
        const payload = await response.clone().json();
        if (Array.isArray(payload?.result?.tools)) wireTools = payload.result.tools;
      }
    } catch {
      // The normal SDK validation below remains authoritative if capture fails.
    }
    return response;
  };
  const transport = new StreamableHTTPClientTransport(
    new URL("/mcp", transportBase),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: "https://chatgpt.com",
        },
      },
      fetch: captureFetch,
    },
  );
  const client = new Client({ name: "noteflix-production-readonly-verifier", version: "1.0.0" });
  await client.connect(transport);
  try {
    const exactUserTokenBound = await verifyOAuthTokenBinding(accessToken, identity, clientId);
    const catalog = await client.listTools();
    const names = catalog.tools.map((tool) => tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(expectedTools)) fail("The live tool catalog changed.");
    if (!Array.isArray(wireTools) || wireTools.length !== expectedTools.length) {
      fail("The raw tools/list response could not be verified.");
    }
    const requiredScopes = {
      create_private_note: ["notes:create"],
      create_public_note_video: ["videos:create", "videos:publish"],
      get_video_allowance: ["videos:read"],
      get_video_status: ["videos:read"],
    };
    for (const tool of wireTools) {
      const expectedScopes = requiredScopes[tool.name];
      if (
        !expectedScopes
        || !Array.isArray(tool.securitySchemes)
        || tool.securitySchemes.length !== 1
        || tool.securitySchemes[0]?.type !== "oauth2"
        || !Array.isArray(tool.securitySchemes[0]?.scopes)
        || JSON.stringify([...tool.securitySchemes[0].scopes].sort())
          !== JSON.stringify([...expectedScopes].sort())
        || !Array.isArray(tool._meta?.securitySchemes)
        || JSON.stringify(tool.securitySchemes) !== JSON.stringify(tool._meta.securitySchemes)
      ) {
        fail(`Tool ${tool.name} did not mirror its OAuth security scheme.`);
      }
    }
    const publicVideo = catalog.tools.find((tool) => tool.name === "create_public_note_video");
    if (
      publicVideo?.annotations?.readOnlyHint !== false
      || publicVideo?.annotations?.destructiveHint !== false
      || publicVideo?.annotations?.openWorldHint !== true
      || publicVideo?.annotations?.idempotentHint !== true
    ) {
      fail("The public-video annotations did not match the reviewed contract.");
    }

    const first = await client.callTool({ name: "get_video_allowance", arguments: {} });
    const second = await client.callTool({ name: "get_video_allowance", arguments: {} });
    if (first.isError || second.isError) fail("The reviewer allowance call failed.");
    assertToolResultPrivacy(first, "The first allowance call");
    assertToolResultPrivacy(second, "The second allowance call");
    validateAllowance(first.structuredContent);
    validateAllowance(second.structuredContent);
    if (
      (
        sameAllowancePeriod(first.structuredContent, second.structuredContent)
        && !allowanceCountsEqual(first.structuredContent, second.structuredContent)
      )
      || (
        !sameAllowancePeriod(first.structuredContent, second.structuredContent)
        && !contiguousAllowancePeriods(first.structuredContent, second.structuredContent)
      )
    ) {
      fail("The read-only allowance call changed the account allowance.");
    }
    const result = {
      tool_count: catalog.tools.length,
      oauth_schemes_mirrored: true,
      oauth_schemes_exact: true,
      public_video_annotations_verified: true,
      exact_user_token_bound: exactUserTokenBound,
      exact_user_eligible: exactUserTokenBound && second.structuredContent.eligible === true,
      allowance_read_only: true,
      can_generate: second.structuredContent.can_generate,
    };
    if (fixtureMode) {
      return {
        ...result,
        ...await createReviewerFixture(client, second.structuredContent, identity),
      };
    }
    return result;
  } finally {
    await client.close();
  }
}

async function revoke(clientId, accessToken) {
  const response = await fetchWithTimeout(new URL("/revoke", transportBase), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      token: accessToken,
      token_type_hint: "access_token",
    }),
  });
  if (!response.ok) fail(`Token revocation failed with HTTP ${response.status}.`);

  const probe = await fetchWithTimeout(new URL("/mcp", transportBase), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: "https://chatgpt.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "revocation-probe", version: "1" },
      },
    }),
  });
  if (probe.status !== 401) fail("The revoked access token remained usable.");
}

const verifier = randomBytes(48).toString("base64url");
const state = randomBytes(32).toString("base64url");
let clientId;
let accessToken;

try {
  clientId = await registerClient();
  const requestId = await authorize(clientId, verifier, state);
  const consent = await completeConsent(requestId);
  accessToken = await exchangeCode(clientId, verifier, consent.redirect, state);
  const result = await verifyMcp(accessToken, consent.identity, clientId);
  await revoke(clientId, accessToken);
  accessToken = undefined;
  process.stdout.write(JSON.stringify({ ok: true, ...result, revoked: true }));
} finally {
  if (clientId && accessToken) {
    await revoke(clientId, accessToken).catch(() => undefined);
  }
}
