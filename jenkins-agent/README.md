# Jenkins Agent with Docker Access

This Dockerfile creates a Jenkins agent that can build Docker images using the host's Docker daemon (Docker-outside-of-Docker approach).

## Building the Image

```bash
cd jenkins-agent
docker build -t jenkins-agent-docker:latest .
```

## Using with Jenkins

### Option 1: Docker Agent Template (Recommended)

In Jenkins **Manage Jenkins → Clouds → Docker (or Add a new cloud)**:

1. Add a Docker Agent template with:
   - **Docker Image**: `jenkins-agent-docker:latest` (or your registry path)
   - **Container Settings**:
     - **Volumes**: `/var/run/docker.sock:/var/run/docker.sock`
     - **Run in privileged mode**: Unchecked (not needed for DooD)

2. Add a label like `docker-builder` to this template

3. Update the Jenkinsfile:
   ```groovy
   agent {
     label 'docker-builder'
   }
   ```

### Option 2: Static Agent with Docker

Run the agent container manually on your Jenkins node:

```bash
docker run -d \
  --name jenkins-agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v jenkins-agent-home:/home/jenkins \
  -e JENKINS_URL=http://your-jenkins-server:8080 \
  -e JENKINS_SECRET=your-agent-secret \
  -e JENKINS_AGENT_NAME=agent-docker-1 \
  jenkins-agent-docker:latest
```

### Option 3: Docker Compose for Agent

```yaml
version: '3.8'
services:
  jenkins-agent:
    build: ./jenkins-agent
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - agent-home:/home/jenkins
    environment:
      - JENKINS_URL=${JENKINS_URL}
      - JENKINS_SECRET=${JENKINS_SECRET}
      - JENKINS_AGENT_NAME=${JENKINS_AGENT_NAME:-docker-agent-1}
    restart: unless-stopped

volumes:
  agent-home:
```

## How It Works

- The container has the Docker CLI installed
- The host's Docker socket (`/var/run/docker.sock`) is mounted into the container
- Commands like `docker build`, `docker save`, etc. are sent to the host's Docker daemon
- The `jenkins` user is added to the `docker` group for permissions

## Security Considerations

- This gives the Jenkins agent full access to the host's Docker daemon
- Any container can access any other container, volumes, etc. on the host
- Consider using Docker-in-Docker (DinD) for stronger isolation if needed
- In Kubernetes, consider using Kaniko or BuildKit for building images without Docker socket access
