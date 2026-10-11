/**
 * Publishes a CSV produced for Samuhia Desk and returns a short-lived signed download link.
 * The object lives under an unguessable path (`desk-exports/<school>/<uuid>/…`) and the link expires after 15 minutes.
 * Signing needs `iam.serviceAccounts.signBlob` on the function's runtime service account (roles/iam.serviceAccountTokenCreator
 * on itself — see DEPLOYMENT.md). If signing is not available the object is deleted again and the caller gets a clear error:
 * we never fall back to a public link.
 */
import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import { DelegateFault, safeFileName, toCsv } from "./deskDelegateCore";
import type { DelegateFileResult } from "./deskContract";

export const FILE_LINK_TTL_MS = 15 * 60 * 1000;

export async function publishCsv(schoolId: string, baseName: string, rows: string[][]): Promise<DelegateFileResult> {
  const name = `${safeFileName(baseName)}.csv`;
  const path = `desk-exports/${schoolId}/${randomUUID()}/${name}`;
  const file = admin.storage().bucket().file(path);
  try {
    await file.save("﻿" + toCsv(rows), {
      resumable: false,
      contentType: "text/csv; charset=utf-8",
      metadata: { contentDisposition: `attachment; filename="${name}"`, cacheControl: "private, max-age=0" },
    });
  } catch (err) {
    console.error("desk export upload failed", err);
    throw new DelegateFault("internal", "The file could not be prepared. Please try again.");
  }
  const expiresAt = Date.now() + FILE_LINK_TTL_MS;
  try {
    const [downloadUrl] = await file.getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
    return { downloadUrl, expiresAt };
  } catch (err) {
    console.error("desk export signing failed", err);
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw new DelegateFault("failed_precondition", "Download links are not enabled for MyRegister yet. The MyRegister administrator must grant the function's service account permission to sign URLs (see DEPLOYMENT.md).");
  }
}
