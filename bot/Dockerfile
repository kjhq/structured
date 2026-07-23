FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc && npm prune --omit=dev

USER node
CMD ["node", "dist/index.js"]
