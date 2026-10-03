FROM node:20-alpine AS build
WORKDIR /app
# Default to a SAME-ORIGIN path rather than an absolute host URL: the bundle is then
# valid on every origin this image is served from, and nginx.conf proxies /api/ to the
# `backend` service. See frontend/nginx.conf for the full reasoning.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
