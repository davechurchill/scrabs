# Use an official Node.js runtime as the base image.
# `20-alpine` keeps the image small while still supporting modern Node features.
FROM node:20-alpine

# Set the working directory inside the container.
# All following relative paths (COPY, RUN, CMD) are resolved from `/app`.
WORKDIR /app

# Copy only dependency manifest files first.
# This enables Docker layer caching: if app source changes but dependencies do not,
# Docker can reuse the `npm ci` layer and build faster.
COPY package.json package-lock.json ./

# Install production dependencies in a clean, reproducible way.
# - `npm ci` uses package-lock exactly (good for deterministic builds)
# - `--omit=dev` skips devDependencies to keep runtime image smaller
RUN npm ci --omit=dev

# Copy the rest of the project into the image.
# This happens after dependency install to maximize cache efficiency.
COPY . .

# Runtime environment variables used by the Node server.
# These defaults can be overridden at `docker run` time or by Docker Compose.
ENV PORT=3000
ENV MONGODB_URI=mongodb://mongo:27017/scrabs
ENV MONGODB_DB=scrabs

# Document that the container listens on port 3000.
# (This does not publish the port by itself; Compose `ports:` does that.)
EXPOSE 3000

# Default container startup command.
# Launches the app using the `start` script from package.json.
CMD ["npm", "start"]