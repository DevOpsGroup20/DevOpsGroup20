#!/usr/bin/env bash
set -euo pipefail

# Enable shell trace for verbose command logging by default.
if [[ "${TRACE:-1}" == "1" ]]; then
  set -x
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

STACK_NAME="${STACK_NAME:-devopsgroup20-e2e-local}"
AWS_REGION="${AWS_REGION:-us-east-1}"
LOCALSTACK_ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
BOOKING_VERBOSE="${BOOKING_VERBOSE:-1}"
BOOKING_POLL_INTERVAL_MS="${BOOKING_POLL_INTERVAL_MS:-1000}"
BOOKING_POLL_TIMEOUT_MS="${BOOKING_POLL_TIMEOUT_MS:-60000}"
CLEANUP="${CLEANUP:-1}"
INSTALL_DEPS="${INSTALL_DEPS:-auto}"

export AWS_REGION
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION}}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export LOCALSTACK_ENDPOINT

STACK_DEPLOYED=0

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

cleanup() {
  local status=$?
  set +e

  if [[ ${status} -ne 0 ]]; then
    docker compose logs --no-color localstack
  fi

  if [[ "${CLEANUP}" == "1" ]]; then
    if [[ ${STACK_DEPLOYED} -eq 1 ]]; then
      awslocal cloudformation delete-stack --stack-name "${STACK_NAME}" || true
      awslocal cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}" || true
    fi
    docker compose down -v || true
  else
    echo "CLEANUP=0 -> keeping LocalStack and stack '${STACK_NAME}'"
  fi

  exit "${status}"
}

trap cleanup EXIT

require_cmd docker
require_cmd npm
require_cmd samlocal
require_cmd awslocal

ensure_node_deps() {
  case "${INSTALL_DEPS}" in
    1|true|always)
      npm install --no-audit --no-fund
      ;;
    0|false|never)
      ;;
    auto)
      if ! node -e "import('@aws-sdk/client-dynamodb').then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1; then
        echo "Installing npm dependencies (missing @aws-sdk/client-dynamodb)..."
        npm install --no-audit --no-fund
      fi
      ;;
    *)
      echo "Invalid INSTALL_DEPS value: ${INSTALL_DEPS}. Use auto|always|never." >&2
      exit 1
      ;;
  esac
}

ensure_node_deps

docker compose up -d localstack

for _ in $(seq 1 40); do
  if awslocal sts get-caller-identity >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

if ! awslocal sts get-caller-identity >/dev/null 2>&1; then
  echo "LocalStack did not become ready in time" >&2
  exit 1
fi

samlocal build --template template.yaml
samlocal deploy \
  --stack-name "${STACK_NAME}" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset
STACK_DEPLOYED=1

API_ID="$(awslocal cloudformation describe-stack-resources \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id API \
  --query "StackResources[0].PhysicalResourceId" \
  --output text)"

if [[ -z "${API_ID}" || "${API_ID}" == "None" ]]; then
  echo "Failed to resolve API id from CloudFormation resources" >&2
  exit 1
fi

SEAT_TABLE="$(awslocal cloudformation describe-stack-resources \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id SeatCapacity \
  --query "StackResources[0].PhysicalResourceId" \
  --output text)"

if [[ -z "${SEAT_TABLE}" || "${SEAT_TABLE}" == "None" ]]; then
  echo "Failed to resolve SeatCapacity table name from CloudFormation resources" >&2
  exit 1
fi

awslocal dynamodb put-item \
  --table-name "${SEAT_TABLE}" \
  --item '{"id":{"S":"CAPACITY"},"totalSeats":{"N":"100"},"availableSeats":{"N":"100"}}' \
  --condition-expression "attribute_not_exists(id)" || true

BOOKING_API_BASE_URL="${LOCALSTACK_ENDPOINT}/restapis/${API_ID}/Prod/_user_request_"
SEAT_CAPACITY_TABLE_NAME="${SEAT_TABLE}"

BOOKING_API_BASE_URL="${BOOKING_API_BASE_URL}" \
SEAT_CAPACITY_TABLE_NAME="${SEAT_CAPACITY_TABLE_NAME}" \
BOOKING_VERBOSE="${BOOKING_VERBOSE}" \
BOOKING_POLL_INTERVAL_MS="${BOOKING_POLL_INTERVAL_MS}" \
BOOKING_POLL_TIMEOUT_MS="${BOOKING_POLL_TIMEOUT_MS}" \
npm run test:e2e:booking
