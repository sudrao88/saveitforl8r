#!/bin/bash
set -e

# Check if gcloud is authenticated by trying to list the active account
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" > /dev/null 2>&1; then
  echo "Error: No active account found in gcloud."
  echo "Please run 'gcloud auth login' and then try this script again."
  exit 1
fi

SERVICE_NAME="saveitforl8r"
PROJECT_ID=$(gcloud config get-value project)

echo "Checking for existing services named '$SERVICE_NAME' in project '$PROJECT_ID'..."

# Get regions where the service is deployed
REGIONS=$(gcloud run services list --filter="SERVICE:$SERVICE_NAME" --format="value(REGION)")

if [ -z "$REGIONS" ]; then
  echo "No existing service found with name '$SERVICE_NAME'."
  echo "To deploy a new service, run:"
  echo "gcloud run deploy $SERVICE_NAME --source ."
  exit 1
fi

# Deploy to each detected region
for REGION in $REGIONS; do
  echo "Found service in region: $REGION. Deploying update..."
  gcloud run deploy $SERVICE_NAME \
    --source . \
    --region "$REGION" \
    --allow-unauthenticated
done

echo "Deployment complete for all detected regions."
