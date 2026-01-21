# Stage 1: Build
FROM node:20-alpine as build
WORKDIR /app

# Accept secrets as build arguments
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GOOGLE_CLIENT_SECRET

# Expose arguments as environment variables for the build process
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_SECRET=$VITE_GOOGLE_CLIENT_SECRET

COPY package*.json ./
RUN npm install
COPY . .
# The build command will now use the environment variables
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
# Copy build output to the root html folder
COPY --from=build /app/dist /usr/share/nginx/html
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
