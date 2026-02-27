#!/bin/bash
set -e

PROJECT_ID="gen-lang-client-0882625776"
REGIONS=("us-west1" "asia-south1")
SERVER_STG_DOMAIN="api-stg.saveitforl8r.com"
CLIENT_STG_DOMAIN="stg.saveitforl8r.com"

echo "--- 1. Initializing APIs ---"
gcloud config set project $PROJECT_ID
gcloud services enable compute.googleapis.com

echo "--- 2. Reserving Global IP ---"
IP_NAME="saveitforl8r-stg-ip"
if ! gcloud compute addresses describe $IP_NAME --global &>/dev/null; then
    gcloud compute addresses create $IP_NAME --global
fi
STG_IP=$(gcloud compute addresses describe $IP_NAME --global --format="value(address)")
echo "Staging Global IP: $STG_IP"

echo "--- 3. Creating Serverless NEGs ---"
for REGION in "${REGIONS[@]}"; do
    if ! gcloud compute network-endpoint-groups describe saveitforl8r-server-stg-neg --region=$REGION &>/dev/null; then
        gcloud compute network-endpoint-groups create saveitforl8r-server-stg-neg \
            --region=$REGION \
            --network-endpoint-type=serverless \
            --cloud-run-service=saveitforl8r-server-stg
    fi
    if ! gcloud compute network-endpoint-groups describe saveitforl8r-client-stg-neg --region=$REGION &>/dev/null; then
        gcloud compute network-endpoint-groups create saveitforl8r-client-stg-neg \
            --region=$REGION \
            --network-endpoint-type=serverless \
            --cloud-run-service=saveitforl8r-client-stg
    fi
done

echo "--- 4. Creating Backend Services ---"
if ! gcloud compute backend-services describe saveitforl8r-server-stg-backend --global &>/dev/null; then
    gcloud compute backend-services create saveitforl8r-server-stg-backend --global
fi
if ! gcloud compute backend-services describe saveitforl8r-client-stg-backend --global &>/dev/null; then
    gcloud compute backend-services create saveitforl8r-client-stg-backend --global
fi

# Add NEGs to Backend Services
for REGION in "${REGIONS[@]}"; do
    if ! gcloud compute backend-services describe saveitforl8r-server-stg-backend --global --format="value(backends[].group)" | grep -q $REGION; then
        gcloud compute backend-services add-backend saveitforl8r-server-stg-backend \
            --global \
            --network-endpoint-group=saveitforl8r-server-stg-neg \
            --network-endpoint-group-region=$REGION
    fi
    if ! gcloud compute backend-services describe saveitforl8r-client-stg-backend --global --format="value(backends[].group)" | grep -q $REGION; then
        gcloud compute backend-services add-backend saveitforl8r-client-stg-backend \
            --global \
            --network-endpoint-group=saveitforl8r-client-stg-neg \
            --network-endpoint-group-region=$REGION
    fi
done

echo "--- 5. Creating URL Map ---"
URL_MAP_NAME="saveitforl8r-stg-url-map"
cat > stg_url_map.yaml <<EOF
kind: compute#urlMap
name: $URL_MAP_NAME
defaultService: projects/$PROJECT_ID/global/backendServices/saveitforl8r-client-stg-backend
hostRules:
- hosts:
  - '$CLIENT_STG_DOMAIN'
  pathMatcher: client-matcher
- hosts:
  - '$SERVER_STG_DOMAIN'
  pathMatcher: server-matcher
pathMatchers:
- name: client-matcher
  defaultService: projects/$PROJECT_ID/global/backendServices/saveitforl8r-client-stg-backend
- name: server-matcher
  defaultService: projects/$PROJECT_ID/global/backendServices/saveitforl8r-server-stg-backend
EOF

if ! gcloud compute url-maps describe $URL_MAP_NAME &>/dev/null; then
    gcloud compute url-maps import $URL_MAP_NAME --source stg_url_map.yaml --quiet
else
    gcloud compute url-maps import $URL_MAP_NAME --source stg_url_map.yaml --quiet
fi
rm stg_url_map.yaml

echo "--- 6. Setting up SSL Certificates ---"
CERT_NAME="saveitforl8r-stg-cert"
if ! gcloud compute ssl-certificates describe $CERT_NAME &>/dev/null; then
    gcloud compute ssl-certificates create $CERT_NAME \
        --domains=$CLIENT_STG_DOMAIN,$SERVER_STG_DOMAIN
fi

echo "--- 7. Creating Target HTTPS Proxy ---"
PROXY_NAME="saveitforl8r-stg-https-proxy"
if ! gcloud compute target-https-proxies describe $PROXY_NAME &>/dev/null; then
    gcloud compute target-https-proxies create $PROXY_NAME \
        --url-map=$URL_MAP_NAME \
        --ssl-certificates=$CERT_NAME
fi

echo "--- 8. Creating Forwarding Rule ---"
FWD_RULE_NAME="saveitforl8r-stg-fwd-rule"
if ! gcloud compute forwarding-rules describe $FWD_RULE_NAME --global &>/dev/null; then
    gcloud compute forwarding-rules create $FWD_RULE_NAME \
        --address=$IP_NAME \
        --global \
        --target-https-proxy=$PROXY_NAME \
        --ports=443
fi

echo "--- LB SETUP COMPLETE ---"
echo "Global IP: $STG_IP"
echo "DNS A Records required for: $CLIENT_STG_DOMAIN, $SERVER_STG_DOMAIN"
