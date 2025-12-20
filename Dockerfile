FROM node:20.11.0-alpine3.19

# Update packages and install system dependencies for code execution
RUN apk update && apk upgrade && apk add --no-cache \
  python3 \
  py3-pip \
  openjdk11-jre \
  openjdk11-jdk \
  gcc \
  g++ \
  make \
  dotnet-sdk-6.0 \
  typescript

# Install Python packages
RUN pip3 install --no-cache-dir \
  numpy \
  pandas \
  matplotlib \
  requests

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Create temp directory for code execution
RUN mkdir -p temp && chmod 777 temp

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["npm", "start"]
