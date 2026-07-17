#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const project = "studywnoteflix";
const accountDisplayName = "OpenAI cross-account review fixture";
const credentialSecret = "noteflix-openai-cross-account-fixture-credentials";
const revenueCatSecret = "REVENUECAT_SECRET_KEY";
const revenueCatProjectId = "proj3bd66d0a";
const revenueCatPremiumEntitlementId = "entl02f9fb7a74";
const premiumLookupKey = "Noteflix Pro";
const grantDurationDays = 60;
const confirmation = "CREATE_LOCKED_SYNTHETIC_REVIEW_ACCOUNT";

if (
  process.argv.length !== 2
  || process.env.CROSS_ACCOUNT_FIXTURE_CONFIRMATION !== confirmation
) {
  throw new Error(
    "Set the exact CROSS_ACCOUNT_FIXTURE_CONFIRMATION value to prepare the locked synthetic account.",
  );
}

function fail(message) {
  throw new Error(message);
}

function gcloud(args, input, env = process.env) {
  return execFileSync("gcloud", args, {
    encoding: "utf8",
    env,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
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
  return gcloud(args, input, {
    ...process.env,
    CLOUDSDK_AUTH_ACCESS_TOKEN: adcToken(),
  });
}

function secretExists(name) {
  try {
    authorizedGcloud([
      "secrets",
      "describe",
      name,
      "--project",
      project,
      "--format=value(name)",
    ]);
    return true;
  } catch (cause) {
    const stderr = String(cause?.stderr ?? "");
    if (/\bNOT_FOUND\b|\bnot found\b/i.test(stderr)) return false;
    fail(`Secret Manager could not determine whether ${name} exists.`);
  }
}

function readSecret(name) {
  const value = authorizedGcloud([
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret",
    name,
    "--project",
    project,
  ]);
  if (!value) fail(`Secret ${name} was empty.`);
  return value;
}

function createSecret(name, value) {
  authorizedGcloud([
    "secrets",
    "create",
    name,
    "--project",
    project,
    "--replication-policy=automatic",
  ]);
  authorizedGcloud([
    "secrets",
    "versions",
    "add",
    name,
    "--project",
    project,
    "--data-file=-",
  ], `${value}\n`);
}

function parseCredentials(raw) {
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    fail("The synthetic-account credential secret was malformed.");
  }
  if (
    typeof credentials?.email !== "string"
    || !/^openai-cross-account-[a-z0-9-]+@noteflix\.com$/.test(credentials.email)
    || typeof credentials?.password !== "string"
    || credentials.password.length < 24
  ) {
    fail("The synthetic-account credential secret was malformed.");
  }
  return credentials;
}

async function revenueCatRequest(apiKey, path, init = {}) {
  const response = await fetch(`https://api.revenuecat.com/v2${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function resolveRevenueCatConfiguration(apiKey) {
  const entitlements = await revenueCatRequest(
    apiKey,
    `/projects/${encodeURIComponent(revenueCatProjectId)}/entitlements?limit=100`,
  );
  if (!entitlements.response.ok) {
    fail(`RevenueCat entitlement lookup failed with HTTP ${entitlements.response.status}.`);
  }
  const premium = (Array.isArray(entitlements.body?.items) ? entitlements.body.items : [])
    .filter((candidate) => (
      candidate?.id === revenueCatPremiumEntitlementId
      && candidate?.lookup_key === premiumLookupKey
      && candidate?.state === "active"
    ));
  if (premium.length !== 1) {
    fail("The immutable production Noteflix Pro entitlement was not available.");
  }
  return {
    projectId: revenueCatProjectId,
    entitlementId: revenueCatPremiumEntitlementId,
  };
}

async function activeEntitlements(apiKey, projectId, uid) {
  const result = await revenueCatRequest(
    apiKey,
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(uid)}/active_entitlements?limit=100`,
  );
  if (result.response.status === 404) return [];
  if (!result.response.ok) {
    fail(`RevenueCat active-entitlement lookup failed with HTTP ${result.response.status}.`);
  }
  return Array.isArray(result.body?.items) ? result.body.items : [];
}

async function ensureRevenueCatEntitlement(uid) {
  const apiKey = readSecret(revenueCatSecret);
  const configuration = await resolveRevenueCatConfiguration(apiKey);
  const customerPath = `/projects/${encodeURIComponent(configuration.projectId)}/customers/${encodeURIComponent(uid)}`;
  const existingCustomer = await revenueCatRequest(apiKey, customerPath);
  let customerCreated = false;
  if (existingCustomer.response.status === 404) {
    const created = await revenueCatRequest(
      apiKey,
      `/projects/${encodeURIComponent(configuration.projectId)}/customers`,
      { method: "POST", body: JSON.stringify({ id: uid }) },
    );
    if (created.response.status !== 201 && created.response.status !== 409) {
      fail(`RevenueCat customer creation failed with HTTP ${created.response.status}.`);
    }
    customerCreated = created.response.status === 201;
  } else if (!existingCustomer.response.ok) {
    fail(`RevenueCat customer lookup failed with HTTP ${existingCustomer.response.status}.`);
  }

  const before = await activeEntitlements(apiKey, configuration.projectId, uid);
  const alreadyActive = before.some((item) => (
    item?.entitlement_id === configuration.entitlementId
    && (item.expires_at === null || Number(item.expires_at) > Date.now())
  ));
  let grantCreated = false;
  if (!alreadyActive) {
    const expiresAt = Date.now() + grantDurationDays * 24 * 60 * 60 * 1000;
    const grant = await revenueCatRequest(
      apiKey,
      `${customerPath}/actions/grant_entitlement`,
      {
        method: "POST",
        body: JSON.stringify({
          entitlement_id: configuration.entitlementId,
          expires_at: expiresAt,
        }),
      },
    );
    if (grant.response.status !== 201 && grant.response.status !== 409) {
      fail(`RevenueCat entitlement grant failed with HTTP ${grant.response.status}.`);
    }
    grantCreated = grant.response.status === 201;
  }
  const after = await activeEntitlements(apiKey, configuration.projectId, uid);
  const active = after.some((item) => (
    item?.entitlement_id === configuration.entitlementId
    && (item.expires_at === null || Number(item.expires_at) > Date.now())
  ));
  if (!active) fail("The synthetic RevenueCat entitlement was not active after setup.");
  return { active, customerCreated, grantCreated };
}

async function main() {
  const credentialAlreadyExists = secretExists(credentialSecret);
  const app = initializeApp(
    { credential: applicationDefault(), projectId: project },
    `noteflix-cross-account-setup-${Date.now()}`,
  );
  const auth = getAuth(app);
  let user;
  let firebaseUserCreated = false;
  let credentials = credentialAlreadyExists
    ? parseCredentials(readSecret(credentialSecret))
    : {
        email: `openai-cross-account-${randomBytes(10).toString("hex")}@noteflix.com`,
        password: randomBytes(32).toString("base64url"),
      };
  try {
    try {
      user = await auth.getUserByEmail(credentials.email);
    } catch (cause) {
      if (cause?.code !== "auth/user-not-found") throw cause;
    }

    if (user && !credentialAlreadyExists) {
      fail("The synthetic Firebase account exists without its credential secret; refusing to reset it.");
    }
    if (!user && credentialAlreadyExists) {
      fail("The synthetic credential secret exists without its Firebase account; refusing to recreate it.");
    }

    if (user) {
      if (
        user.email !== credentials.email
        || user.disabled
        || !user.emailVerified
        || user.displayName !== accountDisplayName
      ) {
        fail("The existing synthetic Firebase account did not match the locked review profile.");
      }
    } else {
      user = await auth.createUser({
        email: credentials.email,
        password: credentials.password,
        emailVerified: true,
        disabled: false,
        displayName: accountDisplayName,
      });
      firebaseUserCreated = true;
      try {
        createSecret(credentialSecret, JSON.stringify(credentials));
      } catch (cause) {
        await auth.deleteUser(user.uid).catch(() => undefined);
        throw cause;
      }
    }

    const entitlement = await ensureRevenueCatEntitlement(user.uid);
    process.stdout.write(JSON.stringify({
      ok: true,
      firebase_user_created: firebaseUserCreated,
      credential_secret_present: true,
      email_verified: user.emailVerified,
      disabled: user.disabled,
      entitlement_active: entitlement.active,
      revenuecat_customer_created: entitlement.customerCreated,
      revenuecat_grant_created: entitlement.grantCreated,
      synthetic_uid_hash: createHash("sha256").update(user.uid).digest("hex").slice(0, 16),
    }));
  } finally {
    await deleteApp(app);
  }
}

await main();
