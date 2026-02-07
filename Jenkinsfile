// This pipeline requires a Jenkins agent with Docker access.
// Use the Dockerfile in jenkins-agent/ to build an agent with Docker CLI
// and mount /var/run/docker.sock for Docker-outside-of-Docker.
pipeline {
  agent {
    // Use agent with Docker access; falls back to any agent if not available
    label 'docker-builder || any'
  }

  options {
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    IMAGE_NAME = 'nettools-iplookup'
    IMAGE_TAG = "${env.BUILD_NUMBER}"
    SSH_CRED_ID = 'ssh-key-cicduser'
    PROD_SERVER_CRED = 'servername-app1'
    PROD_APPDIR_CRED = 'deploypath-nettools-iplookup'
    STAGING_SERVER_CRED = 'servername-app1'
    STAGING_APPDIR_CRED = 'deploypath-nettools-iplookup-sg'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Build Docker Image') {
      steps {
        script {
          env.DEPLOY_COMPOSE_FILE = (env.BRANCH_NAME == 'main') ? 'docker-compose.yml' : 'docker-compose.staging.yml'
        }
        sh '''
          set -euo pipefail
          echo "==> Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"
          docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" -t "${IMAGE_NAME}:latest" .
          echo "==> Saving image to tar"
          docker save "${IMAGE_NAME}:${IMAGE_TAG}" > "${IMAGE_NAME}-${IMAGE_TAG}.tar"
          ls -lh "${IMAGE_NAME}-${IMAGE_TAG}.tar"
        '''
      }
    }

    stage('Deploy') {
      when {
        anyOf {
          branch 'main'
          branch 'staging'
        }
      }
      steps {
        withCredentials([
          string(credentialsId: env.PROD_SERVER_CRED, variable: 'PROD_SERVER'),
          string(credentialsId: env.PROD_APPDIR_CRED, variable: 'PROD_APPDIR'),
          string(credentialsId: env.STAGING_SERVER_CRED, variable: 'STAGING_SERVER'),
          string(credentialsId: env.STAGING_APPDIR_CRED, variable: 'STAGING_APPDIR'),
          sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY_FILE', usernameVariable: 'SSH_USER_CRED')
        ]) {
          sh '''
            set -euo pipefail

            # Determine target based on branch
            if [ "$BRANCH_NAME" = "main" ]; then
              DEPLOY_SERVER="$PROD_SERVER"
              DEPLOY_APPDIR="$PROD_APPDIR"
              DEPLOY_TARGET="PRODUCTION"
            else
              DEPLOY_SERVER="$STAGING_SERVER"
              DEPLOY_APPDIR="$STAGING_APPDIR"
              DEPLOY_TARGET="STAGING"
            fi

            SSH_USER_TO_USE="${SSH_USER_CRED:-${SSH_USER:-}}"

            echo "==> Deploying to ${DEPLOY_TARGET}: ${DEPLOY_SERVER}:${DEPLOY_APPDIR}"

            # Transfer image and compose file to server
            echo "==> Transferring image tar to server"
            scp -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no \
              "${IMAGE_NAME}-${IMAGE_TAG}.tar" \
              "${SSH_USER_TO_USE}@${DEPLOY_SERVER}:${DEPLOY_APPDIR}/"

            # Deploy on remote server
            ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no \
              "${SSH_USER_TO_USE}@${DEPLOY_SERVER}" <<EOF
set -euo pipefail
cd "$DEPLOY_APPDIR"

echo "==> Loading Docker image"
docker load < "${IMAGE_NAME}-${IMAGE_TAG}.tar"
rm "${IMAGE_NAME}-${IMAGE_TAG}.tar"

echo "==> Pulling latest code"
git fetch --prune
git checkout "$BRANCH_NAME"
git reset --hard "origin/$BRANCH_NAME"

echo "==> Starting containers with ${DEPLOY_COMPOSE_FILE}"
if docker compose version >/dev/null 2>&1; then
  docker compose -f "$DEPLOY_COMPOSE_FILE" up -d --remove-orphans
else
  docker-compose -f "$DEPLOY_COMPOSE_FILE" up -d --remove-orphans
fi

echo "==> Cleaning up old images"
docker image prune -f || true
EOF
          '''
        }
      }
    }
  }

  post {
    always {
      sh '''
        # Clean up local image tar
        rm -f "${IMAGE_NAME}-${IMAGE_TAG}.tar" || true
        # Optionally clean up local images to save disk
        docker image rm -f "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:latest" 2>/dev/null || true
      '''
    }
    success {
      echo "Deployment succeeded for ${env.BRANCH_NAME}"
    }
    failure {
      echo "Deployment failed for ${env.BRANCH_NAME}"
    }
  }
}
