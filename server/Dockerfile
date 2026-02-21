# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application's code
COPY index.js .

# Make port 8081 available to the world outside this container
EXPOSE 8081

# Define the command to run the app
CMD ["npm", "start"]
