#!/bin/bash
set -e

PROJECT_ID="gen-lang-client-0882625776"

echo "--- Initializing Firestore for Project: $PROJECT_ID ---"
gcloud config set project $PROJECT_ID

echo "Enabling Firestore API..."
gcloud services enable firestore.googleapis.com

PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
COMPUTE_SVC_ACCT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Adding Firestore User role to Compute Service Account..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${COMPUTE_SVC_ACCT}" \
    --role="roles/datastore.user" \
    --condition=None

# Create Firestore database if it doesn't exist
if ! gcloud firestore databases describe --database="(default)" &>/dev/null; then
    echo "Creating Firestore database in us-central1..."
    gcloud firestore databases create --location=us-central1
else
    echo "Firestore database already exists."
fi

echo "Configuring TTL policy on enrichment-results collection..."
gcloud firestore fields ttls update expireAt \
    --collection-group=enrichment-results \
    --enable-ttl \
    --database="(default)" 2>/dev/null || true

echo "Firestore setup completed successfully!"
