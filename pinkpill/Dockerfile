# PinkPill production image. Optional on Render (the Blueprint uses Render's native Node runtime);
# works on any container host. The app listens on $PORT, which the host provides (Render sets it).
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
USER node
# Documentation only; the real port is $PORT (default 3000 when unset).
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
