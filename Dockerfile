# Dockerfile for christosphere-community
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
# Ensure uploads directory exists
RUN mkdir -p /app/uploads
ENV NODE_ENV=production
EXPOSE 3000
CMD [ "node", "server.js" ]
