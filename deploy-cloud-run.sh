#!/bin/bash
set -e

PROJECT_ID="gen-lang-client-0882625776"
REGIONS=("us-west1" "asia-south1")
REPO="saveitforl8r-repo"
SERVER_URL="https://api.saveitforl8r.com"

echo "--- 1. Initializing Project & APIs ---"
gcloud config set project $PROJECT_ID
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iam.googleapis.com \
    firestore.googleapis.com

# echo "Waiting for APIs..."
# sleep 15

PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
COMPUTE_SVC_ACCT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${COMPUTE_SVC_ACCT}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${COMPUTE_SVC_ACCT}" \
    --role="roles/datastore.user" \
    --condition=None

# Create Firestore database if it doesn't exist (us-central1 for low latency from both regions)
if ! gcloud firestore databases describe --database="(default)" &>/dev/null; then
    echo "Creating Firestore database..."
    gcloud firestore databases create --location=us-central1
fi

# Configure TTL policy on enrichment-results collection (idempotent)
gcloud firestore fields ttls update expireAt \
    --collection-group=enrichment-results \
    --enable-ttl \
    --database="(default)" 2>/dev/null || true

echo "--- 2. Handling Secrets ---"
function ensure_secret() {
    if ! gcloud secrets describe $1 &>/dev/null; then
        read -p "Enter value for $1: " val
        echo -n "$val" | gcloud secrets create $1 --data-file=-
    fi
}
ensure_secret "GEMINI_API_KEY"
ensure_secret "VITE_GOOGLE_CLIENT_ID"
ensure_secret "VITE_GOOGLE_CLIENT_SECRET"

GOOGLE_CLIENT_ID=$(gcloud secrets versions access latest --secret=VITE_GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=VITE_GOOGLE_CLIENT_SECRET)

for REGION in "${REGIONS[@]}"; do
    echo "=========================================="
    echo "DEPLOYING TO REGION: $REGION"
    echo "=========================================="
    
    if ! gcloud artifacts repositories describe $REPO --location=$REGION &>/dev/null; then
        gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION
    fi

    SERVER_IMG="${REGION}-docker.pkg.dev/$PROJECT_ID/$REPO/server:latest"
    CLIENT_IMG="${REGION}-docker.pkg.dev/$PROJECT_ID/$REPO/client:latest"

    echo "--- Building & Deploying Server ($REGION) ---"
    gcloud builds submit server/ --tag $SERVER_IMG

    gcloud run deploy saveitforl8r-server \
        --image $SERVER_IMG \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated \
        --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,VITE_GOOGLE_CLIENT_ID=VITE_GOOGLE_CLIENT_ID:latest" \
        --port 8081

    # Using global load balancer URL for server
    echo "Server URL (global): $SERVER_URL"

    echo "--- Building & Deploying Client ($REGION) ---"
    cat > temp_cloudbuild.yaml <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: [
    'build',
    '-t', '\$TAG_NAME',
    '--build-arg', 'VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID',
    '--build-arg', 'VITE_GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET',
    '--build-arg', 'VITE_PROXY_URL=$SERVER_URL',
    '.'
  ]
images:
- '\$TAG_NAME'
EOF

    gcloud builds submit . --config temp_cloudbuild.yaml --substitutions TAG_NAME=$CLIENT_IMG
    rm temp_cloudbuild.yaml

    gcloud run deploy saveitforl8r-client \
        --image $CLIENT_IMG \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated

    # Get the client URL (now it definitely exists)
    CLIENT_URL=$(gcloud run services describe saveitforl8r-client --region $REGION --format="value(status.url)")
    
    # Construct ALLOWED_ORIGINS
    # Always include https://saveitforl8r.com and the load balancer URL
    # Also include capacitor://localhost, http://localhost, and https://localhost for native apps
    
    ALLOWED_ORIGINS_VAL="https://saveitforl8r.com,https://api.saveitforl8r.com,capacitor://localhost,http://localhost,https://localhost"
    if [ -n "$CLIENT_URL" ]; then
        ALLOWED_ORIGINS_VAL="${ALLOWED_ORIGINS_VAL},${CLIENT_URL}"
    fi

    echo "--- Updating ALLOWED_ORIGINS on server ($REGION) ---"
    echo "Value: $ALLOWED_ORIGINS_VAL"
    
    # Use env-vars-file to avoid comma parsing issues
    cat > env_vars.yaml <<EOF
ALLOWED_ORIGINS: "$ALLOWED_ORIGINS_VAL"
EOF

    gcloud run services update saveitforl8r-server \
        --region $REGION \
        --env-vars-file env_vars.yaml
        
    rm env_vars.yaml
done

echo "DEPLOYMENTS FINISHED SUCCESSFULLY!"
