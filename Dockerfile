# Stage 1: Build
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
# Use npm install instead of ci to tolerate potential lockfile name mismatches after renaming
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
# Copy build output to the root html folder since we are serving from root now
COPY --from=build /app/dist /usr/share/nginx/html
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
