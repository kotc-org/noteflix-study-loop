import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import type { AppConfig } from "./config.js";

export function initializeFirebase(config: AppConfig) {
  const app =
    getApps()[0] ??
    initializeApp({
      credential: applicationDefault(),
      projectId: config.firebaseProjectId,
    });

  return {
    db: getFirestore(app, config.firestoreDatabaseId),
  };
}
