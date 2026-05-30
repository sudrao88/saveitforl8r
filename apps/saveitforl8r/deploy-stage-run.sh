#!/bin/bash
set -e

PROJECT_ID="gen-lang-client-0882625776"
REGIONS=("us-west1" "asia-south1")
REPO="saveitforl8r-stg-repo"
SERVER_STG_DOMAIN="api-stg.saveitforl8r.com"
CLIENT_STG_DOMAIN="stg.saveitforl8r.com"
SERVER_STG_URL="https://${SERVER_STG_DOMAIN}"
CLIENT_STG_URL="https://${CLIENT_STG_DOMAIN}"

echo "--- 1. Initializing Project & APIs ---"
gcloud config set project $PROJECT_ID
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iam.googleapis.com

PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
COMPUTE_SVC_ACCT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${COMPUTE_SVC_ACCT}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None

echo "--- 2. Handling Secrets ---"
GOOGLE_CLIENT_ID=$(gcloud secrets versions access latest --secret=VITE_GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=VITE_GOOGLE_CLIENT_SECRET)

for REGION in "${REGIONS[@]}"; do
    echo "=========================================="
    echo "DEPLOYING TO REGION (STAGING): $REGION"
    echo "=========================================="
    
    if ! gcloud artifacts repositories describe $REPO --location=$REGION &>/dev/null; then
        gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION
    fi

    SERVER_IMG="${REGION}-docker.pkg.dev/$PROJECT_ID/$REPO/server-stg:latest"
    CLIENT_IMG="${REGION}-docker.pkg.dev/$PROJECT_ID/$REPO/client-stg:latest"

    echo "--- Building & Deploying Server Stage ($REGION) ---"
    gcloud builds submit server/ --tag $SERVER_IMG

    gcloud run deploy saveitforl8r-server-stg \
        --image $SERVER_IMG \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated \
        --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,GOOGLE_CLIENT_ID=VITE_GOOGLE_CLIENT_ID:latest" \
        --port 8081

    echo "--- Building & Deploying Client Stage ($REGION) ---"
    cat > temp_cloudbuild_stg.yaml <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: [
    'build',
    '-t', '\$TAG_NAME',
    '--build-arg', 'VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID',
    '--build-arg', 'VITE_GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET',
    '--build-arg', 'VITE_PROXY_URL=$SERVER_STG_URL',
    '.'
  ]
images:
- '\$TAG_NAME'
EOF

    gcloud builds submit . --config temp_cloudbuild_stg.yaml --substitutions TAG_NAME=$CLIENT_IMG
    rm temp_cloudbuild_stg.yaml

    gcloud run deploy saveitforl8r-client-stg \
        --image $CLIENT_IMG \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated

    # Construct ALLOWED_ORIGINS for staging
    ALLOWED_ORIGINS_VAL="${CLIENT_STG_URL},${SERVER_STG_URL},capacitor://localhost,http://localhost,https://localhost"
    
    echo "--- Updating ALLOWED_ORIGINS on server-stg ($REGION) ---"
    cat > env_vars_stg.yaml <<EOF
ALLOWED_ORIGINS: "$ALLOWED_ORIGINS_VAL"
EOF

    gcloud run services update saveitforl8r-server-stg \
        --region $REGION \
        --env-vars-file env_vars_stg.yaml
        
    rm env_vars_stg.yaml
done

echo "STAGING DEPLOYMENTS FINISHED SUCCESSFULLY!"
