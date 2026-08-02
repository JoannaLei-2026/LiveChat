# Node.js 20 Alpine Base Image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Expose Node.js application port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
