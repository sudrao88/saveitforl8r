# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies from lockfile for deterministic builds
RUN npm ci --omit=dev

# Copy the rest of the application's code
COPY index.js .

# Run as non-root user for security
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
USER appuser

# Make port 8081 available to the world outside this container
EXPOSE 8081

# Define the command to run the app
CMD ["npm", "start"]
