#!/bin/bash
set -e

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" > /dev/null 2>&1; then
  echo "Error: No active account found in gcloud."
  echo "Please run 'gcloud auth login' and then try this script again."
  exit 1
fi

# Check for .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found. Please create one with your secrets."
    exit 1
fi

SERVICE_NAME="saveitforl8r"
PROJECT_ID=$(gcloud config get-value project)
REPO_NAME="saveitforl8r-repo"

deploy_to_region() {
  local REGION=$1
  local ARTIFACT_REGION=$REGION # Assuming artifact region is same as deploy region for simplicity
  local IMAGE_NAME="$ARTIFACT_REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$SERVICE_NAME"

  echo "--- Building Container for $REGION ---"
  gcloud builds submit --config cloudbuild.yaml --substitutions=\
_VITE_GOOGLE_CLIENT_ID=$(grep VITE_GOOGLE_CLIENT_ID .env | cut -d '=' -f2),\
_VITE_GOOGLE_CLIENT_SECRET=$(grep VITE_GOOGLE_CLIENT_SECRET .env | cut -d '=' -f2),\
_ARTIFACT_REGION=$ARTIFACT_REGION

  echo "--- Deploying to Cloud Run in $REGION ---"
  gcloud run deploy $SERVICE_NAME \
    --image "$IMAGE_NAME" \
    --region "$REGION" \
    --allow-unauthenticated
}

# --- Main Logic ---
# If a region is provided as an argument, deploy only to that region.
if [ -n "$1" ]; then
  echo "Deploying to specified region: $1"
  deploy_to_region "$1"
else
  # If no argument, deploy to all existing regions, or prompt for new one.
  echo "No region specified. Checking for existing deployments..."
  EXISTING_REGIONS=$(gcloud run services list --filter="SERVICE:$SERVICE_NAME" --format="value(REGION)")

  if [ -z "$EXISTING_REGIONS" ]; then
    echo "No existing service found. Please specify a region to deploy to."
    echo "Example: ./deploy-cloud-run.sh us-central1"
    exit 1
  fi
  
  for REGION in $EXISTING_REGIONS; do
    echo "Found existing deployment in $REGION. Redeploying..."
    deploy_to_region "$REGION"
  done
fi

echo "Deployment script finished."
