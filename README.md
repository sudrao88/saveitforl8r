# SaveItForL8r

Your AI-powered second brain for capturing and recalling thoughts, links, and media.
Containerized for Google Cloud Run with offline support via Service Worker.

## Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the app:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000/launch](http://localhost:3000/launch)

## Deploy to Google Cloud Run

**Prerequisites:**
1. [Install Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
2. Authenticate: `gcloud auth login`
3. Set Project: `gcloud config set project YOUR_PROJECT_ID`

**Deployment:**
Run the following commands to deploy to Mumbai (asia-south1):

```bash
# Enable Services
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

# Create Artifact Registry Repository
gcloud artifacts repositories create saveitforl8r-repo --repository-format=docker --location=asia-south1 --description="Docker repository for SaveItForL8r"

# Build & Push Image
gcloud builds submit --tag asia-south1-docker.pkg.dev/$(gcloud config get-value project)/saveitforl8r-repo/saveitforl8r .

# Deploy to Cloud Run
gcloud run deploy saveitforl8r --image asia-south1-docker.pkg.dev/$(gcloud config get-value project)/saveitforl8r-repo/saveitforl8r --platform managed --region asia-south1 --allow-unauthenticated
```
