#!/usr/bin/env bash
# Connects MyRegister to Samuhia Desk. Run once per environment by a project owner.
#
#   ./scripts/desk-iam.sh <REGISTER_PROJECT_ID> <DESK_PROJECT_NUMBER> [region] [DESK_PROJECT_ID]
#
# With the 4th argument it also wires the OTHER direction (desk commission on school SMS top-ups, see below).
#
# The desk runs as <DESK_PROJECT_NUMBER>-compute@developer.gserviceaccount.com (the shared CYBER / PAY / Plot Yangu project).
# It needs two things in THIS project:
#   1. roles/run.invoker on the private `deskdelegate` function (entity lookup, imports, reports, SMS actions).
#   2. roles/datastore.user so its 30-minute sweeper can read desk_requests AND write status "pulled" / deskStatus / responses
#      back. datastore.viewer is NOT enough: the item would stay "new" and be pulled again on every run.
# It then prints the two values to put in desk_config/global (they are data, not code, so no deploy can set them).
set -euo pipefail

PROJECT="${1:?usage: desk-iam.sh <REGISTER_PROJECT_ID> <DESK_PROJECT_NUMBER> [region]}"
DESK_NUMBER="${2:?usage: desk-iam.sh <REGISTER_PROJECT_ID> <DESK_PROJECT_NUMBER> [region]}"
REGION="${3:-africa-south1}"
DESK_SA="${DESK_NUMBER}-compute@developer.gserviceaccount.com"

echo "Granting invoker on deskdelegate (${PROJECT}, ${REGION}) to ${DESK_SA}"
gcloud run services add-iam-policy-binding deskdelegate \
  --project="${PROJECT}" --region="${REGION}" \
  --member="serviceAccount:${DESK_SA}" --role="roles/run.invoker" >/dev/null

echo "Granting Firestore read/write on ${PROJECT} to ${DESK_SA}"
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${DESK_SA}" --role="roles/datastore.user" --condition=None >/dev/null

URL="$(gcloud run services describe deskdelegate --project="${PROJECT}" --region="${REGION}" --format='value(status.url)')"
echo
echo "Private check (must print 403):"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "${URL}" || true
echo
echo "Set these in Firestore of the DESK project, document desk_config/global:"
echo "  projects.school  = ${PROJECT}"
echo "  delegate.school  = ${URL}"
echo
echo "Also deploy the indexes: firebase deploy --only firestore:indexes --project ${PROJECT}"

# ── Commission on school SMS top-ups (reverse direction) ─────────────────────────────────────────────────────────────
# MyRegister's chargeSmsTopUp calls PAY's private `deskSmsCommission` function (desk project) to plan the desk split.
# It runs as the MyRegister project's default compute service account, which therefore needs roles/run.invoker there.
DESK_PROJECT_ID="${4:-}"
if [[ -n "${DESK_PROJECT_ID}" ]]; then
  REGISTER_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
  REGISTER_SA="${REGISTER_NUMBER}-compute@developer.gserviceaccount.com"
  echo
  echo "Granting ${REGISTER_SA} invoker on deskSmsCommission (${DESK_PROJECT_ID}, ${REGION})"
  gcloud run services add-iam-policy-binding desksmscommission \
    --project="${DESK_PROJECT_ID}" --region="${REGION}" \
    --member="serviceAccount:${REGISTER_SA}" --role="roles/run.invoker" >/dev/null
  PLAN_URL="$(gcloud run services describe desksmscommission --project="${DESK_PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
  echo
  echo "Set this in functions/.env.${PROJECT} (or .env) and redeploy MyRegister functions. Empty = no desk commission, plain charges:"
  echo "  DESK_SMS_PLAN_URL=${PLAN_URL}"
fi
