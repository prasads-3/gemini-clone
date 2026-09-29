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

                    node --version
                    npm --version
                    git --version
                    docker --version
                    trivy --version | head -n 1
                    gitleaks version
                    kubectl version --client --output=yaml | head -n 8 || true
                    terraform version | head -n 1 || true
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
                    npm ci
                '''
            }
        }

        stage('TypeScript Validation') {
            steps {
                sh '''
                    npx tsc --noEmit
                '''
            }
        }

        stage('Application Build') {
            steps {
                sh '''
                    npm run build
                '''
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool 'SonarQube Scanner'

                    withSonarQubeEnv('sonar') {
                        sh """
                            echo "Running SonarQube analysis..."

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
                    trivy fs \
                      --scanners vuln,secret,misconfig \
                      --severity HIGH,CRITICAL \
                      --exit-code 0 \
                      --format table \
                      .
                '''
            }
        }

        stage('Docker Build') {
            steps {
                script {
                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(7)}"
                    env.IMAGE_NAME = "${env.APP_NAME}:${env.IMAGE_TAG}"

                    sh """
                        docker build \
                          --pull \
                          -t ${IMAGE_NAME} \
                          .

                        echo "Docker build PASSED"
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

                        docker rm -f ${CONTAINER_NAME} 2>/dev/null || true

                        docker run -d \
                            --name ${CONTAINER_NAME} \
                            -p 127.0.0.1:18080:3000 \
                            ${IMAGE_NAME}

                        echo "Waiting for application..."

                        for i in \$(seq 1 30); do
                            if curl -fsS http://127.0.0.1:18080/ > /dev/null; then
                                echo "Smoke test PASSED"
                                break
                            fi

                            echo "Attempt \$i/30..."
                            sleep 2

                            if [ "\$i" -eq 30 ]; then
                                docker logs ${CONTAINER_NAME} || true
                                exit 1
                            fi
                        done

                        docker ps --filter "name=${CONTAINER_NAME}"
                        docker logs --tail 30 ${CONTAINER_NAME}
                    """
                }
            }
        }

        stage('Container Security Scan - Trivy') {
            steps {
                sh '''
                    trivy image \
                      --severity HIGH,CRITICAL \
                      --exit-code 0 \
                      --format table \
                      "${IMAGE_NAME}"
                '''
            }
        }
    }

    post {

        always {
            sh '''
                if [ -n "${CONTAINER_NAME}" ]; then
                    docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true
                fi
            '''
        }

        success {
            mail(
                to: 'developerprasad479@gmail.com',
                subject: "SUCCESS: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                body: """
Hello,

Jenkins Build Successful.

Job Name     : ${env.JOB_NAME}
Build Number : ${env.BUILD_NUMBER}
Build URL    : ${env.BUILD_URL}

Pipeline:
- Gitleaks
- npm ci
- TypeScript
- Next.js Build
- SonarQube
- Trivy Filesystem
- Docker Build
- Container Smoke Test
- Trivy Image

Regards,
Jenkins
"""
            )
        }

        failure {
            mail(
                to: 'developerprasad479@gmail.com',
                subject: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                body: """
Hello,

Jenkins Build Failed.

Job Name     : ${env.JOB_NAME}
Build Number : ${env.BUILD_NUMBER}
Build URL    : ${env.BUILD_URL}

Please check the Jenkins console logs.

Regards,
Jenkins
"""
            )
        }
    }
}
