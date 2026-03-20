# Stage 1: Build
FROM node:20-alpine as build
WORKDIR /app

# Accept secrets and config as build arguments
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GOOGLE_CLIENT_SECRET
ARG VITE_PROXY_URL

# Expose arguments as environment variables for the build process
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_SECRET=$VITE_GOOGLE_CLIENT_SECRET
ENV VITE_PROXY_URL=$VITE_PROXY_URL

COPY package*.json ./
RUN npm ci
COPY . .
# The build command will now use the environment variables
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
# Add .mjs MIME type to nginx's default mime.types so that ES module files
# (like the PDF.js worker) are served as application/javascript instead of
# application/octet-stream.  We inject it into the existing types {} block
# rather than using a server-level `types {}` override (which would replace
# ALL inherited MIME mappings).
RUN sed -i 's|application/javascript[[:space:]]*js;|application/javascript js mjs;|' /etc/nginx/mime.types
# Copy build output to the root html folder
COPY --from=build /app/dist /usr/share/nginx/html
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
