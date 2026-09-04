FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# PUBLIC_URL here is scoped to this build step only (not a persisted image ENV) — it just
# tells prebuild's generate-cert.ts to skip self-signed cert generation during the image
# build, since Fly doesn't inject the real FLY_APP_NAME until the container actually runs.
# The genuine runtime value comes from Fly at container start, independent of this line.
RUN PUBLIC_URL=build-time npm run build

ENV NODE_ENV=production
EXPOSE 8443

CMD ["npm", "run", "start"]
