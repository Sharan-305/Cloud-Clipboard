FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Ensure storage directories exist
RUN mkdir -p storage/uploads storage/temp_chunks

# Expose server port
EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["npm", "start"]
