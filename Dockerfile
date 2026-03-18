# Use a stable Node.js image
FROM node:20-slim

# Install Pandoc, WeasyPrint (for PDF generation), and base fonts
RUN apt-get update && apt-get install -y \
    pandoc \
    weasyprint \
    fonts-liberation \
    fontconfig \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", ".mastra/output/index.mjs"]