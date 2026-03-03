#!/bin/bash
set -e

PROJECT_ID="gen-lang-client-0882625776"

echo "--- Initializing Firestore for Project: $PROJECT_ID ---"
gcloud config set project $PROJECT_ID

echo "Enabling Firestore API..."
gcloud services enable firestore.googleapis.com

PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
COMPUTE_SVC_ACCT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Adding Firestore roles to Compute Service Account..."
# datastore.user for CRUD operations
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${COMPUTE_SVC_ACCT}" \
    --role="roles/datastore.user" \
    --condition=None

# datastore.indexAdmin for TTL and index management
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${COMPUTE_SVC_ACCT}" \
    --role="roles/datastore.indexAdmin" \
    --condition=None

# Create Firestore database if it doesn't exist
if ! gcloud firestore databases describe --database="(default)" &>/dev/null; then
    echo "Creating Firestore database in us-central1..."
    gcloud firestore databases create --location=us-central1
else
    echo "Firestore database already exists."
fi

echo "Configuring TTL policy on enrichment-results collection..."
# Removed error suppression to ensure visibility of failures.
# Note: This may fail if the TTL is already being enabled or if there's a conflict,
# but we want to see the error as per reviewer feedback.
gcloud firestore fields ttls update expireAt \
    --collection-group=enrichment-results \
    --enable-ttl \
    --database="(default)"

echo "Firestore setup completed successfully!"
