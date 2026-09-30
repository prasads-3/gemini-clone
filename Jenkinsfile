pipeline {

    agent {
        label 'built-in'
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        APP_NAME = 'gemini-clone'
        AWS_REGION = 'eu-west-1'
        AWS_DEFAULT_REGION = 'eu-west-1'
        AWS_ACCOUNT_ID = '064990711811'
        ECR_REPOSITORY = 'gemini-clone'
        ECR_REGISTRY = '064990711811.dkr.ecr.eu-west-1.amazonaws.com'
    }

    stages {

        stage('Clean Workspace') {
            steps {
                deleteDir()
            }
        }

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Toolchain Verification') {
            steps {
                sh '''
                    echo "========== TOOLCHAIN =========="

                    echo "Node:"
                    node --version

                    echo "NPM:"
                    npm --version

                    echo "Git:"
                    git --version

                    echo "Docker:"
                    docker --version

                    echo "AWS CLI:"
                    aws --version

                    echo "Trivy:"
                    trivy --version | head -n 1

                    echo "Gitleaks:"
                    gitleaks version

                    echo "Kubectl:"
                    kubectl version --client --output=yaml | head -n 8 || true

                    echo "Terraform:"
                    terraform version | head -n 1 || true

                    echo "Helm:"
                    helm version --short || true

                    echo "=============================="
                '''
            }
        }

        stage('Secret Scan - Gitleaks') {
            steps {
                sh '''
                    echo "Running Gitleaks..."

                    gitleaks detect \
                      --source . \
                      --no-git \
                      --redact \
                      --no-banner \
                      --exit-code 1

                    echo "Gitleaks PASSED"
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    echo "Installing dependencies..."
                    npm ci
                '''
            }
        }

        stage('TypeScript Validation') {
            steps {
                sh '''
                    echo "Running TypeScript validation..."

                    npx tsc --noEmit

                    echo "TypeScript validation PASSED"
                '''
            }
        }

        stage('Application Build') {
            steps {
                sh '''
                    echo "Building Next.js application..."

                    npm run build

                    echo "Next.js build PASSED"
                '''
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {

                    def scannerHome = tool 'SonarQube Scanner'

                    withSonarQubeEnv('sonar') {
                        sh """
                            echo "======================================"
                            echo "Running SonarQube Analysis"
                            echo "======================================"

                            ${scannerHome}/bin/sonar-scanner

                            echo "SonarQube analysis completed"
                        """
                    }
                }
            }
        }

        stage('Filesystem Security Scan - Trivy') {
            steps {
                sh '''
                    echo "Running Trivy filesystem scan..."

                    trivy fs \
                      --scanners vuln,secret,misconfig \
                      --severity HIGH,CRITICAL \
                      --exit-code 0 \
                      --format table \
                      .

                    echo "Trivy filesystem scan completed"
                '''
            }
        }

        stage('Docker Build') {
            steps {
                script {

                    def shortCommit = sh(
                        script: 'git rev-parse --short=7 HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${shortCommit}"
                    env.IMAGE_NAME = "${env.APP_NAME}:${env.IMAGE_TAG}"

                    echo "======================================"
                    echo "Docker Image Build"
                    echo "Image: ${env.IMAGE_NAME}"
                    echo "======================================"

                    sh """
                        docker build \
                          --pull \
                          -t ${env.IMAGE_NAME} \
                          .

                        echo "Docker build PASSED"

                        docker images ${env.APP_NAME}
                    """
                }
            }
        }

        stage('Container Smoke Test') {
            steps {
                script {

                    env.CONTAINER_NAME =
                        "${env.APP_NAME}-smoke-${env.BUILD_NUMBER}"

                    sh """
                        set -e

                        echo "======================================"
                        echo "Container Smoke Test"
                        echo "======================================"

                        docker rm -f ${env.CONTAINER_NAME} 2>/dev/null || true

                        docker run -d \
                            --name ${env.CONTAINER_NAME} \
                            -p 127.0.0.1:18080:3000 \
                            ${env.IMAGE_NAME}

                        echo "Container started"
                        echo "Waiting for application..."

                        for i in \$(seq 1 30); do

                            if curl -fsS \
                                http://127.0.0.1:18080/ \
                                > /dev/null; then

                                echo "Application is responding"
                                echo "Smoke test PASSED"
                                break
                            fi

                            echo "Attempt \$i/30: application not ready yet..."

                            sleep 2

                            if [ "\$i" -eq 30 ]; then

                                echo "Application failed to become ready"

                                echo "========== CONTAINER STATUS =========="

                                docker ps \
                                    --filter "name=${env.CONTAINER_NAME}" || true

                                echo "========== CONTAINER LOGS =========="

                                docker logs \
                                    ${env.CONTAINER_NAME} || true

                                exit 1
                            fi
                        done

                        echo "========== CONTAINER STATUS =========="

                        docker ps \
                            --filter "name=${env.CONTAINER_NAME}"

                        echo "========== CONTAINER LOGS =========="

                        docker logs \
                            --tail 30 \
                            ${env.CONTAINER_NAME}
                    """
                }
            }
        }

        stage('Container Security Scan - Trivy') {
            steps {
                sh '''
                    echo "======================================"
                    echo "Trivy Container Image Scan"
                    echo "======================================"

                    trivy image \
                      --severity HIGH,CRITICAL \
                      --exit-code 0 \
                      --format table \
                      "${IMAGE_NAME}"

                    echo "Trivy image scan completed"
                '''
            }
        }

        stage('Push Image to AWS ECR') {
            steps {
                script {

                    withCredentials([
                        [$class: 'AmazonWebServicesCredentialsBinding',
                         credentialsId: 'aws-ecr']
                    ]) {

                        env.ECR_IMAGE =
                            "${env.ECR_REGISTRY}/${env.ECR_REPOSITORY}:${env.IMAGE_TAG}"

                        sh '''
                            set -e

                            echo "======================================"
                            echo "AWS Identity"
                            echo "======================================"

                            aws sts get-caller-identity

                            echo "======================================"
                            echo "ECR Login"
                            echo "======================================"

                            aws ecr get-login-password \
                                --region "$AWS_REGION" | \
                            docker login \
                                --username AWS \
                                --password-stdin "$ECR_REGISTRY"

                            echo "ECR login successful"

                            echo "======================================"
                            echo "Tagging Docker Image"
                            echo "======================================"

                            docker tag \
                                "$IMAGE_NAME" \
                                "$ECR_IMAGE"

                            echo "Local Image:"
                            echo "$IMAGE_NAME"

                            echo "ECR Image:"
                            echo "$ECR_IMAGE"

                            echo "======================================"
                            echo "Pushing Image to ECR"
                            echo "======================================"

                            docker push "$ECR_IMAGE"

                            echo "======================================"
                            echo "ECR PUSH SUCCESS"
                            echo "======================================"
                        '''
                    }
                }
            }
        }
    }

    post {

        always {
            sh '''
                echo "Cleaning smoke-test container..."

                if [ -n "${CONTAINER_NAME}" ]; then
                    docker rm -f \
                        "${CONTAINER_NAME}" \
                        2>/dev/null || true
                fi

                echo "Post-build cleanup completed"
            '''
        }

        success {
            echo "=========================================="
            echo "CI + ECR PUSH PASSED"
            echo "=========================================="

            echo "Docker Image: ${env.IMAGE_NAME ?: 'N/A'}"
            echo "ECR Image: ${env.ECR_IMAGE ?: 'N/A'}"
        }

        failure {
            echo "=========================================="
            echo "CI / ECR PIPELINE FAILED"
            echo "=========================================="

            echo "Check the Jenkins console logs."
        }
    }
}
