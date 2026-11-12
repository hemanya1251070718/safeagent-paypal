FROM node:22-slim

WORKDIR /app

# Copy package manifests and lockfiles for deterministic resolution
COPY package.json ./
COPY shared/package*.json ./shared/
COPY gateway/package*.json ./gateway/
COPY agent/package*.json ./agent/
COPY payments/package*.json ./payments/
COPY client/package*.json ./client/

# Install dependencies in root and each package
RUN npm install --no-audit
RUN cd shared && npm install --no-audit
RUN cd gateway && npm install --no-audit
RUN cd agent && npm install --no-audit
RUN cd payments && npm install --no-audit
RUN cd client && npm install --no-audit

# Copy source trees and supervisor
COPY shared ./shared
COPY gateway ./gateway
COPY agent ./agent
COPY payments ./payments
COPY client ./client
COPY server.js ./

# Build backend packages
RUN cd shared && npm run build
RUN cd gateway && npm run build
RUN cd agent && npm run build
RUN cd payments && npm run build

# Build client React application with relative API URLs
ENV VITE_GATEWAY_URL=""
ENV VITE_AGENT_URL=""
ENV VITE_PAYMENTS_URL=""
ENV VITE_ALLOW_DIRECT_CAPTURE="false"
RUN cd client && npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
